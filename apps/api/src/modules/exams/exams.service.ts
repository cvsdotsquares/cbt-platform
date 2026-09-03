import { Injectable, NotFoundException, BadRequestException, ConflictException } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { ExamType } from '@prisma/client';
import { DEFAULT_EXAM_TIMEZONE, parseExamDateTime, validateExamSchedule } from '@cbt/shared';
import { resolveCandidateId } from '../../common/utils/candidate.util';
import { parsePage, parseLimit } from '../../common/utils/pagination.util';
import {
  CANDIDATE_VISIBLE_EXAM_STATUSES,
  assertExamVisibleToCandidate,
} from '../../common/utils/exam-visibility.util';
@Injectable()
export class ExamsService {
  constructor(private prisma: PrismaService) {}

  async assertTitleUnique(tenantId: string, title: string, excludeId?: string) {
    const normalized = title.trim();
    if (!normalized) {
      throw new BadRequestException('Test name is required');
    }
    const existing = await this.prisma.exam.findFirst({
      where: {
        tenantId,
        title: { equals: normalized, mode: 'insensitive' },
        ...(excludeId ? { NOT: { id: excludeId } } : {}),
      },
      select: { id: true, title: true },
    });
    if (existing) {
      throw new ConflictException(
        `A test named "${existing.title}" already exists. Choose a unique test name.`,
      );
    }
    return normalized;
  }

  async create(
    tenantId: string,
    userId: string,
    data: {
      title: string;
      code: string;
      type: ExamType;
      startTime: string;
      endTime: string;
      timezone?: string;
      settings?: Record<string, unknown>;
      securityPolicy?: Record<string, unknown>;
      sections?: { name: string; orderIndex: number; durationMinutes?: number }[];
    },
  ) {
    const title = await this.assertTitleUnique(tenantId, data.title);
    const timezone = data.timezone || DEFAULT_EXAM_TIMEZONE;
    const startTime = parseExamDateTime(data.startTime, timezone);
    const endTime = parseExamDateTime(data.endTime, timezone);
    const durationMinutes = typeof data.settings?.durationMinutes === 'number'
      ? data.settings.durationMinutes
      : null;
    const scheduleCheck = validateExamSchedule(startTime, endTime, durationMinutes, {
      disallowPastStart: true,
    });
    if (!scheduleCheck.ok) {
      throw new BadRequestException(scheduleCheck.message);
    }

    return this.prisma.exam.create({
      data: {
        tenantId,
        title,
        code: data.code,
        type: data.type,
        startTime,
        endTime,
        timezone,
        settings: (data.settings || {}) as never,
        securityPolicy: (data.securityPolicy || {}) as never,
        createdById: userId,
        sections: data.sections
          ? { create: data.sections }
          : undefined,
      },
      include: { sections: true },
    });
  }

  async findAll(tenantId: string, page?: unknown, limit?: unknown, createdById?: string) {
    const p = parsePage(page);
    const l = parseLimit(limit);
    const where = {
      tenantId,
      ...(createdById ? { createdById } : {}),
    };
    const [items, total] = await Promise.all([
      this.prisma.exam.findMany({
        where,
        include: {
          sections: {
            orderBy: { orderIndex: 'asc' },
            include: { _count: { select: { questions: true } } },
          },
          aiTestConfig: {
            include: {
              batch: { include: { academicClass: { select: { id: true, name: true, level: true } } } },
            },
          },
          _count: { select: { registrations: true, sessions: true, results: true } },
        },
        skip: (p - 1) * l,
        take: l,
        orderBy: { startTime: 'desc' },
      }),
      this.prisma.exam.count({ where }),
    ]);
    return { items, total, page: p, limit: l, totalPages: Math.ceil(total / l) };
  }
  async findOne(id: string, tenantId: string) {
    const exam = await this.prisma.exam.findFirst({
      where: { id, tenantId },
      include: {
        sections: {
          include: {
            questions: {
              include: {
                question: {
                  include: {
                    versions: { orderBy: { versionNumber: 'desc' }, take: 1 },
                  },
                },
              },
            },
          },
          orderBy: { orderIndex: 'asc' },
        },
        registrations: {
          include: {
            candidate: {
              include: { user: { select: { firstName: true, lastName: true, email: true } } },
            },
          },
        },
        aiTestConfig: {
          include: {
            batch: { include: { academicClass: true } },
          },
        },
      },
    });
    if (!exam) throw new NotFoundException('Exam not found');
    return exam;
  }

  async publish(id: string, tenantId: string) {
    const exam = await this.prisma.exam.findFirst({ where: { id, tenantId } });
    if (!exam) throw new NotFoundException('Exam not found');

    const [questionCount, registrationCount] = await Promise.all([
      this.prisma.examQuestion.count({ where: { examId: id } }),
      this.prisma.examRegistration.count({ where: { examId: id } }),
    ]);
    if (questionCount === 0) {
      throw new BadRequestException('Add at least one approved question before publishing');
    }
    if (registrationCount === 0) {
      throw new BadRequestException('Assign at least one candidate before publishing');
    }

    const examQuestionIds = (
      await this.prisma.examQuestion.findMany({
        where: { examId: id },
        select: { questionId: true },
      })
    ).map((eq) => eq.questionId);

    if (examQuestionIds.length) {
      await this.prisma.question.updateMany({
        where: { id: { in: examQuestionIds }, status: 'DRAFT' },
        data: { status: 'APPROVED' },
      });
    }

    return this.prisma.exam.update({
      where: { id },
      data: { status: 'PUBLISHED', publishedAt: new Date() },
    });
  }

  async updateSchedule(
    id: string,
    tenantId: string,
    data: { startTime: string; endTime: string; timezone?: string; durationMinutes?: number },
  ) {
    const exam = await this.prisma.exam.findFirst({ where: { id, tenantId } });
    if (!exam) throw new NotFoundException('Exam not found');
    if (exam.status === 'COMPLETED') {
      throw new BadRequestException('Cannot edit schedule of a completed exam');
    }

    const timezone = data.timezone || exam.timezone || DEFAULT_EXAM_TIMEZONE;
    const startTime = parseExamDateTime(data.startTime, timezone);
    const endTime = parseExamDateTime(data.endTime, timezone);
    const existingSettings = (exam.settings || {}) as Record<string, unknown>;
    const currentDuration = typeof existingSettings.durationMinutes === 'number'
      ? existingSettings.durationMinutes
      : null;
    const durationMinutes = typeof data.durationMinutes === 'number' && data.durationMinutes > 0
      ? Math.round(data.durationMinutes)
      : currentDuration;

    if (typeof data.durationMinutes === 'number' && data.durationMinutes <= 0) {
      throw new BadRequestException('Duration must be at least 1 minute.');
    }

    const scheduleCheck = validateExamSchedule(startTime, endTime, durationMinutes, {
      disallowPastStart: true,
    });
    if (!scheduleCheck.ok) {
      throw new BadRequestException(scheduleCheck.message);
    }

    return this.prisma.exam.update({
      where: { id },
      data: {
        startTime,
        endTime,
        timezone,
        ...(durationMinutes != null
          ? { settings: { ...existingSettings, durationMinutes } as never }
          : {}),
      },
    });
  }

  async assignCandidates(examId: string, tenantId: string, candidateIds: string[]) {
    const exam = await this.prisma.exam.findFirst({ where: { id: examId, tenantId } });
    if (!exam) throw new NotFoundException('Exam not found');

    const candidates = await this.prisma.candidate.findMany({
      where: { id: { in: candidateIds }, tenantId },
    });
    if (candidates.length !== candidateIds.length) {
      throw new BadRequestException('One or more candidates are invalid for this tenant');
    }

    const existing = await this.prisma.examRegistration.findMany({
      where: { examId, candidateId: { in: candidateIds } },
      select: { candidateId: true },
    });
    const existingIds = new Set(existing.map((r) => r.candidateId));
    const data = candidateIds
      .filter((candidateId) => !existingIds.has(candidateId))
      .map((candidateId) => ({ examId, candidateId }));
    if (!data.length) return { count: 0, skipped: candidateIds.length };
    const result = await this.prisma.examRegistration.createMany({ data });
    return { count: result.count, skipped: candidateIds.length - result.count };
  }

  /** Set exactly which candidates are registered — draft exams only. */
  async syncCandidates(examId: string, tenantId: string, candidateIds: string[]) {
    const exam = await this.prisma.exam.findFirst({ where: { id: examId, tenantId } });
    if (!exam) throw new NotFoundException('Exam not found');
    if (exam.status !== 'DRAFT') {
      throw new BadRequestException('Only draft exams can update student assignments');
    }

    const uniqueIds = [...new Set(candidateIds)];
    const aiConfig = await this.prisma.aiTestConfig.findUnique({ where: { examId } });

    if (aiConfig?.batchId) {
      const enrolled = await this.prisma.batchEnrollment.findMany({
        where: { batchId: aiConfig.batchId, candidateId: { in: uniqueIds } },
        select: { candidateId: true },
      });
      if (enrolled.length !== uniqueIds.length) {
        throw new BadRequestException('Students must belong to the batch linked to this test');
      }
    } else if (uniqueIds.length) {
      const candidates = await this.prisma.candidate.findMany({
        where: { id: { in: uniqueIds }, tenantId },
        select: { id: true },
      });
      if (candidates.length !== uniqueIds.length) {
        throw new BadRequestException('One or more students are invalid for this tenant');
      }
    }

    const existing = await this.prisma.examRegistration.findMany({ where: { examId } });
    const existingIds = new Set(existing.map((r) => r.candidateId));
    const targetIds = new Set(uniqueIds);

    const toRemove = existing.filter((r) => !targetIds.has(r.candidateId));
    for (const reg of toRemove) {
      const sessions = await this.prisma.examSession.count({ where: { registrationId: reg.id } });
      if (sessions > 0) {
        throw new BadRequestException('Cannot remove students who already started this exam');
      }
    }

    if (toRemove.length) {
      await this.prisma.examRegistration.deleteMany({
        where: { examId, candidateId: { in: toRemove.map((r) => r.candidateId) } },
      });
    }

    const toAdd = uniqueIds.filter((id) => !existingIds.has(id));
    if (toAdd.length) {
      await this.prisma.examRegistration.createMany({
        data: toAdd.map((candidateId) => ({ examId, candidateId })),
      });
    }

    return { assigned: uniqueIds.length, added: toAdd.length, removed: toRemove.length };
  }

  async addQuestions(
    examId: string,
    tenantId: string,
    userId: string,
    sectionId: string,
    questionIds: string[],
  ) {
    const section = await this.prisma.examSection.findFirst({
      where: { id: sectionId, exam: { id: examId, tenantId } },
    });
    if (!section) throw new NotFoundException('Section not found');

    const uniqueIds = [...new Set(questionIds)];
    const alreadyLinked = await this.prisma.examQuestion.findMany({
      where: { sectionId, questionId: { in: uniqueIds } },
      select: { questionId: true },
    });
    const linkedSet = new Set(alreadyLinked.map((q) => q.questionId));
    const newIds = uniqueIds.filter((id) => !linkedSet.has(id));

    if (!newIds.length) {
      return { added: 0, skipped: uniqueIds.length, exam: await this.findOne(examId, tenantId) };
    }

    const found = await this.prisma.question.findMany({
      where: { id: { in: newIds }, tenantId },
      include: { versions: { orderBy: { versionNumber: 'desc' }, take: 1 } },
    });
    if (found.length !== newIds.length) {
      throw new BadRequestException('One or more questions are invalid for this tenant');
    }

    const draftIds = found.filter((q) => q.status === 'DRAFT').map((q) => q.id);
    if (draftIds.length) {
      await this.prisma.question.updateMany({
        where: { id: { in: draftIds } },
        data: { status: 'APPROVED' },
      });
      for (const q of found.filter((item) => item.status === 'DRAFT')) {
        const version = q.versions[0];
        if (version) {
          await this.prisma.questionVersion.update({
            where: { id: version.id },
            data: { approvedById: userId, approvedAt: new Date() },
          });
          await this.prisma.question.update({
            where: { id: q.id },
            data: { currentVersionId: version.id },
          });
        }
      }
    }

    const orderBase = await this.prisma.examQuestion.count({ where: { sectionId } });
    await this.prisma.examQuestion.createMany({
      data: newIds.map((questionId, i) => ({
        examId,
        sectionId,
        questionId,
        orderIndex: orderBase + i + 1,
      })),
    });

    return {
      added: newIds.length,
      skipped: uniqueIds.length - newIds.length,
      exam: await this.findOne(examId, tenantId),
    };
  }

  async removeQuestion(examId: string, tenantId: string, questionId: string) {
    const exam = await this.prisma.exam.findFirst({ where: { id: examId, tenantId } });
    if (!exam) throw new NotFoundException('Exam not found');
    if (exam.status !== 'DRAFT') {
      throw new BadRequestException('Questions can only be removed while the exam is in draft');
    }

    const link = await this.prisma.examQuestion.findFirst({ where: { examId, questionId } });
    if (!link) throw new NotFoundException('Question is not on this exam');

    await this.prisma.examQuestion.delete({ where: { id: link.id } });
    return { removed: true, exam: await this.findOne(examId, tenantId) };
  }

  async remove(id: string, tenantId: string) {
    const exam = await this.prisma.exam.findFirst({
      where: { id, tenantId },
      include: { _count: { select: { sessions: true, results: true } } },
    });
    if (!exam) throw new NotFoundException('Exam not found');

    if (exam.status === 'COMPLETED') {
      throw new BadRequestException('Cannot delete a completed exam');
    }
    if (exam._count.results > 0) {
      throw new BadRequestException('Cannot delete: exam has candidate results on record');
    }
    if (exam._count.sessions > 0) {
      throw new BadRequestException('Cannot delete: candidates have started or submitted this exam');
    }

    await this.prisma.$transaction([
      this.prisma.examRegistration.deleteMany({ where: { examId: id } }),
      this.prisma.examQuestion.deleteMany({ where: { examId: id } }),
      this.prisma.examSection.deleteMany({ where: { examId: id } }),
      this.prisma.exam.delete({ where: { id } }),
    ]);

    return { deleted: true };
  }

  async getAvailableForCandidate(userId: string) {
    const candidateId = await resolveCandidateId(this.prisma, userId);
    return this.prisma.examRegistration.findMany({
      where: {
        candidateId,
        exam: { status: { in: [...CANDIDATE_VISIBLE_EXAM_STATUSES] } },
      },
      include: {
        exam: true,
        sessions: {
          where: { candidateId },
          orderBy: { createdAt: 'desc' },
          take: 1,
          select: { id: true, status: true, submittedAt: true },
        },
      },
      orderBy: { registeredAt: 'desc' },
    });
  }

  /** Safe exam metadata for candidates — no answers, registration required. */
  async getInstructionsForCandidate(examId: string, userId: string) {
    const candidateId = await resolveCandidateId(this.prisma, userId);
    const registration = await this.prisma.examRegistration.findUnique({
      where: { examId_candidateId: { examId, candidateId } },
      include: {
        exam: {
          select: {
            id: true,
            title: true,
            code: true,
            status: true,
            startTime: true,
            endTime: true,
            timezone: true,
            settings: true,
            securityPolicy: true,
          },
        },
        sessions: {
          where: { candidateId },
          orderBy: { createdAt: 'desc' },
          take: 1,
          select: { id: true, status: true },
        },
      },
    });
    if (!registration) throw new NotFoundException('Not registered for this exam');
    assertExamVisibleToCandidate(registration.exam.status);

    return {
      ...registration.exam,
      registration: {
        id: registration.id,
        sessions: registration.sessions,
      },
    };
  }
}
