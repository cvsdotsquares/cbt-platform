import { Injectable, NotFoundException, ConflictException, BadRequestException, ForbiddenException } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { Prisma, SyllabusProgressStatus } from '@prisma/client';
import {
  getTeacherBatchIds,
  getTeacherSubjectIdsForBatch,
  teacherHasBatchAccess,
  teacherHasSubjectAccess,
} from '../../common/utils/teacher-scope.util';

type BatchWriteData = {
  academicClassId: string;
  name: string;
  academicYear: string;
  isActive?: boolean;
};

@Injectable()
export class BatchesService {
  constructor(private prisma: PrismaService) {}

  async findAll(tenantId: string, teacherUserId?: string) {
    const batchIds = teacherUserId
      ? await getTeacherBatchIds(this.prisma, teacherUserId)
      : null;

    if (teacherUserId && (!batchIds || batchIds.length === 0)) {
      return [];
    }

    return this.prisma.batch.findMany({
      where: {
        tenantId,
        ...(batchIds ? { id: { in: batchIds } } : {}),
      },
      orderBy: { createdAt: 'desc' },
      include: {
        academicClass: true,
        _count: { select: { enrollments: true } },
        ...(teacherUserId
          ? {
              teacherAssignments: {
                where: { userId: teacherUserId },
                include: { subject: { select: { id: true, name: true, code: true } } },
              },
            }
          : {}),
      },
    });
  }

  async findOne(id: string, tenantId: string, teacherUserId?: string) {
    if (teacherUserId) {
      const allowed = await teacherHasBatchAccess(this.prisma, teacherUserId, id);
      if (!allowed) throw new ForbiddenException('You are not assigned to this class');
    }

    const batch = await this.prisma.batch.findFirst({
      where: { id, tenantId },
      include: {
        academicClass: { include: { subjects: true } },
        enrollments: {
          include: {
            candidate: {
              include: { user: { select: { firstName: true, lastName: true, email: true } } },
            },
          },
        },
        teacherAssignments: {
          include: { subject: true },
          ...(teacherUserId ? { where: { userId: teacherUserId } } : {}),
        },
      },
    });
    if (!batch) throw new NotFoundException('Batch not found');
    return batch;
  }

  private normalizeBatchInput(data: BatchWriteData): BatchWriteData {
    const name = data.name?.trim();
    const academicYear = data.academicYear?.trim();
    if (!name) throw new BadRequestException('Batch name is required');
    if (!academicYear) throw new BadRequestException('Academic year is required');
    if (!data.academicClassId) throw new BadRequestException('Class is required');
    return { ...data, name, academicYear };
  }

  private async assertBatchUnique(
    tenantId: string,
    data: Pick<BatchWriteData, 'name' | 'academicYear' | 'academicClassId'>,
    excludeId?: string,
  ) {
    const existing = await this.prisma.batch.findFirst({
      where: {
        tenantId,
        name: data.name,
        academicYear: data.academicYear,
        academicClassId: data.academicClassId,
        ...(excludeId ? { NOT: { id: excludeId } } : {}),
      },
      include: { academicClass: { select: { level: true } } },
    });
    if (existing) {
      throw new ConflictException(
        `A batch named "${data.name}" already exists for Class ${existing.academicClass.level} in ${data.academicYear}`,
      );
    }
  }

  private handleBatchWriteError(error: unknown): never {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
      throw new ConflictException('A batch with this name already exists for this class and academic year');
    }
    throw error;
  }

  async create(tenantId: string, data: BatchWriteData) {
    const normalized = this.normalizeBatchInput(data);
    await this.assertBatchUnique(tenantId, normalized);
    try {
      return await this.prisma.batch.create({
        data: { tenantId, ...normalized },
        include: { academicClass: true },
      });
    } catch (error) {
      this.handleBatchWriteError(error);
    }
  }

  async update(
    id: string,
    tenantId: string,
    data: Partial<BatchWriteData>,
  ) {
    const batch = await this.prisma.batch.findFirst({ where: { id, tenantId } });
    if (!batch) throw new NotFoundException('Batch not found');

    const next = this.normalizeBatchInput({
      academicClassId: data.academicClassId ?? batch.academicClassId,
      name: data.name ?? batch.name,
      academicYear: data.academicYear ?? batch.academicYear,
      isActive: data.isActive ?? batch.isActive,
    });

    await this.assertBatchUnique(tenantId, next, id);

    try {
      return await this.prisma.batch.update({
        where: { id },
        data: {
          name: next.name,
          academicYear: next.academicYear,
          academicClassId: next.academicClassId,
          ...(data.isActive !== undefined ? { isActive: data.isActive } : {}),
        },
        include: { academicClass: true },
      });
    } catch (error) {
      this.handleBatchWriteError(error);
    }
  }

  async remove(id: string, tenantId: string) {
    const batch = await this.prisma.batch.findFirst({
      where: { id, tenantId },
      include: {
        academicClass: { select: { name: true } },
        _count: { select: { enrollments: true } },
      },
    });
    if (!batch) throw new NotFoundException('Batch not found');

    await this.prisma.batch.delete({ where: { id } });

    return {
      deleted: true,
      id: batch.id,
      name: batch.name,
      className: batch.academicClass.name,
      studentsUnassigned: batch._count.enrollments,
    };
  }

  async enrollStudent(batchId: string, tenantId: string, candidateId: string, rollNumber?: string) {
    const batch = await this.prisma.batch.findFirst({ where: { id: batchId, tenantId } });
    if (!batch) throw new NotFoundException('Batch not found');

    const roll = rollNumber?.trim() || null;
    const existing = await this.prisma.batchEnrollment.findFirst({
      where: { candidateId, batchId },
    });
    if (existing) {
      return this.prisma.batchEnrollment.update({
        where: { id: existing.id },
        data: { rollNumber: roll },
      });
    }

    await this.prisma.batchEnrollment.deleteMany({ where: { candidateId } });
    return this.prisma.batchEnrollment.create({
      data: { batchId, candidateId, rollNumber: roll },
    });
  }

  async assignTeacher(
    batchId: string,
    tenantId: string,
    userId: string,
    subjectIdsInput: string | string[],
  ) {
    const batch = await this.prisma.batch.findFirst({
      where: { id: batchId, tenantId },
      include: { academicClass: { include: { subjects: true } } },
    });
    if (!batch) throw new NotFoundException('Batch not found');

    const subjectIds = [...new Set(
      (Array.isArray(subjectIdsInput) ? subjectIdsInput : [subjectIdsInput])
        .map((id) => id?.trim())
        .filter((id): id is string => !!id),
    )];
    if (!subjectIds.length) throw new BadRequestException('At least one subject is required');

    const classSubjectIds = new Set(batch.academicClass.subjects.map((s) => s.id));
    for (const subjectId of subjectIds) {
      if (!classSubjectIds.has(subjectId)) {
        throw new BadRequestException('Subject does not belong to this batch class');
      }
    }

    const user = await this.prisma.user.findFirst({ where: { id: userId, tenantId } });
    if (!user) throw new NotFoundException('Teacher user not found');

    const assignments = await Promise.all(
      subjectIds.map((subjectId) =>
        this.prisma.teacherAssignment.upsert({
          where: { userId_batchId_subjectId: { userId, batchId, subjectId } },
          update: {},
          create: { batchId, userId, subjectId },
          include: { subject: { select: { id: true, name: true, code: true } } },
        }),
      ),
    );

    return { count: assignments.length, assignments };
  }

  async removeTeacher(batchId: string, tenantId: string, assignmentId: string) {
    const batch = await this.prisma.batch.findFirst({ where: { id: batchId, tenantId } });
    if (!batch) throw new NotFoundException('Batch not found');

    const assignment = await this.prisma.teacherAssignment.findFirst({
      where: { id: assignmentId, batchId },
    });
    if (!assignment) throw new NotFoundException('Teacher assignment not found');

    await this.prisma.teacherAssignment.delete({ where: { id: assignmentId } });
    return { deleted: true };
  }

  async listTeacherAssignments(batchId: string, tenantId: string) {
    const batch = await this.prisma.batch.findFirst({ where: { id: batchId, tenantId } });
    if (!batch) throw new NotFoundException('Batch not found');

    const assignments = await this.prisma.teacherAssignment.findMany({
      where: { batchId },
      include: { subject: true },
      orderBy: { assignedAt: 'desc' },
    });

    const userIds = [...new Set(assignments.map((a) => a.userId))];
    const users = userIds.length
      ? await this.prisma.user.findMany({
          where: { id: { in: userIds }, tenantId },
          select: { id: true, firstName: true, lastName: true, email: true },
        })
      : [];
    const userMap = new Map(users.map((u) => [u.id, u]));

    return assignments.map((a) => ({
      ...a,
      user: userMap.get(a.userId) ?? null,
    }));
  }

  async listTeacherAssignmentsByUser(tenantId: string, userId?: string) {
    const assignments = await this.prisma.teacherAssignment.findMany({
      where: {
        ...(userId ? { userId } : {}),
        batch: { tenantId },
      },
      include: {
        subject: { select: { id: true, name: true, code: true } },
        batch: {
          select: {
            id: true,
            name: true,
            academicYear: true,
            academicClass: { select: { id: true, name: true, level: true } },
          },
        },
      },
      orderBy: { assignedAt: 'desc' },
    });

    const userIds = [...new Set(assignments.map((a) => a.userId))];
    const users = userIds.length
      ? await this.prisma.user.findMany({
          where: { id: { in: userIds }, tenantId },
          select: { id: true, firstName: true, lastName: true, email: true },
        })
      : [];
    const userMap = new Map(users.map((u) => [u.id, u]));

    return assignments.map((a) => ({
      ...a,
      user: userMap.get(a.userId) ?? null,
    }));
  }

  private async resolveSubjectIdFromProgress(
    chapterId?: string,
    topicId?: string,
  ): Promise<string | null> {
    if (chapterId) {
      const chapter = await this.prisma.chapter.findUnique({
        where: { id: chapterId },
        select: { book: { select: { subjectId: true } } },
      });
      return chapter?.book.subjectId ?? null;
    }
    if (topicId) {
      const topic = await this.prisma.syllabusTopic.findUnique({
        where: { id: topicId },
        select: { chapter: { select: { book: { select: { subjectId: true } } } } },
      });
      return topic?.chapter.book.subjectId ?? null;
    }
    return null;
  }

  /** Chapter IDs available from indexed uploads for this batch's class level. */
  private async resolveUploadedChapterIds(
    tenantId: string,
    classLevel: number,
    subjectId?: string,
  ): Promise<Set<string>> {
    const ids = new Set<string>();

    const materials = await this.prisma.studyMaterial.findMany({
      where: {
        tenantId,
        status: 'READY',
        academicClass: { level: classLevel },
        ...(subjectId ? { subjectId } : {}),
      },
      select: { id: true, chapterId: true, bookId: true },
    });

    for (const m of materials) {
      if (m.chapterId) ids.add(m.chapterId);
    }

    const bookIds = [...new Set(materials.filter((m) => m.bookId).map((m) => m.bookId!))];
    if (bookIds.length) {
      const bookChapters = await this.prisma.chapter.findMany({
        where: { bookId: { in: bookIds } },
        select: { id: true },
      });
      bookChapters.forEach((c) => ids.add(c.id));
    }

    const materialIds = materials.map((m) => m.id);
    if (materialIds.length) {
      const chunkChapters = await this.prisma.documentChunk.findMany({
        where: {
          materialId: { in: materialIds },
          chapterId: { not: null },
        },
        select: { chapterId: true },
        distinct: ['chapterId'],
      });
      chunkChapters.forEach((c) => { if (c.chapterId) ids.add(c.chapterId); });
    }

    return ids;
  }

  async getSyllabusProgress(
    batchId: string,
    tenantId: string,
    subjectId?: string,
    teacherUserId?: string,
  ) {
    if (teacherUserId) {
      const allowed = await teacherHasBatchAccess(this.prisma, teacherUserId, batchId);
      if (!allowed) throw new ForbiddenException('You are not assigned to this class');
    }

    const batch = await this.prisma.batch.findFirst({
      where: { id: batchId, tenantId },
      include: { academicClass: true },
    });
    if (!batch) throw new NotFoundException('Batch not found');

    let allowedSubjectIds: string[] | null = null;
    if (teacherUserId) {
      allowedSubjectIds = await getTeacherSubjectIdsForBatch(this.prisma, teacherUserId, batchId);
      if (!allowedSubjectIds.length) return [];
      if (subjectId && !allowedSubjectIds.includes(subjectId)) {
        throw new ForbiddenException('You are not assigned to this subject');
      }
    }

    const effectiveSubjectId = subjectId
      ?? (allowedSubjectIds?.length === 1 ? allowedSubjectIds[0] : undefined);

    const availableChapterIds = await this.resolveUploadedChapterIds(
      tenantId,
      batch.academicClass.level,
      effectiveSubjectId,
    );

    if (!availableChapterIds.size) {
      return [];
    }

    const chapters = await this.prisma.chapter.findMany({
      where: { id: { in: [...availableChapterIds] } },
      orderBy: { orderIndex: 'asc' },
      include: {
        topics: { orderBy: { orderIndex: 'asc' } },
        book: {
          include: {
            subject: {
              include: { academicClass: true },
            },
          },
        },
      },
    });

    const classLevel = batch.academicClass.level;
    const relevant = chapters.filter(
      (ch) => ch.book.subject.academicClass.level === classLevel,
    );

    const progress = await this.prisma.syllabusProgress.findMany({
      where: { batchId },
    });

    const progressMap = new Map(
      progress.map((p) => [`${p.chapterId || ''}:${p.topicId || ''}`, p]),
    );

    const bySubject = new Map<string, {
      subject: { id: string; name: string };
      chapters: typeof relevant;
    }>();

    for (const chapter of relevant) {
      const subject = chapter.book.subject;
      if (effectiveSubjectId && subject.id !== effectiveSubjectId) continue;
      if (allowedSubjectIds && !allowedSubjectIds.includes(subject.id)) continue;

      if (!bySubject.has(subject.id)) {
        bySubject.set(subject.id, { subject: { id: subject.id, name: subject.name }, chapters: [] });
      }

      bySubject.get(subject.id)!.chapters.push({
        ...chapter,
        status: progressMap.get(`${chapter.id}:`)?.status ?? 'NOT_STARTED',
        topics: chapter.topics.map((topic) => ({
          ...topic,
          status: progressMap.get(`:${topic.id}`)?.status
            ?? progressMap.get(`${chapter.id}:${topic.id}`)?.status
            ?? 'NOT_STARTED',
        })),
      } as typeof chapter & { status: string; topics: (typeof chapter.topics[0] & { status: string })[] });
    }

    return [...bySubject.values()]
      .map((entry) => ({
        subject: entry.subject,
        chapters: entry.chapters.sort((a, b) => a.number - b.number),
      }))
      .filter((entry) => entry.chapters.length > 0);
  }

  async updateSyllabusProgress(
    batchId: string,
    tenantId: string,
    data: { chapterId?: string; topicId?: string; status: SyllabusProgressStatus },
    updatedById: string,
    teacherUserId?: string,
  ) {
    const batch = await this.prisma.batch.findFirst({ where: { id: batchId, tenantId } });
    if (!batch) throw new NotFoundException('Batch not found');

    if (teacherUserId) {
      const subjectId = await this.resolveSubjectIdFromProgress(data.chapterId, data.topicId);
      if (!subjectId) throw new BadRequestException('Unable to resolve subject for progress update');
      const allowed = await teacherHasSubjectAccess(this.prisma, teacherUserId, batchId, subjectId);
      if (!allowed) throw new ForbiddenException('You can only update progress for your assigned subjects');
    }

    const existing = await this.prisma.syllabusProgress.findFirst({
      where: {
        batchId,
        chapterId: data.chapterId ?? null,
        topicId: data.topicId ?? null,
      },
    });

    if (existing) {
      return this.prisma.syllabusProgress.update({
        where: { id: existing.id },
        data: {
          status: data.status,
          completedAt: data.status === 'COMPLETED' ? new Date() : null,
          updatedById,
        },
      });
    }

    return this.prisma.syllabusProgress.create({
      data: {
        batchId,
        chapterId: data.chapterId,
        topicId: data.topicId,
        status: data.status,
        completedAt: data.status === 'COMPLETED' ? new Date() : null,
        updatedById,
      },
    });
  }

  async bulkUpdateChapterProgress(
    batchId: string,
    tenantId: string,
    chapterIds: string[],
    status: SyllabusProgressStatus,
    updatedById: string,
    teacherUserId?: string,
  ) {
    const results = [];
    for (const chapterId of chapterIds) {
      results.push(
        await this.updateSyllabusProgress(
          batchId,
          tenantId,
          { chapterId, status },
          updatedById,
          teacherUserId,
        ),
      );
    }
    return results;
  }
}
