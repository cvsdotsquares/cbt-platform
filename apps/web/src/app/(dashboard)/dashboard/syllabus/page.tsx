'use client';

import { useMemo, useState } from 'react';
import {
  MATERIALS_INDEX_POLL_MS,
  materialsNeedLivePoll,
} from '@/lib/materials-indexing-poll';
import { useMaterialIndexingSync } from '@/hooks/use-material-indexing-sync';
import Link from 'next/link';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { PageHeader } from '@/components/layout/page-header';
import { HorizontalTabScroller } from '@/components/layout/horizontal-tab-scroller';
import { EmptyState } from '@/components/layout/data-table';
import { curriculumApi, materialsApi } from '@/lib/api';
import { useRequireAuth } from '@/hooks/use-auth';
import { TableSkeleton } from '@/components/ui/skeleton';
import { cn } from '@/lib/utils';
import { displayChapterTitle } from '@/lib/chapter-title';
import { toast } from '@/hooks/use-toast';
import {
  BookOpen, ChevronDown, ChevronRight, Upload, GraduationCap,
  Library, Sparkles, Eye, Download, Loader2, Trash2,
} from 'lucide-react';
import { useAuthStore } from '@/stores/auth-store';
import { isTeacherOnly, normalizeRoles } from '@/lib/roles';
import { usePermissions } from '@/hooks/use-permissions';
import { Permission } from '@cbt/shared';
import { guessSubjectId } from '@/lib/subject-guess';

type Topic = { id: string; title: string };
type Chapter = { id: string; number: number; title: string; topics: Topic[] };
type Book = { id: string; title: string; chapters: Chapter[] };
type Subject = { id: string; name: string; code: string; books: Book[] };
type AcademicClass = {
  id: string;
  level: number;
  name: string;
  subjects: Subject[];
};

type MaterialItem = {
  id: string;
  title: string;
  fileName: string;
  fileSize: number;
  status: string;
  subjectId?: string | null;
  subject?: { id?: string; name: string; code: string } | null;
  academicClass?: { level: number; name: string } | null;
  chapter?: { title: string; number: number } | null;
};

const NCERT_LEVELS = [9, 10, 11, 12] as const;

/** Idle subject row — tints for light mode; translucent tints in dark (avoid white boxes + invisible badge text). */
const SUBJECT_IDLE_ICON: Record<string, string> = {
  MATH: 'border-0 bg-[#EEF2FF] text-[#4F46E5] dark:bg-indigo-500/20 dark:text-indigo-300',
  SCI: 'border-0 bg-[#ECFDF5] text-[#059669] dark:bg-emerald-500/20 dark:text-emerald-300',
  SST: 'border-0 bg-[#FFF7ED] text-[#C2410C] dark:bg-orange-500/20 dark:text-orange-300',
  ENG: 'border-0 bg-[#F3EDF7] text-[#7D49AF] dark:bg-violet-500/20 dark:text-violet-300',
  PHY: 'border-0 bg-[#F0F9FF] text-[#0284C7] dark:bg-sky-500/20 dark:text-sky-300',
  CHEM: 'border-0 bg-[#FFF1F2] text-[#E11D48] dark:bg-rose-500/20 dark:text-rose-300',
  BIO: 'border-0 bg-[#F7FEE7] text-[#65A30D] dark:bg-lime-500/20 dark:text-lime-300',
};

const SUBJECT_IDLE_BADGE: Record<string, string> = {
  MATH: 'border-0 bg-[#E0E7FF] text-[#4F46E5] dark:bg-indigo-500/25 dark:text-indigo-200',
  SCI: 'border-0 bg-[#D1FAE5] text-[#059669] dark:bg-emerald-500/25 dark:text-emerald-200',
  SST: 'border-0 bg-[#FFEDD5] text-[#C2410C] dark:bg-orange-500/25 dark:text-orange-200',
  ENG: 'border-0 bg-[#FCEFE8] text-[#7D49AF] dark:bg-violet-500/25 dark:text-violet-200',
  PHY: 'border-0 bg-[#E0F2FE] text-[#0284C7] dark:bg-sky-500/25 dark:text-sky-200',
  CHEM: 'border-0 bg-[#FFE4E6] text-[#E11D48] dark:bg-rose-500/25 dark:text-rose-200',
  BIO: 'border-0 bg-[#ECFCCB] text-[#65A30D] dark:bg-lime-500/25 dark:text-lime-200',
};

function subjectIdleIcon(code: string) {
  return SUBJECT_IDLE_ICON[code] ?? 'border-0 bg-primary/10 text-primary dark:bg-primary/20 dark:text-primary-foreground';
}

function subjectIdleBadge(code: string) {
  return SUBJECT_IDLE_BADGE[code] ?? 'border-0 bg-primary/10 text-primary dark:bg-primary/25 dark:text-primary-foreground';
}

/** Subject tiles — flat until expanded */
const SYLLABUS_SUBJECT_TILE =
  'border-border/50 bg-[#FFFDF8] shadow-none dark:bg-card';

const SYLLABUS_SUBJECT_TILE_OPEN =
  'relative z-10 -translate-y-1 scale-[1.008] border-border/60 shadow-[0_14px_32px_-10px_rgba(15,23,42,0.22)] dark:shadow-card-hover';

const SYLLABUS_TILE_MOTION =
  'transition-[transform,box-shadow,border-color] duration-300 ease-out motion-reduce:transition-none motion-reduce:transform-none';

/** Selected uploaded book row — elevated only when clicked */
const SYLLABUS_BOOK_ELEVATED =
  'relative z-[1] -translate-y-0.5 scale-[1.008] border-border/60 shadow-[0_10px_24px_-10px_rgba(15,23,42,0.18)] ring-1 ring-black/[0.04] dark:shadow-card-hover dark:ring-white/10';

function chapterCount(subject: Subject) {
  return subject.books.reduce((sum, b) => sum + b.chapters.length, 0);
}

function topicCount(subject: Subject) {
  return subject.books.reduce(
    (sum, b) => sum + b.chapters.reduce((n, ch) => n + (ch.topics?.length ?? 0), 0),
    0,
  );
}

function formatFileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

const SYLLABUS_INNER_PANEL =
  'rounded-sm border border-border/60 bg-muted/20 p-4 shadow-sm dark:bg-muted/10';

/** Uploaded book row (matches batch syllabus book headers) */
const SYLLABUS_BOOK_ROW =
  'rounded-xl border border-border/50 bg-[#FFFDF8] shadow-none dark:bg-card';

export default function SyllabusPage() {
  const { accessToken } = useRequireAuth(true);
  const queryClient = useQueryClient();
  const { can } = usePermissions();
  const { user } = useAuthStore();
  const teacherPortal = isTeacherOnly(normalizeRoles(user?.roles));
  const [selectedLevel, setSelectedLevel] = useState<number | null>(null);
  const [expandedSubjects, setExpandedSubjects] = useState<Set<string>>(new Set());
  const [selectedBookId, setSelectedBookId] = useState<string | null>(null);
  const [openingId, setOpeningId] = useState<string | null>(null);
  const canDeleteMaterial = can(Permission.MATERIAL_DELETE);

  const { data: materials } = useQuery({
    queryKey: ['materials'],
    queryFn: () => materialsApi.list(accessToken!) as Promise<MaterialItem[]>,
    enabled: !!accessToken,
    staleTime: 0,
    refetchInterval: (query) =>
      materialsNeedLivePoll(query.state.data as MaterialItem[] | undefined)
        ? MATERIALS_INDEX_POLL_MS
        : false,
  });

  useMaterialIndexingSync(queryClient, materials);

  const materialsPollActive = materialsNeedLivePoll(materials);

  const { data: uploadClasses, isLoading: uploadsLoading } = useQuery({
    queryKey: ['curriculum-from-uploads'],
    queryFn: () => curriculumApi.getClasses(accessToken!, { uploadedOnly: true, includeTopics: true }) as Promise<AcademicClass[]>,
    enabled: !!accessToken,
    staleTime: 0,
    refetchInterval: materialsPollActive ? MATERIALS_INDEX_POLL_MS : false,
  });

  const { data: allClasses, isLoading: allClassesLoading } = useQuery({
    queryKey: ['curriculum-all-classes'],
    queryFn: () => curriculumApi.getClasses(accessToken!, { includeTopics: true }) as Promise<AcademicClass[]>,
    enabled: !!accessToken,
  });

  const isLoading = uploadsLoading || allClassesLoading;

  const classTabs = useMemo(() => {
    const byLevel = new Map<number, AcademicClass>();
    for (const cls of allClasses ?? []) {
      if (NCERT_LEVELS.includes(cls.level as (typeof NCERT_LEVELS)[number])) {
        byLevel.set(cls.level, cls);
      }
    }
    return NCERT_LEVELS.map((level) => byLevel.get(level)).filter(Boolean) as AcademicClass[];
  }, [allClasses]);

  const uploadByLevel = useMemo(() => {
    const map = new Map<number, AcademicClass>();
    for (const cls of uploadClasses ?? []) map.set(cls.level, cls);
    return map;
  }, [uploadClasses]);

  const materialsForClassLevel = (level: number) =>
    (materials ?? []).filter((m) => m.academicClass?.level === level);

  /** Assign each upload to the best subject (filename/title beats wrong DB tag). */
  const materialsForSubject = (subject: Subject, classLevel: number) => {
    const classMaterials = materialsForClassLevel(classLevel);
    const classSubjects =
      classTabs.find((c) => c.level === classLevel)?.subjects
      ?? uploadByLevel.get(classLevel)?.subjects
      ?? [];
    return classMaterials.filter((m) => {
      const taggedId = m.subjectId ?? m.subject?.id;
      const guessed = guessSubjectId(
        m.fileName,
        m.title,
        classSubjects.map((s) => ({ id: s.id, name: s.name, code: s.code })),
        taggedId ?? null,
      );
      return guessed === subject.id;
    });
  };

  const mergedClassView = (level: number): AcademicClass | null => {
    const base = classTabs.find((c) => c.level === level);
    if (!base) return uploadByLevel.get(level) ?? null;
    const fromUploads = uploadByLevel.get(level);
    if (!fromUploads) {
      const withBooks = base.subjects.filter((s) => materialsForSubject(s, level).length > 0);
      return withBooks.length ? { ...base, subjects: withBooks } : null;
    }
    const uploadSubjectById = new Map(fromUploads.subjects.map((s) => [s.id, s]));
    const subjectIds = new Set<string>();
    for (const s of fromUploads.subjects) subjectIds.add(s.id);
    for (const s of base.subjects) {
      if (materialsForSubject(s, level).length > 0) subjectIds.add(s.id);
    }
    const subjects = [...subjectIds]
      .map((id) => {
        const uploadSub = uploadSubjectById.get(id);
        const baseSub = base.subjects.find((s) => s.id === id);
        const subject = uploadSub ?? baseSub;
        if (!subject) return null;
        if (uploadSub) {
          return uploadSub;
        }
        return subject;
      })
      .filter(Boolean) as Subject[];
    subjects.sort((a, b) => a.name.localeCompare(b.name));
    return { ...base, subjects };
  };

  const tabClasses = useMemo(() => {
    if (classTabs.length) return classTabs;
    return [...uploadByLevel.values()].sort((a, b) => a.level - b.level);
  }, [classTabs, uploadByLevel]);

  const activeLevel = selectedLevel ?? tabClasses[0]?.level ?? NCERT_LEVELS[0];
  const activeClass = mergedClassView(activeLevel);

  function toggleSubject(id: string) {
    setExpandedSubjects((prev) => {
      const next = new Set(prev);
      if (next.has(id)) {
        next.delete(id);
        setSelectedBookId(null);
      } else {
        next.add(id);
        setSelectedBookId(null);
      }
      return next;
    });
  }

  function expandAllSubjects() {
    if (!activeClass) return;
    setExpandedSubjects(new Set(activeClass.subjects.map((s) => s.id)));
  }

  function collapseAll() {
    setExpandedSubjects(new Set());
  }

  const reconcileMutation = useMutation({
    mutationFn: () =>
      materialsApi.reconcileSubjects(accessToken!) as Promise<{ updated?: number }>,
    onSuccess: (result: { updated?: number }) => {
      queryClient.invalidateQueries({ queryKey: ['materials'] });
      queryClient.invalidateQueries({ queryKey: ['curriculum-from-uploads'] });
      toast({
        title: 'Subject tags updated',
        description: result.updated
          ? `${result.updated} book(s) re-tagged from file names. Indexing may take a minute.`
          : 'All books were already tagged correctly.',
        variant: 'success',
      });
    },
    onError: (e: Error) => {
      toast({ title: 'Could not fix tags', description: e.message, variant: 'destructive' });
    },
  });

  const deleteMaterialMutation = useMutation({
    mutationFn: (materialId: string) => materialsApi.delete(accessToken!, materialId),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['materials'] });
      queryClient.invalidateQueries({ queryKey: ['curriculum-from-uploads'] });
      queryClient.invalidateQueries({ queryKey: ['curriculum-all-classes'] });
      toast({ title: 'Book deleted', description: 'Chapters from this upload were removed.', variant: 'success' });
    },
    onError: (e: Error) => {
      toast({ title: 'Could not delete book', description: e.message, variant: 'destructive' });
    },
  });

  async function viewMaterial(id: string) {
    setOpeningId(id);
    try {
      await materialsApi.openFile(accessToken!, id);
    } catch (e) {
      toast({
        title: 'Could not open book',
        description: e instanceof Error ? e.message : '',
        variant: 'destructive',
      });
    } finally {
      setOpeningId(null);
    }
  }

  return (
    <div className="space-y-8">
      <PageHeader
        title="NCERT Syllabus"
        highlight="Syllabus"
        description={
          teacherPortal
            ? 'Your assigned subjects with uploaded books, chapters, and topics. View or download books here.'
            : 'Chapter tree extracted from your uploaded books. Mark studied chapters on Classes & Batches to scope AI class tests.'
        }
        badge={teacherPortal ? 'Teacher · Assigned subjects' : 'Classes 9–12'}
      >
        {can(Permission.MATERIAL_UPLOAD) && (
          <>
            <Button
              variant="outline"
              size="sm"
              disabled={reconcileMutation.isPending}
              onClick={() => reconcileMutation.mutate()}
            >
              {reconcileMutation.isPending ? (
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
              ) : null}
              Fix subject tags
            </Button>
            <Button variant="outline" size="sm" asChild>
              <Link href="/dashboard/materials">
                <Upload className="mr-2 h-4 w-4" /> Upload books
              </Link>
            </Button>
          </>
        )}
      </PageHeader>

      {isLoading ? (
        <TableSkeleton rows={4} cols={1} />
      ) : tabClasses.length === 0 ? (
        <Card className="surface-card">
          <EmptyState
            icon={BookOpen}
            title={teacherPortal ? 'No syllabus for your subjects yet' : 'No syllabus extracted yet'}
            description={
              teacherPortal && !can(Permission.MATERIAL_UPLOAD)
                ? 'Ask your admin to upload NCERT books for your assigned class and subject. Chapters will appear here once indexed.'
                : 'Upload NCERT Class 9–12 PDFs on NCERT Books. Chapters and topics are detected automatically from your files.'
            }
          />
          {(can(Permission.MATERIAL_UPLOAD) || !teacherPortal) && (
            <div className="flex justify-center gap-3 pb-8">
              <Button asChild>
                <Link href="/dashboard/materials">
                  <Upload className="mr-2 h-4 w-4" /> Upload NCERT books
                </Link>
              </Button>
              <Button variant="outline" asChild>
                <Link href="/dashboard/ai-tests">
                  <Sparkles className="mr-2 h-4 w-4" /> Create Class Test
                </Link>
              </Button>
            </div>
          )}
        </Card>
      ) : (
        <div className="space-y-6">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <HorizontalTabScroller>
              {tabClasses.map((cls) => {
                const active = cls.level === activeLevel;
                return (
                  <button
                    key={cls.id}
                    type="button"
                    onClick={() => {
                      setSelectedLevel(cls.level);
                      setExpandedSubjects(new Set());
                      setSelectedBookId(null);
                    }}
                    className={cn(
                      'inline-flex shrink-0 items-center rounded-full border px-4 py-2 text-sm font-semibold transition-all',
                      active
                        ? 'border-primary bg-primary text-primary-foreground shadow-sm'
                        : 'border-border/60 bg-card text-muted-foreground hover:border-primary/30 hover:text-foreground',
                    )}
                  >
                    {cls.name}
                  </button>
                );
              })}
            </HorizontalTabScroller>
            {activeClass && (
              <div className="flex gap-2">
                <Button variant="ghost" size="sm" onClick={expandAllSubjects}>Expand all</Button>
                <Button variant="ghost" size="sm" onClick={collapseAll}>Collapse</Button>
              </div>
            )}
          </div>

          {activeClass && (
            <>
              <Card className="overflow-hidden border-primary/15 bg-gradient-to-br from-primary/[0.06] via-transparent to-violet-500/[0.04]">
                <CardContent className="flex flex-wrap items-center justify-between gap-4 p-6">
                  <div className="flex items-center gap-4">
                    <div className="flex h-14 w-14 items-center justify-center rounded-2xl bg-primary/10 text-primary">
                      <GraduationCap className="h-7 w-7" />
                    </div>
                    <div>
                      <h2 className="text-2xl font-bold tracking-tight">{activeClass.name}</h2>
                      <p className="mt-1 text-sm text-muted-foreground">
                        {activeClass.subjects.length} subject{activeClass.subjects.length === 1 ? '' : 's'}
                        {' · '}
                        {activeClass.subjects.reduce((n, s) => n + chapterCount(s), 0)} chapters from uploads
                      </p>
                    </div>
                  </div>
                  <Badge variant="secondary" className="normal-case tracking-normal">
                    NCERT · Upload-sourced
                  </Badge>
                </CardContent>
              </Card>

              <div className="columns-1 gap-4 space-y-4 md:columns-2">
                {activeClass.subjects.map((subject) => {
                  const subjectBooks = materialsForSubject(subject, activeLevel);
                  const chapters = subjectBooks.length
                    ? subject.books.flatMap((b) => b.chapters)
                    : [];
                  const topics = subjectBooks.length ? topicCount(subject) : 0;
                  const open = expandedSubjects.has(subject.id);

                  return (
                    <Card
                      key={subject.id}
                      className={cn(
                        'mb-4 break-inside-avoid overflow-hidden rounded-xl border shadow-none',
                        SYLLABUS_TILE_MOTION,
                        SYLLABUS_SUBJECT_TILE,
                        open && SYLLABUS_SUBJECT_TILE_OPEN,
                      )}
                    >
                      <button
                        type="button"
                        className="w-full rounded-t-xl text-left outline-none focus-visible:ring-2 focus-visible:ring-primary/30"
                        onClick={() => toggleSubject(subject.id)}
                      >
                        <CardHeader className={cn('pb-4', open && 'pb-3')}>
                          <div className="flex items-start justify-between gap-3">
                            <div className="flex items-start gap-3">
                              <div className={cn(
                                'flex h-11 w-11 shrink-0 items-center justify-center rounded-xl border transition-colors duration-200',
                                subjectIdleIcon(subject.code),
                              )}>
                                <BookOpen className="h-5 w-5" />
                              </div>
                              <div>
                                <div className="flex flex-wrap items-center gap-2">
                                  <Badge
                                    variant="default"
                                    className={cn(
                                      'font-mono text-[10px] normal-case tracking-normal transition-colors duration-200',
                                      subjectIdleBadge(subject.code),
                                    )}
                                  >
                                    {subject.code}
                                  </Badge>
                                  <CardTitle className="text-base">
                                    {subject.name}
                                  </CardTitle>
                                </div>
                                <p className="mt-1.5 text-xs text-muted-foreground">
                                  {chapters.length} chapter{chapters.length === 1 ? '' : 's'}
                                  {topics > 0 ? ` · ${topics} topics` : ''}
                                  {subjectBooks.length > 0
                                    ? ` · ${subjectBooks.length} book${subjectBooks.length === 1 ? '' : 's'}`
                                    : ''}
                                </p>
                              </div>
                            </div>
                            {open ? (
                              <ChevronDown className="mt-1 h-5 w-5 shrink-0 text-muted-foreground" />
                            ) : (
                              <ChevronRight className="mt-1 h-5 w-5 shrink-0 text-muted-foreground" />
                            )}
                          </div>
                        </CardHeader>
                      </button>

                      {open && (
                        <CardContent className="border-t border-border/50 px-6 pb-6 pt-4">
                          <div className={SYLLABUS_INNER_PANEL}>
                            <p className="text-[11px] font-bold uppercase tracking-wider text-muted-foreground">
                              Uploaded books &amp; documents
                            </p>
                            {subjectBooks.length === 0 ? (
                              <p className="mt-3 rounded-lg border border-dashed border-border/60 px-3 py-3 text-center text-xs text-muted-foreground">
                                No books uploaded for this subject yet.
                              </p>
                            ) : (
                              <div className="mt-3 flex flex-col gap-2">
                                {subjectBooks.map((m) => {
                                  const bookSelected = selectedBookId === m.id;
                                  const bookMeta = m.chapter
                                    ? `Ch.${m.chapter.number} ${displayChapterTitle(m.chapter.title)}`
                                    : 'Complete book';
                                  return (
                                  <div
                                    key={m.id}
                                    className={cn(
                                      'flex items-center gap-1 px-3 py-2 sm:px-4',
                                      SYLLABUS_TILE_MOTION,
                                      SYLLABUS_BOOK_ROW,
                                      bookSelected && SYLLABUS_BOOK_ELEVATED,
                                    )}
                                  >
                                    <button
                                      type="button"
                                      className="min-w-0 flex-1 rounded-lg py-1.5 pl-1 pr-2 text-left"
                                      onClick={() => setSelectedBookId(m.id)}
                                    >
                                      <span className="block truncate text-base font-semibold">
                                        {m.title}
                                      </span>
                                      <span className="block truncate text-xs text-muted-foreground">
                                        {bookMeta}
                                        {' · '}
                                        {formatFileSize(m.fileSize)}
                                      </span>
                                    </button>
                                    <div className="flex shrink-0 items-center gap-0.5">
                                      <Button
                                        size="icon"
                                        variant="ghost"
                                        className="h-8 w-8 shrink-0 text-muted-foreground"
                                        title="View"
                                        disabled={openingId === m.id}
                                        onClick={() => {
                                          setSelectedBookId(m.id);
                                          void viewMaterial(m.id);
                                        }}
                                      >
                                        {openingId === m.id
                                          ? <Loader2 className="h-4 w-4 animate-spin" />
                                          : <Eye className="h-4 w-4" />}
                                      </Button>
                                      <Button
                                        size="icon"
                                        variant="ghost"
                                        className="h-8 w-8 shrink-0 text-muted-foreground"
                                        title="Download"
                                        onClick={() => {
                                          setSelectedBookId(m.id);
                                          void materialsApi.downloadFile(accessToken!, m.id, m.fileName);
                                        }}
                                      >
                                        <Download className="h-4 w-4" />
                                      </Button>
                                      {canDeleteMaterial && (
                                        <Button
                                          size="icon"
                                          variant="ghost"
                                          className="h-8 w-8 shrink-0 text-destructive hover:bg-destructive/10 hover:text-destructive"
                                          title="Delete book"
                                          disabled={
                                            deleteMaterialMutation.isPending
                                            && deleteMaterialMutation.variables === m.id
                                          }
                                          onClick={() => {
                                            setSelectedBookId(m.id);
                                            if (
                                              !window.confirm(
                                                `Delete "${m.title}"? This removes indexed chapters for this book.`,
                                              )
                                            ) {
                                              return;
                                            }
                                            deleteMaterialMutation.mutate(m.id);
                                          }}
                                        >
                                          {deleteMaterialMutation.isPending
                                          && deleteMaterialMutation.variables === m.id
                                            ? <Loader2 className="h-4 w-4 animate-spin" />
                                            : <Trash2 className="h-4 w-4" />}
                                        </Button>
                                      )}
                                    </div>
                                  </div>
                                  );
                                })}
                              </div>
                            )}
                          </div>
                        </CardContent>
                      )}
                    </Card>
                  );
                })}
              </div>

              {activeClass.subjects.length === 0 && (
                <Card className="surface-card">
                  <EmptyState
                    icon={Library}
                    title={`No subjects for ${activeClass.name} yet`}
                    description={
                      teacherPortal && !can(Permission.MATERIAL_UPLOAD)
                        ? 'No assigned subjects with uploaded books for this class.'
                        : 'Upload books tagged to this class on NCERT Books.'
                    }
                  />
                </Card>
              )}
            </>
          )}

          {!activeClass && (
            <Card className="surface-card">
              <EmptyState
                icon={Upload}
                title={`Class ${activeLevel} — no books yet`}
                description="Upload NCERT PDFs for this class on NCERT Books. Use multi-file upload; English, Maths, and Science are detected from each file name."
              />
              {can(Permission.MATERIAL_UPLOAD) && (
                <div className="flex justify-center pb-8">
                  <Button asChild>
                    <Link href="/dashboard/materials">
                      <Upload className="mr-2 h-4 w-4" /> Upload for Class {activeLevel}
                    </Link>
                  </Button>
                </div>
              )}
            </Card>
          )}
        </div>
      )}
    </div>
  );
}
