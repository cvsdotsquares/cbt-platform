'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import Link from 'next/link';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { PageHeader } from '@/components/layout/page-header';
import { aiApi, curriculumApi, batchesApi, materialsApi } from '@/lib/api';
import { useRequireAuth } from '@/hooks/use-auth';
import { toast } from '@/hooks/use-toast';
import { AiTestQuestionsReview } from '@/components/admin/ai-test-questions-review';
import { cn } from '@/lib/utils';
import {
  Sparkles, BookOpen, Layers, Clock, Hash, Shield, Loader2,
  CheckCircle2, ArrowRight, GraduationCap, FileText, Check, Upload,
} from 'lucide-react';
import { useAuthStore } from '@/stores/auth-store';
import { isTeacherOnly, normalizeRoles } from '@/lib/roles';

type TestMode = 'single' | 'all';

type SyllabusChapter = {
  id: string;
  number: number;
  title: string;
  status: string;
  readableForTest?: boolean;
  topics?: { id: string; title: string; status?: string }[];
};

type SyllabusSubject = {
  subject: { id: string; name: string };
  chapters: SyllabusChapter[];
};

const STEPS = [
  { id: 1, label: 'Configure' },
  { id: 2, label: 'Generate' },
  { id: 3, label: 'Review' },
] as const;

const DIFFICULTY_OPTIONS = [
  { value: 'EASY', label: 'Easy', hint: 'Recall & basic understanding' },
  { value: 'MEDIUM', label: 'Medium', hint: 'Application & reasoning' },
  { value: 'HARD', label: 'Hard', hint: 'Analysis & multi-step' },
] as const;

const QUESTION_TYPE_OPTIONS = [
  { value: 'MCQ', label: 'MCQ', hint: 'One correct option' },
  { value: 'MSQ', label: 'MSQ', hint: 'Multiple correct options' },
  { value: 'SUBJECTIVE', label: 'Subjective', hint: 'Text answer, AI graded' },
  { value: 'CASE_STUDY', label: 'Case study', hint: 'Open-ended text answer' },
] as const;

const selectClass =
  'mt-1.5 flex h-10 w-full rounded-lg border border-input bg-background px-3 text-sm shadow-sm transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring';

const INITIAL_CREATE_FORM = {
  title: '',
  subjectId: '',
  batchId: '',
  chapterIds: [] as string[],
  questionCount: 10,
  questionsPerSubject: 5,
  difficulty: 'MEDIUM',
  syllabusScope: 'COMPLETED_ONLY',
  durationMinutes: 90,
  assignToBatch: true,
  questionTypes: ['MCQ'] as string[],
  shuffleQuestions: true,
};

export default function AiTestsPage() {
  const { accessToken } = useRequireAuth(true);
  const { user } = useAuthStore();
  const queryClient = useQueryClient();
  const teacherPortal = isTeacherOnly(normalizeRoles(user?.roles));
  const [createdExam, setCreatedExam] = useState<{
    id: string;
    title: string;
    questionCount: number;
  } | null>(null);
  const [mode, setMode] = useState<TestMode>(teacherPortal ? 'single' : 'all');
  const [showAdvanced, setShowAdvanced] = useState(false);
  const [uploadFile, setUploadFile] = useState<File | null>(null);
  const [uploadTitle, setUploadTitle] = useState('');
  const [form, setForm] = useState({ ...INITIAL_CREATE_FORM });

  useEffect(() => {
    if (teacherPortal) setMode('single');
  }, [teacherPortal]);

  const { data: classes } = useQuery({
    queryKey: ['curriculum-classes'],
    queryFn: () => curriculumApi.getClasses(accessToken!) as Promise<{
      id: string; level: number;
      subjects: { id: string; name: string }[];
    }[]>,
    enabled: !!accessToken && !teacherPortal,
  });

  const { data: batches } = useQuery({
    queryKey: ['batches'],
    queryFn: () => batchesApi.list(accessToken!) as Promise<{
      id: string; name: string;
      academicClass: { name: string; level: number };
      _count?: { enrollments: number };
      teacherAssignments?: { subject: { id: string; name: string; code?: string } }[];
    }[]>,
    enabled: !!accessToken,
  });

  const subjects = (classes ?? []).flatMap((c) =>
    c.subjects.map((s) => ({ ...s, classLevel: c.level })),
  );

  const selectedBatch = (batches ?? []).find((b) => b.id === form.batchId);
  const uploadClass = selectedBatch
    ? (classes ?? []).find((c) => c.level === selectedBatch.academicClass.level)
    : undefined;

  const teacherSubjects = useMemo(() => {
    if (!teacherPortal || !selectedBatch?.teacherAssignments?.length) return [];
    return selectedBatch.teacherAssignments.map((a) => ({
      id: a.subject.id,
      name: a.subject.name,
      classLevel: selectedBatch.academicClass.level,
    }));
  }, [teacherPortal, selectedBatch]);

  const classSubjects = teacherPortal
    ? teacherSubjects
    : selectedBatch
      ? subjects.filter((s) => s.classLevel === selectedBatch.academicClass.level)
      : [];

  const selectedSubject = classSubjects.find((s) => s.id === form.subjectId)
    ?? subjects.find((s) => s.id === form.subjectId);

  const singleSubjectMode = mode === 'single' || teacherPortal;

  const { data: syllabusProgress, isLoading: syllabusLoading } = useQuery({
    queryKey: ['syllabus-progress', form.batchId, form.subjectId],
    queryFn: () =>
      batchesApi.getSyllabusProgress(accessToken!, form.batchId, form.subjectId) as Promise<SyllabusSubject[]>,
    enabled: !!accessToken && singleSubjectMode && !!form.batchId && !!form.subjectId,
    staleTime: 0,
    refetchOnWindowFocus: true,
  });

  const { data: indexedMaterials } = useQuery({
    queryKey: ['materials-for-ai-tests'],
    queryFn: () => materialsApi.list(accessToken!) as Promise<{
      id: string;
      status: string;
      subjectId?: string | null;
      subject?: { id: string; name: string } | null;
      academicClass?: { level: number } | null;
    }[]>,
    enabled: !!accessToken && !!selectedBatch,
  });

  const subjectHasUploadedBook = (subjectId: string, classLevel: number) =>
    (indexedMaterials ?? []).some(
      (m) =>
        m.status === 'READY'
        && m.academicClass?.level === classLevel
        && (m.subjectId === subjectId || m.subject?.id === subjectId),
    );

  const subjectChapters = useMemo(() => {
    const list = syllabusProgress ?? [];
    let subjectEntry = list.find((s) => s.subject.id === form.subjectId);
    if (!subjectEntry && selectedSubject) {
      subjectEntry = list.find(
        (s) => s.subject.name.toLowerCase() === selectedSubject.name.toLowerCase(),
      );
    }
    if (!subjectEntry && list.length === 1) subjectEntry = list[0];
    return subjectEntry?.chapters ?? [];
  }, [syllabusProgress, form.subjectId, selectedSubject]);

  const selectableChapters = useMemo(
    () => subjectChapters.filter(
      (ch) => String(ch.status ?? '').toUpperCase() === 'COMPLETED' && ch.readableForTest !== false,
    ),
    [subjectChapters],
  );

  const selectableChapterIdsKey = selectableChapters.map((c) => c.id).join(',');

  const subjectsMissingBooks = useMemo(() => {
    if (!selectedBatch) return [];
    const level = selectedBatch.academicClass.level;
    return classSubjects.filter((s) => !subjectHasUploadedBook(s.id, level));
  }, [selectedBatch, classSubjects, indexedMaterials]);

  const uploadMutation = useMutation({
    mutationFn: async () => {
      if (!uploadFile) throw new Error('Choose a PDF or text document first');
      if (!form.batchId || !form.subjectId || !uploadClass?.id) {
        throw new Error('Choose a class, batch, and subject before uploading');
      }
      const data = new FormData();
      data.append('file', uploadFile);
      data.append('title', uploadTitle.trim() || uploadFile.name.replace(/\.[^.]+$/, ''));
      data.append('type', 'NCERT');
      data.append('academicClassId', uploadClass.id);
      data.append('subjectId', form.subjectId);
      data.append('academicSession', '2025-26');
      data.append('fullBook', 'true');
      const material = await materialsApi.upload(accessToken!, data) as { id?: string };
      if (!material.id) throw new Error('Upload completed without a material id');
      await materialsApi.reindex(accessToken!, material.id);
      return material;
    },
    onSuccess: () => {
      setUploadFile(null);
      setUploadTitle('');
      queryClient.invalidateQueries({ queryKey: ['curriculum-classes'] });
      queryClient.invalidateQueries({ queryKey: ['syllabus-progress'] });
      toast({ title: 'Document uploaded and indexed', description: 'Select the indexed chapters below to create your test.' });
    },
    onError: (e: Error) => toast({ title: 'Could not index document', description: e.message, variant: 'destructive' }),
  });

  useEffect(() => {
    if (!teacherPortal || !form.batchId || form.subjectId) return;
    if (teacherSubjects.length === 1) {
      setForm((f) => ({ ...f, subjectId: teacherSubjects[0].id, chapterIds: [] }));
    }
  }, [teacherPortal, form.batchId, form.subjectId, teacherSubjects]);

  // Default the test to chapters marked Done for this batch.
  useEffect(() => {
    if (!singleSubjectMode || !form.subjectId || syllabusLoading) return;
    setForm((f) => ({
      ...f,
      chapterIds: selectableChapterIdsKey ? selectableChapterIdsKey.split(',') : [],
    }));
  }, [singleSubjectMode, form.batchId, form.subjectId, syllabusLoading, selectableChapterIdsKey]);

  const estimatedQuestions = useMemo(() => {
    if (mode === 'all') {
      return classSubjects.length * form.questionsPerSubject;
    }
    return form.questionCount;
  }, [mode, classSubjects.length, form.questionsPerSubject, form.questionCount]);

  const toggleChapter = (chapterId: string) => {
    setForm((f) => ({
      ...f,
      chapterIds: f.chapterIds.includes(chapterId)
        ? f.chapterIds.filter((id) => id !== chapterId)
        : [...f.chapterIds, chapterId],
    }));
  };

  const selectAllChapters = () => {
    setForm((f) => ({ ...f, chapterIds: selectableChapters.map((c) => c.id) }));
  };

  const clearChapters = () => {
    setForm((f) => ({ ...f, chapterIds: [] }));
  };

  const chapterListRef = useRef<HTMLDivElement>(null);
  const [chapterScroll, setChapterScroll] = useState({ canUp: false, canDown: false });

  const updateChapterScrollHints = () => {
    const el = chapterListRef.current;
    if (!el) {
      setChapterScroll({ canUp: false, canDown: false });
      return;
    }
    const { scrollTop, scrollHeight, clientHeight } = el;
    setChapterScroll({
      canUp: scrollTop > 4,
      canDown: scrollTop + clientHeight < scrollHeight - 4,
    });
  };

  useEffect(() => {
    updateChapterScrollHints();
  }, [selectableChapters.length, syllabusLoading, form.subjectId]);

  const createMutation = useMutation({
    mutationFn: () => {
      const base = {
        title: form.title,
        batchId: form.batchId,
        difficulty: form.difficulty,
        syllabusScope: form.syllabusScope,
        assignToBatch: form.assignToBatch,
        questionTypes: form.questionTypes,
        shuffleQuestions: form.shuffleQuestions,
        allSubjects: teacherPortal ? false : mode === 'all',
        durationMinutes: mode === 'all' && !teacherPortal
          ? form.durationMinutes
          : Math.min(form.durationMinutes, 60),
      };

      if (mode === 'all' && !teacherPortal) {
        return aiApi.createAiTest(accessToken!, {
          ...base,
          questionsPerSubject: form.questionsPerSubject,
          questionCount: classSubjects.length * form.questionsPerSubject,
        });
      }

      const doneChapterIds = selectableChapters
        .map((ch) => ch.id)
        .filter((id) => form.chapterIds.includes(id));
      return aiApi.createAiTest(accessToken!, {
        ...base,
        subjectId: form.subjectId,
        questionCount: form.questionCount,
        chapterIds: doneChapterIds,
        syllabusScope: 'COMPLETED_ONLY',
      });
    },
    onSuccess: (data) => {
      const d = data as {
        exam?: { id: string; title: string };
        questionCount?: number;
        message?: string;
        source?: string;
      };
      const examId = d.exam?.id;
      queryClient.invalidateQueries({ queryKey: ['exams'] });
      queryClient.invalidateQueries({ queryKey: ['teacher-dashboard'] });
      if (!examId) {
        toast({ title: 'Draft exam created', description: d.message, variant: 'destructive' });
        return;
      }
      setCreatedExam({
        id: examId,
        title: d.exam?.title ?? form.title,
        questionCount: d.questionCount ?? 0,
      });
      toast({
        title: 'Draft exam created',
        description: d.message ?? 'Review AI-generated questions below, then publish from Class Tests.',
        variant: 'success',
      });
    },
    onError: (e: Error) => toast({ title: 'Could not create test', description: e.message, variant: 'destructive' }),
  });

  const resetForNewTest = () => {
    setCreatedExam(null);
    setForm({
      ...INITIAL_CREATE_FORM,
      questionTypes: [...INITIAL_CREATE_FORM.questionTypes],
    });
    setMode(teacherPortal ? 'single' : 'all');
    setShowAdvanced(false);
    setUploadFile(null);
    setUploadTitle('');
    createMutation.reset();
  };

  const selectedSubjectMissingBook =
    singleSubjectMode
    && !!form.subjectId
    && !!selectedBatch
    && !subjectHasUploadedBook(form.subjectId, selectedBatch.academicClass.level);

  const canCreate =
    !!form.title.trim()
    && form.batchId
    && form.questionTypes.length > 0
    && (mode === 'all' || !!form.subjectId)
    && (!singleSubjectMode || (form.chapterIds.length > 0 && !selectedSubjectMissingBook))
    && (mode !== 'all' || subjectsMissingBooks.length === 0)
    && !createdExam;
  const activeStep = createdExam ? 3 : createMutation.isPending ? 2 : 1;

  if (createdExam && accessToken) {
    return (
      <div className="space-y-8">
        <StepIndicator activeStep={3} />
        <PageHeader
          title="Review your test"
          highlight="test"
          description="Edit any AI-generated question or answer, then publish from Class Tests when you are satisfied."
          badge="Step 3 · Review"
        />
        <AiTestQuestionsReview
          accessToken={accessToken}
          examId={createdExam.id}
          examTitle={createdExam.title}
          questionCount={createdExam.questionCount}
          onCreateAnother={resetForNewTest}
        />
      </div>
    );
  }

  return (
    <div className="min-w-0 space-y-8">
      <StepIndicator activeStep={activeStep} />

      <PageHeader
        title="Create Class Test"
        highlight="Class Test"
        description={
          teacherPortal
            ? 'Generate a NCERT-aligned draft from your assigned subject, using chapters your class has studied.'
            : 'Build a NCERT-aligned draft test from uploaded books. Questions are generated only from indexed chapters your batch has studied.'
        }
        badge={teacherPortal ? 'Teacher · Assigned subject' : 'NCERT · AI'}
      />

      <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_minmax(260px,320px)]">
        {/* Main form */}
        <div className="space-y-6">
          {false && (
            <Card className="border-primary/20 bg-primary/[0.03]">
              <CardContent className="space-y-4 p-4 sm:p-5">
                <div className="flex items-start gap-3">
                  <Upload className="mt-0.5 h-5 w-5 shrink-0 text-primary" />
                  <div className="min-w-0">
                    <p className="font-medium">Upload and index source document</p>
                    <p className="mt-1 text-sm text-muted-foreground">
                      Choose a batch and subject above, then upload a PDF, TXT, or Markdown file. It will be indexed before chapters appear here.
                    </p>
                  </div>
                </div>
                <div className="grid gap-3 sm:grid-cols-[minmax(0,1fr)_minmax(0,1fr)_auto] sm:items-end">
                  <div className="min-w-0">
                    <Label htmlFor="source-document">Document</Label>
                    <Input
                      id="source-document"
                      className="mt-1.5 disabled:cursor-not-allowed disabled:opacity-60"
                      type="file"
                      accept=".pdf,.txt,.md,application/pdf,text/plain,text/markdown"
                      disabled
                      onChange={(e) => setUploadFile(e.target.files?.[0] ?? null)}
                    />
                  </div>
                  <div className="min-w-0">
                    <Label htmlFor="source-title">Document title</Label>
                    <Input
                      id="source-title"
                      className="mt-1.5 disabled:cursor-not-allowed disabled:opacity-60"
                      placeholder="Defaults to file name"
                      value={uploadTitle}
                      onChange={(e) => setUploadTitle(e.target.value)}
                      disabled
                    />
                  </div>
                  <Button
                    type="button"
                    variant="outline"
                    className="w-full sm:w-auto disabled:cursor-not-allowed disabled:opacity-60"
                    disabled
                    onClick={() => uploadMutation.mutate()}
                  >
                    <Upload className="mr-2 h-4 w-4" />
                    Upload & index
                  </Button>
                </div>
              </CardContent>
            </Card>
          )}
          <Card className="surface-card overflow-hidden border-primary/10">
            <div className="h-1 bg-gradient-to-r from-violet-500 via-primary to-indigo-500" />
            <CardHeader className="pb-2">
              <CardTitle className="flex items-center gap-2 text-lg">
                <Sparkles className="h-5 w-5 text-primary" />
                {teacherPortal ? 'Your assigned subject' : 'Test type'}
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-6">
              {!teacherPortal && (
              <div className="grid gap-3 sm:grid-cols-2">
                <ModeCard
                  active={mode === 'all'}
                  icon={Layers}
                  title="All subjects"
                  description="One combined exam — each subject becomes a section using studied chapters only."
                  onClick={() => setMode('all')}
                />
                <ModeCard
                  active={mode === 'single'}
                  icon={BookOpen}
                  title="One subject"
                  description="Focused test for a single subject from uploaded chapter content."
                  onClick={() => setMode('single')}
                />
              </div>
              )}

              <div className="space-y-4">
                <div>
                  <Label htmlFor="test-title">Test name</Label>
                  <Input
                    id="test-title"
                    className="mt-1.5"
                    placeholder={mode === 'all' ? 'e.g. Weekly Test — All Subjects' : 'e.g. Social Science Unit Test'}
                    value={form.title}
                    onChange={(e) => setForm({ ...form, title: e.target.value })}
                    required
                  />
                  <p className="mt-1.5 text-xs text-muted-foreground">
                    Must be unique — cannot reuse an existing test name.
                  </p>
                </div>

                <div>
                  <Label htmlFor="batch">Class / Batch</Label>
                  <select
                    id="batch"
                    className={selectClass}
                    value={form.batchId}
                    onChange={(e) => setForm({ ...form, batchId: e.target.value, subjectId: '', chapterIds: [] })}
                  >
                    <option value="">Choose batch</option>
                    {(batches ?? []).map((b) => (
                      <option key={b.id} value={b.id}>
                        {b.academicClass.name} — {b.name}
                      </option>
                    ))}
                  </select>
                  {teacherPortal && !(batches ?? []).length && (
                    <p className="mt-1.5 text-xs text-muted-foreground">
                      No assigned classes yet. Ask your admin to assign you to a batch and subject.
                    </p>
                  )}
                </div>

                {(mode === 'single' || teacherPortal) && (
                  <div>
                    <Label htmlFor="subject">Subject</Label>
                    <select
                      id="subject"
                      className={selectClass}
                      value={form.subjectId}
                      onChange={(e) => setForm({ ...form, subjectId: e.target.value, chapterIds: [] })}
                    >
                      <option value="">Choose subject</option>
                      {(classSubjects.length ? classSubjects : subjects).map((s) => (
                        <option key={s.id} value={s.id}>Class {s.classLevel} — {s.name}</option>
                      ))}
                    </select>
                  </div>
                )}

                {singleSubjectMode && form.batchId && form.subjectId && (
                  <div className="overflow-hidden rounded-xl border border-border/70 bg-card shadow-sm">
                    <div className="flex items-start justify-between gap-3 border-b border-border/60 bg-muted/30 px-4 py-3">
                      <div className="min-w-0">
                        <div className="flex items-center gap-2">
                          <BookOpen className="h-4 w-4 shrink-0 text-primary" />
                          <Label className="text-sm font-semibold">Done chapters</Label>
                          {!syllabusLoading && selectableChapters.length > 0 && (
                            <Badge variant="secondary" className="font-normal tabular-nums">
                              {form.chapterIds.length}/{selectableChapters.length}
                            </Badge>
                          )}
                        </div>
                        <p className="mt-1 text-xs leading-relaxed text-muted-foreground">
                          Only chapters marked Done for this batch. Choose which of those this test should use.
                        </p>
                      </div>
                      {selectableChapters.length > 0 && (
                        <div className="flex shrink-0 gap-1 rounded-lg border border-border/60 bg-background p-0.5 shadow-sm">
                          <button
                            type="button"
                            onClick={selectAllChapters}
                            disabled={form.chapterIds.length === selectableChapters.length}
                            className="rounded-md px-2.5 py-1 text-xs font-medium text-foreground transition-colors hover:bg-muted disabled:pointer-events-none disabled:opacity-40"
                          >
                            All
                          </button>
                          <button
                            type="button"
                            onClick={clearChapters}
                            disabled={form.chapterIds.length === 0}
                            className="rounded-md px-2.5 py-1 text-xs font-medium text-muted-foreground transition-colors hover:bg-muted hover:text-foreground disabled:pointer-events-none disabled:opacity-40"
                          >
                            None
                          </button>
                        </div>
                      )}
                    </div>

                    {selectableChapters.length > 0 && (
                      <div className="h-1 bg-muted">
                        <div
                          className="h-full bg-primary transition-all duration-300 ease-out"
                          style={{
                            width: `${Math.round((form.chapterIds.length / selectableChapters.length) * 100)}%`,
                          }}
                        />
                      </div>
                    )}

                    <div className="relative">
                      {chapterScroll.canUp && (
                        <div className="pointer-events-none absolute inset-x-0 top-0 z-10 h-6 bg-gradient-to-b from-card to-transparent" />
                      )}
                      <div
                        ref={chapterListRef}
                        onScroll={updateChapterScrollHints}
                        className="max-h-72 overflow-y-auto overscroll-contain scroll-smooth [scrollbar-gutter:stable]"
                      >
                        {syllabusLoading ? (
                          <div className="flex items-center justify-center gap-2 px-4 py-10 text-sm text-muted-foreground">
                            <Loader2 className="h-4 w-4 animate-spin" />
                            Loading chapters…
                          </div>
                        ) : selectedSubjectMissingBook ? (
                          <div className="px-4 py-8 text-center">
                            <p className="text-sm font-medium text-destructive">
                              This book is not uploaded — first upload a book on Books &amp; Notes.
                            </p>
                          </div>
                        ) : selectableChapters.length === 0 ? (
                          <div className="px-4 py-8 text-center">
                            <div className="mx-auto mb-3 flex h-10 w-10 items-center justify-center rounded-full bg-muted">
                              <BookOpen className="h-5 w-5 text-muted-foreground" />
                            </div>
                            {subjectChapters.length > 0 ? (
                              <>
                                <p className="text-sm font-medium">No chapters marked Done</p>
                                <p className="mt-1 text-xs text-muted-foreground">
                                  This test only uses chapters marked Done. Mark them on{' '}
                                  <Link href="/dashboard/batches" className="font-medium text-primary underline-offset-2 hover:underline">
                                    Classes &amp; Batches
                                  </Link>
                                  .
                                </p>
                              </>
                            ) : (
                              <>
                                <p className="text-sm font-medium">No indexed chapters yet</p>
                                <p className="mt-1 text-xs text-muted-foreground">
                                  Upload and index an NCERT book for this subject, then mark chapters as Done on{' '}
                                  <Link href="/dashboard/batches" className="font-medium text-primary underline-offset-2 hover:underline">
                                    Classes &amp; Batches
                                  </Link>
                                  .
                                </p>
                              </>
                            )}
                          </div>
                        ) : (
                          <ul className="divide-y divide-border/50">
                            {selectableChapters.map((ch) => {
                              const checked = form.chapterIds.includes(ch.id);
                              return (
                                <li key={ch.id}>
                                  <button
                                    type="button"
                                    onClick={() => toggleChapter(ch.id)}
                                    className={cn(
                                      'flex w-full items-center gap-3 px-4 py-3 text-left transition-colors',
                                      checked ? 'bg-primary/[0.04]' : 'hover:bg-muted/40',
                                    )}
                                  >
                                    <span
                                      className={cn(
                                        'flex h-5 w-5 shrink-0 items-center justify-center rounded-md border transition-colors',
                                        checked
                                          ? 'border-primary bg-primary text-primary-foreground shadow-sm'
                                          : 'border-border/80 bg-background',
                                      )}
                                      aria-hidden
                                    >
                                      {checked && <Check className="h-3.5 w-3.5" strokeWidth={2.75} />}
                                    </span>
                                    <span className="flex h-7 w-10 shrink-0 items-center justify-center rounded-md border border-border/60 bg-muted/40 font-mono text-[11px] font-semibold tabular-nums text-muted-foreground">
                                      {ch.number}
                                    </span>
                                    <span className="min-w-0 flex-1">
                                      <span className={cn('block truncate text-sm font-medium', checked ? 'text-foreground' : 'text-foreground/90')}>
                                        {ch.title}
                                      </span>
                                      <span className="mt-0.5 block text-[11px] text-muted-foreground">
                                        Chapter {ch.number}
                                      </span>
                                    </span>
                                    {checked && (
                                      <Badge variant="secondary" className="shrink-0 text-[10px] font-medium uppercase tracking-wide">
                                        Included
                                      </Badge>
                                    )}
                                  </button>
                                </li>
                              );
                            })}
                          </ul>
                        )}
                      </div>
                      {chapterScroll.canDown && (
                        <div className="pointer-events-none absolute inset-x-0 bottom-0 z-10 h-8 bg-gradient-to-t from-card to-transparent" />
                      )}
                    </div>

                    {(chapterScroll.canDown || chapterScroll.canUp) && (
                      <div className="border-t border-border/60 bg-muted/20 px-4 py-2 text-center text-[11px] text-muted-foreground">
                        Scroll to see all {selectableChapters.length} chapters
                      </div>
                    )}
                  </div>
                )}

                <div className="grid gap-4 sm:grid-cols-2">
                  {mode === 'all' ? (
                    <div>
                      <Label htmlFor="q-per-subject">Questions per subject</Label>
                      <Input
                        id="q-per-subject"
                        className="mt-1.5"
                        type="number"
                        min={2}
                        max={15}
                        value={form.questionsPerSubject}
                        onChange={(e) => setForm({ ...form, questionsPerSubject: parseInt(e.target.value) || 5 })}
                      />
                      {classSubjects.length > 0 && (
                        <p className="mt-1 text-xs text-muted-foreground">
                          {form.questionsPerSubject} per subject × {classSubjects.length} subjects ={' '}
                          {form.questionsPerSubject * classSubjects.length} total questions
                        </p>
                      )}
                    </div>
                  ) : (
                    <div>
                      <Label htmlFor="q-count">Total questions</Label>
                      <Input
                        id="q-count"
                        className="mt-1.5"
                        type="number"
                        min={5}
                        max={30}
                        value={form.questionCount}
                        onChange={(e) => setForm({ ...form, questionCount: parseInt(e.target.value) || 10 })}
                      />
                    </div>
                  )}
                  <div>
                    <Label htmlFor="duration">Duration (minutes)</Label>
                    <Input
                      id="duration"
                      className="mt-1.5"
                      type="number"
                      min={15}
                      max={180}
                      value={form.durationMinutes}
                      onChange={(e) => setForm({ ...form, durationMinutes: parseInt(e.target.value) || 90 })}
                    />
                  </div>
                </div>
              </div>

              {/* Advanced */}
              <div className="rounded-xl border bg-muted/20">
                <button
                  type="button"
                  className="flex w-full items-center justify-between px-4 py-3 text-sm font-medium"
                  onClick={() => setShowAdvanced(!showAdvanced)}
                >
                  Advanced options
                  <span className="text-muted-foreground">{showAdvanced ? 'Hide' : 'Show'}</span>
                </button>
                {showAdvanced && (
                  <div className="space-y-4 border-t px-4 pb-4 pt-4">
                    <div>
                      <Label className="mb-2 block">Question types</Label>
                      <div className="grid gap-2 sm:grid-cols-2">
                        {QUESTION_TYPE_OPTIONS.map((type) => {
                          const selected = form.questionTypes.includes(type.value);
                          return (
                            <label
                              key={type.value}
                              className={cn(
                                'flex cursor-pointer items-start gap-3 rounded-lg border p-3 transition-all',
                                selected
                                  ? 'border-primary bg-primary/5 ring-1 ring-primary/30'
                                  : 'hover:border-primary/30 hover:bg-muted/50',
                              )}
                            >
                              <input
                                type="checkbox"
                                checked={selected}
                                onChange={() => {
                                  setForm({
                                    ...form,
                                    questionTypes: selected
                                      ? form.questionTypes.filter((value) => value !== type.value)
                                      : [...form.questionTypes, type.value],
                                  });
                                }}
                                className="mt-0.5 rounded"
                              />
                              <span>
                                <span className="block text-sm font-medium">{type.label}</span>
                                <span className="block text-[11px] text-muted-foreground">{type.hint}</span>
                              </span>
                            </label>
                          );
                        })}
                      </div>
                      <p className="mt-2 text-xs text-muted-foreground">
                        Select one or more types. Subjective and Case study questions use text answers without options.
                      </p>
                    </div>
                    <div>
                      <Label className="mb-2 block">Difficulty</Label>
                      <div className="grid gap-2 sm:grid-cols-3">
                        {DIFFICULTY_OPTIONS.map((d) => (
                          <button
                            key={d.value}
                            type="button"
                            onClick={() => setForm({ ...form, difficulty: d.value })}
                            className={cn(
                              'rounded-lg border p-3 text-left transition-all',
                              form.difficulty === d.value
                                ? 'border-primary bg-primary/5 ring-1 ring-primary/30'
                                : 'hover:border-primary/30 hover:bg-muted/50',
                            )}
                          >
                            <p className="text-sm font-medium">{d.label}</p>
                            <p className="mt-0.5 text-[11px] text-muted-foreground">{d.hint}</p>
                          </button>
                        ))}
                      </div>
                    </div>
                    <label className="flex cursor-pointer items-center gap-2 text-sm">
                      <input
                        type="checkbox"
                        checked={form.assignToBatch}
                        onChange={(e) => setForm({ ...form, assignToBatch: e.target.checked })}
                        className="rounded"
                      />
                      Auto-assign to all students in the batch
                    </label>
                    <label className="flex cursor-pointer items-center gap-2 text-sm">
                      <input
                        type="checkbox"
                        checked={form.shuffleQuestions}
                        onChange={(e) => setForm({ ...form, shuffleQuestions: e.target.checked })}
                        className="rounded"
                      />
                      Shuffle question order for each student
                    </label>
                  </div>
                )}
              </div>

              <Button
                className="h-12 w-full text-base shadow-md"
                size="lg"
                disabled={!canCreate || createMutation.isPending}
                onClick={() => createMutation.mutate()}
              >
                {createMutation.isPending ? (
                  <>
                    <Loader2 className="mr-2 h-5 w-5 animate-spin" />
                    Generating from your books…
                  </>
                ) : (
                  <>
                    <Sparkles className="mr-2 h-5 w-5" />
                    Generate draft exam
                    <ArrowRight className="ml-2 h-4 w-4 opacity-70" />
                  </>
                )}
              </Button>

              {createMutation.isPending && (
                <p className="text-center text-sm text-muted-foreground">
                  Reading uploaded chapters and framing questions — usually 30–90 seconds.
                </p>
              )}
            </CardContent>
          </Card>

          <Card className="border-primary/15 bg-primary/[0.03]">
            <CardContent className="flex gap-3 p-4 text-sm">
              <Shield className="mt-0.5 h-5 w-5 shrink-0 text-primary" />
              <div className="space-y-1">
                <p className="font-medium">Strict document-only AI</p>
                <p className="text-muted-foreground">
                  Questions are retrieved from your indexed PDFs only — not from the internet or a static question bank.
                  Mark chapters as studied on{' '}
                  <Link href="/dashboard/batches" className="font-medium text-primary underline-offset-2 hover:underline">
                    Classes &amp; Batches
                  </Link>{' '}
                  before generating.
                </p>
              </div>
            </CardContent>
          </Card>
        </div>

        {/* Summary sidebar */}
        <div className="min-w-0 space-y-4 lg:sticky lg:top-6 lg:self-start">
          <Card className="surface-card">
            <CardHeader className="pb-3">
              <CardTitle className="text-base">Test summary</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <SummaryRow
                icon={Hash}
                label="Est. questions"
                value={selectedBatch ? String(estimatedQuestions) : '—'}
              />
              <SummaryRow
                icon={Clock}
                label="Duration"
                value={`${form.durationMinutes} min`}
              />
              <SummaryRow
                icon={GraduationCap}
                label="Batch"
                value={selectedBatch ? `${selectedBatch.academicClass.name} · ${selectedBatch.name}` : 'Not selected'}
              />

              {mode === 'all' && classSubjects.length > 0 && (
                <div>
                  <p className="mb-2 text-xs font-medium uppercase tracking-wide text-muted-foreground">
                    Subjects included
                  </p>
                  <div className="flex flex-wrap gap-1.5">
                    {classSubjects.map((s) => {
                      const missing = selectedBatch
                        && !subjectHasUploadedBook(s.id, selectedBatch.academicClass.level);
                      return (
                        <Badge
                          key={s.id}
                          variant={missing ? 'destructive' : 'secondary'}
                          className="text-xs font-normal"
                        >
                          {s.name}
                        </Badge>
                      );
                    })}
                  </div>
                  {subjectsMissingBooks.length > 0 && (
                    <ul className="mt-2 space-y-1 text-xs text-destructive">
                      {subjectsMissingBooks.map((s) => (
                        <li key={s.id}>
                          {s.name}: this book is not uploaded — first upload a book on Books &amp; Notes.
                        </li>
                      ))}
                    </ul>
                  )}
                </div>
              )}

              {mode === 'single' && selectedSubject && (
                <div>
                  <p className="mb-1 text-xs font-medium uppercase tracking-wide text-muted-foreground">Subject</p>
                  <Badge variant="secondary">{selectedSubject.name}</Badge>
                  {selectedSubjectMissingBook && (
                    <p className="mt-2 text-xs text-destructive">
                      This book is not uploaded — first upload a book on Books &amp; Notes.
                    </p>
                  )}
                </div>
              )}

              {singleSubjectMode && form.chapterIds.length > 0 && (
                <div>
                  <p className="mb-2 text-xs font-medium uppercase tracking-wide text-muted-foreground">
                    Chapters ({form.chapterIds.length})
                  </p>
                  <div className="flex flex-wrap gap-1.5">
                    {selectableChapters
                      .filter((ch) => form.chapterIds.includes(ch.id))
                      .map((ch) => (
                        <Badge key={ch.id} variant="secondary" className="text-xs font-normal">
                          Ch.{ch.number}
                        </Badge>
                      ))}
                  </div>
                </div>
              )}

              <div className="border-t pt-4">
                <p className="mb-2 text-xs font-medium uppercase tracking-wide text-muted-foreground">
                  Checklist
                </p>
                <ul className="space-y-2">
                  <ChecklistItem done={!!form.batchId} label="Batch selected" />
                  <ChecklistItem done={mode === 'all' || !!form.subjectId} label="Subject configured" />
                  <ChecklistItem
                    done={!singleSubjectMode || form.chapterIds.length > 0}
                    label={
                      singleSubjectMode
                        ? form.chapterIds.length > 0
                          ? `${form.chapterIds.length} chapter${form.chapterIds.length === 1 ? '' : 's'} selected`
                          : 'Chapters selected'
                        : 'Chapters selected'
                    }
                  />
                  <ChecklistItem done={!!form.title.trim()} label="Test name set" />
                  <ChecklistItem
                    done={mode === 'all' ? classSubjects.length > 0 : !!form.subjectId}
                    label="Subjects available for class"
                  />
                </ul>
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardContent className="space-y-3 p-4 text-sm">
              <p className="font-medium">Before you generate</p>
              <ul className="space-y-2 text-muted-foreground">
                <li className="flex gap-2">
                  <FileText className="mt-0.5 h-4 w-4 shrink-0" />
                  <span>
                    {teacherPortal ? (
                      'Make sure your admin has uploaded NCERT books for your subject'
                    ) : (
                      <>
                        Upload books on{' '}
                        <Link href="/dashboard/materials" className="text-primary hover:underline">Books &amp; Notes</Link>
                      </>
                    )}
                  </span>
                </li>
                <li className="flex gap-2">
                  <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0" />
                  <span>Mark studied chapters on Classes &amp; Batches</span>
                </li>
                <li className="flex gap-2">
                  <Sparkles className="mt-0.5 h-4 w-4 shrink-0" />
                  <span>Review &amp; edit questions before publishing</span>
                </li>
              </ul>
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  );
}

function StepIndicator({ activeStep }: { activeStep: number }) {
  return (
    <div className="flex items-center gap-2 sm:gap-4">
      {STEPS.map((step, i) => (
        <div key={step.id} className="flex flex-1 items-center gap-2 sm:gap-3">
          <div className="flex items-center gap-2 min-w-0">
            <div
              className={cn(
                'flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-xs font-bold transition-colors',
                activeStep >= step.id
                  ? 'bg-primary text-primary-foreground'
                  : 'bg-muted text-muted-foreground',
              )}
            >
              {activeStep > step.id ? <CheckCircle2 className="h-4 w-4" /> : step.id}
            </div>
            <span
              className={cn(
                'hidden truncate text-sm font-medium sm:inline',
                activeStep >= step.id ? 'text-foreground' : 'text-muted-foreground',
              )}
            >
              {step.label}
            </span>
          </div>
          {i < STEPS.length - 1 && (
            <div
              className={cn(
                'h-px flex-1',
                activeStep > step.id ? 'bg-primary/50' : 'bg-border',
              )}
            />
          )}
        </div>
      ))}
    </div>
  );
}

function ModeCard({
  active,
  icon: Icon,
  title,
  description,
  onClick,
}: {
  active: boolean;
  icon: typeof Layers;
  title: string;
  description: string;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        'rounded-xl border p-4 text-left transition-all',
        active
          ? 'border-primary bg-primary/5 ring-2 ring-primary/20 shadow-sm'
          : 'hover:border-primary/30 hover:bg-muted/30',
      )}
    >
      <div
        className={cn(
          'mb-3 flex h-10 w-10 items-center justify-center rounded-lg',
          active ? 'bg-primary/15 text-primary' : 'bg-muted text-muted-foreground',
        )}
      >
        <Icon className="h-5 w-5" />
      </div>
      <p className="font-semibold">{title}</p>
      <p className="mt-1 text-xs leading-relaxed text-muted-foreground">{description}</p>
    </button>
  );
}

function SummaryRow({
  icon: Icon,
  label,
  value,
}: {
  icon: typeof Hash;
  label: string;
  value: string;
}) {
  return (
    <div className="flex items-start gap-3">
      <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-muted">
        <Icon className="h-4 w-4 text-muted-foreground" />
      </div>
      <div className="min-w-0">
        <p className="text-xs text-muted-foreground">{label}</p>
        <p className="text-sm font-medium leading-snug">{value}</p>
      </div>
    </div>
  );
}

function ChecklistItem({ done, label }: { done: boolean; label: string }) {
  return (
    <li className="flex items-center gap-2 text-sm">
      <CheckCircle2
        className={cn('h-4 w-4 shrink-0', done ? 'text-emerald-600' : 'text-muted-foreground/40')}
      />
      <span className={done ? 'text-foreground' : 'text-muted-foreground'}>{label}</span>
    </li>
  );
}
