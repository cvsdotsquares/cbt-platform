import { Injectable, Logger, BadRequestException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PrismaService } from '../../prisma/prisma.service';
import { CurriculumService, SyncedChapterRef } from '../curriculum/curriculum.service';
import { SyllabusExtractionService, ExtractedChapter } from './syllabus-extraction.service';
import { extractPdfText, type PdfExtractResult } from './pdf-text-extractor';
import { looksLikeSingleChapterPdf, isUnreadablePdfText, isInvalidChapterTitle } from './ncert-text-utils';
import { sanitizeTextForDb } from './text-sanitize';
import { StorageService } from '../../common/storage/storage.service';

export interface RetrievedChunk {
  id: string;
  content: string;
  materialId: string;
  chapterId?: string | null;
  topicId?: string | null;
  pageNumber?: number | null;
  score: number;
}

export interface StrictRetrieveParams {
  tenantId: string;
  query: string;
  academicClassId: string;
  subjectId: string;
  chapterIds: string[];
  topicIds?: string[];
  limit?: number;
}

@Injectable()
export class RagService {
  private readonly logger = new Logger(RagService.name);

  constructor(
    private prisma: PrismaService,
    private config: ConfigService,
    private curriculumService: CurriculumService,
    private syllabusExtraction: SyllabusExtractionService,
    private storage: StorageService,
  ) {}

  async embedText(text: string): Promise<number[]> {
    const apiKey = this.config.get<string>('OPENAI_API_KEY')?.trim();
    if (!apiKey) return this.hashEmbedding(text);

    const baseUrl = this.config.get('OPENAI_BASE_URL') || 'https://api.openai.com/v1';
    const model = this.config.get('OPENAI_EMBEDDING_MODEL') || 'text-embedding-3-small';

    const res = await fetch(`${baseUrl}/embeddings`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey}` },
      body: JSON.stringify({ model, input: text.slice(0, 8000) }),
    });

    if (!res.ok) {
      this.logger.warn(`Embedding API failed: ${res.status}`);
      return this.hashEmbedding(text);
    }

    const data = await res.json() as { data: { embedding: number[] }[] };
    return data.data[0]?.embedding ?? this.hashEmbedding(text);
  }

  private hashEmbedding(text: string): number[] {
    const dims = 128;
    const vec = new Array(dims).fill(0);
    for (let i = 0; i < text.length; i++) {
      vec[i % dims] += text.charCodeAt(i) / 255;
    }
    const norm = Math.sqrt(vec.reduce((s, v) => s + v * v, 0)) || 1;
    return vec.map((v) => v / norm);
  }

  cosineSimilarity(a: number[], b: number[]): number {
    if (!a.length || !b.length || a.length !== b.length) return 0;
    let dot = 0, na = 0, nb = 0;
    for (let i = 0; i < a.length; i++) {
      dot += a[i] * b[i];
      na += a[i] * a[i];
      nb += b[i] * b[i];
    }
    return dot / (Math.sqrt(na) * Math.sqrt(nb) || 1);
  }

  chunkText(text: string, chunkSize = 800, overlap = 100): string[] {
    const chunks: string[] = [];
    const cleaned = sanitizeTextForDb(text).replace(/\s+/g, ' ').trim();
    if (!cleaned) return [];

    let start = 0;
    while (start < cleaned.length) {
      const end = Math.min(start + chunkSize, cleaned.length);
      chunks.push(cleaned.slice(start, end));
      if (end >= cleaned.length) break;
      start = end - overlap;
    }
    return chunks;
  }

  /** Chapter IDs available for a subject based on indexed uploads (extracted from documents). */
  async getAvailableChapterIds(
    tenantId: string,
    academicClassId: string,
    subjectId?: string,
  ): Promise<Set<string>> {
    const cls = await this.prisma.academicClass.findUnique({
      where: { id: academicClassId },
      select: { level: true },
    });
    if (!cls) return new Set();

    const ids = new Set<string>();

    const materials = await this.prisma.studyMaterial.findMany({
      where: {
        tenantId,
        status: 'READY',
        academicClass: { level: cls.level },
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
      const chunks = await this.prisma.documentChunk.findMany({
        where: {
          materialId: { in: materialIds },
          chapterId: { not: null },
          ...(subjectId ? { subjectId } : {}),
        },
        select: { chapterId: true },
        distinct: ['chapterId'],
      });
      chunks.forEach((c) => { if (c.chapterId) ids.add(c.chapterId); });
    }

    return ids;
  }

  /** @deprecated use getAvailableChapterIds */
  async getUploadedChapterIds(
    tenantId: string,
    academicClassId: string,
    subjectId?: string,
  ): Promise<Set<string>> {
    return this.getAvailableChapterIds(tenantId, academicClassId, subjectId);
  }

  async hasFullBookUpload(
    tenantId: string,
    academicClassId: string,
    subjectId: string,
  ): Promise<boolean> {
    // READY full-book uploads keep chapterId null; single-chapter uploads link chapterId after indexing.
    const count = await this.prisma.studyMaterial.count({
      where: {
        tenantId,
        status: 'READY',
        academicClassId,
        subjectId,
        chapterId: null,
      },
    });
    return count > 0;
  }

  async indexMaterial(materialId: string): Promise<{ chunkCount: number; chaptersExtracted?: number }> {
    const material = await this.prisma.studyMaterial.findUnique({
      where: { id: materialId },
      include: {
        chapter: { include: { book: { include: { subject: true } } } },
        topic: true,
      },
    });
    if (!material) throw new Error('Material not found');

    if (!material.subjectId || !material.academicClassId) {
      throw new Error('Document must be tagged with Class and Subject before indexing');
    }

    await this.prisma.studyMaterial.update({
      where: { id: materialId },
      data: { status: 'INDEXING', errorMessage: null },
    });

    try {
      let text = '';
      let pdfLayout: Awaited<ReturnType<typeof extractPdfText>> | undefined;
      const buffer = await this.storage.readBuffer(material.fileUrl);
      const isPdf = material.mimeType === 'application/pdf'
        || material.fileName.toLowerCase().endsWith('.pdf');

      if (isPdf) {
        try {
          pdfLayout = await extractPdfText(buffer);
          text = pdfLayout.text;
        } catch (pdfErr) {
          this.logger.warn(`PDF layout extract failed for ${materialId}, falling back: ${pdfErr}`);
          try {
            // eslint-disable-next-line @typescript-eslint/no-require-imports
            const pdfParse = require('pdf-parse');
            const parsed = await pdfParse(buffer);
            text = parsed.text || '';
          } catch {
            text = '';
          }
        }
      } else {
        text = buffer.toString('utf-8');
      }

      if (!text.trim()) {
        throw new Error('No text content extracted from file');
      }
      text = sanitizeTextForDb(text);

      await this.prisma.documentChunk.deleteMany({ where: { materialId } });

      const isFullBook = this.inferFullBookScope(
        this.materialUploadScope(material),
        pdfLayout,
        text,
      );
      let bookId = material.bookId;

      if (!bookId) {
        const subject = await this.prisma.subject.findUnique({
          where: { id: material.subjectId },
          include: { books: { take: 1, orderBy: { orderIndex: 'asc' } } },
        });
        bookId = subject?.books[0]?.id ?? null;
        if (!bookId) {
          const book = await this.prisma.book.create({
            data: {
              subjectId: material.subjectId,
              title: material.title,
              publisher: 'Uploaded',
              isNcert: material.type === 'NCERT',
            },
          });
          bookId = book.id;
        }
      }

      if (isFullBook && bookId) {
        await this.prisma.book.update({
          where: { id: bookId },
          data: { title: material.title },
        });
      }

      const subjectMeta = await this.prisma.subject.findUnique({
        where: { id: material.subjectId },
        include: { academicClass: true },
      });

      let linkedChapterId = material.chapterId;
      if (isFullBook) {
        linkedChapterId = null;
        await this.prisma.studyMaterial.update({
          where: { id: materialId },
          data: { chapterId: null, topicId: null },
        });
      }

      const unreadableText = isUnreadablePdfText(text);

      const extracted = await this.syllabusExtraction.extractFromText(text, {
        singleChapter: !isFullBook,
        fallbackTitle: material.title,
        fileName: material.fileName,
        subjectName: subjectMeta?.name,
        subjectCode: subjectMeta?.code,
        classLevel: subjectMeta?.academicClass.level,
        pdfLayout,
      });

      if (!extracted.length) {
        throw new Error('Could not extract chapters from document. Check PDF has readable text.');
      }

      let syncedChapters: SyncedChapterRef[] = [];
      if (linkedChapterId && bookId && !isFullBook && extracted.length) {
        const single = extracted[0];
        if (!isInvalidChapterTitle(single.title)) {
          await this.prisma.chapter.update({
            where: { id: linkedChapterId },
            data: { title: single.title },
          });
        }
        syncedChapters = [
          await this.curriculumService.syncTopicsForChapter(
            linkedChapterId,
            single.topics,
            single.content,
          ),
        ];
        this.logger.log(`Updated topics for chapter ${linkedChapterId} from material ${materialId}`);
      } else if (bookId && extracted.length) {
        syncedChapters = await this.curriculumService.syncExtractedSyllabus(
          bookId,
          extracted,
          isFullBook,
        );
        this.logger.log(
          `Extracted ${syncedChapters.length} chapters for material ${materialId}: `
          + extracted.map((c) => `Ch${c.number} "${c.title}" (${c.topics.length} topics)`).join('; '),
        );
      }

      if (bookId) {
        const removed = await this.curriculumService.cleanupInvalidChapters(bookId);
        if (removed > 0) {
          this.logger.log(`Cleaned up ${removed} invalid chapter(s) for book ${bookId}`);
        }
      }

      if (!isFullBook && !linkedChapterId && syncedChapters.length) {
        linkedChapterId = syncedChapters[0].chapterId;
        await this.prisma.studyMaterial.update({
          where: { id: materialId },
          data: { chapterId: linkedChapterId, bookId, topicId: null },
        });
      } else if (material.topicId) {
        await this.prisma.studyMaterial.update({
          where: { id: materialId },
          data: { topicId: null },
        });
      }

      const subjectId = material.subjectId;
      const academicClassId = material.academicClassId;
      let chunkIndex = 0;

      if (syncedChapters.length && !unreadableText) {
        for (const synced of syncedChapters) {
          const source = extracted.find((e) => e.number === synced.number) ?? extracted[0];
          chunkIndex += await this.indexChapterContent({
            materialId,
            material,
            academicClassId,
            subjectId,
            chapterId: synced.chapterId,
            chapter: source,
            synced,
            chunkIndexStart: chunkIndex,
            scope: isFullBook ? 'FULL_BOOK' : 'CHAPTER',
            fallbackText: text,
          });
        }
      } else if (!unreadableText) {
        const chunks = this.chunkText(text);
        for (let i = 0; i < chunks.length; i++) {
          await this.saveChunk({
            materialId,
            material,
            content: chunks[i],
            chunkIndex: i,
            academicClassId,
            subjectId,
            chapterId: linkedChapterId,
            topicId: null,
            scope: isFullBook ? 'FULL_BOOK' : 'CHAPTER',
          });
        }
        chunkIndex = chunks.length;
      }

      await this.prisma.studyMaterial.update({
        where: { id: materialId },
        data: {
          status: 'READY',
          chunkCount: chunkIndex,
          indexedAt: new Date(),
          bookId,
          errorMessage: unreadableText
            ? 'Syllabus applied from NCERT catalog. PDF text is not readable for AI search — upload a text-based PDF for full indexing.'
            : null,
          ...(linkedChapterId && !material.chapterId ? { chapterId: linkedChapterId } : {}),
        },
      });

      return { chunkCount: chunkIndex, chaptersExtracted: syncedChapters.length || undefined };
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      await this.prisma.studyMaterial.updateMany({
        where: { id: materialId },
        data: { status: 'FAILED', errorMessage: msg.slice(0, 500) },
      });
      throw e;
    }
  }

  private async indexChapterContent(params: {
    materialId: string;
    material: { id: string; title: string; type: string; academicSession: string };
    academicClassId: string;
    subjectId: string;
    chapterId: string;
    chapter: ExtractedChapter;
    synced: SyncedChapterRef;
    chunkIndexStart: number;
    scope: string;
    fallbackText: string;
  }): Promise<number> {
    const startCount = params.chunkIndexStart;
    let chunkIndex = startCount;

    const textForChapter = params.chapter.content?.trim() || params.fallbackText;
    const topicEntries = params.synced.topics.length
      ? params.synced.topics.map((t, i) => ({
          topicId: t.topicId,
          content: params.chapter.topics[i]?.content?.trim() || textForChapter,
        }))
      : [{ topicId: null as string | null, content: textForChapter }];

    for (const entry of topicEntries) {
      const chunks = this.chunkText(entry.content);
      for (const content of chunks) {
        await this.saveChunk({
          materialId: params.materialId,
          material: params.material,
          content,
          chunkIndex: chunkIndex++,
          academicClassId: params.academicClassId,
          subjectId: params.subjectId,
          chapterId: params.chapterId,
          topicId: entry.topicId,
          scope: params.scope,
        });
      }
    }

    if (chunkIndex === startCount) {
      await this.saveChunk({
        materialId: params.materialId,
        material: params.material,
        content: textForChapter.slice(0, 800) || ' ',
        chunkIndex: chunkIndex++,
        academicClassId: params.academicClassId,
        subjectId: params.subjectId,
        chapterId: params.chapterId,
        topicId: null,
        scope: params.scope,
      });
    }

    return chunkIndex - startCount;
  }

  private async saveChunk(params: {
    materialId: string;
    material: { id: string; title: string; type: string; academicSession: string };
    content: string;
    chunkIndex: number;
    academicClassId: string;
    subjectId: string;
    chapterId?: string | null;
    topicId?: string | null;
    scope: string;
  }) {
    let topicId = params.topicId ?? null;
    if (topicId) {
      const topic = await this.prisma.syllabusTopic.findUnique({
        where: { id: topicId },
        select: { id: true },
      });
      if (!topic) topicId = null;
    }

    let chapterId = params.chapterId ?? null;
    if (chapterId) {
      const chapter = await this.prisma.chapter.findUnique({
        where: { id: chapterId },
        select: { id: true },
      });
      if (!chapter) chapterId = null;
    }

    const content = sanitizeTextForDb(params.content);
    if (!content.trim()) return;

    const embedding = await this.embedText(content);
    await this.prisma.documentChunk.create({
      data: {
        materialId: params.materialId,
        content,
        chunkIndex: params.chunkIndex,
        pageNumber: Math.floor(params.chunkIndex * 800 / 3000) + 1,
        tokenCount: Math.ceil(content.length / 4),
        embedding,
        academicClassId: params.academicClassId,
        subjectId: params.subjectId,
        chapterId,
        topicId,
        metadata: {
          source: sanitizeTextForDb(params.material.title),
          type: params.material.type,
          materialId: params.material.id,
          academicSession: sanitizeTextForDb(params.material.academicSession),
          scope: params.scope,
        },
      },
    });
  }

  /**
   * Retrieve ONLY from documents matching metadata filters.
   * Never searches the full knowledge base without class/subject/chapter filters.
   */
  async retrieveStrict(params: StrictRetrieveParams): Promise<RetrievedChunk[]> {
    if (!params.academicClassId || !params.subjectId) {
      throw new BadRequestException('Class and Subject are required for document retrieval');
    }
    if (!params.chapterIds?.length) {
      throw new BadRequestException('At least one chapter must be selected for retrieval');
    }

    const queryEmbedding = await this.embedText(params.query);
    const limit = params.limit ?? 12;

    const chunks = await this.prisma.documentChunk.findMany({
      where: {
        academicClassId: params.academicClassId,
        subjectId: params.subjectId,
        material: { tenantId: params.tenantId, status: 'READY' },
        OR: [
          { chapterId: { in: params.chapterIds } },
          // Full-book upload: chunks apply to any chapter in this subject
          { chapterId: null },
        ],
        ...(params.topicIds?.length ? { topicId: { in: params.topicIds } } : {}),
      },
      take: 400,
      select: {
        id: true,
        content: true,
        materialId: true,
        chapterId: true,
        topicId: true,
        pageNumber: true,
        embedding: true,
      },
    });

    if (!chunks.length) {
      return [];
    }

    return chunks
      .map((c) => {
        const emb = Array.isArray(c.embedding) ? (c.embedding as number[]) : [];
        return {
          id: c.id,
          content: c.content,
          materialId: c.materialId,
          chapterId: c.chapterId,
          topicId: c.topicId,
          pageNumber: c.pageNumber,
          score: this.cosineSimilarity(queryEmbedding, emb),
        };
      })
      .sort((a, b) => b.score - a.score)
      .slice(0, limit);
  }

  async getCompletedChapterIds(batchId: string): Promise<string[]> {
    const progress = await this.prisma.syllabusProgress.findMany({
      where: {
        batchId,
        status: { in: ['COMPLETED', 'IN_PROGRESS'] },
        chapterId: { not: null },
      },
      select: { chapterId: true },
    });
    return [...new Set(progress.map((p) => p.chapterId!).filter(Boolean))];
  }

  /** Studied chapters with uploaded docs only — for combined AI tests */
  async getStudiedChaptersBySubject(
    tenantId: string,
    batchId: string,
  ): Promise<{ subjectId: string; subjectName: string; chapterIds: string[] }[]> {
    const batch = await this.prisma.batch.findUnique({
      where: { id: batchId },
      include: {
        academicClass: {
          include: {
            subjects: {
              orderBy: { orderIndex: 'asc' },
              include: {
                books: { include: { chapters: { select: { id: true } } } },
              },
            },
          },
        },
      },
    });
    if (!batch) return [];

    const studied = new Set(await this.getCompletedChapterIds(batchId));
    const uploaded = await this.getUploadedChapterIds(tenantId, batch.academicClassId);
    const result: { subjectId: string; subjectName: string; chapterIds: string[] }[] = [];

    for (const subject of batch.academicClass.subjects) {
      const available = await this.getAvailableChapterIds(
        tenantId,
        batch.academicClassId,
        subject.id,
      );
      const chapterIds = subject.books
        .flatMap((b) => b.chapters.map((c) => c.id))
        .filter((id) => studied.has(id) && available.has(id));
      if (chapterIds.length) {
        result.push({ subjectId: subject.id, subjectName: subject.name, chapterIds });
      }
    }
    return result;
  }

  /** Read upload scope from material (supports pre-migration rows without isFullBook). */
  private materialUploadScope(material: {
    chapterId: string | null;
    fileName: string;
    isFullBook?: boolean;
  }): { isFullBook: boolean; chapterId: string | null; fileName: string } {
    const isFullBook = typeof material.isFullBook === 'boolean'
      ? material.isFullBook
      : material.chapterId === null;
    return { isFullBook, chapterId: material.chapterId, fileName: material.fileName };
  }

  /** Resolve full-book vs single-chapter scope (handles legacy uploads before isFullBook was stored). */
  private inferFullBookScope(
    material: { isFullBook: boolean; chapterId: string | null; fileName: string },
    pdfLayout?: PdfExtractResult,
    text?: string,
  ): boolean {
    if (material.isFullBook === false) return false;
    if (material.isFullBook) return true;
    if (material.chapterId) return false;
    if (text && looksLikeSingleChapterPdf(material.fileName, text)) return false;

    const tocLines = pdfLayout?.tocBlock?.split('\n') ?? [];
    const tocChapterEntries = tocLines.filter((l) => /^\d{1,2}\s*[.)]\s+\S/.test(l.trim())).length;
    if (tocChapterEntries >= 3) return true;

    const bodySample = (text ?? pdfLayout?.text ?? '').slice(0, 8000);
    const bodyChapterHeaders = (bodySample.match(/(?:^|\n)\s*(?:CHAPTER|Chapter)\s+\d+/gi) ?? []).length;
    if (bodyChapterHeaders >= 3) return true;

    if (tocChapterEntries <= 1 && bodyChapterHeaders <= 1) return false;

    return material.isFullBook;
  }
}
