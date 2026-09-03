import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import type { ExtractedChapter } from '../rag/syllabus-extraction.service';
import { isInvalidChapterTitle } from '../rag/ncert-text-utils';
import { sanitizeTextForDb } from '../rag/text-sanitize';

export interface SyncedChapterRef {
  number: number;
  chapterId: string;
  topics: { topicId: string; title: string; orderIndex: number }[];
}

@Injectable()
export class CurriculumService {
  private readonly logger = new Logger(CurriculumService.name);

  constructor(private prisma: PrismaService) {}

  async getClasses(tenantId?: string, allowedSubjectIds?: string[]) {
    const classes = await this.prisma.academicClass.findMany({
      where: tenantId ? { OR: [{ tenantId }, { tenantId: null }] } : undefined,
      orderBy: { level: 'asc' },
      include: {
        subjects: {
          ...(allowedSubjectIds
            ? { where: { id: { in: allowedSubjectIds } } }
            : {}),
          orderBy: { orderIndex: 'asc' },
          include: {
            books: {
              orderBy: { orderIndex: 'asc' },
              include: {
                chapters: {
                  orderBy: { orderIndex: 'asc' },
                  include: {
                    topics: { orderBy: { orderIndex: 'asc' } },
                  },
                },
              },
            },
          },
        },
      },
    });

    if (!allowedSubjectIds) return classes;
    return classes.filter((cls) => cls.subjects.length > 0);
  }

  async getClassTree(classId: string) {
    const cls = await this.prisma.academicClass.findUnique({
      where: { id: classId },
      include: {
        subjects: {
          orderBy: { orderIndex: 'asc' },
          include: {
            books: {
              orderBy: { orderIndex: 'asc' },
              include: {
                chapters: {
                  orderBy: { orderIndex: 'asc' },
                  include: {
                    topics: { orderBy: { orderIndex: 'asc' } },
                  },
                },
              },
            },
          },
        },
      },
    });
    if (!cls) throw new NotFoundException('Class not found');
    return cls;
  }

  async createClass(data: { tenantId?: string; level: number; name: string; description?: string }) {
    return this.prisma.academicClass.create({ data });
  }

  async createSubject(data: { academicClassId: string; name: string; code: string; description?: string }) {
    return this.prisma.subject.create({ data });
  }

  async createBook(data: { subjectId: string; title: string; publisher?: string; isNcert?: boolean }) {
    return this.prisma.book.create({
      data: { ...data, publisher: data.publisher ?? 'NCERT', isNcert: data.isNcert ?? true },
    });
  }

  async createChapter(data: { bookId: string; number: number; title: string; description?: string }) {
    return this.prisma.chapter.create({ data });
  }

  async createSyllabusTopic(data: { chapterId: string; title: string; description?: string }) {
    return this.prisma.syllabusTopic.create({ data });
  }

  async getSubjectChapters(subjectId: string) {
    const subject = await this.prisma.subject.findUnique({
      where: { id: subjectId },
      include: {
        books: {
          include: {
            chapters: {
              orderBy: { orderIndex: 'asc' },
              include: { topics: { orderBy: { orderIndex: 'asc' } } },
            },
          },
        },
      },
    });
    if (!subject) throw new NotFoundException('Subject not found');
    return subject;
  }

  /** Replace topics for one chapter from extracted PDF content. */
  async syncTopicsForChapter(
    chapterId: string,
    topics: ExtractedChapter['topics'],
    chapterContent: string,
  ): Promise<SyncedChapterRef> {
    const chapter = await this.prisma.chapter.findUnique({ where: { id: chapterId } });
    if (!chapter) throw new NotFoundException('Chapter not found');

    await this.clearChapterTopics(chapterId);

    const topicRefs: SyncedChapterRef['topics'] = [];
    const resolvedTopics = (topics.length
      ? topics
      : chapterContent.trim()
        ? [{ title: chapter.title, content: chapterContent, orderIndex: 0 }]
        : []).slice(0, 15);

    for (const [i, topic] of resolvedTopics.entries()) {
      const created = await this.prisma.syllabusTopic.create({
        data: {
          chapterId,
          title: sanitizeTextForDb(topic.title),
          description: topic.content ? sanitizeTextForDb(topic.content.slice(0, 500)) : null,
          orderIndex: topic.orderIndex ?? i,
        },
      });
      topicRefs.push({
        topicId: created.id,
        title: created.title,
        orderIndex: created.orderIndex,
      });
    }

    return { number: chapter.number, chapterId, topics: topicRefs };
  }

  /** Detach FK references so topics can be replaced without violating constraints. */
  private async clearChapterTopics(chapterId: string): Promise<void> {
    const existing = await this.prisma.syllabusTopic.findMany({
      where: { chapterId },
      select: { id: true },
    });
    if (!existing.length) return;

    const topicIds = existing.map((t) => t.id);
    await this.prisma.documentChunk.updateMany({
      where: { topicId: { in: topicIds } },
      data: { topicId: null },
    });
    await this.prisma.studyMaterial.updateMany({
      where: { topicId: { in: topicIds } },
      data: { topicId: null },
    });
    await this.prisma.syllabusTopic.deleteMany({ where: { chapterId } });
  }

  /** Upsert chapters parsed from an uploaded document (chapter headings only). */
  async syncExtractedSyllabus(
    bookId: string,
    chapters: ExtractedChapter[],
    replaceOrphans = false,
  ): Promise<SyncedChapterRef[]> {
    const refs: SyncedChapterRef[] = [];
    const numbers = chapters.map((c) => c.number);

    if (replaceOrphans && numbers.length) {
      const orphans = await this.prisma.chapter.findMany({
        where: { bookId, number: { notIn: numbers } },
        include: { _count: { select: { documentChunks: true, syllabusProgress: true } } },
      });
      for (const orphan of orphans) {
        if (orphan._count.documentChunks === 0 && orphan._count.syllabusProgress === 0) {
          await this.clearChapterTopics(orphan.id);
          await this.prisma.chapter.delete({ where: { id: orphan.id } });
        }
      }
    }

    for (const ch of chapters) {
      const chapter = await this.prisma.chapter.upsert({
        where: { bookId_number: { bookId, number: ch.number } },
        update: { title: sanitizeTextForDb(ch.title), orderIndex: ch.number - 1 },
        create: {
          bookId,
          number: ch.number,
          title: sanitizeTextForDb(ch.title),
          orderIndex: ch.number - 1,
        },
      });

      const synced = await this.syncTopicsForChapter(chapter.id, ch.topics, ch.content);
      refs.push({ number: ch.number, chapterId: chapter.id, topics: synced.topics });
    }

    return refs;
  }

  /**
   * Remove chapters with clearly invalid titles (e.g. "M ATHEMA TICS", "not polynomials.")
   * when they have no indexed content, progress, or linked uploads.
   */
  async cleanupInvalidChapters(bookId: string): Promise<number> {
    const chapters = await this.prisma.chapter.findMany({
      where: { bookId },
      include: {
        _count: {
          select: {
            documentChunks: true,
            syllabusProgress: true,
            materials: true,
          },
        },
      },
    });

    let removed = 0;
    for (const ch of chapters) {
      if (!isInvalidChapterTitle(ch.title)) continue;

      const { documentChunks, syllabusProgress, materials } = ch._count;
      if (documentChunks > 0 || syllabusProgress > 0 || materials > 0) {
        this.logger.warn(
          `Skipping cleanup of Ch.${ch.number} "${ch.title}" — has linked data`,
        );
        continue;
      }

      await this.clearChapterTopics(ch.id);
      await this.prisma.chapter.delete({ where: { id: ch.id } });
      this.logger.log(`Removed invalid chapter Ch.${ch.number}: "${ch.title}"`);
      removed++;
    }

    return removed;
  }

  /** Return only classes/subjects/chapters that have indexed uploads for this tenant. */
  async getClassesFromUploads(tenantId: string, allowedSubjectIds?: string[]) {
    const chapterIds = await this.getUploadedChapterIdsForTenant(tenantId, allowedSubjectIds);
    if (!chapterIds.size) return [];

    const classes = await this.getClasses(tenantId, allowedSubjectIds);
    return classes
      .map((cls) => ({
        ...cls,
        subjects: cls.subjects
          .map((subject) => ({
            ...subject,
            books: subject.books
              .map((book) => ({
                ...book,
                chapters: book.chapters
                  .filter((ch) => chapterIds.has(ch.id)),
              }))
              .filter((book) => book.chapters.length > 0),
          }))
          .filter((subject) => subject.books.some((b) => b.chapters.length > 0)),
      }))
      .filter((cls) => cls.subjects.length > 0);
  }

  async getUploadedChapterIdsForTenant(
    tenantId: string,
    allowedSubjectIds?: string[],
  ): Promise<Set<string>> {
    const ids = new Set<string>();

    if (allowedSubjectIds && allowedSubjectIds.length === 0) {
      return ids;
    }

    const materials = await this.prisma.studyMaterial.findMany({
      where: {
        tenantId,
        status: 'READY',
        ...(allowedSubjectIds ? { subjectId: { in: allowedSubjectIds } } : {}),
      },
      select: { id: true, chapterId: true, bookId: true, isFullBook: true },
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

    const fullBookIds = materials.filter((m) => m.isFullBook).map((m) => m.id);
    if (fullBookIds.length) {
      const chunks = await this.prisma.documentChunk.findMany({
        where: { materialId: { in: fullBookIds }, chapterId: { not: null } },
        select: { chapterId: true },
        distinct: ['chapterId'],
      });
      chunks.forEach((c) => { if (c.chapterId) ids.add(c.chapterId); });
    }

    return ids;
  }
}
