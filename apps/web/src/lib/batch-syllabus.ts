import { displayChapterTitle } from '@/lib/chapter-title';
import { sessionsMatch } from '@/lib/academic-session';

export type SyllabusChapterRow = {
  id: string;
  number: number;
  title: string;
  status: string;
  bookId?: string | null;
  topics?: { id: string; title: string; status?: string }[];
};

export type SyllabusSubjectRow = {
  subject: { id: string; name: string };
  chapters: SyllabusChapterRow[];
  materialStatuses?: Record<string, string>;
};

export type BatchMaterialRow = {
  id: string;
  title: string;
  fileName?: string;
  mimeType?: string;
  status: string;
  errorMessage?: string | null;
  type: string;
  academicSession?: string;
  isFullBook?: boolean;
  chapterId?: string | null;
  subjectId?: string | null;
  batchId?: string | null;
  batch?: { id: string; name: string } | null;
  bookId?: string | null;
  subject?: { id?: string; name: string } | null;
  academicClass?: { level: number } | null;
};

export type CurriculumBookChapter = {
  id: string;
  number: number;
  title: string;
  topics?: { id: string; title: string }[];
};

export type CurriculumBookRow = {
  id: string;
  title: string;
  chapters: CurriculumBookChapter[];
};

export type CurriculumClass = {
  id: string;
  level?: number;
  subjects: {
    id: string;
    name: string;
    books: {
      id: string;
      title: string;
      chapters: {
        id: string;
        number: number;
        title: string;
        topics?: { id: string; title: string }[];
      }[];
    }[];
  }[];
};

const NOTE_MATERIAL_TYPES = new Set([
  'TEACHER_NOTES',
  'INSTITUTE_NOTES',
  'WORKSHEET',
  'QUESTION_BANK',
]);

export function isNoteMaterial(m: BatchMaterialRow): boolean {
  if (NOTE_MATERIAL_TYPES.has(m.type)) return true;
  if (m.isFullBook === false) return true;
  return false;
}

export function isFullBookMaterial(m: BatchMaterialRow): boolean {
  if (m.isFullBook === false) return false;
  if (m.type === 'NCERT') return true;
  return !m.chapterId && !NOTE_MATERIAL_TYPES.has(m.type);
}

/**
 * Shared uploads (no batch) appear in every section.
 * Batch-tagged uploads also appear on sibling sections (same class level + session).
 */
export function materialVisibleForBatch(
  m: BatchMaterialRow,
  batchId: string | null | undefined,
  siblingBatchIds?: ReadonlySet<string>,
): boolean {
  const tagged = m.batchId ?? m.batch?.id ?? null;
  if (!tagged) return true;
  if (!batchId) return false;
  if (tagged === batchId) return true;
  if (siblingBatchIds?.has(tagged)) return true;
  return false;
}

/** NCERT books for a class are shared across all sections/batches of that class level. */
export function materialVisibleForClassSyllabus(
  m: BatchMaterialRow,
  classLevel: number,
  batchAcademicYear: string,
): boolean {
  if (m.academicClass?.level !== classLevel) return false;
  const batchTagged = m.batchId ?? m.batch?.id ?? null;
  if (isFullBookMaterial(m) && !batchTagged) {
    return true;
  }
  return sessionsMatch(m.academicSession, batchAcademicYear);
}

/** Match materials by subject id or subject name (duplicate subject rows per class). */
export function materialsForBatchSubject(
  materials: BatchMaterialRow[],
  subject: { id: string; name: string },
  classLevel?: number,
): BatchMaterialRow[] {
  const nameNorm = subject.name.trim().toLowerCase();
  return materials.filter((m) => {
    if (classLevel != null && m.academicClass?.level != null && m.academicClass.level !== classLevel) {
      return false;
    }
    const sid = m.subjectId ?? m.subject?.id;
    if (sid === subject.id) return true;
    const mName = (m.subject?.name ?? '').trim().toLowerCase();
    return Boolean(mName && mName === nameNorm);
  });
}

export function noteMaterialsForSubject(
  materials: BatchMaterialRow[],
  subjectId: string,
): BatchMaterialRow[] {
  return materials.filter(
    (m) => isNoteMaterial(m) && (m.subjectId ?? m.subject?.id) === subjectId,
  );
}

export function materialsForSubjectId(
  materials: BatchMaterialRow[],
  subjectId: string,
): BatchMaterialRow[] {
  return materials.filter((m) => (m.subjectId ?? m.subject?.id) === subjectId);
}

export function booksAndNotesMaterialsForSubject(
  materials: BatchMaterialRow[],
  subjectId: string,
  pinnedMaterialIds: string[],
): BatchMaterialRow[] {
  const forSubject = materialsForSubjectId(materials, subjectId);
  if (pinnedMaterialIds.length === 0) return [];
  const pinSet = new Set(pinnedMaterialIds);
  return forSubject.filter((m) => pinSet.has(m.id));
}

function normalizeBookTitle(value: string): string {
  return value.trim().toLowerCase().replace(/\.[^.]+$/, '').replace(/\s+/g, ' ');
}

function titleCaseToken(token: string): string {
  const t = token.trim();
  if (!t) return t;
  if (/^ncert$/i.test(t)) return 'NCERT';
  if (/^class$/i.test(t)) return 'Class';
  return t.charAt(0).toUpperCase() + t.slice(1).toLowerCase();
}

const GENERIC_SUBJECT_TOKENS = new Set([
  'english',
  'mathematics',
  'maths',
  'math',
  'science',
  'social',
  'social science',
  'hindi',
  'sanskrit',
  'physics',
  'chemistry',
  'biology',
]);

/** Heading for an institute upload on Classes & Batches (exact title from upload). */
export function formatUploadedMaterialHeading(materialTitle: string): string {
  return materialTitle.trim() || 'Uploaded book';
}

/** Display heading for catalog / untitled uploads (not the upload title line). */
export function formatBatchBookHeading(options: {
  materialTitle?: string;
  curriculumBookTitle?: string;
  subjectName: string;
  classLevel?: number;
}): string {
  const uploadTitle = (options.materialTitle || '').trim();
  if (uploadTitle) {
    return uploadTitle;
  }

  const raw = (options.curriculumBookTitle || '').trim();
  const subject = options.subjectName.trim() || 'Subject';
  const subjectKey = subject.toLowerCase();

  if (!raw) {
    return options.classLevel != null
      ? `NCERT ${subject} Class ${options.classLevel}`
      : `NCERT ${subject}`;
  }

  if (/^ncert\b/i.test(raw) && /\bclass\s*\d+/i.test(raw)) {
    return raw
      .replace(/\s+/g, ' ')
      .replace(/\bclass\s*(\d{1,2})\b/gi, (_, level: string) => `Class ${level}`);
  }

  const segments = raw
    .split(/[-–—|·,]+/)
    .map((part) => part.trim())
    .filter(Boolean);

  let level = options.classLevel;
  const bookNameParts: string[] = [];

  for (const part of segments) {
    const classMatch = part.match(/\bclass\s*(\d{1,2})\b/i);
    if (classMatch) {
      level ??= parseInt(classMatch[1], 10);
      continue;
    }
    if (/^\d{1,2}$/.test(part)) {
      level ??= parseInt(part, 10);
      continue;
    }
    const lower = part.toLowerCase();
    if (lower === subjectKey || GENERIC_SUBJECT_TOKENS.has(lower)) continue;
    bookNameParts.push(part);
  }

  let bookName = bookNameParts.map(titleCaseToken).join(' ').trim();
  if (!bookName && options.materialTitle?.trim()) {
    bookName = options.materialTitle
      .trim()
      .split(/\s+/)
      .map(titleCaseToken)
      .join(' ');
  }
  let heading = 'NCERT';
  if (bookName) heading += ` ${bookName}`;
  heading += ` ${subject}`;
  if (level != null) heading += ` Class ${level}`;
  return heading.replace(/\s+/g, ' ').trim();
}

export function findCurriculumBookForMaterial(
  material: BatchMaterialRow,
  books: CurriculumBookRow[],
): CurriculumBookRow | undefined {
  if (material.bookId) {
    return books.find((b) => b.id === material.bookId);
  }
  const mt = normalizeBookTitle(material.title);
  if (!mt) return undefined;
  return books.find((b) => {
    const bt = normalizeBookTitle(b.title);
    return bt === mt;
  });
}

export function fullBookMaterialsForSubject(
  materials: BatchMaterialRow[],
  subjectId: string,
): BatchMaterialRow[] {
  return materialsForSubjectId(materials, subjectId).filter(isFullBookMaterial);
}

export type BatchSubjectBookSection = {
  key: string;
  /** Section id for batch-only hide (material upload or catalog book). */
  hideKey: string;
  title: string;
  chapters: SyllabusChapterRow[];
  materialId?: string;
  bookId?: string | null;
  isUpload?: boolean;
  extractionFailed?: boolean;
};

export type BatchSubjectBookSectionOptions = {
  /** Classes & Batches: only show full-book uploads with PDF-extracted chapters. */
  uploadsOnly?: boolean;
};

export function batchSubjectBookSections(
  subject: SyllabusSubjectRow,
  materials: BatchMaterialRow[],
  curriculumBooks: CurriculumBookRow[],
  classLevel?: number,
  allCurriculumBooks?: CurriculumBookRow[],
  options?: BatchSubjectBookSectionOptions,
): BatchSubjectBookSection[] {
  const bookLookup = allCurriculumBooks ?? curriculumBooks;
  const headingFor = (
    materialTitle: string | undefined,
    curriculumBookTitle: string | undefined,
    materialLevel?: number,
  ) =>
    formatBatchBookHeading({
      materialTitle,
      curriculumBookTitle,
      subjectName: subject.subject.name,
      classLevel: materialLevel ?? classLevel,
    });

  const uploads = materialsForBatchSubject(materials, subject.subject, classLevel).filter(
    isFullBookMaterial,
  );
  const uploadBookIds = new Set(
    uploads.map((m) => m.bookId).filter(Boolean) as string[],
  );

  const uploadSections: BatchSubjectBookSection[] = uploads
    .map((m) => {
      const bookId = m.bookId ?? null;
      const book = bookId ? bookLookup.find((b) => b.id === bookId) : undefined;
      const chapters = chaptersForUploadedBook(subject.chapters, bookLookup, bookId, {
        preferSyncedFromUpload: true,
      });
      const displayTitle = m.title?.trim()
        ? formatUploadedMaterialHeading(m.title)
        : formatBatchBookHeading({
            curriculumBookTitle: book?.title,
            subjectName: subject.subject.name,
          });
      return {
        key: m.id,
        hideKey: `material:${m.id}`,
        title: displayTitle,
        chapters,
        materialId: m.id,
        bookId,
        isUpload: true,
      };
    })
    .filter((section) => section.chapters.length > 0 || section.isUpload);

  const uploadTitles = new Set(
    uploadSections.map((s) => s.title.trim().toLowerCase()),
  );

  if (options?.uploadsOnly) {
    return uploadSections;
  }

  const catalogSections = curriculumBooks
    .filter((book) => !uploadBookIds.has(book.id))
    .map((book) => ({
      key: book.id,
      hideKey: `book:${book.id}`,
      title: headingFor(undefined, book.title),
      chapters: chaptersForUploadedBook(subject.chapters, curriculumBooks, book.id),
      bookId: book.id,
      isUpload: false,
    }))
    .filter((section) => section.chapters.length > 0)
    .filter((section) => !uploadTitles.has(section.title.trim().toLowerCase()));

  if (uploadSections.length > 0) {
    return [...uploadSections, ...catalogSections];
  }
  return catalogSections;
}

/** Book accordions for Classes & Batches — uploads, catalog, then chapter grouping fallback. */
export function resolveBatchSubjectBookSections(
  subject: SyllabusSubjectRow,
  materials: BatchMaterialRow[],
  curriculumBooks: CurriculumBookRow[],
  options?: {
    classLevel?: number;
    allCurriculumBooks?: CurriculumBookRow[];
    hiddenKeys?: ReadonlySet<string>;
  },
): BatchSubjectBookSection[] {
  const { classLevel, allCurriculumBooks, hiddenKeys = new Set() } = options ?? {};
  const bookLookup = allCurriculumBooks?.length ? allCurriculumBooks : curriculumBooks;

  let sections = batchSubjectBookSections(
    subject,
    materials,
    curriculumBooks,
    classLevel,
    bookLookup,
    { uploadsOnly: true },
  );
  if (!sections.length) {
    sections = batchSubjectBookSections(
      subject,
      materials,
      curriculumBooks,
      classLevel,
      bookLookup,
      { uploadsOnly: false },
    );
  }

  if (!sections.length && subject.chapters.length > 0) {
    const byBook = new Map<string, SyllabusChapterRow[]>();
    for (const ch of subject.chapters) {
      const groupKey = ch.bookId ?? '__all__';
      if (!byBook.has(groupKey)) byBook.set(groupKey, []);
      byBook.get(groupKey)!.push(ch);
    }
    sections = [...byBook.entries()].map(([bookKey, chapters]) => {
      const sorted = [...chapters].sort((a, b) => a.number - b.number || a.title.localeCompare(b.title));
      const bookId = bookKey === '__all__' ? null : bookKey;
      const book = bookId ? bookLookup.find((b) => b.id === bookId) : undefined;
      const mat = bookId
        ? materials.find((m) => m.bookId === bookId)
        : materials.find((m) => isFullBookMaterial(m));
      return {
        key: mat?.id ?? bookId ?? `subject:${subject.subject.id}`,
        hideKey: mat ? `material:${mat.id}` : (bookId ? `book:${bookId}` : `subject:${subject.subject.id}`),
        title: (mat?.title?.trim() || book?.title || subject.subject.name),
        chapters: sorted,
        materialId: mat?.id,
        bookId,
        isUpload: Boolean(mat),
      };
    });
  }

  return sections.filter((section) => !hiddenKeys.has(section.hideKey));
}

/** Chapter ids visible on a batch syllabus tab (respects batch-only hidden books). */
export function batchSyllabusChapterIds(
  subjects: SyllabusSubjectRow[],
  materials: BatchMaterialRow[],
  curriculumClass: CurriculumClass | null | undefined,
  classLevel: number | undefined,
  hiddenKeys: ReadonlySet<string>,
): Set<string> {
  const ids = new Set<string>();
  if (!curriculumClass) return ids;
  for (const subject of subjects) {
    const curriculumBooks =
      curriculumClass.subjects.find((s) => s.id === subject.subject.id)?.books ?? [];
    const sections = batchSubjectBookSections(
      subject,
      materials,
      curriculumBooks,
      classLevel,
      undefined,
      { uploadsOnly: true },
    ).filter((section) => !hiddenKeys.has(section.hideKey));
    for (const section of sections) {
      for (const ch of section.chapters) {
        ids.add(ch.id);
      }
    }
  }
  return ids;
}

export function filterSubjectsForBatchSyllabusView(
  subjects: SyllabusSubjectRow[],
  allowedChapterIds: ReadonlySet<string>,
): SyllabusSubjectRow[] {
  if (!allowedChapterIds.size) {
    return subjects.map((s) => ({ ...s, chapters: [] }));
  }
  return subjects.map((s) => ({
    ...s,
    chapters: s.chapters.filter((c) => allowedChapterIds.has(c.id)),
  }));
}

export type MaterialChapterApiRow = {
  id: string;
  chapterNumber: number;
  title: string;
};

/** Chapters from GET /materials/:id/chapters merged with batch syllabus progress. */
export function syllabusRowsFromMaterialChapters(
  progressChapters: SyllabusChapterRow[],
  apiChapters: MaterialChapterApiRow[],
  bookId: string | null | undefined,
): SyllabusChapterRow[] {
  const statusById = new Map(progressChapters.map((c) => [c.id, c]));
  return [...apiChapters]
    .sort((a, b) => a.chapterNumber - b.chapterNumber || a.title.localeCompare(b.title))
    .map((ch) => {
      const fromProgress = statusById.get(ch.id);
      return {
        id: ch.id,
        number: ch.chapterNumber,
        title: displayChapterTitle(ch.title),
        bookId: bookId ?? fromProgress?.bookId ?? null,
        status: fromProgress?.status ?? 'NOT_STARTED',
        topics: fromProgress?.topics ?? [],
      };
    });
}

export function chaptersForUploadedBook(
  progressChapters: SyllabusChapterRow[],
  curriculumBooks: { id: string; chapters: CurriculumBookChapter[] }[],
  bookId: string | null | undefined,
  options?: { preferSyncedFromUpload?: boolean },
): SyllabusChapterRow[] {
  if (!bookId) return [];
  const statusById = new Map(progressChapters.map((c) => [c.id, c]));
  const book = curriculumBooks.find((b) => b.id === bookId);
  const catalogChapters = book?.chapters ?? [];
  const progressForBook = progressChapters.filter((c) => c.bookId === bookId);
  const progressAsCatalog = progressForBook.map((c) => ({
    id: c.id,
    number: c.number,
    title: displayChapterTitle(c.title),
    topics: c.topics?.map((t) => ({ id: t.id, title: t.title })),
  }));
  /** Uploaded books must not show another book's catalog chapters while extraction runs. */
  const source =
    progressForBook.length > 0
      ? progressAsCatalog
      : options?.preferSyncedFromUpload
        ? []
        : progressAsCatalog.length
          ? progressAsCatalog
          : catalogChapters;

  if (!source.length) return [];

  return [...source]
    .sort((a, b) => a.number - b.number || a.title.localeCompare(b.title))
    .map((ch) => {
      const fromProgress = statusById.get(ch.id);
      return {
        id: ch.id,
        number: ch.number,
        title: displayChapterTitle(ch.title),
        bookId,
        status: fromProgress?.status ?? 'NOT_STARTED',
        topics:
          fromProgress?.topics
          ?? ch.topics?.map((t) => ({ ...t, status: 'NOT_STARTED' }))
          ?? [],
      };
    });
}

export function syllabusChapterRowsForSubject(
  subject: SyllabusSubjectRow,
  materials: BatchMaterialRow[],
): SyllabusChapterRow[] {
  const noteChapterIds = new Set(
    noteMaterialsForSubject(materials, subject.subject.id)
      .map((m) => m.chapterId)
      .filter(Boolean) as string[],
  );
  return subject.chapters.filter((ch) => !noteChapterIds.has(ch.id));
}

export function subjectProgressStats(
  subject: SyllabusSubjectRow,
  materials: BatchMaterialRow[],
): { percent: number; studied: number; total: number; completed: number } {
  const notes = noteMaterialsForSubject(materials, subject.subject.id);
  const chapters = syllabusChapterRowsForSubject(subject, materials);
  const statuses = subject.materialStatuses ?? {};
  const chapterCompleted = chapters.filter((c) => c.status === 'COMPLETED').length;
  const chapterStudied = chapters.filter(
    (c) => c.status === 'COMPLETED' || c.status === 'IN_PROGRESS',
  ).length;
  const noteCompleted = notes.filter((n) => statuses[n.id] === 'COMPLETED').length;
  const total = chapters.length + notes.length;
  const completed = chapterCompleted + noteCompleted;
  const studied = chapterStudied + noteCompleted;
  return {
    percent: total ? Math.round((completed / total) * 100) : 0,
    studied,
    total,
    completed,
  };
}

const EMPTY_PROGRESS = { percent: 0, studied: 0, total: 0, completed: 0 };

export function subjectHasBatchUploads(
  batchMaterials: BatchMaterialRow[],
  subjectId: string,
): boolean {
  return materialsForSubjectId(batchMaterials, subjectId).length > 0;
}

/** Progress counts only after at least one upload exists for this subject on the batch. */
export function subjectProgressStatsForBatch(
  batchMaterials: BatchMaterialRow[],
  subject: SyllabusSubjectRow,
  syllabusMaterials: BatchMaterialRow[],
): { percent: number; studied: number; total: number; completed: number } {
  if (!subjectHasBatchUploads(batchMaterials, subject.subject.id)) {
    return EMPTY_PROGRESS;
  }
  return subjectProgressStats(subject, syllabusMaterials);
}

function sortChapters(chapters: SyllabusChapterRow[]): SyllabusChapterRow[] {
  return [...chapters].sort(
    (a, b) => a.number - b.number || a.title.localeCompare(b.title),
  );
}

export function mergeBatchSyllabus(
  progress: SyllabusSubjectRow[],
  curriculumClass: CurriculumClass | null | undefined,
  materials: BatchMaterialRow[],
): { subjects: SyllabusSubjectRow[]; materialsBySubject: Map<string, BatchMaterialRow[]> } {
  const progressBySubject = new Map(progress.map((r) => [r.subject.id, r]));
  const subjectMap = new Map<string, SyllabusSubjectRow>();
  const materialsBySubject = new Map<string, BatchMaterialRow[]>();

  const ensureSubject = (id: string, name: string): SyllabusSubjectRow => {
    if (!subjectMap.has(id)) {
      const fromProgress = progressBySubject.get(id);
      subjectMap.set(id, {
        subject: { id, name },
        chapters: fromProgress ? [...fromProgress.chapters] : [],
        materialStatuses: fromProgress?.materialStatuses
          ? { ...fromProgress.materialStatuses }
          : {},
      });
    }
    return subjectMap.get(id)!;
  };

  if (curriculumClass) {
    for (const subj of curriculumClass.subjects) {
      const row = ensureSubject(subj.id, subj.name);
      const chapterMap = new Map(row.chapters.map((c) => [c.id, c]));
      for (const book of subj.books) {
        for (const ch of book.chapters) {
          const fromProgress = progressBySubject
            .get(subj.id)
            ?.chapters.find((c) => c.id === ch.id);
          chapterMap.set(ch.id, {
            id: ch.id,
            bookId: book.id,
            number: ch.number,
            title: displayChapterTitle(ch.title),
            status: fromProgress?.status ?? 'NOT_STARTED',
            topics:
              fromProgress?.topics
              ?? ch.topics?.map((t) => ({ ...t, status: 'NOT_STARTED' }))
              ?? [],
          });
        }
      }
      row.chapters = sortChapters([...chapterMap.values()]);
    }
  }

  for (const row of progress) {
    const existing = ensureSubject(row.subject.id, row.subject.name);
    const chapterMap = new Map(existing.chapters.map((c) => [c.id, c]));
    for (const ch of row.chapters) {
      const prev = chapterMap.get(ch.id);
      chapterMap.set(ch.id, prev
        ? { ...prev, status: ch.status, topics: ch.topics ?? prev.topics }
        : ch);
    }
    existing.chapters = sortChapters([...chapterMap.values()]);
    if (row.materialStatuses) {
      existing.materialStatuses = { ...existing.materialStatuses, ...row.materialStatuses };
    }
  }

  for (const m of materials) {
    const sid = m.subjectId ?? m.subject?.id;
    if (!sid) continue;
    ensureSubject(sid, m.subject?.name ?? 'Subject');
    if (!materialsBySubject.has(sid)) materialsBySubject.set(sid, []);
    materialsBySubject.get(sid)!.push(m);
  }

  const subjects = [...subjectMap.values()]
    .filter(
      (s) => s.chapters.length > 0 || (materialsBySubject.get(s.subject.id)?.length ?? 0) > 0,
    )
    .sort((a, b) => a.subject.name.localeCompare(b.subject.name));

  return { subjects, materialsBySubject };
}
