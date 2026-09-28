import { Injectable, BadRequestException, NotFoundException, ForbiddenException, forwardRef, Inject } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { ResultsService } from '../results/results.service';
import { resolveCandidateId } from '../../common/utils/candidate.util';

@Injectable()
export class ExamEngineService {
  constructor(
    private prisma: PrismaService,
    @Inject(forwardRef(() => ResultsService))
    private resultsService: ResultsService,
  ) {}

  async startSessionByUser(
    examId: string,
    userId: string,
    ipAddress: string,
    deviceFingerprint: string,
  ) {
    const candidateId = await resolveCandidateId(this.prisma, userId);
    return this.startSession(examId, candidateId, ipAddress, deviceFingerprint);
  }

  async startSession(examId: string, candidateId: string, ipAddress: string, deviceFingerprint: string) {
    const existing = await this.prisma.examSession.findFirst({
      where: { examId, candidateId, status: 'IN_PROGRESS' },
    });
    if (existing) {
      return this.getSessionState(existing.id, candidateId);
    }

    const registration = await this.prisma.examRegistration.findUnique({
      where: { examId_candidateId: { examId, candidateId } },
    });
    if (!registration) throw new BadRequestException('Not registered for this exam');

    const exam = await this.prisma.exam.findUnique({
      where: { id: examId },
      include: {
        sections: {
          include: {
            questions: {
              include: {
                question: {
                  include: { versions: { take: 1, orderBy: { versionNumber: 'desc' } } },
                },
              },
            },
          },
          orderBy: { orderIndex: 'asc' },
        },
      },
    });
    if (!exam) throw new NotFoundException('Exam not found');
    if (exam.status !== 'PUBLISHED') {
      throw new BadRequestException(
        'This test is not available yet. An administrator must publish it first.',
      );
    }

    const now = new Date();
    if (now < exam.startTime) throw new BadRequestException('Exam has not started yet');
    if (now > exam.endTime) throw new BadRequestException('Exam has ended');

    const settings = (exam.settings || {}) as Record<string, unknown>;
    const maxAttempts = typeof settings.maxAttempts === 'number' && settings.maxAttempts >= 1
      ? Math.floor(settings.maxAttempts)
      : 1;
    const completedAttempts = await this.prisma.examSession.count({
      where: {
        examId,
        candidateId,
        status: { in: ['SUBMITTED', 'AUTO_SUBMITTED'] },
      },
    });
    if (completedAttempts >= maxAttempts) {
      throw new BadRequestException('You have used all allowed attempts for this exam');
    }
    const durationMinutes = this.getDurationMinutes(settings, exam.startTime, exam.endTime);
    const initialRemaining = this.calculateTimeRemaining(
      { startedAt: now, timeRemainingSeconds: durationMinutes * 60 },
      durationMinutes,
      exam.endTime,
    );

    const session = await this.prisma.examSession.create({
      data: {
        examId,
        candidateId,
        registrationId: registration.id,
        status: 'IN_PROGRESS',
        startedAt: now,
        timeRemainingSeconds: initialRemaining,
        currentSectionId: exam.sections[0]?.id,
        ipAddress,
        deviceFingerprint,
      },
    });

    let questionOrder = exam.sections.flatMap((s) => s.questions.map((q) => q.questionId));
    if (settings.shuffleQuestions) {
      questionOrder = this.shuffle(questionOrder);
    }

    await this.prisma.examSession.update({
      where: { id: session.id },
      data: { questionOrder },
    });

    return this.getSessionState(session.id, candidateId);
  }

  async assertSessionOwner(sessionId: string, userId: string) {
    const candidateId = await resolveCandidateId(this.prisma, userId);
    const session = await this.prisma.examSession.findUnique({ where: { id: sessionId } });
    if (!session) throw new NotFoundException('Session not found');
    if (session.candidateId !== candidateId) {
      throw new ForbiddenException('Session does not belong to this candidate');
    }
    return { session, candidateId };
  }

  async getSessionState(sessionId: string, candidateId?: string) {
    const session = await this.prisma.examSession.findUnique({
      where: { id: sessionId },
      include: {
        exam: {
          include: {
            sections: {
              include: {
                questions: {
                  include: {
                    question: {
                      include: { versions: { take: 1, orderBy: { versionNumber: 'desc' } } },
                    },
                  },
                },
              },
              orderBy: { orderIndex: 'asc' },
            },
          },
        },
        responses: true,
      },
    });
    if (!session) throw new NotFoundException('Session not found');
    if (candidateId && session.candidateId !== candidateId) {
      throw new BadRequestException('Session does not belong to candidate');
    }

    const exam = session.exam;
    const durationMinutes = this.getDurationMinutes(exam?.settings, exam?.startTime, exam?.endTime);
    const timeRemaining = this.calculateTimeRemaining(session, durationMinutes, exam?.endTime);

    const questions = (session.questionOrder as string[] || []).map((qId) => {
      for (const section of exam?.sections || []) {
        const eq = section.questions.find((q) => q.questionId === qId);
        if (eq) {
          const version = eq.question.versions[0];
          return {
            id: eq.questionId,
            sectionId: section.id,
            type: eq.question.type,
            title: eq.question.title,
            content: version?.content,
            options: version?.options,
            marks: eq.marks ?? version?.marks,
            negativeMarks: eq.negativeMarks ?? version?.negativeMarks,
          };
        }
      }
      return null;
    }).filter(Boolean);

    return {
      sessionId: session.id,
      examId: session.examId,
      status: session.status,
      timeRemainingSeconds: timeRemaining,
      exam: {
        id: exam?.id,
        title: exam?.title,
        settings: exam?.settings,
        securityPolicy: exam?.securityPolicy,
      },
      riskScore: session.riskScore,
      questions,
      responses: session.responses.map((r) => ({
        questionId: r.questionId,
        answer: r.answer,
        markedForReview: r.markedForReview,
      })),
    };
  }

  async saveAnswer(
    sessionId: string,
    userId: string,
    questionId: string,
    answer: unknown,
    timeSpentSeconds: number,
    markedForReview = false,
  ) {
    const { session } = await this.assertSessionOwner(sessionId, userId);
    if (session.status !== 'IN_PROGRESS') {
      throw new BadRequestException('Session is not active');
    }

    return this.prisma.sessionResponse.upsert({
      where: { sessionId_questionId: { sessionId, questionId } },
      create: {
        sessionId,
        questionId,
        answer: answer as never,
        timeSpentSeconds,
        markedForReview,
        answeredAt: new Date(),
      },
      update: {
        answer: answer as never,
        timeSpentSeconds,
        markedForReview,
        answeredAt: new Date(),
      },
    });
  }

  async markForReview(sessionId: string, userId: string, questionId: string, marked: boolean) {
    await this.assertSessionOwner(sessionId, userId);
    const response = await this.prisma.sessionResponse.findUnique({
      where: { sessionId_questionId: { sessionId, questionId } },
    });
    if (response) {
      return this.prisma.sessionResponse.update({
        where: { id: response.id },
        data: { markedForReview: marked },
      });
    }
    return this.prisma.sessionResponse.create({
      data: { sessionId, questionId, markedForReview: marked, answer: Prisma.DbNull },
    });
  }

  private async persistPendingAnswers(
    sessionId: string,
    answers: {
      questionId: string;
      answer: unknown;
      timeSpentSeconds?: number;
      markedForReview?: boolean;
    }[],
  ) {
    for (const item of answers) {
      if (!item?.questionId || item.answer == null || item.answer === '') continue;
      const answer =
        typeof item.answer === 'object' && item.answer !== null && 'value' in (item.answer as object)
          ? item.answer
          : { value: item.answer };
      await this.prisma.sessionResponse.upsert({
        where: { sessionId_questionId: { sessionId, questionId: item.questionId } },
        create: {
          sessionId,
          questionId: item.questionId,
          answer: answer as never,
          timeSpentSeconds: item.timeSpentSeconds ?? 0,
          markedForReview: item.markedForReview ?? false,
          answeredAt: new Date(),
        },
        update: {
          answer: answer as never,
          timeSpentSeconds: item.timeSpentSeconds ?? 0,
          markedForReview: item.markedForReview ?? false,
          answeredAt: new Date(),
        },
      });
    }
  }

  async submitSession(
    sessionId: string,
    userId: string,
    pendingAnswers?: {
      questionId: string;
      answer: unknown;
      timeSpentSeconds?: number;
      markedForReview?: boolean;
    }[],
    options?: { auto?: boolean },
  ) {
    const { session } = await this.assertSessionOwner(sessionId, userId);
    if (session.status === 'SUBMITTED' || session.status === 'AUTO_SUBMITTED') {
      const result = await this.prisma.examResult.findUnique({ where: { sessionId } });
      if (result) return { session, result };
      throw new BadRequestException('Already submitted');
    }

    // Persist any client-side answers before closing the session (critical for time-up)
    if (pendingAnswers?.length) {
      await this.persistPendingAnswers(sessionId, pendingAnswers);
    }

    const updated = await this.prisma.examSession.update({
      where: { id: sessionId },
      data: {
        status: options?.auto ? 'AUTO_SUBMITTED' : 'SUBMITTED',
        submittedAt: new Date(),
        timeRemainingSeconds: 0,
      },
    });

    const result = await this.resultsService.evaluateSession(sessionId);
    return { session: updated, result };
  }

  async heartbeat(
    sessionId: string,
    userId: string,
    pendingAnswers?: {
      questionId: string;
      answer: unknown;
      timeSpentSeconds?: number;
      markedForReview?: boolean;
    }[],
  ) {
    const candidateId = await resolveCandidateId(this.prisma, userId);
    const session = await this.prisma.examSession.findUnique({
      where: { id: sessionId },
      include: { exam: { select: { settings: true, endTime: true } } },
    });
    if (!session) throw new NotFoundException('Session not found');
    if (session.candidateId !== candidateId) {
      throw new ForbiddenException('Session does not belong to this candidate');
    }
    if (session.status === 'PAUSED') {
      return {
        alive: true,
        paused: true,
        autoSubmitted: false,
        timeRemainingSeconds: session.timeRemainingSeconds ?? 0,
      };
    }

    if (session.status === 'TERMINATED') {
      return {
        alive: false,
        terminated: true,
        autoSubmitted: false,
        timeRemainingSeconds: 0,
      };
    }

    if (session.status !== 'IN_PROGRESS') {
      const result = await this.prisma.examResult.findUnique({ where: { sessionId } });
      return {
        alive: false,
        autoSubmitted: session.status === 'AUTO_SUBMITTED' || session.status === 'SUBMITTED',
        timeRemainingSeconds: 0,
        result: result ?? undefined,
      };
    }

    // Keep DB in sync with latest client answers during the exam
    if (pendingAnswers?.length) {
      await this.persistPendingAnswers(sessionId, pendingAnswers);
    }

    const durationMinutes = this.getDurationMinutes(session.exam?.settings, undefined, session.exam?.endTime);
    const timeRemaining = this.calculateTimeRemaining(session, durationMinutes, session.exam?.endTime);
    await this.prisma.examSession.update({
      where: { id: sessionId },
      data: { timeRemainingSeconds: timeRemaining },
    });

    if (timeRemaining <= 0) {
      const { result } = await this.submitSession(sessionId, userId, pendingAnswers, { auto: true });
      return { alive: false, autoSubmitted: true, timeRemainingSeconds: 0, result };
    }

    return { alive: true, autoSubmitted: false, timeRemainingSeconds: timeRemaining };
  }

  private getDurationMinutes(settings: unknown, startTime?: Date | null, endTime?: Date | null): number {
    const config = (settings || {}) as Record<string, unknown>;
    const configured = config.durationMinutes;
    if (typeof configured === 'number' && configured > 0) return configured;
    if (startTime && endTime) {
      const windowMinutes = Math.floor((endTime.getTime() - startTime.getTime()) / 60_000);
      if (windowMinutes > 0) return windowMinutes;
    }
    return 120;
  }

  private calculateTimeRemaining(
    session: { startedAt: Date | null; timeRemainingSeconds: number | null },
    durationMinutes: number,
    examEndTime?: Date | null,
  ): number {
    const fromDuration = this.calculateTimeRemainingFromDuration(session, durationMinutes);
    if (!examEndTime) return fromDuration;
    const untilWindowEnd = Math.floor((examEndTime.getTime() - Date.now()) / 1000);
    return Math.max(0, Math.min(fromDuration, untilWindowEnd));
  }

  private calculateTimeRemainingFromDuration(
    session: { startedAt: Date | null; timeRemainingSeconds: number | null },
    durationMinutes: number,
  ): number {
    const totalSeconds = durationMinutes * 60;
    if (!session.startedAt) return session.timeRemainingSeconds ?? totalSeconds;
    const elapsed = Math.floor((Date.now() - session.startedAt.getTime()) / 1000);
    return Math.max(0, totalSeconds - elapsed);
  }

  private shuffle<T>(array: T[]): T[] {
    const arr = [...array];
    for (let i = arr.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [arr[i], arr[j]] = [arr[j], arr[i]];
    }
    return arr;
  }
}
