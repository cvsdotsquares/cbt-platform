'use client';

import { useMemo, useState } from 'react';
import Link from 'next/link';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { PageHeader } from '@/components/layout/page-header';
import { HorizontalTabScroller, ScrollableListPanel } from '@/components/layout/horizontal-tab-scroller';
import { StatCard } from '@/components/layout/stat-card';
import { EmptyState } from '@/components/layout/data-table';
import { curriculumApi, materialsApi } from '@/lib/api';
import { useRequireAuth } from '@/hooks/use-auth';
import { TableSkeleton } from '@/components/ui/skeleton';
import { cn } from '@/lib/utils';
import { toast } from '@/hooks/use-toast';
import {
  BookOpen, ChevronDown, ChevronRight, Upload, Layers, GraduationCap,
  Library, Sparkles, Hash, FileText, Eye, Download, Loader2, Trash2,
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

const SUBJECT_ACCENTS: Record<string, string> = {
  MATH: 'from-blue-500/15 to-indigo-500/5 text-blue-600 border-blue-500/20',
  SCI: 'from-emerald-500/15 to-teal-500/5 text-emerald-600 border-emerald-500/20',
  SST: 'from-amber-500/15 to-orange-500/5 text-amber-700 border-amber-500/20',
  ENG: 'from-violet-500/15 to-purple-500/5 text-violet-600 border-violet-500/20',
  PHY: 'from-sky-500/15 to-cyan-500/5 text-sky-600 border-sky-500/20',
  CHEM: 'from-rose-500/15 to-pink-500/5 text-rose-600 border-rose-500/20',
  BIO: 'from-lime-500/15 to-green-500/5 text-lime-700 border-lime-500/20',
};

function subjectAccent(code: string) {
  return SUBJECT_ACCENTS[code] ?? 'from-primary/10 to-primary/5 text-primary border-primary/20';
}

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

export default function SyllabusPage() {
  const { accessToken } = useRequireAuth(true);
  const queryClient = useQueryClient();
  const { can } = usePermissions();
  const { user } = useAuthStore();
  const teacherPortal = isTeacherOnly(normalizeRoles(user?.roles));
  const [selectedLevel, setSelectedLevel] = useState<number | null>(null);
  const [expandedSubjects, setExpandedSubjects] = useState<Set<string>>(new Set());
  const [expandedChapters, setExpandedChapters] = useState<Set<string>>(new Set());
  const [openingId, setOpeningId] = useState<string | null>(null);
  const canDeleteMaterial = can(Permission.MATERIAL_DELETE);

  const { data: uploadClasses, isLoading: uploadsLoading } = useQuery({
    queryKey: ['curriculum-from-uploads'],
    queryFn: () => curriculumApi.getClasses(accessToken!, { uploadedOnly: true, includeTopics: true }) as Promise<AcademicClass[]>,
    enabled: !!accessToken,
  });

  const { data: allClasses, isLoading: allClassesLoading } = useQuery({
    queryKey: ['curriculum-all-classes'],
    queryFn: () => curriculumApi.getClasses(accessToken!, { includeTopics: true }) as Promise<AcademicClass[]>,
    enabled: !!accessToken,
  });

  const isLoading = uploadsLoading || allClassesLoading;

  const { data: materials } = useQuery({
    queryKey: ['materials'],
    queryFn: () => materialsApi.list(accessToken!) as Promise<MaterialItem[]>,
    enabled: !!accessToken,
  });

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

  const totals = useMemo(() => {
    const views = NCERT_LEVELS.map((level) => mergedClassView(level)).filter(Boolean) as AcademicClass[];
    const subjects = views.reduce((n, c) => n + c.subjects.length, 0);
    const chapters = views.reduce(
      (n, c) => n + c.subjects.reduce((s, sub) => s + chapterCount(sub), 0),
      0,
    );
    const topics = views.reduce(
      (n, c) => n + c.subjects.reduce((s, sub) => s + topicCount(sub), 0),
      0,
    );
    return { classes: views.length, subjects, chapters, topics };
  }, [uploadClasses, allClasses, materials]);

  function toggleSubject(id: string) {
    setExpandedSubjects((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function toggleChapter(id: string) {
    setExpandedChapters((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function expandAllSubjects() {
    if (!activeClass) return;
    setExpandedSubjects(new Set(activeClass.subjects.map((s) => s.id)));
  }

  function collapseAll() {
    setExpandedSubjects(new Set());
    setExpandedChapters(new Set());
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
        {can(Permission.MATERIAL_UPLOAD) && !teacherPortal && (
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
        <Button size="sm" asChild>
          <Link href="/dashboard/batches">
            <GraduationCap className="mr-2 h-4 w-4" /> Mark progress
          </Link>
        </Button>
      </PageHeader>

      <div className="grid grid-cols-2 gap-3 sm:gap-4 lg:grid-cols-4">
        <StatCard title="Classes covered" value={totals.classes} icon={GraduationCap} accent="blue" />
        <StatCard title="Subjects" value={totals.subjects} icon={Library} accent="violet" />
        <StatCard title="Chapters" value={totals.chapters} icon={BookOpen} accent="green" />
        <StatCard title="Topics" value={totals.topics} icon={Layers} accent="amber" />
      </div>

      {isLoading ? (
        <TableSkeleton rows={4} cols={1} />
      ) : tabClasses.length === 0 ? (
        <Card className="surface-card">
          <EmptyState
            icon={BookOpen}
            title={teacherPortal ? 'No syllabus for your subjects yet' : 'No syllabus extracted yet'}
            description={
              teacherPortal
                ? 'Ask your admin to upload NCERT books for your assigned class and subject. Chapters will appear here once indexed.'
                : 'Upload NCERT Class 9–12 PDFs on NCERT Books. Chapters and topics are detected automatically from your files.'
            }
          />
          {!teacherPortal && (
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
                const view = mergedClassView(cls.level);
                const chapters = view?.subjects.reduce((n, s) => n + chapterCount(s), 0) ?? 0;
                const bookCount = materialsForClassLevel(cls.level).length;
                const active = cls.level === activeLevel;
                return (
                  <button
                    key={cls.id}
                    type="button"
                    onClick={() => {
                      setSelectedLevel(cls.level);
                      setExpandedSubjects(new Set());
                      setExpandedChapters(new Set());
                    }}
                    className={cn(
                      'inline-flex shrink-0 items-center gap-2 rounded-full border px-4 py-2 text-sm font-semibold transition-all',
                      active
                        ? 'border-primary bg-primary text-primary-foreground shadow-sm'
                        : 'border-border/60 bg-card text-muted-foreground hover:border-primary/30 hover:text-foreground',
                    )}
                  >
                    {cls.name}
                    <span className={cn(
                      'rounded-full px-1.5 py-0.5 text-[10px] font-bold',
                      active ? 'bg-white/20 text-white' : 'bg-muted text-muted-foreground',
                    )}>
                      {chapters || bookCount}
                    </span>
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
                  const accent = subjectAccent(subject.code);

                  return (
                    <Card
                      key={subject.id}
                      className={cn(
                        'surface-card mb-4 break-inside-avoid overflow-hidden transition-shadow',
                        open && 'ring-1 ring-primary/20 shadow-md',
                      )}
                    >
                      <button
                        type="button"
                        className="w-full text-left"
                        onClick={() => toggleSubject(subject.id)}
                      >
                        <CardHeader className="pb-4">
                          <div className="flex items-start justify-between gap-3">
                            <div className="flex items-start gap-3">
                              <div className={cn(
                                'flex h-11 w-11 shrink-0 items-center justify-center rounded-xl border bg-gradient-to-br',
                                accent,
                              )}>
                                <BookOpen className="h-5 w-5" />
                              </div>
                              <div>
                                <div className="flex flex-wrap items-center gap-2">
                                  <Badge variant="outline" className="font-mono text-[10px]">{subject.code}</Badge>
                                  <CardTitle className="text-base">{subject.name}</CardTitle>
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
                        <CardContent className="space-y-4 border-t border-border/60 pt-4">
                          {/* Uploaded books for this subject */}
                          <div className="space-y-2">
                            <p className="text-[11px] font-bold uppercase tracking-wider text-muted-foreground">
                              Uploaded books & Documents
                            </p>
                            {subjectBooks.length === 0 ? (
                              <p className="rounded-xl border border-dashed border-border/60 px-3 py-3 text-center text-xs text-muted-foreground">
                                No books uploaded for this subject yet.
                              </p>
                            ) : (
                              <ScrollableListPanel maxHeightClass="max-h-52" className="space-y-2">
                              {subjectBooks.map((m) => (
                                <div
                                  key={m.id}
                                  className="flex items-center gap-2 rounded-xl border border-border/50 bg-muted/20 px-3 py-2.5"
                                >
                                  <FileText className="h-4 w-4 shrink-0 text-primary" />
                                  <div className="min-w-0 flex-1">
                                    <p className="truncate text-sm font-medium">{m.title}</p>
                                    <p className="truncate text-[11px] text-muted-foreground">
                                      {m.chapter
                                        ? `Ch.${m.chapter.number} ${m.chapter.title}`
                                        : 'Complete book'}
                                      {' · '}{formatFileSize(m.fileSize)}
                                    </p>
                                  </div>
                                  <Button
                                    size="icon"
                                    variant="ghost"
                                    className="h-8 w-8 shrink-0"
                                    title="View"
                                    disabled={openingId === m.id}
                                    onClick={(e) => {
                                      e.stopPropagation();
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
                                    className="h-8 w-8 shrink-0"
                                    title="Download"
                                    onClick={(e) => {
                                      e.stopPropagation();
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
                                      disabled={deleteMaterialMutation.isPending && deleteMaterialMutation.variables === m.id}
                                      onClick={(e) => {
                                        e.stopPropagation();
                                        if (!window.confirm(`Delete "${m.title}"? This removes indexed chapters for this book.`)) return;
                                        deleteMaterialMutation.mutate(m.id);
                                      }}
                                    >
                                      {deleteMaterialMutation.isPending && deleteMaterialMutation.variables === m.id
                                        ? <Loader2 className="h-4 w-4 animate-spin" />
                                        : <Trash2 className="h-4 w-4" />}
                                    </Button>
                                  )}
                                </div>
                              ))}
                              </ScrollableListPanel>
                            )}
                          </div>

                          <div className="space-y-2">
                            <p className="text-[11px] font-bold uppercase tracking-wider text-muted-foreground">
                              Chapters & topics
                            </p>
                            {subjectBooks.length === 0 ? (
                              <p className="py-2 text-center text-sm text-muted-foreground">
                                Upload a book for this subject to see extracted chapters here.
                              </p>
                            ) : chapters.length === 0 ? (
                              <p className="py-2 text-center text-sm text-muted-foreground">
                                Indexing in progress — chapters will appear when the book is ready.
                              </p>
                            ) : (
                              <ScrollableListPanel maxHeightClass="max-h-64" className="space-y-2">
                              {chapters
                                .slice()
                                .sort((a, b) => a.number - b.number)
                                .map((ch) => {
                                  const chOpen = expandedChapters.has(ch.id);
                                  const hasTopics = ch.topics.length > 0;
                                  return (
                                    <div
                                      key={ch.id}
                                      className="rounded-xl border border-border/50 bg-muted/20 transition-colors hover:bg-muted/40"
                                    >
                                      <button
                                        type="button"
                                        className="flex w-full items-start gap-3 px-3.5 py-3 text-left"
                                        onClick={() => hasTopics && toggleChapter(ch.id)}
                                        disabled={!hasTopics}
                                      >
                                        <span className="mt-0.5 inline-flex h-6 min-w-6 items-center justify-center rounded-md bg-background px-1.5 font-mono text-[11px] font-bold text-primary shadow-sm">
                                          {ch.number}
                                        </span>
                                        <div className="min-w-0 flex-1">
                                          <p className="text-sm font-semibold leading-snug">{ch.title}</p>
                                          {hasTopics && (
                                            <p className="mt-0.5 flex items-center gap-1 text-[11px] text-muted-foreground">
                                              <Hash className="h-3 w-3" />
                                              {ch.topics.length} topic{ch.topics.length === 1 ? '' : 's'}
                                            </p>
                                          )}
                                        </div>
                                        {hasTopics && (
                                          chOpen
                                            ? <ChevronDown className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" />
                                            : <ChevronRight className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" />
                                        )}
                                      </button>

                                      {chOpen && hasTopics && (
                                        <ul className="space-y-1 border-t border-border/40 px-3.5 py-2.5">
                                          {ch.topics.map((t) => (
                                            <li
                                              key={t.id}
                                              className="flex items-start gap-2 rounded-lg px-2 py-1.5 text-xs text-muted-foreground"
                                            >
                                              <span className="mt-1.5 h-1 w-1 shrink-0 rounded-full bg-primary/50" />
                                              <span>{t.title}</span>
                                            </li>
                                          ))}
                                        </ul>
                                      )}
                                    </div>
                                  );
                                })}
                              </ScrollableListPanel>
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
                      teacherPortal
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
              {can(Permission.MATERIAL_UPLOAD) && !teacherPortal && (
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
