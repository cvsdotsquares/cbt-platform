'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { PageHeader } from '@/components/layout/page-header';
import { StatCard } from '@/components/layout/stat-card';
import { EmptyState } from '@/components/layout/data-table';
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from '@/components/ui/dialog';
import { batchesApi, curriculumApi, candidatesApi, usersApi, materialsApi } from '@/lib/api';
import { useRequireAuth } from '@/hooks/use-auth';
import { usePermissions } from '@/hooks/use-permissions';
import { Permission } from '@cbt/shared';
import { sessionsMatch } from '@/lib/academic-session';
import { batchSectionKey, compareBatchesForList, formatBatchListTitle } from '@/lib/academic-class';
import {
  MATERIALS_INDEX_POLL_MS,
  materialsNeedLivePoll,
} from '@/lib/materials-indexing-poll';
import { useMaterialIndexingSync } from '@/hooks/use-material-indexing-sync';
import {
  batchSyllabusChapterIds,
  filterSubjectsForBatchSyllabusView,
  materialVisibleForBatch,
  materialVisibleForClassSyllabus,
  isFullBookMaterial,
  mergeBatchSyllabus,
  resolveBatchSubjectBookSections,
  subjectHasBatchUploads,
  subjectProgressStatsForBatch,
  syllabusRowsFromMaterialChapters,
  type BatchMaterialRow,
  type BatchSubjectBookSection,
  type CurriculumClass,
  type SyllabusChapterRow,
  type SyllabusSubjectRow,
} from '@/lib/batch-syllabus';
import { hideBatchSyllabusBook, readHiddenBatchSyllabusBooks } from '@/lib/batch-syllabus-hidden';
import { toast } from '@/hooks/use-toast';
import {
  School, Users, Plus, Search, Filter, X,
  GraduationCap, BookOpen, UserPlus, Trash2, Pencil, Upload, UserCog, ChevronDown,
} from 'lucide-react';
import { TableSkeleton } from '@/components/ui/skeleton';
import Link from 'next/link';
import { cn } from '@/lib/utils';
import { useAuthStore } from '@/stores/auth-store';
import { isTeacherOnly, normalizeRoles } from '@/lib/roles';
import { guessSubjectId } from '@/lib/subject-guess';

type Batch = {
  id: string;
  name: string;
  academicYear: string;
  academicClass: { id: string; name: string; level: number };
  _count: { enrollments: number };
  teacherAssignments?: { subject: { id: string; name: string } }[];
};

type BatchForm = { name: string; academicYear: string; academicClassId: string };

type SyllabusSubject = SyllabusSubjectRow;

type TabId = 'students' | 'syllabus' | 'teachers';

type BatchTeacherAssignment = {
  id: string;
  userId: string;
  subjectId: string;
  subject: { id: string; name: string };
  user: { id: string; firstName: string; lastName: string; email: string } | null;
};

type StaffUser = {
  id: string;
  firstName: string;
  lastName: string;
  email: string;
  userRoles: { role: { name: string } }[];
};

const BATCH_HOVER_SURFACE =
  'hover:bg-white hover:text-foreground dark:hover:bg-white dark:hover:text-foreground';

const BATCH_OUTLINE_BTN =
  'hover:bg-white hover:text-foreground dark:hover:bg-white dark:hover:text-foreground';

const BATCH_FILTER_FIELD =
  'flex h-9 w-full rounded-md border border-border/70 bg-white px-2 text-sm text-foreground shadow-none';

/** ~6 batch rows (two-line item + gap) before scrolling */
const BATCH_LIST_SCROLL_MAX_CLASS = 'max-h-[calc(6*3.625rem+5*0.25rem)]';

const SYLLABUS_MARK_SURFACE = 'bg-primary/[0.05]';

const STATUS_CONFIG = {
  COMPLETED: {
    label: 'Done',
    dot: 'bg-primary',
    active: 'rounded-md bg-primary text-primary-foreground shadow-sm shadow-primary/25',
  },
  IN_PROGRESS: {
    label: 'Studying',
    dot: 'bg-primary/70',
    active: 'rounded-md bg-primary/15 text-primary shadow-sm ring-1 ring-primary/25',
  },
  NOT_STARTED: {
    label: 'Not started',
    dot: 'bg-muted-foreground/35',
    active: 'rounded-md bg-primary/10 text-foreground shadow-sm ring-1 ring-primary/20',
  },
};

const MARK_PROGRESS_INACTIVE_TAB =
  'rounded-md px-2.5 py-1.5 text-xs font-semibold text-muted-foreground transition-all hover:bg-primary/10 hover:text-foreground';

const SYLLABUS_BOOK_ROW =
  'rounded-xl border border-primary/15 bg-card shadow-sm transition-colors';

const SYLLABUS_BOOK_ROW_HOVER =
  'hover:border-primary/30 hover:bg-primary/[0.04]';

const SYLLABUS_BOOK_ROW_OPEN =
  'border-primary/40 bg-primary/[0.04] ring-1 ring-primary/15';

const STATUS_CYCLE = ['NOT_STARTED', 'IN_PROGRESS', 'COMPLETED'] as const;

function nextChapterStatus(current: string): (typeof STATUS_CYCLE)[number] {
  const idx = STATUS_CYCLE.indexOf(current as (typeof STATUS_CYCLE)[number]);
  return STATUS_CYCLE[(idx + 1) % STATUS_CYCLE.length];
}

function applyLiveChapterStatuses(
  sections: BatchSubjectBookSection[],
  liveStatus: ReadonlyMap<string, string>,
): BatchSubjectBookSection[] {
  if (!liveStatus.size) return sections;
  return sections.map((section) => ({
    ...section,
    chapters: section.chapters.map((ch) => {
      const next = liveStatus.get(ch.id);
      return next ? { ...ch, status: next } : ch;
    }),
  }));
}

function patchSyllabusProgressCache(
  queryClient: ReturnType<typeof useQueryClient>,
  batchId: string,
  chapterId: string,
  status: string,
) {
  queryClient.setQueryData<SyllabusSubject[]>(['syllabus-progress', batchId], (old) => {
    if (!old?.length) return old;
    let touched = false;
    const next = old.map((subj) => ({
      ...subj,
      chapters: subj.chapters.map((ch) => {
        if (ch.id !== chapterId) return ch;
        touched = true;
        return { ...ch, status };
      }),
    }));
    return touched ? next : old;
  });
}

function ProgressRing({ percent, className }: { percent: number; className?: string }) {
  const size = 72;
  const stroke = 7;
  const radius = (size - stroke) / 2;
  const circumference = 2 * Math.PI * radius;
  const clamped = Math.min(100, Math.max(0, percent));
  const offset = circumference - (clamped / 100) * circumference;
  const gradientId = 'batch-progress-ring';

  return (
    <div
      className={cn(
        'relative shrink-0 rounded-full bg-primary/5 ring-1 ring-primary/10',
        className,
      )}
      style={{ width: size, height: size }}
      title={`${clamped}% complete`}
    >
      <svg width={size} height={size} className="-rotate-90" viewBox={`0 0 ${size} ${size}`}>
        <defs>
          <linearGradient id={gradientId} x1="0%" y1="0%" x2="100%" y2="0%">
            <stop offset="0%" stopColor="#60a5fa" />
            <stop offset="50%" stopColor="#a78bfa" />
            <stop offset="100%" stopColor="#34d399" />
          </linearGradient>
        </defs>
        <circle
          cx={size / 2}
          cy={size / 2}
          r={radius}
          fill="none"
          stroke="#e2e8f0"
          strokeWidth={stroke}
        />
        <circle
          cx={size / 2}
          cy={size / 2}
          r={radius}
          fill="none"
          stroke={`url(#${gradientId})`}
          strokeWidth={stroke}
          strokeLinecap="round"
          strokeDasharray={circumference}
          strokeDashoffset={offset}
          className="transition-all duration-700"
        />
      </svg>
      <div className="absolute inset-0 flex flex-col items-center justify-center">
        <span className="text-sm font-bold tabular-nums leading-none text-foreground">{clamped}%</span>
        <span className="mt-0.5 text-[9px] font-semibold uppercase tracking-wider text-muted-foreground">Done</span>
      </div>
    </div>
  );
}

function calcProgress(subjects: SyllabusSubject[]) {
  const chapters = subjects.flatMap((s) => s.chapters);
  if (!chapters.length) return { percent: 0, studied: 0, total: 0, completed: 0 };
  const completed = chapters.filter((c) => c.status === 'COMPLETED').length;
  const studied = chapters.filter((c) => c.status === 'COMPLETED' || c.status === 'IN_PROGRESS').length;
  return {
    percent: Math.round((completed / chapters.length) * 100),
    studied,
    total: chapters.length,
    completed,
  };
}

function initials(first: string, last: string) {
  return `${first.charAt(0)}${last.charAt(0)}`.toUpperCase();
}

export default function BatchesPage() {
  const searchParams = useSearchParams();
  const batchFromQuery = searchParams.get('batch');
  const { accessToken } = useRequireAuth(true);
  const { can } = usePermissions();
  const { user } = useAuthStore();
  const teacherPortal = isTeacherOnly(normalizeRoles(user?.roles));
  const canManage = can(Permission.BATCH_MANAGE);
  const queryClient = useQueryClient();
  const [selectedBatch, setSelectedBatch] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState<TabId>('syllabus');
  const [selectedSubjectId, setSelectedSubjectId] = useState<string | null>(null);
  const [showCreate, setShowCreate] = useState(false);
  const [showEdit, setShowEdit] = useState(false);
  const [search, setSearch] = useState('');
  const [filterClassLevel, setFilterClassLevel] = useState<string>('all');
  const [filterSection, setFilterSection] = useState<string>('all');
  const [filterSession, setFilterSession] = useState<string>('all');
  const [filterPanelOpen, setFilterPanelOpen] = useState(false);
  const filterPanelRef = useRef<HTMLDivElement>(null);
  const [form, setForm] = useState<BatchForm>({ name: '', academicYear: '2025-26', academicClassId: '' });
  const [editForm, setEditForm] = useState<BatchForm>({ name: '', academicYear: '', academicClassId: '' });
  const [enrollCandidateId, setEnrollCandidateId] = useState('');
  const [enrollRoll, setEnrollRoll] = useState('');
  const [showDelete, setShowDelete] = useState(false);
  const [assignTeacherUserId, setAssignTeacherUserId] = useState('');
  const [assignSubjectId, setAssignSubjectId] = useState('');
  const [syllabusHiddenRevision, setSyllabusHiddenRevision] = useState(0);
  const [expandedBookKeys, setExpandedBookKeys] = useState<Set<string>>(() => new Set());
  const [bookToHide, setBookToHide] = useState<BatchSubjectBookSection | null>(null);
  /** Optimistic chapter status until syllabus-progress refetch confirms. */
  const [liveChapterStatus, setLiveChapterStatus] = useState<Map<string, string>>(() => new Map());
  const [progressChapterPending, setProgressChapterPending] = useState<string | null>(null);

  const hiddenBookKeys = useMemo(() => {
    void syllabusHiddenRevision;
    return readHiddenBatchSyllabusBooks(selectedBatch ?? '');
  }, [selectedBatch, syllabusHiddenRevision]);

  const { data: batches, isLoading } = useQuery({
    queryKey: ['batches'],
    queryFn: () => batchesApi.list(accessToken!) as Promise<Batch[]>,
    enabled: !!accessToken,
  });

  const { data: classes } = useQuery({
    queryKey: ['curriculum-classes'],
    queryFn: () => curriculumApi.getClasses(accessToken!) as Promise<{ id: string; level: number; name: string }[]>,
    enabled: !!accessToken,
  });

  const { data: progress, isLoading: progressLoading } = useQuery({
    queryKey: ['syllabus-progress', selectedBatch],
    queryFn: () => batchesApi.getSyllabusProgress(accessToken!, selectedBatch!) as Promise<SyllabusSubject[]>,
    enabled: !!accessToken && !!selectedBatch,
    refetchInterval: 30_000,
    refetchIntervalInBackground: false,
  });

  const { data: materials } = useQuery({
    queryKey: ['materials'],
    queryFn: () => materialsApi.list(accessToken!) as Promise<BatchMaterialRow[]>,
    enabled: !!accessToken && !!selectedBatch && activeTab === 'syllabus',
    staleTime: 0,
    refetchInterval: (query) =>
      materialsNeedLivePoll(query.state.data as BatchMaterialRow[] | undefined)
        ? MATERIALS_INDEX_POLL_MS
        : false,
  });

  useMaterialIndexingSync(queryClient, materials);

  const { data: batchDetail } = useQuery({
    queryKey: ['batch-detail', selectedBatch],
    queryFn: () => batchesApi.get(accessToken!, selectedBatch!) as Promise<{
      name: string;
      academicYear: string;
      academicClass: { id: string; name: string; level: number; subjects?: { id: string; name: string }[] };
      enrollments: {
        id: string;
        rollNumber?: string;
        candidate: { id: string; registrationNumber: string; user: { firstName: string; lastName: string } };
      }[];
    }>,
    enabled: !!accessToken && !!selectedBatch,
  });

  const academicClassId = batchDetail?.academicClass.id;
  const { data: curriculumClass, isLoading: curriculumClassLoading } = useQuery({
    queryKey: ['curriculum-class', academicClassId],
    queryFn: () => curriculumApi.getClass(accessToken!, academicClassId!) as Promise<CurriculumClass>,
    enabled: !!accessToken && !!academicClassId && activeTab === 'syllabus',
  });

  const batchClassLevel = batchDetail?.academicClass.level;

  const { data: uploadCurriculumClasses } = useQuery({
    queryKey: ['curriculum-from-uploads'],
    queryFn: () =>
      curriculumApi.getClasses(accessToken!, { uploadedOnly: true, includeTopics: true }) as Promise<CurriculumClass[]>,
    enabled: !!accessToken && activeTab === 'syllabus',
    staleTime: 0,
    refetchInterval: materialsNeedLivePoll(materials) ? MATERIALS_INDEX_POLL_MS : false,
  });

  const curriculumForBatchLevel = useMemo(() => {
    if (batchClassLevel == null) return curriculumClass ?? null;
    const fromUploads = (uploadCurriculumClasses ?? []).find((c) => c.level === batchClassLevel);
    if (fromUploads) return fromUploads;
    return curriculumClass ?? null;
  }, [batchClassLevel, uploadCurriculumClasses, curriculumClass]);

  const { data: candidatesData } = useQuery({
    queryKey: ['candidates-enroll'],
    queryFn: () => candidatesApi.list(accessToken!, 1, ''),
    enabled: !!accessToken && !!selectedBatch && activeTab === 'students',
  });

  const { data: batchTeachers, isLoading: teachersLoading } = useQuery({
    queryKey: ['batch-teachers', selectedBatch],
    queryFn: () => batchesApi.listTeachers(accessToken!, selectedBatch!) as Promise<BatchTeacherAssignment[]>,
    enabled: !!accessToken && !!selectedBatch && (activeTab === 'teachers' || canManage),
  });

  const { data: staffUsersData } = useQuery({
    queryKey: ['staff-teachers-for-batch'],
    queryFn: () => usersApi.list(accessToken!, 1, '', 100) as Promise<{ items: StaffUser[] }>,
    enabled: !!accessToken && canManage && activeTab === 'teachers',
  });

  const teacherOptions = useMemo(
    () => (staffUsersData?.items ?? []).filter((u) =>
      u.userRoles.some((ur) => ur.role.name === 'TEACHER'),
    ),
    [staffUsersData],
  );

  const batchSubjects = batchDetail?.academicClass.subjects ?? [];

  const batchFilterOptions = useMemo(() => {
    const list = batches ?? [];
    const levels = [...new Set(list.map((b) => b.academicClass.level))].sort((a, b) => a - b);
    const sections = [...new Set(list.map((b) => batchSectionKey(b)))].sort();
    const sessions = [...new Set(list.map((b) => b.academicYear).filter(Boolean))].sort();
    return { levels, sections, sessions };
  }, [batches]);

  const filteredBatches = useMemo(() => {
    let list = batches ?? [];
    if (filterClassLevel !== 'all') {
      const level = Number(filterClassLevel);
      list = list.filter((b) => b.academicClass.level === level);
    }
    if (filterSection !== 'all') {
      list = list.filter((b) => batchSectionKey(b) === filterSection);
    }
    if (filterSession !== 'all') {
      list = list.filter((b) => sessionsMatch(b.academicYear, filterSession));
    }
    const q = search.trim().toLowerCase();
    if (q) {
      list = list.filter(
        (b) =>
          b.name.toLowerCase().includes(q)
          || b.academicClass.name.toLowerCase().includes(q)
          || b.academicYear.includes(q)
          || formatBatchListTitle(b).toLowerCase().includes(q),
      );
    }
    return [...list].sort(compareBatchesForList);
  }, [batches, search, filterClassLevel, filterSection, filterSession]);

  const batchFiltersActive =
    filterClassLevel !== 'all' || filterSection !== 'all' || filterSession !== 'all';

  useEffect(() => {
    if (!filterPanelOpen) return;
    function onPointerDown(event: MouseEvent) {
      if (!filterPanelRef.current?.contains(event.target as Node)) {
        setFilterPanelOpen(false);
      }
    }
    document.addEventListener('mousedown', onPointerDown);
    return () => document.removeEventListener('mousedown', onPointerDown);
  }, [filterPanelOpen]);

  const selectedBatchMeta = (batches ?? []).find((b) => b.id === selectedBatch);

  const siblingBatchIds = useMemo(() => {
    if (!selectedBatchMeta) return undefined;
    const ids = new Set<string>();
    for (const b of batches ?? []) {
      if (
        b.academicClass.level === selectedBatchMeta.academicClass.level
        && sessionsMatch(b.academicYear, selectedBatchMeta.academicYear)
      ) {
        ids.add(b.id);
      }
    }
    return ids;
  }, [batches, selectedBatchMeta]);

  const batchMaterialsForStats = useMemo(() => {
    if (!selectedBatch) return [];
    return (materials ?? []).filter((m) =>
      materialVisibleForBatch(m, selectedBatch, siblingBatchIds),
    );
  }, [materials, selectedBatch, siblingBatchIds]);

  const syllabusMaterials = useMemo(() => {
    if (!batchDetail) return [];
    const level = batchDetail.academicClass.level;
    const year = batchDetail.academicYear;
    return batchMaterialsForStats.filter((m) =>
      materialVisibleForClassSyllabus(m, level, year),
    );
  }, [batchMaterialsForStats, batchDetail]);

  const mergedSyllabus = useMemo(
    () => mergeBatchSyllabus(progress ?? [], curriculumForBatchLevel ?? null, syllabusMaterials),
    [progress, curriculumForBatchLevel, syllabusMaterials],
  );

  const allowedChapterIds = useMemo(
    () => batchSyllabusChapterIds(
      mergedSyllabus.subjects,
      syllabusMaterials,
      curriculumForBatchLevel ?? null,
      batchDetail?.academicClass.level,
      hiddenBookKeys,
    ),
    [mergedSyllabus.subjects, syllabusMaterials, curriculumForBatchLevel, batchDetail?.academicClass.level, hiddenBookKeys],
  );

  const assignedSubjectIds = useMemo(() => {
    if (!teacherPortal) return null;
    return new Set((selectedBatchMeta?.teacherAssignments ?? []).map((a) => a.subject.id));
  }, [teacherPortal, selectedBatchMeta]);

  const visibleProgress = useMemo(() => {
    let rows: SyllabusSubject[];
    if (curriculumForBatchLevel && !curriculumClassLoading) {
      if (allowedChapterIds.size > 0) {
        rows = filterSubjectsForBatchSyllabusView(mergedSyllabus.subjects, allowedChapterIds);
      } else {
        const merged = mergedSyllabus.subjects.filter(
          (s) =>
            s.chapters.length > 0
            || subjectHasBatchUploads(batchMaterialsForStats, s.subject.id),
        );
        rows = merged.length ? merged : (progress ?? []);
      }
    } else {
      rows = progress ?? [];
    }
    if (!assignedSubjectIds) return rows;
    return rows.filter((row) => assignedSubjectIds.has(row.subject.id));
  }, [
    progress,
    mergedSyllabus.subjects,
    allowedChapterIds,
    curriculumForBatchLevel,
    curriculumClassLoading,
    assignedSubjectIds,
    batchMaterialsForStats,
  ]);

  const classSubjectHints = useMemo(() => {
    const map = new Map<string, { id: string; name: string; code: string }>();
    for (const s of curriculumForBatchLevel?.subjects ?? []) {
      map.set(s.id, { id: s.id, name: s.name, code: (s as { code?: string }).code ?? '' });
    }
    for (const s of curriculumClass?.subjects ?? []) {
      map.set(s.id, { id: s.id, name: s.name, code: (s as { code?: string }).code ?? '' });
    }
    for (const s of batchSubjects) {
      map.set(s.id, { id: s.id, name: s.name, code: '' });
    }
    return [...map.values()];
  }, [curriculumForBatchLevel, curriculumClass, batchSubjects]);

  const progressStats = useMemo(() => {
    if (!batchMaterialsForStats.length) return calcProgress(visibleProgress);
    let completed = 0;
    let studied = 0;
    let total = 0;
    for (const sp of visibleProgress) {
      const stats = subjectProgressStatsForBatch(batchMaterialsForStats, sp, syllabusMaterials);
      completed += stats.completed;
      studied += stats.studied;
      total += stats.total;
    }
    return {
      percent: total ? Math.round((completed / total) * 100) : 0,
      studied,
      total,
      completed,
    };
  }, [visibleProgress, batchMaterialsForStats, syllabusMaterials]);

  const activeSubject = useMemo(() => {
    if (!visibleProgress.length) return null;
    return visibleProgress.find((s) => s.subject.id === selectedSubjectId) ?? visibleProgress[0];
  }, [visibleProgress, selectedSubjectId]);

  const materialsForActiveSubject = useMemo(() => {
    if (!activeSubject || batchClassLevel == null || !batchDetail) return syllabusMaterials;
    const level = batchClassLevel;
    const year = batchDetail.academicYear;
    const pool = batchMaterialsForStats.filter(
      (m) => m.academicClass?.level === level && materialVisibleForClassSyllabus(m, level, year),
    );
    const subjectName = activeSubject.subject.name.trim().toLowerCase();
    const matched = pool.filter((m) => {
      const guessed = guessSubjectId(
        m.fileName ?? m.title,
        m.title,
        classSubjectHints,
        m.subjectId ?? m.subject?.id ?? null,
      );
      if (guessed === activeSubject.subject.id) return true;
      return (m.subject?.name ?? '').trim().toLowerCase() === subjectName;
    });
    return matched.length ? matched : syllabusMaterials;
  }, [
    activeSubject,
    batchClassLevel,
    batchDetail,
    batchMaterialsForStats,
    syllabusMaterials,
    classSubjectHints,
  ]);

  useEffect(() => {
    if (batchFromQuery && batches?.some((b) => b.id === batchFromQuery)) {
      setSelectedBatch(batchFromQuery);
      return;
    }
    if (!selectedBatch && batches?.length) {
      const first = [...batches].sort(compareBatchesForList)[0];
      setSelectedBatch(first.id);
    }
  }, [batches, selectedBatch, batchFromQuery]);

  useEffect(() => {
    if (!visibleProgress.length) return;
    const stillVisible = visibleProgress.some((row) => row.subject.id === selectedSubjectId);
    if (!selectedSubjectId || !stillVisible) {
      setSelectedSubjectId(visibleProgress[0].subject.id);
    }
  }, [visibleProgress, selectedSubjectId]);

  useEffect(() => {
    setSelectedSubjectId(null);
    setAssignTeacherUserId('');
    setAssignSubjectId('');
    setExpandedBookKeys(new Set());
    setBookToHide(null);
    setLiveChapterStatus(new Map());
    setSyllabusHiddenRevision((n) => n + 1);
  }, [selectedBatch]);

  useEffect(() => {
    if (!progress?.length || liveChapterStatus.size === 0) return;
    setLiveChapterStatus((prev) => {
      if (!prev.size) return prev;
      const serverStatus = new Map<string, string>();
      for (const subj of progress) {
        for (const ch of subj.chapters) {
          serverStatus.set(ch.id, ch.status);
        }
      }
      let changed = false;
      const next = new Map(prev);
      for (const [chapterId, optimistic] of prev) {
        if (serverStatus.get(chapterId) === optimistic) {
          next.delete(chapterId);
          changed = true;
        }
      }
      return changed ? next : prev;
    });
  }, [progress, liveChapterStatus.size]);

  const allCurriculumBooks = useMemo(() => {
    const books = [
      ...(curriculumForBatchLevel?.subjects.flatMap((s) => s.books) ?? []),
      ...(curriculumClass?.subjects.flatMap((s) => s.books) ?? []),
    ];
    const seen = new Set<string>();
    return books.filter((b) => {
      if (seen.has(b.id)) return false;
      seen.add(b.id);
      return true;
    });
  }, [curriculumForBatchLevel, curriculumClass]);

  const activeSubjectBookSections = useMemo(() => {
    if (!activeSubject) return [];
    const curriculumBooks =
      curriculumForBatchLevel?.subjects.find((s) => s.id === activeSubject.subject.id)?.books
      ?? curriculumClass?.subjects.find((s) => s.id === activeSubject.subject.id)?.books
      ?? [];
    return resolveBatchSubjectBookSections(
      activeSubject,
      materialsForActiveSubject,
      curriculumBooks,
      {
        classLevel: batchClassLevel,
        allCurriculumBooks,
        hiddenKeys: hiddenBookKeys,
      },
    );
  }, [
    activeSubject,
    curriculumForBatchLevel,
    curriculumClass,
    materialsForActiveSubject,
    batchClassLevel,
    allCurriculumBooks,
    hiddenBookKeys,
  ]);

  const fullBookMaterialIds = useMemo(
    () => materialsForActiveSubject.filter(isFullBookMaterial).map((m) => m.id),
    [materialsForActiveSubject],
  );

  const { data: extractedChaptersByMaterial } = useQuery({
    queryKey: ['material-extracted-chapters', selectedBatch, ...fullBookMaterialIds],
    queryFn: async () => {
      const map = new Map<
        string,
        {
          chapters: { id: string; chapterNumber: number; title: string }[];
          extractionFailed: boolean;
        }
      >();
      await Promise.all(
        fullBookMaterialIds.map(async (materialId) => {
          const res = await materialsApi.chapters(accessToken!, materialId) as {
            chapters: { id: string; chapterNumber: number; title: string }[];
            extractionFailed?: boolean;
          };
          map.set(materialId, {
            chapters: res.chapters ?? [],
            extractionFailed: Boolean(res.extractionFailed),
          });
        }),
      );
      return map;
    },
    enabled: !!accessToken && !!selectedBatch && activeTab === 'syllabus' && fullBookMaterialIds.length > 0,
    staleTime: 15_000,
  });

  const activeSubjectBookSectionsDisplay = useMemo(() => {
    if (!activeSubject) return activeSubjectBookSections;
    return activeSubjectBookSections.map((section) => {
      if (!section.materialId) return section;
      const raw = extractedChaptersByMaterial?.get(section.materialId);
      const apiChapters = Array.isArray(raw)
        ? raw
        : (raw?.chapters ?? []);
      const extractionFailed = Array.isArray(raw)
        ? false
        : Boolean(raw?.extractionFailed);
      if (apiChapters.length > 0) {
        return {
          ...section,
          extractionFailed: false,
          chapters: syllabusRowsFromMaterialChapters(
            activeSubject.chapters,
            apiChapters,
            section.bookId,
          ),
        };
      }
      if (section.isUpload) {
        return {
          ...section,
          chapters: [],
          extractionFailed,
        };
      }
      return section;
    });
  }, [activeSubject, activeSubjectBookSections, extractedChaptersByMaterial]);

  const activeSubjectBookSectionsLive = useMemo(
    () => applyLiveChapterStatuses(activeSubjectBookSectionsDisplay, liveChapterStatus),
    [activeSubjectBookSectionsDisplay, liveChapterStatus],
  );

  const activeBookSectionKeys = useMemo(
    () => activeSubjectBookSectionsLive.map((s) => s.key).join('|'),
    [activeSubjectBookSectionsLive],
  );

  useEffect(() => {
    if (!activeSubject?.subject.id) return;
    if (activeSubjectBookSectionsLive.length > 0) {
      setExpandedBookKeys(new Set([activeSubjectBookSectionsLive[0].key]));
    } else {
      setExpandedBookKeys(new Set());
    }
  }, [activeSubject?.subject.id, activeBookSectionKeys, activeSubjectBookSectionsLive.length]);

  function toggleBookExpanded(bookKey: string) {
    setExpandedBookKeys((current) => {
      const next = new Set(current);
      if (next.has(bookKey)) next.delete(bookKey);
      else next.add(bookKey);
      return next;
    });
  }

  function renderChapterRow(ch: SyllabusChapterRow) {
    const st = STATUS_CONFIG[ch.status as keyof typeof STATUS_CONFIG] ?? STATUS_CONFIG.NOT_STARTED;
    const rowPending = progressChapterPending === ch.id;
    return (
      <div
        key={ch.id}
        className="rounded-2xl border border-primary/10 bg-card/80 px-3.5 py-3 transition-colors hover:border-primary/20 hover:bg-card"
      >
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <button
            type="button"
            disabled={rowPending}
            title="Click to cycle: Not started → Studying → Done"
            onClick={() => updateProgress.mutate({
              chapterId: ch.id,
              status: nextChapterStatus(ch.status),
            })}
            className={cn(
              'flex min-w-0 flex-1 items-center gap-3 rounded-lg text-left transition-colors',
              'cursor-pointer hover:bg-primary/5 disabled:cursor-wait disabled:opacity-70',
            )}
          >
            <span className={cn('h-2.5 w-2.5 shrink-0 rounded-full ring-2 ring-background', st.dot)} />
            <p className="min-w-0 truncate text-sm font-semibold text-foreground">
              <span className="mr-2 inline-flex rounded-full bg-primary/10 px-2 py-0.5 font-mono text-[11px] font-bold text-primary">
                Ch.{ch.number}
              </span>
              {ch.title}
            </p>
          </button>
          <div
            className="flex shrink-0 flex-wrap gap-0.5 rounded-lg border border-primary/15 bg-primary/[0.04] p-0.5 shadow-inner sm:ml-4"
            role="group"
            aria-label={`Progress for chapter ${ch.number}`}
          >
            {STATUS_CYCLE.map((s) => {
              const cfg = STATUS_CONFIG[s];
              const active = ch.status === s;
              return (
                <button
                  key={s}
                  type="button"
                  disabled={rowPending}
                  aria-pressed={active}
                  onClick={() => updateProgress.mutate({ chapterId: ch.id, status: s })}
                  className={cn(
                    'min-w-[4.5rem] px-2.5 py-1.5 text-xs font-semibold transition-all disabled:opacity-60',
                    active ? cfg.active : MARK_PROGRESS_INACTIVE_TAB,
                  )}
                >
                  {cfg.label}
                </button>
              );
            })}
          </div>
        </div>
      </div>
    );
  }

  const totalStudents = useMemo(
    () => (batches ?? []).reduce((sum, b) => sum + b._count.enrollments, 0),
    [batches],
  );

  const classCount = useMemo(
    () => new Set((batches ?? []).map((b) => b.academicClass.level)).size,
    [batches],
  );

  const enrollMutation = useMutation({
    mutationFn: () => batchesApi.enroll(accessToken!, selectedBatch!, {
      candidateId: enrollCandidateId,
      rollNumber: enrollRoll || undefined,
    }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['batch-detail', selectedBatch] });
      queryClient.invalidateQueries({ queryKey: ['batches'] });
      setEnrollCandidateId('');
      setEnrollRoll('');
      toast({ title: 'Student added to batch' });
    },
    onError: (e: Error) => toast({ title: 'Could not enroll', description: e.message, variant: 'destructive' }),
  });

  const assignTeacherMutation = useMutation({
    mutationFn: () =>
      batchesApi.assignTeacher(accessToken!, selectedBatch!, {
        userId: assignTeacherUserId,
        subjectId: assignSubjectId,
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['batch-teachers', selectedBatch] });
      queryClient.invalidateQueries({ queryKey: ['users'] });
      queryClient.invalidateQueries({ queryKey: ['teacher-assignments'] });
      setAssignTeacherUserId('');
      setAssignSubjectId('');
      toast({ title: 'Teacher assigned', variant: 'success' });
    },
    onError: (e: Error) =>
      toast({ title: 'Could not assign teacher', description: e.message, variant: 'destructive' }),
  });

  const removeTeacherMutation = useMutation({
    mutationFn: (assignmentId: string) =>
      batchesApi.removeTeacher(accessToken!, selectedBatch!, assignmentId),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['batch-teachers', selectedBatch] });
      toast({ title: 'Teacher removed', variant: 'success' });
    },
    onError: (e: Error) =>
      toast({ title: 'Could not remove teacher', description: e.message, variant: 'destructive' }),
  });

  const createMutation = useMutation({
    mutationFn: () => batchesApi.create(accessToken!, form),
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ['batches'] });
      setShowCreate(false);
      setForm({ name: '', academicYear: '2025-26', academicClassId: '' });
      const created = data as { id?: string };
      if (created?.id) setSelectedBatch(created.id);
      toast({ title: 'Batch created', description: 'Add students and mark studied chapters.' });
    },
    onError: (e: Error) => toast({ title: 'Could not create batch', description: e.message, variant: 'destructive' }),
  });

  const updateMutation = useMutation({
    mutationFn: () => batchesApi.update(accessToken!, selectedBatch!, editForm),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['batches'] });
      queryClient.invalidateQueries({ queryKey: ['batch-detail', selectedBatch] });
      queryClient.invalidateQueries({ queryKey: ['candidates'] });
      setShowEdit(false);
      toast({ title: 'Batch updated' });
    },
    onError: (e: Error) => toast({ title: 'Could not update batch', description: e.message, variant: 'destructive' }),
  });

  const deleteMutation = useMutation({
    mutationFn: () => batchesApi.remove(accessToken!, selectedBatch!),
    onSuccess: (data) => {
      const result = data as { name?: string; studentsUnassigned?: number };
      queryClient.invalidateQueries({ queryKey: ['batches'] });
      queryClient.invalidateQueries({ queryKey: ['candidates'] });
      queryClient.invalidateQueries({ queryKey: ['batch-detail'] });
      setShowDelete(false);
      setSelectedBatch(null);
      toast({
        title: 'Batch deleted',
        description: result.studentsUnassigned
          ? `${result.studentsUnassigned} student(s) are now unassigned.`
          : undefined,
        variant: 'success',
      });
    },
    onError: (e: Error) => toast({ title: 'Could not delete batch', description: e.message, variant: 'destructive' }),
  });

  const updateProgress = useMutation({
    mutationFn: ({ chapterId, status }: { chapterId: string; status: string }) =>
      batchesApi.updateSyllabusProgress(accessToken!, selectedBatch!, { chapterId, status }),
    onMutate: async ({ chapterId, status }) => {
      if (!selectedBatch) return {};
      setProgressChapterPending(chapterId);
      setLiveChapterStatus((prev) => {
        const next = new Map(prev);
        next.set(chapterId, status);
        return next;
      });
      await queryClient.cancelQueries({ queryKey: ['syllabus-progress', selectedBatch] });
      const previous = queryClient.getQueryData<SyllabusSubject[]>([
        'syllabus-progress',
        selectedBatch,
      ]);
      patchSyllabusProgressCache(queryClient, selectedBatch, chapterId, status);
      return { previous, chapterId };
    },
    onError: (e: Error, { chapterId }, context) => {
      if (selectedBatch && context?.previous) {
        queryClient.setQueryData(['syllabus-progress', selectedBatch], context.previous);
      }
      setLiveChapterStatus((prev) => {
        if (!prev.has(chapterId)) return prev;
        const next = new Map(prev);
        next.delete(chapterId);
        return next;
      });
      toast({
        title: 'Could not update progress',
        description: e.message,
        variant: 'destructive',
      });
    },
    onSettled: () => {
      setProgressChapterPending(null);
      if (selectedBatch) {
        void queryClient.invalidateQueries({ queryKey: ['syllabus-progress', selectedBatch] });
      }
    },
  });

  const enrolledIds = new Set((batchDetail?.enrollments ?? []).map((e) => e.candidate.id));
  const availableCandidates = ((candidatesData?.items ?? []) as {
    id: string;
    registrationNumber: string;
    user: { firstName: string; lastName: string };
  }[]).filter((c) => !enrolledIds.has(c.id));

  function openEditDialog() {
    const meta = selectedBatchMeta;
    const detail = batchDetail;
    if (!meta) return;
    const classId = detail?.academicClass.id
      ?? classes?.find((c) => c.level === meta.academicClass.level)?.id
      ?? '';
    setEditForm({
      name: detail?.name ?? meta.name,
      academicYear: detail?.academicYear ?? meta.academicYear,
      academicClassId: classId,
    });
    setShowEdit(true);
  }

  const tabs = ([
    { id: 'syllabus' as const, label: 'Syllabus', icon: BookOpen, show: true },
    {
      id: 'students' as const,
      label: 'Students',
      count: batchDetail?.enrollments?.length ?? selectedBatchMeta?._count.enrollments ?? 0,
      icon: Users,
      show: true,
    },
    {
      id: 'teachers' as const,
      label: 'Teachers',
      count: batchTeachers?.length ?? 0,
      icon: UserCog,
      show: canManage,
    },
  ] as const).filter((t) => t.show);

  return (
    <div className="space-y-6">
      <PageHeader
        title={teacherPortal ? 'Topic Progress' : 'Classes & Batches'}
        highlight={teacherPortal ? 'Progress' : 'Batches'}
        badge={teacherPortal ? 'Teacher' : 'Admin'}
        description={
          teacherPortal
            ? 'Select a class and mark chapter progress for your subjects.'
            : 'Organize students into class batches and track which chapters they have studied.'
        }
      >
        {canManage && (
          <Button onClick={() => setShowCreate(true)} className="gap-2">
            <Plus className="h-4 w-4" />
            New batch
          </Button>
        )}
        {(can(Permission.MATERIAL_UPLOAD) || (!teacherPortal && can(Permission.MATERIAL_READ))) && (
          <Button variant="outline" asChild className={BATCH_OUTLINE_BTN}>
            <Link href="/dashboard/materials">
              <Upload className="mr-2 h-4 w-4" /> Books
            </Link>
          </Button>
        )}
        {can(Permission.CURRICULUM_READ) && !teacherPortal && (
          <Button variant="outline" asChild className={BATCH_OUTLINE_BTN}>
            <Link href="/dashboard/syllabus">
              <BookOpen className="mr-2 h-4 w-4" /> Syllabus
            </Link>
          </Button>
        )}
      </PageHeader>

      {!teacherPortal && (
        <div className="grid gap-4 sm:grid-cols-3">
          <StatCard title="Batches" value={batches?.length ?? 0} icon={School} accent="blue" />
          <StatCard title="Students enrolled" value={totalStudents} icon={Users} accent="green" />
          <StatCard title="Classes" value={classCount} icon={GraduationCap} accent="violet" />
        </div>
      )}

      <div className="grid gap-6 lg:grid-cols-[280px_1fr]">
        {/* Batch list */}
        <Card className="surface-card relative h-fit overflow-visible bg-white">
          <CardHeader className="space-y-2 pb-2">
            <div className="flex items-center justify-between gap-2">
              <CardTitle className="text-base">Batches</CardTitle>
              <div className="flex items-center gap-1.5">
                <div ref={filterPanelRef} className="relative">
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon"
                    className={cn('h-8 w-8 shrink-0', BATCH_OUTLINE_BTN)}
                    aria-expanded={filterPanelOpen}
                    aria-haspopup="dialog"
                    aria-label="Filter batches"
                    title="Filters"
                    onClick={() => setFilterPanelOpen((open) => !open)}
                  >
                    <Filter className="h-4 w-4" />
                    {batchFiltersActive && (
                      <span className="absolute right-1 top-1 h-2 w-2 rounded-full bg-primary ring-2 ring-card" />
                    )}
                  </Button>
                  {filterPanelOpen && (
                    <div
                      role="dialog"
                      aria-label="Batch filters"
                      className="absolute z-50 w-[min(calc(100vw-2rem),18rem)] rounded-xl border border-border/60 bg-white p-4 text-foreground shadow-lg max-lg:left-0 max-lg:top-full max-lg:mt-2 dark:border-border/60 dark:bg-white lg:left-full lg:top-0 lg:ml-2"
                    >
                      <div className="mb-3 flex items-start justify-between gap-2">
                        <p className="text-xs font-bold uppercase tracking-wider text-muted-foreground">
                          Filter batches
                        </p>
                        <Button
                          type="button"
                          variant="ghost"
                          size="icon"
                          className={cn('h-7 w-7 shrink-0 text-muted-foreground', BATCH_OUTLINE_BTN)}
                          aria-label="Close filters"
                          onClick={() => setFilterPanelOpen(false)}
                        >
                          <X className="h-4 w-4" />
                        </Button>
                      </div>
                      <div className="space-y-3">
                        <div className="space-y-1">
                          <Label className="text-[10px] uppercase tracking-wide text-muted-foreground">Class</Label>
                          <select className={BATCH_FILTER_FIELD} value={filterClassLevel} onChange={(e) => setFilterClassLevel(e.target.value)}>
                            <option value="all">All classes</option>
                            {batchFilterOptions.levels.map((level) => (
                              <option key={level} value={String(level)}>Class {level}</option>
                            ))}
                          </select>
                        </div>
                        <div className="space-y-1">
                          <Label className="text-[10px] uppercase tracking-wide text-muted-foreground">Section</Label>
                          <select className={BATCH_FILTER_FIELD} value={filterSection} onChange={(e) => setFilterSection(e.target.value)}>
                            <option value="all">All sections</option>
                            {batchFilterOptions.sections.map((section) => (
                              <option key={section} value={section}>{section}</option>
                            ))}
                          </select>
                        </div>
                        <div className="space-y-1">
                          <Label className="text-[10px] uppercase tracking-wide text-muted-foreground">Session</Label>
                          <select className={BATCH_FILTER_FIELD} value={filterSession} onChange={(e) => setFilterSession(e.target.value)}>
                            <option value="all">All sessions</option>
                            {batchFilterOptions.sessions.map((session) => (
                              <option key={session} value={session}>{session}</option>
                            ))}
                          </select>
                        </div>
                      </div>
                    </div>
                  )}
                </div>
                <span className="text-xs text-muted-foreground tabular-nums">{filteredBatches.length}</span>
              </div>
            </div>
            <div className="relative">
              <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
              <Input
                placeholder="Search batches…"
                aria-label="Search batches"
                className="h-9 border-border/70 bg-white pl-9 text-sm text-foreground shadow-none"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
              />
            </div>
          </CardHeader>
          <CardContent className={cn('space-y-1 overflow-y-auto p-2 pt-0', BATCH_LIST_SCROLL_MAX_CLASS)}>
            {isLoading ? (
              <TableSkeleton rows={4} />
            ) : filteredBatches.length === 0 ? (
              <div className="px-2 py-6">
                <EmptyState
                  icon={School}
                  title={search || batchFiltersActive ? 'No matches' : 'No batches yet'}
                  description={
                    search || batchFiltersActive
                      ? 'Try different filters or search.'
                      : 'Create a batch to get started.'
                  }
                />
                {canManage && !search && !batchFiltersActive && (
                  <div className="flex justify-center pb-2">
                    <Button size="sm" onClick={() => setShowCreate(true)}>
                      <Plus className="mr-2 h-4 w-4" /> Create batch
                    </Button>
                  </div>
                )}
              </div>
            ) : (
              filteredBatches.map((batch) => {
                const isActive = selectedBatch === batch.id;
                return (
                  <button
                    key={batch.id}
                    type="button"
                    onClick={() => setSelectedBatch(batch.id)}
                    className={cn(
                      'flex w-full items-center rounded-lg px-3 py-2.5 text-left transition-colors',
                      isActive
                        ? 'bg-primary/10 text-foreground'
                        : BATCH_HOVER_SURFACE,
                    )}
                  >
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-sm font-semibold">
                        {formatBatchListTitle(batch)}
                      </span>
                      <span className="block truncate text-xs text-muted-foreground">
                        {batch.academicYear}
                        {' · '}
                        {batch._count.enrollments} student{batch._count.enrollments === 1 ? '' : 's'}
                      </span>
                    </span>
                  </button>
                );
              })
            )}
          </CardContent>
        </Card>

        {/* Batch detail */}
        <div className="min-w-0 space-y-4">
          {!selectedBatch ? (
            <Card className="surface-card">
              <EmptyState
                icon={BookOpen}
                title="Select a batch"
                description="Choose a batch from the list to view students and syllabus progress."
              />
            </Card>
          ) : (
            <>
              <Card className="surface-card">
                <CardContent className="flex flex-col gap-4 p-5 sm:flex-row sm:items-center sm:justify-between">
                  <div className="min-w-0 space-y-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <h2 className="truncate text-xl font-bold tracking-tight">
                        {batchDetail?.name ?? selectedBatchMeta?.name}
                      </h2>
                      <Badge variant="secondary" className="normal-case tracking-normal">
                        {batchDetail?.academicClass.name ?? selectedBatchMeta?.academicClass.name}
                      </Badge>
                      <Badge variant="outline" className="normal-case tracking-normal">
                        {batchDetail?.academicYear ?? selectedBatchMeta?.academicYear}
                      </Badge>
                    </div>
                    {progressStats.total > 0 && (
                      <div className="mt-3 max-w-md">
                        <div className="mb-1.5 flex justify-between text-xs text-muted-foreground">
                          <span>{teacherPortal ? 'Your subject coverage' : 'Overall syllabus coverage'}</span>
                          <span>{progressStats.completed} / {progressStats.total} chapters</span>
                        </div>
                        <div className="h-2 overflow-hidden rounded-full bg-muted">
                          <div
                            className="h-full rounded-full bg-gradient-to-r from-primary via-violet-500 to-emerald-500 transition-all duration-700"
                            style={{ width: `${progressStats.percent}%` }}
                          />
                        </div>
                      </div>
                    )}
                  </div>
                  <div className="flex shrink-0 items-center gap-3">
                    {progressStats.total > 0 && (
                      <ProgressRing percent={progressStats.percent} />
                    )}
                    {canManage && (
                      <div className="flex gap-2">
                        <Button variant="outline" size="sm" onClick={openEditDialog}>
                          <Pencil className="mr-2 h-3.5 w-3.5" />
                          Edit
                        </Button>
                        <Button
                          variant="outline"
                          size="sm"
                          className="text-destructive hover:text-destructive"
                          onClick={() => setShowDelete(true)}
                        >
                          <Trash2 className="mr-2 h-3.5 w-3.5" />
                          Delete
                        </Button>
                      </div>
                    )}
                  </div>
                </CardContent>
              </Card>

              <div className="flex gap-1 border-b border-border">
                {tabs.map(({ id, label, icon: Icon, ...rest }) => {
                  const count = 'count' in rest ? rest.count : undefined;
                  return (
                    <button
                      key={id}
                      type="button"
                      onClick={() => setActiveTab(id)}
                      className={cn(
                        'inline-flex items-center gap-2 border-b-2 px-4 py-2.5 text-sm font-medium transition-colors',
                        activeTab === id
                          ? 'border-primary text-foreground'
                          : cn(
                              'border-transparent text-muted-foreground hover:text-foreground',
                              BATCH_HOVER_SURFACE,
                              'rounded-t-md',
                            ),
                      )}
                    >
                      <Icon className="h-4 w-4" />
                      {label}
                      {count !== undefined && (
                        <span className="rounded-md bg-muted px-1.5 py-0.5 text-xs tabular-nums text-muted-foreground">
                          {count}
                        </span>
                      )}
                    </button>
                  );
                })}
              </div>

              {activeTab === 'students' && (
                <Card className="surface-card">
                  <CardHeader className="pb-3">
                    <CardTitle className="flex items-center gap-2 text-base">
                      <UserPlus className="h-4 w-4 text-primary" />
                      Students
                    </CardTitle>
                  </CardHeader>
                  <CardContent className="space-y-4">
                    {canManage ? (
                      <div className="grid gap-2 sm:grid-cols-[1fr_7rem_auto]">
                        <select
                          className="flex h-10 w-full rounded-lg border border-input bg-background px-3 text-sm"
                          value={enrollCandidateId}
                          onChange={(e) => setEnrollCandidateId(e.target.value)}
                        >
                          <option value="">Choose a student…</option>
                          {availableCandidates.map((c) => (
                            <option key={c.id} value={c.id}>
                              {c.user.firstName} {c.user.lastName} — {c.registrationNumber}
                            </option>
                          ))}
                        </select>
                        <Input
                          placeholder="Auto from 1"
                          value={enrollRoll}
                          onChange={(e) => setEnrollRoll(e.target.value)}
                        />
                        <Button
                          disabled={!enrollCandidateId || enrollMutation.isPending}
                          onClick={() => enrollMutation.mutate()}
                        >
                          {enrollMutation.isPending ? 'Adding…' : 'Add'}
                        </Button>
                      </div>
                    ) : (
                      <p className="text-sm text-muted-foreground">View-only: you cannot enroll students.</p>
                    )}

                    {(batchDetail?.enrollments ?? []).length === 0 ? (
                      <EmptyState
                        icon={Users}
                        title="No students enrolled"
                        description={canManage ? 'Add a student above, or assign them from the Students page.' : 'No students in this batch yet.'}
                      />
                    ) : (
                      <ul className="divide-y rounded-lg border">
                        {(batchDetail?.enrollments ?? []).map((e) => (
                          <li key={e.id} className="flex items-center gap-3 px-3 py-2.5">
                            <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-muted text-xs font-semibold">
                              {initials(e.candidate.user.firstName, e.candidate.user.lastName)}
                            </span>
                            <span className="min-w-0 flex-1">
                              <span className="block truncate text-sm font-medium">
                                {e.candidate.user.firstName} {e.candidate.user.lastName}
                              </span>
                              <span className="block font-mono text-xs text-muted-foreground">
                                {e.candidate.registrationNumber}
                              </span>
                            </span>
                            {e.rollNumber && (
                              <Badge variant="outline" className="normal-case tracking-normal">
                                Roll {e.rollNumber}
                              </Badge>
                            )}
                          </li>
                        ))}
                      </ul>
                    )}
                  </CardContent>
                </Card>
              )}

              {activeTab === 'teachers' && canManage && (
                <Card className="surface-card">
                  <CardHeader className="pb-3">
                    <CardTitle className="flex items-center gap-2 text-base">
                      <UserCog className="h-4 w-4 text-primary" />
                      Teachers
                    </CardTitle>
                    <p className="text-sm text-muted-foreground">
                      Assign a teacher to a subject for this batch.
                    </p>
                  </CardHeader>
                  <CardContent className="space-y-4">
                    <div className="grid gap-2 sm:grid-cols-[1fr_1fr_auto]">
                      <select
                        className="flex h-10 w-full rounded-lg border border-input bg-background px-3 text-sm"
                        value={assignTeacherUserId}
                        onChange={(e) => setAssignTeacherUserId(e.target.value)}
                      >
                        <option value="">Choose a teacher…</option>
                        {teacherOptions.map((t) => (
                          <option key={t.id} value={t.id}>
                            {t.firstName} {t.lastName} — {t.email}
                          </option>
                        ))}
                      </select>
                      <select
                        className="flex h-10 w-full rounded-lg border border-input bg-background px-3 text-sm"
                        value={assignSubjectId}
                        onChange={(e) => setAssignSubjectId(e.target.value)}
                      >
                        <option value="">Choose a subject…</option>
                        {batchSubjects.map((s) => (
                          <option key={s.id} value={s.id}>{s.name}</option>
                        ))}
                      </select>
                      <Button
                        disabled={!assignTeacherUserId || !assignSubjectId || assignTeacherMutation.isPending}
                        onClick={() => assignTeacherMutation.mutate()}
                      >
                        {assignTeacherMutation.isPending ? 'Assigning…' : 'Assign'}
                      </Button>
                    </div>

                    {teacherOptions.length === 0 && (
                      <p className="text-xs text-muted-foreground">
                        No teachers yet. Create one under{' '}
                        <Link href="/dashboard/users" className="font-medium text-primary hover:underline">
                          Staff &amp; Teachers
                        </Link>
                        .
                      </p>
                    )}

                    {teachersLoading ? (
                      <TableSkeleton rows={3} />
                    ) : (batchTeachers ?? []).length === 0 ? (
                      <EmptyState
                        icon={UserCog}
                        title="No teachers assigned"
                        description="Choose a teacher and subject above."
                      />
                    ) : (
                      <ul className="divide-y rounded-lg border">
                        {(batchTeachers ?? []).map((a) => (
                          <li key={a.id} className="flex items-center gap-3 px-3 py-2.5">
                            <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-muted text-xs font-semibold">
                              {a.user ? initials(a.user.firstName, a.user.lastName) : '?'}
                            </span>
                            <span className="min-w-0 flex-1">
                              <span className="block truncate text-sm font-medium">
                                {a.user ? `${a.user.firstName} ${a.user.lastName}` : 'Unknown teacher'}
                              </span>
                              <span className="block truncate text-xs text-muted-foreground">
                                {a.user?.email ?? a.userId}
                              </span>
                            </span>
                            <Badge variant="secondary" className="normal-case tracking-normal shrink-0">
                              {a.subject.name}
                            </Badge>
                            <Button
                              size="icon"
                              variant="ghost"
                              className="shrink-0 text-destructive hover:text-destructive"
                              title="Remove assignment"
                              disabled={removeTeacherMutation.isPending}
                              onClick={() => removeTeacherMutation.mutate(a.id)}
                            >
                              <Trash2 className="h-4 w-4" />
                            </Button>
                          </li>
                        ))}
                      </ul>
                    )}
                  </CardContent>
                </Card>
              )}

              {activeTab === 'syllabus' && (
                <div className="space-y-4">
                  {progressLoading ? (
                    <TableSkeleton rows={6} />
                  ) : !visibleProgress.length ? (
                    <Card className="surface-card">
                      <EmptyState
                        icon={BookOpen}
                        title={
                          teacherPortal && !(assignedSubjectIds?.size)
                            ? 'No subject assigned to you'
                            : teacherPortal
                              ? 'No chapters for your subject yet'
                              : 'No books for this class yet'
                        }
                        description={
                          teacherPortal && !(assignedSubjectIds?.size)
                            ? 'You can mark chapter progress only for the subject an admin assigned you on this class.'
                            : teacherPortal
                              ? 'Ask your admin to upload NCERT books for your assigned subject. Chapters appear here after indexing.'
                              : 'Upload NCERT books for this class. Chapters appear here after indexing.'
                        }
                      />
                      {!teacherPortal && (
                        <div className="flex justify-center gap-3 pb-8">
                          <Button asChild>
                            <Link href="/dashboard/materials">
                              <Upload className="mr-2 h-4 w-4" /> Upload books
                            </Link>
                          </Button>
                          <Button variant="outline" asChild>
                            <Link href="/dashboard/syllabus">View syllabus</Link>
                          </Button>
                        </div>
                      )}
                    </Card>
                  ) : (
                    <>
                      <div className="flex flex-wrap gap-2">
                        {visibleProgress.map((sp) => {
                          const subjProgress = batchMaterialsForStats.length
                            ? subjectProgressStatsForBatch(batchMaterialsForStats, sp, syllabusMaterials)
                            : calcProgress([sp]);
                          const isActive = activeSubject?.subject.id === sp.subject.id;
                          return (
                            <button
                              key={sp.subject.id}
                              type="button"
                              onClick={() => setSelectedSubjectId(sp.subject.id)}
                              className={cn(
                                'inline-flex items-center gap-2 rounded-full px-4 py-2.5 text-sm font-semibold transition-all',
                                isActive
                                  ? 'bg-primary text-primary-foreground shadow-md shadow-primary/25'
                                  : cn(SYLLABUS_MARK_SURFACE, 'text-foreground hover:bg-primary/10'),
                              )}
                            >
                              {sp.subject.name}
                              <span className={cn(
                                'rounded-full px-2 py-0.5 text-[10px] font-bold tabular-nums',
                                isActive
                                  ? 'bg-primary-foreground/20 text-primary-foreground'
                                  : 'bg-background/70 text-muted-foreground',
                              )}>
                                {subjProgress.percent}%
                              </span>
                            </button>
                          );
                        })}
                      </div>

                      {activeSubject && (
                        <Card className="overflow-hidden border-primary/15 bg-white shadow-sm">
                          <CardHeader className="border-b border-primary/10 bg-white pb-4">
                            <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                              <div>
                                <CardTitle className="text-xl font-bold tracking-tight">
                                  {activeSubject.subject.name}
                                </CardTitle>
                                <p className="mt-1 text-sm text-muted-foreground">
                                  Extracted books — click to expand chapters
                                </p>
                              </div>
                              <Badge
                                variant="outline"
                                className="w-fit shrink-0 rounded-full border-primary/15 bg-background/80 px-3 py-1 text-sm font-semibold normal-case tracking-normal text-foreground"
                              >
                                {activeSubject.chapters.filter((c) => c.status === 'COMPLETED').length}
                                /{activeSubject.chapters.length} chapters done
                              </Badge>
                            </div>
                          </CardHeader>
                          <CardContent className="space-y-3 p-3 sm:p-4">
                            {activeSubjectBookSectionsLive.length > 0 ? (
                              <div className="space-y-3">
                                {activeSubjectBookSectionsLive.map((bookSection) => {
                                  const open = expandedBookKeys.has(bookSection.key);
                                  const completed = bookSection.chapters.filter(
                                    (c) => c.status === 'COMPLETED',
                                  ).length;
                                  return (
                                    <div
                                      key={bookSection.key}
                                      className={cn(
                                        'group/book overflow-hidden',
                                        SYLLABUS_BOOK_ROW,
                                        open ? SYLLABUS_BOOK_ROW_OPEN : SYLLABUS_BOOK_ROW_HOVER,
                                      )}
                                    >
                                      <div className="flex items-stretch gap-0.5 px-2 py-1 sm:px-3">
                                        <button
                                          type="button"
                                          className="flex min-w-0 flex-1 items-center justify-between gap-2 py-3 pl-1 pr-2 text-left"
                                          onClick={() => toggleBookExpanded(bookSection.key)}
                                        >
                                          <span className="min-w-0">
                                            <span className="block truncate text-base font-semibold text-foreground">
                                              {bookSection.title}
                                            </span>
                                            <span className="text-xs text-muted-foreground">
                                              {bookSection.chapters.length} chapter
                                              {bookSection.chapters.length === 1 ? '' : 's'}
                                              {' · '}
                                              {completed} done
                                            </span>
                                          </span>
                                          <ChevronDown
                                            className={cn(
                                              'h-4 w-4 shrink-0 text-muted-foreground transition-transform',
                                              !open && '-rotate-90',
                                            )}
                                          />
                                        </button>
                                        {!teacherPortal && (
                                          <Button
                                            type="button"
                                            variant="ghost"
                                            size="icon"
                                            className="h-9 w-9 shrink-0 self-center text-muted-foreground hover:bg-destructive/10 hover:text-destructive"
                                            title="Remove from this batch"
                                            onClick={() => setBookToHide(bookSection)}
                                          >
                                            <Trash2 className="h-4 w-4" />
                                          </Button>
                                        )}
                                      </div>
                                      {open && (
                                        <div className="space-y-2 border-t border-primary/10 bg-background/50 px-3 pb-3 pt-2 sm:px-4">
                                          {bookSection.chapters.length === 0 ? (
                                            <p className="rounded-lg border border-dashed px-3 py-4 text-center text-xs text-muted-foreground">
                                              {bookSection.extractionFailed
                                                ? 'Chapter extraction failed for this PDF. Re-upload or use Re-index on Materials once the file has a readable table of contents.'
                                                : 'No chapters extracted yet. Wait for indexing to finish on Materials.'}
                                            </p>
                                          ) : (
                                            bookSection.chapters.map((ch) => renderChapterRow(ch))
                                          )}
                                        </div>
                                      )}
                                    </div>
                                  );
                                })}
                              </div>
                            ) : (
                              <p className="rounded-lg border border-dashed border-primary/20 px-3 py-6 text-center text-sm text-muted-foreground">
                                No chapters for this subject yet. Upload a full-book PDF under Materials and wait for indexing.
                              </p>
                            )}
                          </CardContent>
                        </Card>
                      )}
                    </>
                  )}
                </div>
              )}
            </>
          )}
        </div>
      </div>

      <Dialog open={!!bookToHide} onOpenChange={(open) => { if (!open) setBookToHide(null); }}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Remove book from this batch?</DialogTitle>
            <DialogDescription>
              {bookToHide
                ? `"${bookToHide.title}" will be hidden on this batch only. The upload stays in Materials and Syllabus.`
                : ''}
            </DialogDescription>
          </DialogHeader>
          <DialogFooter className="gap-2 sm:gap-0">
            <Button type="button" variant="outline" onClick={() => setBookToHide(null)}>
              Cancel
            </Button>
            <Button
              type="button"
              variant="destructive"
              onClick={() => {
                if (!selectedBatch || !bookToHide) return;
                hideBatchSyllabusBook(selectedBatch, bookToHide.hideKey);
                setSyllabusHiddenRevision((n) => n + 1);
                setExpandedBookKeys((current) => {
                  const next = new Set(current);
                  next.delete(bookToHide.key);
                  return next;
                });
                setBookToHide(null);
                toast({
                  title: 'Book removed from this batch',
                  description: 'It is still available in Materials and Syllabus.',
                });
              }}
            >
              Remove from batch
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={showCreate} onOpenChange={setShowCreate}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Create batch</DialogTitle>
            <DialogDescription>
              A batch groups students in the same class for tests and syllabus tracking.
            </DialogDescription>
          </DialogHeader>
          <div className="grid gap-4 py-2">
            <div className="space-y-2">
              <Label>Batch name</Label>
              <Input
                placeholder="e.g. Section A, Morning Batch"
                value={form.name}
                onChange={(e) => setForm({ ...form, name: e.target.value })}
              />
            </div>
            <div className="space-y-2">
              <Label>Class</Label>
              <select
                className="flex h-10 w-full rounded-md border border-input bg-background px-3 text-sm"
                value={form.academicClassId}
                onChange={(e) => setForm({ ...form, academicClassId: e.target.value })}
              >
                <option value="">Select class</option>
                {(classes ?? []).map((c) => (
                  <option key={c.id} value={c.id}>Class {c.level} — {c.name}</option>
                ))}
              </select>
            </div>
            <div className="space-y-2">
              <Label>Academic year</Label>
              <Input
                value={form.academicYear}
                onChange={(e) => setForm({ ...form, academicYear: e.target.value })}
                placeholder="2025-26"
              />
            </div>
          </div>
          <DialogFooter>
            <Button
              disabled={!form.name || !form.academicClassId || createMutation.isPending}
              onClick={() => createMutation.mutate()}
            >
              {createMutation.isPending ? 'Creating…' : 'Create batch'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={showEdit} onOpenChange={setShowEdit}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Edit batch</DialogTitle>
            <DialogDescription>
              Update the batch name, class, or academic year.
            </DialogDescription>
          </DialogHeader>
          <div className="grid gap-4 py-2">
            <div className="space-y-2">
              <Label>Batch name</Label>
              <Input
                placeholder="e.g. Section A, Morning Batch"
                value={editForm.name}
                onChange={(e) => setEditForm({ ...editForm, name: e.target.value })}
              />
            </div>
            <div className="space-y-2">
              <Label>Class</Label>
              <select
                className="flex h-10 w-full rounded-md border border-input bg-background px-3 text-sm"
                value={editForm.academicClassId}
                onChange={(e) => setEditForm({ ...editForm, academicClassId: e.target.value })}
              >
                <option value="">Select class</option>
                {(classes ?? []).map((c) => (
                  <option key={c.id} value={c.id}>Class {c.level} — {c.name}</option>
                ))}
              </select>
            </div>
            <div className="space-y-2">
              <Label>Academic year</Label>
              <Input
                value={editForm.academicYear}
                onChange={(e) => setEditForm({ ...editForm, academicYear: e.target.value })}
                placeholder="2025-26"
              />
            </div>
          </div>
          <DialogFooter>
            <Button
              disabled={!editForm.name || !editForm.academicClassId || updateMutation.isPending}
              onClick={() => updateMutation.mutate()}
            >
              {updateMutation.isPending ? 'Saving…' : 'Save changes'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={showDelete} onOpenChange={setShowDelete}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Delete batch?</DialogTitle>
            <DialogDescription>
              {selectedBatchMeta && (
                <>
                  <span className="font-medium text-foreground">
                    {selectedBatchMeta.name}
                  </span>{' '}
                  ({selectedBatchMeta.academicClass.name}, {selectedBatchMeta.academicYear}) will be permanently removed.
                  {selectedBatchMeta._count.enrollments > 0 && (
                    <>
                      {' '}
                      <strong>{selectedBatchMeta._count.enrollments}</strong> enrolled student(s) will become unassigned.
                    </>
                  )}
                  {' '}Syllabus progress and teacher assignments for this batch will also be removed.
                </>
              )}
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button
              variant="destructive"
              disabled={deleteMutation.isPending || !selectedBatch}
              onClick={() => deleteMutation.mutate()}
            >
              {deleteMutation.isPending ? 'Deleting…' : 'Delete batch'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
