import { Injectable, NotFoundException, BadRequestException, ForbiddenException } from '@nestjs/common';
import { Role, type JwtPayload } from '@cbt/shared';
import { PrismaService } from '../../prisma/prisma.service';
import { parsePage, parseLimit } from '../../common/utils/pagination.util';
import { LearningService } from '../learning/learning.service';
import { isTeacherScoped } from '../../common/utils/teacher-scope.util';
import { AiService } from '../ai/ai.service';
import { gradeSubjectiveByKeywords } from '../../common/utils/subjective-grading.util';

const RESULT_STAFF_ROLES: Role[] = [
  Role.SUPER_ADMIN,
  Role.ORG_ADMIN,
  Role.INSTITUTE_ADMIN,
  Role.EXAM_MANAGER,
  Role.TEACHER,
  Role.EVALUATOR,
  Role.AUDITOR,
];

@Injectable()
export class ResultsService {
  private readonly subjectiveTypes = ['SUBJECTIVE', 'CASE_STUDY', 'CODING', 'AUDIO', 'VIDEO'];
  private readonly manualGradeTypes = ['SUBJECTIVE', 'CASE_STUDY', 'CODING', 'AUDIO', 'VIDEO', 'MSQ'];

  constructor(
    private prisma: PrismaService,
    private learningService: LearningService,
    private aiService: AiService,
  ) {}

  /** Teachers may only manage results for exams they created. */
  async assertTeacherOwnsExam(examId: string, teacherUserId: string) {
    const exam = await this.prisma.exam.findUnique({
      where: { id: examId },
      select: { id: true, createdById: true },
    });
    if (!exam) throw new NotFoundException('Exam not found');
    if (exam.createdById !== teacherUserId) {
      throw new ForbiddenException('You can only manage results for class tests you created');
    }
    return exam;
  }

  async assertTeacherOwnsSession(sessionId: string, teacherUserId: string) {
    const session = await this.prisma.examSession.findUnique({
      where: { id: sessionId },
      select: { examId: true },
    });
    if (!session) throw new NotFoundException('Session not found');
    await this.assertTeacherOwnsExam(session.examId, teacherUserId);
    return session;
  }

  async evaluateSession(sessionId: string) {
    const session = await this.prisma.examSession.findUnique({
      where: { id: sessionId },
      include: {
        responses: { include: { question: { include: { versions: { take: 1, orderBy: { versionNumber: 'desc' } } } } } },
        exam: true,
      },
    });
    if (!session) throw new NotFoundException('Session not found');

    const examSettings = (session.exam.settings || {}) as Record<string, unknown>;
    const negativeMarkingEnabled = examSettings.negativeMarking === true;

    let totalScore = 0;
    let maxScore = 0;
    let hasUngraded = false;

    const examQuestions = await this.prisma.examQuestion.findMany({
      where: { examId: session.examId },
      include: { question: { include: { versions: { take: 1, orderBy: { versionNumber: 'desc' } } } } },
    });

    for (const eq of examQuestions) {
      const version = eq.question.versions[0];
      if (version) maxScore += version.marks;
    }

    for (const response of session.responses) {
      const version = response.question.versions[0];
      if (!version) continue;

      if (this.subjectiveTypes.includes(response.question.type)) {
        if (response.marksAwarded == null && response.answer) {
          const content = (version.content || {}) as { text?: string };
          const correct = (version.correctAnswer || {}) as { value?: unknown; rubric?: string };
          const candidate = this.normalizeAnswer(response.answer).join(' ') || '';

          const openEnded = ['SUBJECTIVE', 'CASE_STUDY'].includes(response.question.type);
          if (openEnded) {
            const keywordGrade = gradeSubjectiveByKeywords(
              candidate,
              version.correctAnswer,
              version.marks,
            );
            if (keywordGrade.marksAwarded != null) {
              await this.prisma.sessionResponse.update({
                where: { id: response.id },
                data: {
                  isCorrect: keywordGrade.isCorrect,
                  marksAwarded: keywordGrade.marksAwarded,
                },
              });
              totalScore += keywordGrade.marksAwarded;
              continue;
            }
          }

          try {
            const graded = await this.aiService.gradeSubjective({
              question: content.text || response.question.title || 'Question',
              referenceAnswer: correct.value == null ? undefined : String(correct.value),
              rubric: correct.rubric,
              answer: candidate,
              maxMarks: version.marks,
            });
            if (graded.source === 'openai') {
              await this.prisma.sessionResponse.update({
                where: { id: response.id },
                data: { isCorrect: graded.isCorrect, marksAwarded: graded.marksAwarded },
              });
              totalScore += graded.marksAwarded;
            } else {
              hasUngraded = true;
            }
          } catch {
            // Keep the response in manual review when the grading provider is unavailable.
            hasUngraded = true;
          }
        } else if (response.marksAwarded != null) {
          totalScore += response.marksAwarded;
        } else {
          hasUngraded = true;
        }
        continue;
      }

      if (response.marksAwarded != null && response.question.type === 'MSQ') {
        totalScore += response.marksAwarded;
        continue;
      }

      if (!version.correctAnswer || !response.answer) continue;

      const { isCorrect, marks } = this.gradeAnswer(
        response.question.type,
        version.correctAnswer,
        response.answer,
        version.marks,
        negativeMarkingEnabled ? (version.negativeMarks || 0) : 0,
      );
      totalScore += Math.max(marks, 0);

      await this.prisma.sessionResponse.update({
        where: { id: response.id },
        data: { isCorrect, marksAwarded: marks },
      });

      // Fire-and-forget mastery update — never block scoring on analytics failure
      this.learningService
        .recordAnswerMastery(session.candidateId, response.questionId, isCorrect)
        .catch(() => undefined);
    }

    const percentage = maxScore > 0 ? (totalScore / maxScore) * 100 : 0;
    return this.prisma.examResult.upsert({
      where: { sessionId },
      create: {
        sessionId,
        examId: session.examId,
        candidateId: session.candidateId,
        totalScore,
        maxScore,
        percentage,
        evaluationStatus: hasUngraded ? 'MANUAL_REVIEW' : 'AUTO_EVALUATED',
      },
      update: {
        totalScore,
        maxScore,
        percentage,
        evaluationStatus: hasUngraded ? 'MANUAL_REVIEW' : 'AUTO_EVALUATED',
      },
    });
  }

  async calculateRanks(examId: string) {
    const results = await this.prisma.examResult.findMany({
      where: { examId },
      orderBy: [{ totalScore: 'desc' }, { createdAt: 'asc' }],
    });

    const total = results.length;
    let currentRank = 0;
    let previousScore: number | null = null;

    for (let i = 0; i < results.length; i++) {
      const score = results[i].totalScore;
      if (previousScore === null || score < previousScore) {
        currentRank = i + 1;
        previousScore = score;
      }

      const percentile =
        total <= 1 ? 100 : ((total - currentRank) / (total - 1)) * 100;

      await this.prisma.examResult.update({
        where: { id: results[i].id },
        data: { rank: currentRank, percentile },
      });
    }

    return { examId, totalCandidates: total };
  }

  async publishResults(examId: string) {
    await this.calculateRanks(examId);
    await this.prisma.examResult.updateMany({
      where: { examId },
      data: { published: true, publishedAt: new Date(), evaluationStatus: 'PUBLISHED' },
    });
    return { examId, published: true };
  }

  async getExamResults(examId: string, page?: unknown, limit?: unknown) {
    const p = parsePage(page);
    const l = parseLimit(limit, 50);
    const [items, total] = await Promise.all([
      this.prisma.examResult.findMany({
        where: { examId },
        include: {
          candidate: {
            include: { user: { select: { firstName: true, lastName: true, email: true } } },
          },
        },
        orderBy: { totalScore: 'desc' },
        skip: (p - 1) * l,
        take: l,
      }),
      this.prisma.examResult.count({ where: { examId } }),
    ]);
    return { items, total, page: p, limit: l, totalPages: Math.ceil(total / l) };
  }

  private gradeAnswer(
    questionType: string,
    correctAnswer: unknown,
    givenAnswer: unknown,
    marks: number,
    negativeMarks: number,
  ): { isCorrect: boolean; marks: number } {
    const expected = this.normalizeAnswer(correctAnswer);
    const given = this.normalizeAnswer(givenAnswer);

    if (questionType === 'MSQ') {
      const expSet = new Set(expected);
      const givSet = new Set(given);
      const allCorrect = expected.every((a) => givSet.has(a));
      const noExtra = given.every((a) => expSet.has(a));
      const isCorrect = allCorrect && noExtra && expected.length > 0;
      if (isCorrect) return { isCorrect: true, marks };
      const partial = expected.filter((a) => givSet.has(a)).length;
      if (partial > 0 && !given.some((a) => !expSet.has(a))) {
        const partialMarks = (partial / expected.length) * marks;
        return { isCorrect: false, marks: partialMarks };
      }
      return { isCorrect: false, marks: -negativeMarks };
    }

    if (questionType === 'NUMERICAL') {
      const expNum = parseFloat(expected[0]);
      const givNum = parseFloat(given[0]);
      const isCorrect = !Number.isNaN(expNum) && !Number.isNaN(givNum)
        && Math.abs(expNum - givNum) < 0.001;
      return { isCorrect, marks: isCorrect ? marks : -negativeMarks };
    }

    if (['SUBJECTIVE', 'CASE_STUDY', 'CODING', 'AUDIO', 'VIDEO'].includes(questionType)) {
      return { isCorrect: false, marks: 0 };
    }

    const isCorrect = expected.length === 1 && given.length === 1 &&
      expected[0].toLowerCase() === given[0].toLowerCase();
    return { isCorrect, marks: isCorrect ? marks : -negativeMarks };
  }

  private normalizeAnswer(answer: unknown): string[] {
    if (!answer) return [];
    const raw = typeof answer === 'object' && answer !== null && 'value' in answer
      ? (answer as { value: unknown }).value
      : answer;
    if (Array.isArray(raw)) return raw.map(String);
    return [String(raw)];
  }

  async exportExamResultsCsv(examId: string) {
    const results = await this.prisma.examResult.findMany({
      where: { examId },
      include: {
        candidate: { include: { user: { select: { firstName: true, lastName: true, email: true } } } },
        exam: { select: { code: true, title: true } },
      },
      orderBy: [{ rank: 'asc' }, { totalScore: 'desc' }],
    });

    const header = 'Rank,Candidate Name,Email,Score,Max Score,Percentage,Status,Published\n';
    const rows = results.map((r) => [
      r.rank ?? '',
      `"${r.candidate.user.firstName} ${r.candidate.user.lastName}"`,
      r.candidate.user.email,
      r.totalScore,
      r.maxScore,
      r.percentage.toFixed(2),
      r.evaluationStatus,
      r.published ? 'Yes' : 'No',
    ].join(','));
    return header + rows.join('\n');
  }

  async getMyResults(userId: string) {
    const candidate = await this.prisma.candidate.findUnique({ where: { userId } });
    if (!candidate) return { items: [] };

    const items = await this.prisma.examResult.findMany({
      where: { candidateId: candidate.id, published: true },
      include: { exam: { select: { title: true, code: true, settings: true } } },
      orderBy: { createdAt: 'desc' },
    });

    const examIds = [...new Set(items.map((r) => r.examId))];
    const totals = await Promise.all(
      examIds.map(async (examId) => {
        const count = await this.prisma.examResult.count({
          where: { examId, published: true },
        });
        return [examId, count] as const;
      }),
    );
    const totalByExam = Object.fromEntries(totals);

    return {
      items: items.map((r) => ({
        ...r,
        totalCandidates: totalByExam[r.examId] ?? null,
      })),
    };
  }

  async getResultReview(user: JwtPayload, resultId: string) {
    const result = await this.prisma.examResult.findUnique({
      where: { id: resultId },
      include: {
        exam: { select: { id: true, title: true, code: true } },
        candidate: {
          include: { user: { select: { id: true, firstName: true, lastName: true } } },
        },
        session: { include: { responses: true } },
      },
    });
    if (!result) throw new NotFoundException('Result not found');

    const candidate = await this.prisma.candidate.findUnique({ where: { userId: user.sub } });
    const isOwner = !!candidate && candidate.id === result.candidateId;
    const isStaff = (user.roles ?? []).some((role) => RESULT_STAFF_ROLES.includes(role as Role));

    if (isOwner) {
      if (!result.published) {
        throw new ForbiddenException('Result is not published yet');
      }
    } else if (!isStaff) {
      throw new ForbiddenException('You cannot view this result');
    } else if (isTeacherScoped(user)) {
      await this.assertTeacherOwnsExam(result.examId, user.sub);
    }

    const examQuestions = await this.prisma.examQuestion.findMany({
      where: { examId: result.examId },
      include: {
        section: { select: { name: true, orderIndex: true } },
        question: {
          include: { versions: { take: 1, orderBy: { versionNumber: 'desc' } } },
        },
      },
      orderBy: [{ section: { orderIndex: 'asc' } }, { orderIndex: 'asc' }],
    });

    const responseByQuestion = new Map(
      result.session.responses.map((response) => [response.questionId, response]),
    );

    const questions = examQuestions.map((eq, index) => {
      const version = eq.question.versions[0];
      const response = responseByQuestion.get(eq.questionId);
      const content = (version?.content || {}) as { text?: string };
      const options = this.normalizeOptions(version?.options);
      const correctAnswer = this.normalizeAnswer(version?.correctAnswer);
      const candidateAnswer = this.normalizeAnswer(response?.answer);
      const answered = candidateAnswer.length > 0;
      const maxMarks = version?.marks ?? eq.marks ?? 0;
      let isCorrect = response?.isCorrect ?? null;
      if (isCorrect == null && answered) {
        isCorrect = this.inferIsCorrect(eq.question.type, candidateAnswer, correctAnswer);
      }
      let marksAwarded = response?.marksAwarded ?? null;
      const qtype = (eq.question.type || 'MCQ').toUpperCase();
      if (
        marksAwarded == null
        && answered
        && (qtype === 'SUBJECTIVE' || qtype === 'CASE_STUDY')
      ) {
        const keywordGrade = gradeSubjectiveByKeywords(
          candidateAnswer.join(' '),
          version?.correctAnswer,
          maxMarks,
        );
        if (keywordGrade.marksAwarded != null) {
          marksAwarded = keywordGrade.marksAwarded;
          isCorrect = keywordGrade.isCorrect;
        }
      }
      if (marksAwarded == null) {
        if (!answered) marksAwarded = 0;
        else if (isCorrect === true) marksAwarded = maxMarks;
        else if (isCorrect === false) marksAwarded = 0;
      }

      return {
        number: index + 1,
        questionId: eq.questionId,
        type: eq.question.type,
        title: eq.question.title ?? 'Question',
        text: content.text?.trim() || eq.question.title || 'Question',
        sectionName: eq.section.name,
        options,
        candidateAnswer,
        candidateAnswerLabel: this.formatAnswerLabel(candidateAnswer, options),
        correctAnswer,
        correctAnswerLabel: this.formatAnswerLabel(correctAnswer, options),
        isCorrect,
        marksAwarded,
        maxMarks,
        explanation: version?.explanation ?? null,
        answered,
      };
    });

    return {
      resultId: result.id,
      sessionId: result.sessionId,
      examTitle: result.exam.title,
      examCode: result.exam.code,
      candidateName: `${result.candidate.user.firstName} ${result.candidate.user.lastName}`,
      totalScore: result.totalScore,
      maxScore: result.maxScore,
      percentage: result.percentage,
      published: result.published,
      questions,
    };
  }

  private inferIsCorrect(
    questionType: string,
    given: string[],
    expected: string[],
  ): boolean | null {
    if (!given.length || !expected.length) return null;
    const qtype = (questionType || 'MCQ').toUpperCase();
    if (qtype === 'MSQ') {
      const expSet = new Set(expected.map((a) => a.toLowerCase()));
      const givSet = new Set(given.map((a) => a.toLowerCase()));
      return (
        expected.every((a) => givSet.has(a.toLowerCase()))
        && given.every((a) => expSet.has(a.toLowerCase()))
      );
    }
    if (qtype === 'NUMERICAL') {
      const expNum = Number(expected[0]);
      const givNum = Number(given[0]);
      if (Number.isNaN(expNum) || Number.isNaN(givNum)) return false;
      return Math.abs(expNum - givNum) < 0.001;
    }
    if (['SUBJECTIVE', 'CASE_STUDY', 'CODING', 'AUDIO', 'VIDEO'].includes(qtype)) {
      return null;
    }
    return given[0].trim().toLowerCase() === expected[0].trim().toLowerCase();
  }

  private normalizeOptions(options: unknown): Record<string, string> {
    if (!options || typeof options !== 'object') return {};
    const raw = options as Record<string, unknown>;
    const out: Record<string, string> = {};
    for (const key of ['a', 'b', 'c', 'd', 'A', 'B', 'C', 'D']) {
      const value = raw[key];
      if (value != null && String(value).trim()) {
        out[key.toLowerCase()] = String(value);
      }
    }
    return out;
  }

  private formatAnswerLabel(keys: string[], options: Record<string, string>): string {
    if (!keys.length) return 'Not answered';
    return keys
      .map((key) => {
        const normalized = key.trim().toLowerCase();
        const label = options[normalized];
        if (label) return `${normalized.toUpperCase()}. ${label}`;
        return key;
      })
      .join(', ');
  }

  async getCertificate(userId: string, resultId: string) {
    const candidate = await this.prisma.candidate.findUnique({ where: { userId } });
    if (!candidate) throw new NotFoundException('Candidate profile not found');

    const result = await this.prisma.examResult.findFirst({
      where: { id: resultId, candidateId: candidate.id, published: true },
      include: {
        exam: { select: { title: true, code: true, settings: true } },
        candidate: { include: { user: { select: { firstName: true, lastName: true, email: true } } } },
      },
    });
    if (!result) throw new NotFoundException('Published result not found');

    const totalCandidates = await this.prisma.examResult.count({
      where: { examId: result.examId, published: true },
    });
    const settings = (result.exam.settings || {}) as Record<string, unknown>;
    const passingScore = (settings.passingScore as number) ?? 40;
    if (result.percentage < passingScore) {
      throw new ForbiddenException(
        'Certificates are only available when you meet the exam pass score',
      );
    }

    return {
      certificateId: result.id,
      certificateNumber: `CERT-${result.exam.code}-${result.id.slice(0, 8).toUpperCase()}`,
      candidateName: `${result.candidate.user.firstName} ${result.candidate.user.lastName}`,
      candidateEmail: result.candidate.user.email,
      examTitle: result.exam.title,
      examCode: result.exam.code,
      totalScore: result.totalScore,
      maxScore: result.maxScore,
      percentage: result.percentage,
      passingScore,
      rank: result.rank,
      percentile: result.percentile,
      totalCandidates,
      issuedAt: result.publishedAt ?? result.createdAt,
      verificationUrl: `/verify/certificate/${result.id}`,
    };
  }

  async verifyCertificate(resultId: string) {
    const result = await this.prisma.examResult.findFirst({
      where: { id: resultId, published: true },
      include: {
        exam: { select: { title: true, code: true, settings: true } },
        candidate: { include: { user: { select: { firstName: true, lastName: true } } } },
      },
    });
    if (!result) throw new NotFoundException('Certificate not found or not published');

    const settings = (result.exam.settings || {}) as Record<string, unknown>;
    const passingScore = (settings.passingScore as number) ?? 40;

    return {
      valid: true,
      certificateId: result.id,
      certificateNumber: `CERT-${result.exam.code}-${result.id.slice(0, 8).toUpperCase()}`,
      candidateName: `${result.candidate.user.firstName} ${result.candidate.user.lastName}`,
      examTitle: result.exam.title,
      examCode: result.exam.code,
      totalScore: result.totalScore,
      maxScore: result.maxScore,
      percentage: result.percentage,
      passingScore,
      passed: result.percentage >= passingScore,
      rank: result.rank,
      issuedAt: result.publishedAt ?? result.createdAt,
    };
  }

  async getSubjectiveResponses(examId: string) {
    return this.prisma.sessionResponse.findMany({
      where: {
        session: { examId, status: { in: ['SUBMITTED', 'AUTO_SUBMITTED'] } },
        question: { type: { in: this.subjectiveTypes as never } },
      },
      include: {
        question: {
          include: { versions: { take: 1, orderBy: { versionNumber: 'desc' } } },
        },
        session: {
          include: {
            candidate: {
              include: { user: { select: { firstName: true, lastName: true, email: true } } },
            },
          },
        },
      },
      orderBy: { updatedAt: 'asc' },
    });
  }

  async gradeResponse(sessionId: string, questionId: string, marksAwarded: number) {
    const response = await this.prisma.sessionResponse.findUnique({
      where: { sessionId_questionId: { sessionId, questionId } },
      include: { question: true },
    });
    if (!response) throw new NotFoundException('Response not found');
    if (!this.manualGradeTypes.includes(response.question.type)) {
      throw new BadRequestException('This question type cannot be manually graded');
    }

    const version = await this.prisma.questionVersion.findFirst({
      where: { questionId },
      orderBy: { versionNumber: 'desc' },
    });
    const maxMarks = version?.marks ?? 0;
    if (marksAwarded < 0 || marksAwarded > maxMarks) {
      throw new BadRequestException(`Marks must be between 0 and ${maxMarks}`);
    }

    await this.prisma.sessionResponse.update({
      where: { sessionId_questionId: { sessionId, questionId } },
      data: {
        marksAwarded,
        isCorrect: marksAwarded >= maxMarks,
      },
    });

    return this.evaluateSession(sessionId);
  }
}
