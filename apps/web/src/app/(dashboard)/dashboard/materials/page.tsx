'use client';

import {
  useRef, useState, useMemo, useEffect, type ComponentProps, type InputHTMLAttributes,
} from 'react';
import { useSearchParams } from 'next/navigation';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { PageHeader } from '@/components/layout/page-header';
import { materialsApi, curriculumApi, batchesApi } from '@/lib/api';
import { sessionsMatch } from '@/lib/academic-session';
import { displayChapterTitle } from '@/lib/chapter-title';
import { invalidateStudentSyllabusLive } from '@/lib/student-syllabus-poll';
import { useRequireAuth } from '@/hooks/use-auth';
import { useMaterialIndexingSync } from '@/hooks/use-material-indexing-sync';
import { materialsNeedLivePoll } from '@/lib/materials-indexing-poll';
import { usePermissions } from '@/hooks/use-permissions';
import { Permission, guessSubjectId } from '@cbt/shared';
import { toast } from '@/hooks/use-toast';
import {
  Upload, FileText, RefreshCw, Trash2, Loader2, Eye, Download, BookOpen, Shield, X, Plus,
  FolderOpen, Pencil,
} from 'lucide-react';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { cn } from '@/lib/utils';
import { useAuthStore } from '@/stores/auth-store';
import {
  readMaterialsUploadSession,
  writeMaterialsUploadSession,
} from '@/lib/materials-upload-session';
import { AcademicSessionField } from '@/components/forms/academic-session-field';
import { defaultAcademicSession } from '@/lib/academic-session';
import { batchMatchesSelectedClass, formatAcademicClassLabel } from '@/lib/academic-class';

type Material = {
  id: string;
  title: string;
  type: string;
  fileName: string;
  fileSize: number;
  mimeType: string;
  status: string;
  chunkCount: number;
  academicSession: string;
  errorMessage?: string | null;
  createdAt: string;
  academicClassId?: string | null;
  subjectId?: string | null;
  academicClass?: { level: number; name: string } | null;
  subject?: { name: string; code: string } | null;
  chapter?: { title: string; number: number } | null;
  topic?: { title: string } | null;
  isFullBook?: boolean;
};

type AcademicClass = {
  id: string;
  level: number;
  name: string;
  subjects: {
    id: string;
    name: string;
    books: { chapters: { id: string; number: number; title: string; topics: { id: string; title: string }[] }[] }[];
  }[];
};

const STATUS_LABEL: Record<string, string> = {
  READY: 'Indexed',
  INDEXING: 'Indexing…',
  PENDING: 'Indexing…',
  FAILED: 'Failed',
};

const MATERIAL_STATUS_RANK: Record<string, number> = {
  PENDING: 1,
  INDEXING: 2,
  FAILED: 3,
  READY: 4,
};

function isUploadPlaceholder(m: Material): boolean {
  return m.id.startsWith('pending-upload-');
}

function materialStatusBadgeVariant(status: string): ComponentProps<typeof Badge>['variant'] {
  if (status === 'READY') return 'success';
  if (status === 'FAILED') return 'destructive';
  if (status === 'PENDING' || status === 'INDEXING') return 'warning';
  return 'outline';
}

const MAX_UPLOAD_BYTES = 100 * 1024 * 1024;
const UPLOAD_PARALLEL_BATCHES = 4;
const FILES_PER_BATCH = 6;

function freshUploadMeta() {
  return {
    academicClassId: '',
    subjectId: '',
    chapterId: '',
    batchId: '',
    academicSession: defaultAcademicSession(),
  };
}

type PendingUpload = { file: File; title: string };

type UploadJobPayload = {
  pending: PendingUpload[];
  meta: {
    academicClassId: string;
    subjectId: string;
    chapterId: string;
    batchId: string;
    academicSession: string;
  };
  uploadScope: 'FULL_BOOK' | 'CHAPTER';
};

type UploadFileResult = { fileName: string; ok: boolean; error?: string };

type UploadMutationResult = {
  materials: Material[];
  fileResults: UploadFileResult[];
};

type UploadMutateContext = {
  placeholders: Material[];
};

function queueItemMetaLine(m: Material): string {
  const parts: string[] = [];
  if (m.subject) parts.push(m.subject.name);
  if (m.chapter) {
    parts.push(`Ch.${m.chapter.number} ${displayChapterTitle(m.chapter.title)}`);
  } else if (m.subject) {
    parts.push(m.isFullBook === false ? 'Chapter document' : 'Complete book');
  }
  parts.push(formatFileSize(m.fileSize));
  if (m.status === 'READY' && m.chunkCount > 0) parts.push(`${m.chunkCount} chunks`);
  return parts.join(' · ');
}

function enrichUploadedMaterial(api: Material, placeholder?: Material): Material {
  if (!placeholder) return api;
  return {
    ...api,
    academicClass: api.academicClass ?? placeholder.academicClass,
    subject: api.subject ?? placeholder.subject,
    isFullBook: api.isFullBook ?? placeholder.isFullBook,
    chapter: api.chapter ?? placeholder.chapter,
  };
}

function mergeSessionUploadIds(existingIds: string[], materials: Material[]): string[] {
  return [
    ...new Set([
      ...existingIds.filter((id) => !id.startsWith('pending-upload-')),
      ...materials.filter((m) => !isUploadPlaceholder(m)).map((m) => m.id),
    ]),
  ];
}

function pickFresherMaterial(existing: Material | undefined, incoming: Material): Material {
  if (!existing) return incoming;
  const existingRank = MATERIAL_STATUS_RANK[existing.status] ?? 0;
  const incomingRank = MATERIAL_STATUS_RANK[incoming.status] ?? 0;
  if (incomingRank !== existingRank) {
    return incomingRank > existingRank ? incoming : existing;
  }
  if (incoming.chunkCount !== existing.chunkCount) {
    return incoming.chunkCount > existing.chunkCount ? incoming : existing;
  }
  return incoming;
}

function buildSessionQueueFromIds(ids: string[], ...sources: Material[][]): Material[] {
  const byId = new Map<string, Material>();
  for (const list of sources) {
    for (const m of list) {
      if (!isUploadPlaceholder(m)) {
        byId.set(m.id, pickFresherMaterial(byId.get(m.id), m));
      }
    }
  }
  return ids.map((id) => byId.get(id)).filter((m): m is Material => !!m);
}

function defaultTitleFromFileName(fileName: string): string {
  return fileName.replace(/\.[^.]+$/, '');
}

function pendingUploadKey(entry: PendingUpload): string {
  const { file } = entry;
  return `${file.name}:${file.size}:${file.lastModified}`;
}

function chunkPendingUploads(items: PendingUpload[], size: number): PendingUpload[][] {
  const batches: PendingUpload[][] = [];
  for (let i = 0; i < items.length; i += size) batches.push(items.slice(i, i + size));
  return batches;
}

async function runPool<T>(items: T[], limit: number, worker: (item: T) => Promise<void>): Promise<void> {
  let index = 0;
  const runners = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (index < items.length) {
      const i = index++;
      await worker(items[i]);
    }
  });
  await Promise.all(runners);
}

function formatFileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function uploadBlockingReason(
  pending: PendingUpload[],
  meta: { academicClassId: string; subjectId: string },
): string | null {
  if (!pending.length) return null;
  if (!meta.academicClassId) return 'Select a class before uploading.';
  if (!meta.subjectId) return 'Select a subject for this class.';
  const missingTitle = pending.find((row) => !row.title.trim());
  if (missingTitle) {
    return `Add a title for “${missingTitle.file.name}” (or restore the suggested name).`;
  }
  return null;
}

function resolvePendingTitle(row: PendingUpload): string {
  const trimmed = row.title.trim();
  if (!trimmed) {
    throw new Error(`Add a title for “${row.file.name}”.`);
  }
  return trimmed;
}

export default function MaterialsPage() {
  const searchParams = useSearchParams();
  const { accessToken } = useRequireAuth(true);
  const { can } = usePermissions();
  const { user } = useAuthStore();
  const canUpload = can(Permission.MATERIAL_UPLOAD);
  const canDelete = can(Permission.MATERIAL_DELETE);
  const canManageCurriculum = can(Permission.CURRICULUM_MANAGE);
  const queryClient = useQueryClient();
  const fileRef = useRef<HTMLInputElement>(null);
  const folderRef = useRef<HTMLInputElement>(null);
  /** Match queue rows to server materials only after upload HTTP completes (by id, not filename). */
  const sessionMaterialIdsRef = useRef<string[]>([]);
  const uploadSessionHydratedRef = useRef(false);
  /** Material ids awaiting READY/FAILED after re-index or post-upload indexing. */
  const pendingReindexRef = useRef<Map<string, { title: string }>>(new Map());
  const [reindexWatchIds, setReindexWatchIds] = useState<string[]>([]);

  const beginReindexWatch = (material: Pick<Material, 'id' | 'title'>) => {
    pendingReindexRef.current.set(material.id, { title: material.title });
    setReindexWatchIds((ids) => (ids.includes(material.id) ? ids : [...ids, material.id]));
  };

  const endReindexWatch = (materialId: string) => {
    pendingReindexRef.current.delete(materialId);
    setReindexWatchIds((ids) => ids.filter((id) => id !== materialId));
  };

  const patchMaterialOnClient = (materialId: string, incoming: Partial<Material>) => {
    queryClient.setQueryData<Material[]>(['materials'], (old) =>
      (old ?? []).map((row) =>
        row.id === materialId
          ? pickFresherMaterial(row, { ...row, ...incoming } as Material)
          : row,
      ),
    );
    setSessionQueue((prev) =>
      prev.map((row) =>
        row.id === materialId
          ? pickFresherMaterial(row, { ...row, ...incoming } as Material)
          : row,
      ),
    );
  };

  const syncUploadSessionStorage = (queue: Material[], ids: string[]) => {
    if (!user?.id) return;
    writeMaterialsUploadSession(user.id, ids, queue);
  };
  const [openingId, setOpeningId] = useState<string | null>(null);
  const [pendingUploads, setPendingUploads] = useState<PendingUpload[]>([]);
  const [uploadProgress, setUploadProgress] = useState<{ current: number; total: number } | null>(null);
  /** Documents uploaded in this browser session — not full server history. */
  const [sessionQueue, setSessionQueue] = useState<Material[]>([]);
  const [meta, setMeta] = useState(freshUploadMeta);
  const [addSubjectOpen, setAddSubjectOpen] = useState(false);
  const [newSubjectName, setNewSubjectName] = useState('');
  const [newSubjectCode, setNewSubjectCode] = useState('');

  const createSubjectMutation = useMutation({
    mutationFn: async () => {
      if (!meta.academicClassId) throw new Error('Select a class first');
      const name = newSubjectName.trim();
      if (!name) throw new Error('Subject name is required');
      const code = newSubjectCode.trim();
      const academicClassId = meta.academicClassId;
      const created = (await curriculumApi.createSubject(accessToken!, {
        academicClassId,
        name,
        ...(code ? { code } : {}),
      })) as {
        id: string;
        name: string;
        code: string;
        books?: AcademicClass['subjects'][number]['books'];
      };
      return { ...created, academicClassId };
    },
    onSuccess: (subject) => {
      queryClient.setQueryData<AcademicClass[]>(['curriculum-classes'], (old) => {
        const list = old ?? [];
        return list.map((cls) => {
          if (cls.id !== subject.academicClassId) return cls;
          if (cls.subjects.some((s) => s.id === subject.id)) return cls;
          const books = subject.books ?? [];
          return {
            ...cls,
            subjects: [...cls.subjects, { id: subject.id, name: subject.name, code: subject.code, books }],
          };
        });
      });
      void queryClient.invalidateQueries({ queryKey: ['curriculum-classes'] });
      void queryClient.invalidateQueries({ queryKey: ['curriculum-from-uploads'] });
      void queryClient.invalidateQueries({ queryKey: ['curriculum-all-classes'] });
      setMeta((m) => ({ ...m, subjectId: subject.id, chapterId: '' }));
      setAddSubjectOpen(false);
      setNewSubjectName('');
      setNewSubjectCode('');
      toast({
        title: 'Subject added',
        description: `${subject.name} (${subject.code}) is ready for book uploads.`,
        variant: 'success',
      });
    },
    onError: (e: Error) => {
      toast({ title: 'Could not add subject', description: e.message, variant: 'destructive' });
    },
  });

  useEffect(() => {
    if (!user?.id || uploadSessionHydratedRef.current) return;
    uploadSessionHydratedRef.current = true;
    const saved = readMaterialsUploadSession(user.id);
    if (!saved?.materialIds.length) return;
    sessionMaterialIdsRef.current = saved.materialIds;
    setSessionQueue(saved.queue as Material[]);
    void queryClient.invalidateQueries({ queryKey: ['materials'] });
  }, [user?.id, queryClient]);

  useEffect(() => {
    if (!accessToken || !canUpload) return;
    let cancelled = false;
    materialsApi
      .reconcileSubjects(accessToken)
      .then((res) => {
        if (cancelled) return;
        const updated = (res as { updated?: number })?.updated ?? 0;
        if (updated > 0) {
          queryClient.invalidateQueries({ queryKey: ['materials'] });
          queryClient.invalidateQueries({ queryKey: ['curriculum-from-uploads'] });
        }
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [accessToken, canUpload, queryClient]);

  const sessionNeedsPoll = sessionQueue.some(
    (m) =>
      isUploadPlaceholder(m)
      || m.status === 'PENDING'
      || m.status === 'INDEXING',
  );
  const reindexNeedsPoll = reindexWatchIds.length > 0;

  const { data: materials } = useQuery({
    queryKey: ['materials'],
    queryFn: () => materialsApi.list(accessToken!) as Promise<Material[]>,
    enabled:
      !!accessToken
      && (
        sessionNeedsPoll
        || reindexNeedsPoll
        || sessionQueue.length > 0
        || materialsNeedLivePoll(queryClient.getQueryData<Material[]>(['materials']))
      ),
    staleTime: 0,
    refetchInterval: (query) => {
      const server = query.state.data as Material[] | undefined;
      return sessionNeedsPoll || reindexNeedsPoll || materialsNeedLivePoll(server)
        ? 3000
        : false;
    },
  });

  useMaterialIndexingSync(queryClient, materials);

  const { data: classes } = useQuery({
    queryKey: ['curriculum-classes'],
    queryFn: () => curriculumApi.getClasses(accessToken!) as Promise<AcademicClass[]>,
    enabled: !!accessToken,
  });

  const { data: instituteBatches } = useQuery({
    queryKey: ['batches'],
    queryFn: () => batchesApi.list(accessToken!) as Promise<{
      id: string;
      name: string;
      academicYear: string;
      academicClass: { id: string; level: number; name: string };
    }[]>,
    enabled: !!accessToken && canUpload,
  });

  const uploadClassLevel = (classes ?? []).find((c) => c.id === meta.academicClassId)?.level;

  const sessionExtraOptions = useMemo(
    () => [...new Set((instituteBatches ?? []).map((b) => b.academicYear).filter(Boolean))],
    [instituteBatches],
  );

  const sectionsForUpload = useMemo(() => {
    if (!meta.academicClassId) return [];
    return (instituteBatches ?? []).filter(
      (b) =>
        batchMatchesSelectedClass(b, meta.academicClassId, uploadClassLevel)
        && sessionsMatch(b.academicYear, meta.academicSession),
    );
  }, [instituteBatches, meta.academicClassId, meta.academicSession, uploadClassLevel]);

  useEffect(() => {
    if (!meta.batchId) return;
    if (!sectionsForUpload.some((b) => b.id === meta.batchId)) {
      setMeta((m) => ({ ...m, batchId: '' }));
    }
  }, [meta.batchId, sectionsForUpload]);

  useEffect(() => {
    const classId = searchParams.get('class') ?? searchParams.get('classId');
    const batchId = searchParams.get('batch') ?? searchParams.get('batchId');
    const session = searchParams.get('session');
    if (!classId && !batchId && !session) return;
    setMeta((m) => ({
      ...m,
      ...(classId ? { academicClassId: classId } : {}),
      ...(batchId ? { batchId } : {}),
      ...(session ? { academicSession: session } : {}),
    }));
  }, [searchParams]);

  const selectedClass = (classes ?? []).find((c) => c.id === meta.academicClassId);

  const addPendingFiles = (incoming: FileList | File[]) => {
    const next = Array.from(incoming);
    if (!next.length) return;
    const tooLarge = next.filter((f) => f.size > MAX_UPLOAD_BYTES);
    if (tooLarge.length) {
      toast({
        title: 'File too large.',
        description: `${tooLarge.map((f) => f.name).join(', ')} exceeds the 100 MB limit.`,
        variant: 'destructive',
      });
    }
    const accepted = next.filter((f) => f.size <= MAX_UPLOAD_BYTES);
    if (!accepted.length) return;
    setPendingUploads((prev) => {
      const seen = new Set(prev.map(pendingUploadKey));
      const merged = [...prev];
      for (const file of accepted) {
        const entry: PendingUpload = {
          file,
          title: defaultTitleFromFileName(file.name),
        };
        const key = pendingUploadKey(entry);
        if (!seen.has(key)) {
          seen.add(key);
          merged.push(entry);
        }
      }
      return merged;
    });
  };

  const updatePendingTitle = (index: number, title: string) => {
    setPendingUploads((prev) =>
      prev.map((row, i) => (i === index ? { ...row, title } : row)),
    );
  };

  const removePendingFile = (index: number) => {
    setPendingUploads((prev) => prev.filter((_, i) => i !== index));
    if (fileRef.current) fileRef.current.value = '';
    if (folderRef.current) folderRef.current.value = '';
  };

  const uploadMutation = useMutation<
    UploadMutationResult,
    Error,
    UploadJobPayload,
    UploadMutateContext
  >({
    mutationFn: async ({ pending, meta: uploadMeta, uploadScope: scope }: UploadJobPayload) => {
      if (!pending.length) throw new Error('Choose at least one file');
      const fileResults: UploadFileResult[] = [];
      const uploadedMaterials: Material[] = [];

      const appendSharedMeta = (fd: FormData) => {
        fd.append('academicClassId', uploadMeta.academicClassId);
        fd.append('subjectId', uploadMeta.subjectId);
        fd.append('academicSession', uploadMeta.academicSession);
        if (uploadMeta.batchId) fd.append('batchId', uploadMeta.batchId);
        fd.append('fullBook', scope === 'FULL_BOOK' ? 'true' : 'false');
        if (scope === 'CHAPTER' && pending.length === 1 && uploadMeta.chapterId) {
          fd.append('chapterId', uploadMeta.chapterId);
        }
      };

      if (pending.length === 1) {
        const { file } = pending[0];
        const fd = new FormData();
        fd.append('file', file);
        fd.append('title', resolvePendingTitle(pending[0]));
        appendSharedMeta(fd);
        const created = (await materialsApi.upload(accessToken!, fd)) as Material;
        uploadedMaterials.push(created);
        return {
          materials: uploadedMaterials,
          fileResults: [{ fileName: file.name, ok: true }],
        };
      }

      const batches = chunkPendingUploads(pending, FILES_PER_BATCH);
      setUploadProgress({ current: 0, total: batches.length });
      let completedBatches = 0;
      await runPool(batches, UPLOAD_PARALLEL_BATCHES, async (batch) => {
        const fd = new FormData();
        for (const row of batch) fd.append('files', row.file);
        fd.append('titles', batch.map((row) => resolvePendingTitle(row)).join('\n'));
        appendSharedMeta(fd);
        try {
          const batchRes = (await materialsApi.uploadBatch(accessToken!, fd)) as {
            materials?: Material[];
          };
          for (const row of batchRes.materials ?? []) uploadedMaterials.push(row);
          for (const row of batch) fileResults.push({ fileName: row.file.name, ok: true });
        } catch (e) {
          const msg = e instanceof Error ? e.message : 'Upload failed';
          for (const row of batch) {
            fileResults.push({ fileName: row.file.name, ok: false, error: msg });
          }
        } finally {
          completedBatches += 1;
          setUploadProgress({ current: completedBatches, total: batches.length });
        }
      });

      const failed = fileResults.filter((r) => !r.ok);
      if (failed.length === fileResults.length) {
        throw new Error(failed[0]?.error ?? 'All uploads failed');
      }
      return { materials: uploadedMaterials, fileResults };
    },
    onMutate: ({ pending, meta: uploadMeta, uploadScope: scope }) => {
      setUploadProgress(null);
      const cls = (classes ?? []).find((c) => c.id === uploadMeta.academicClassId);
      const subjectHints = (cls?.subjects ?? []).map((s) => {
        const row = s as { id: string; name: string; code?: string };
        return { id: row.id, name: row.name, code: row.code ?? '' };
      });
      const placeholders: Material[] = pending.map((row, index) => {
        const { file } = row;
        const title = row.title.trim() || defaultTitleFromFileName(file.name);
        const guessedId = guessSubjectId(
          file.name,
          title,
          subjectHints,
          uploadMeta.subjectId,
        );
        const subject = cls?.subjects.find((s) => s.id === guessedId);
        return {
          id: `pending-upload-${index}-${file.name}-${file.lastModified}`,
          title,
          type: 'NCERT',
          fileName: file.name,
          fileSize: file.size,
          mimeType: file.type || 'application/pdf',
          status: 'PENDING',
          chunkCount: 0,
          academicSession: uploadMeta.academicSession,
          createdAt: new Date().toISOString(),
          academicClass: cls ? { level: cls.level, name: cls.name } : null,
          subject: subject
            ? { name: subject.name, code: (subject as { code?: string }).code ?? '' }
            : null,
          isFullBook: scope === 'FULL_BOOK',
        };
      });
      setSessionQueue((prev) => {
        const settled = prev.filter((p) => !isUploadPlaceholder(p));
        sessionMaterialIdsRef.current = mergeSessionUploadIds(
          sessionMaterialIdsRef.current,
          settled,
        );
        const next = [...settled, ...placeholders];
        syncUploadSessionStorage(settled, sessionMaterialIdsRef.current);
        return next;
      });
      setPendingUploads([]);
      setMeta((m) => ({ ...m, chapterId: '' }));
      if (fileRef.current) fileRef.current.value = '';
      return { placeholders };
    },
    onSuccess: (data, _vars, context) => {
      const placeholders = context?.placeholders ?? [];
      const enriched = data.materials.map((m) => {
        const ph = placeholders.find((p) => p.fileName === m.fileName && p.fileSize === m.fileSize);
        return enrichUploadedMaterial(m, ph);
      });
      setSessionQueue((prev) => {
        const settled = prev.filter((p) => !isUploadPlaceholder(p));
        const pendingPlaceholders = prev
          .filter((p) => isUploadPlaceholder(p))
          .filter(
            (ph) => !enriched.some((e) => e.fileName === ph.fileName && e.fileSize === ph.fileSize),
          );
        sessionMaterialIdsRef.current = mergeSessionUploadIds(
          sessionMaterialIdsRef.current,
          [...settled, ...enriched],
        );
        const queue = buildSessionQueueFromIds(
          sessionMaterialIdsRef.current,
          settled,
          enriched,
        );
        syncUploadSessionStorage(queue, sessionMaterialIdsRef.current);
        return [...queue, ...pendingPlaceholders];
      });

      void queryClient.invalidateQueries({ queryKey: ['materials'] });
      void queryClient.refetchQueries({ queryKey: ['materials'] });
      queryClient.invalidateQueries({ queryKey: ['curriculum-from-uploads'] });
      queryClient.invalidateQueries({ queryKey: ['curriculum-all-classes'] });
      queryClient.invalidateQueries({ queryKey: ['syllabus-progress'] });
      invalidateStudentSyllabusLive(queryClient);
      void materialsApi
        .reconcileSubjects(accessToken!)
        .then(() => {
          queryClient.invalidateQueries({ queryKey: ['materials'] });
          queryClient.invalidateQueries({ queryKey: ['curriculum-from-uploads'] });
        })
        .catch(() => {
          /* reconcile optional if API old */
        });

      const failed = data.fileResults.filter((r) => !r.ok);
      if (failed.length > 0) {
        toast({
          title: `${failed.length} upload${failed.length === 1 ? '' : 's'} failed`,
          description: failed.map((f) => `${f.fileName}: ${f.error}`).join('; '),
          variant: 'destructive',
        });
      } else if (enriched.some((m) => m.status === 'PENDING' || m.status === 'INDEXING')) {
        for (const m of enriched) {
          if (m.status === 'PENDING' || m.status === 'INDEXING') {
            beginReindexWatch(m);
          }
        }
        toast({
          title: 'Upload complete',
          description: 'Indexing in the background — you will get a notification when it finishes.',
        });
      }
    },
    onError: (e: Error) => {
      setSessionQueue((prev) => {
        const next = prev.filter((p) => !isUploadPlaceholder(p));
        sessionMaterialIdsRef.current = next.map((m) => m.id);
        syncUploadSessionStorage(next, sessionMaterialIdsRef.current);
        return next;
      });
      toast({ title: 'Upload failed', description: e.message, variant: 'destructive' });
    },
    onSettled: () => {
      setUploadProgress(null);
    },
  });

  useEffect(() => {
    if (!materials?.length || sessionMaterialIdsRef.current.length === 0) return;
    if (uploadMutation.isPending) return;
    const byId = new Map(materials.map((m) => [m.id, m]));
    const matched = sessionMaterialIdsRef.current
      .map((id) => byId.get(id))
      .filter((m): m is Material => !!m);
    if (matched.length === 0) return;
    sessionMaterialIdsRef.current = mergeSessionUploadIds(sessionMaterialIdsRef.current, matched);
    setSessionQueue((prev) => {
      const ordered = buildSessionQueueFromIds(
        sessionMaterialIdsRef.current,
        prev,
        matched,
      );
      syncUploadSessionStorage(ordered, sessionMaterialIdsRef.current);
      return ordered;
    });
    if (matched.every((m) => m.status === 'READY' || m.status === 'FAILED')) {
      queryClient.invalidateQueries({ queryKey: ['curriculum-from-uploads'] });
      queryClient.invalidateQueries({ queryKey: ['syllabus-progress'] });
      invalidateStudentSyllabusLive(queryClient);
    }
  }, [materials, queryClient, uploadMutation.isPending, user?.id]);

  useEffect(() => {
    if (!materials?.length) return;
    const pending = pendingReindexRef.current;
    if (pending.size === 0) return;

    let curriculumDirty = false;
    for (const m of materials) {
      const entry = pending.get(m.id);
      if (!entry) continue;
      if (m.status === 'PENDING' || m.status === 'INDEXING') {
        continue;
      }
      if (m.status === 'READY') {
        pending.delete(m.id);
        endReindexWatch(m.id);
        curriculumDirty = true;
        toast({
          title: 'Indexing complete',
          description: `"${entry.title}" is indexed and ready for syllabus and AI tests.`,
          variant: 'success',
        });
      } else if (m.status === 'FAILED') {
        pending.delete(m.id);
        endReindexWatch(m.id);
        toast({
          title: 'Re-index failed',
          description: m.errorMessage?.trim() || `"${entry.title}" could not be indexed.`,
          variant: 'destructive',
        });
      }
    }
    if (curriculumDirty) {
      void queryClient.invalidateQueries({ queryKey: ['curriculum-from-uploads'] });
      void queryClient.invalidateQueries({ queryKey: ['syllabus-progress'] });
      invalidateStudentSyllabusLive(queryClient);
    }
  }, [materials, queryClient]);

  const deleteMutation = useMutation({
    mutationFn: async (materialId: string) => {
      const res = (await materialsApi.delete(accessToken!, materialId)) as {
        deleted?: boolean;
        id?: string;
      };
      if (res && 'deleted' in res && res.deleted === false) {
        throw new Error('Server did not confirm deletion');
      }
      return materialId;
    },
    onMutate: async (materialId) => {
      await queryClient.cancelQueries({ queryKey: ['materials'] });
      const previous = queryClient.getQueryData<Material[]>(['materials']);
      queryClient.setQueryData<Material[]>(['materials'], (old) =>
        (old ?? []).filter((row) => row.id !== materialId),
      );
      setSessionQueue((old) => {
        const next = old.filter((row) => row.id !== materialId);
        sessionMaterialIdsRef.current = next.map((m) => m.id);
        syncUploadSessionStorage(next, sessionMaterialIdsRef.current);
        return next;
      });
      return { previous };
    },
    onSuccess: (_id, materialId) => {
      setSessionQueue((old) => {
        const next = old.filter((row) => row.id !== materialId);
        sessionMaterialIdsRef.current = next.map((m) => m.id);
        syncUploadSessionStorage(next, sessionMaterialIdsRef.current);
        return next;
      });
      void queryClient.invalidateQueries({ queryKey: ['materials'] });
      void queryClient.invalidateQueries({ queryKey: ['curriculum-from-uploads'] });
      void queryClient.invalidateQueries({ queryKey: ['curriculum-all-classes'] });
      void queryClient.invalidateQueries({ queryKey: ['syllabus-progress'] });
      invalidateStudentSyllabusLive(queryClient);
    },
    onError: (e: Error, _id, context) => {
      if (context?.previous) {
        queryClient.setQueryData(['materials'], context.previous);
      }
      toast({
        title: 'Could not delete',
        description: e.message || 'Delete failed',
        variant: 'destructive',
      });
    },
  });

  const uploadBlockReason = uploadBlockingReason(pendingUploads, meta);
  const canSubmitUpload = pendingUploads.length > 0 && !uploadBlockReason;

  return (
    <div className="space-y-8">
      <PageHeader
        title="NCERT Books & Notes"
        highlight="Books & Notes"
        description={
          canUpload
            ? 'Upload Class 9–12 NCERT PDFs — complete books or chapter files. Chapters are extracted from your files and power AI class tests.'
            : 'View and download NCERT books uploaded for your classes.'
        }
        badge="NCERT · Classes 9–12"
      />

      {canUpload && (
      <Card className="border-primary/20 bg-primary/[0.03]">
        <CardContent className="flex gap-3 p-4 text-sm">
          <Shield className="mt-0.5 h-5 w-5 shrink-0 text-primary" />
          <div>
            <p className="font-medium">Strict document-only AI</p>
            <p className="mt-1 text-muted-foreground">
              Upload a <strong>complete book</strong> to auto-detect all chapters.
              Classes &amp; Batches syllabus is built only from your uploads.
            </p>
          </div>
        </CardContent>
      </Card>
      )}

      {canUpload && (
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-lg">
            <Upload className="h-5 w-5 text-primary" />
            Upload document
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-5">
          <div className="flex flex-wrap gap-2">
            <Button type="button" variant="outline" size="sm" onClick={() => fileRef.current?.click()}>
              <Upload className="mr-2 h-4 w-4" />
              Choose files
            </Button>
            <Button type="button" variant="outline" size="sm" onClick={() => folderRef.current?.click()}>
              <FolderOpen className="mr-2 h-4 w-4" />
              Choose folder
            </Button>
          </div>
          <div
            className={cn(
              'rounded-xl border-2 border-dashed p-6 transition-colors',
              pendingUploads.length === 0 && 'cursor-pointer hover:border-primary/50',
            )}
            onClick={() => {
              if (pendingUploads.length === 0) fileRef.current?.click();
            }}
          >
            {pendingUploads.length > 0 ? (
              <div className="space-y-3 text-left">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <p className="text-sm font-medium">
                    <FolderOpen className="mr-1.5 inline h-4 w-4 text-primary" />
                    {pendingUploads.length} document{pendingUploads.length > 1 ? 's' : ''} ready
                  </p>
                  <div className="flex gap-2">
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      className="h-8 text-xs"
                      onClick={() => fileRef.current?.click()}
                    >
                      Add files
                    </Button>
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      className="h-8 text-xs"
                      onClick={() => folderRef.current?.click()}
                    >
                      Add folder
                    </Button>
                  </div>
                </div>
                <p className="text-xs text-muted-foreground">
                  <Pencil className="mr-1 inline h-3 w-3" />
                  Edit each title before upload — used for indexing and syllabus labels.
                </p>
                <ul className="max-h-64 space-y-2 overflow-y-auto">
                  {pendingUploads.map((row, index) => (
                    <li
                      key={pendingUploadKey(row)}
                      className="rounded-lg border bg-background p-3"
                      onClick={(e) => e.stopPropagation()}
                    >
                      <div className="flex items-start gap-2">
                        <FileText className="mt-2 h-4 w-4 shrink-0 text-primary" />
                        <div className="min-w-0 flex-1 space-y-1.5">
                          <Label className="text-xs text-muted-foreground">Title *</Label>
                          <Input
                            value={row.title}
                            className="h-9"
                            placeholder="Document title"
                            onChange={(e) => updatePendingTitle(index, e.target.value)}
                          />
                          <p className="truncate text-xs text-muted-foreground" title={row.file.name}>
                            {row.file.name}
                          </p>
                        </div>
                        <Badge variant="outline" className="mt-7 shrink-0">
                          {formatFileSize(row.file.size)}
                        </Badge>
                        <Button
                          type="button"
                          size="icon"
                          variant="ghost"
                          className="mt-6 h-7 w-7 shrink-0"
                          onClick={() => removePendingFile(index)}
                        >
                          <X className="h-4 w-4" />
                        </Button>
                      </div>
                    </li>
                  ))}
                </ul>
              </div>
            ) : (
              <div className="py-4 text-center">
                <BookOpen className="mx-auto h-8 w-8 text-muted-foreground" />
                <p className="mt-2 font-medium">Drop PDFs here or use the buttons above</p>
                <p className="text-sm text-muted-foreground">
                  Multiple files or a whole folder · Max 100 MB each
                </p>
              </div>
            )}
            <input
              ref={fileRef}
              type="file"
              multiple
              accept=".pdf,.txt,.md,application/pdf"
              className="hidden"
              onChange={(e) => {
                if (e.target.files?.length) addPendingFiles(e.target.files);
              }}
            />
            <input
              ref={folderRef}
              type="file"
              multiple
              className="hidden"
              {...({ webkitdirectory: '', directory: '' } as InputHTMLAttributes<HTMLInputElement>)}
              onChange={(e) => {
                if (e.target.files?.length) {
                  const pdfs = Array.from(e.target.files).filter(
                    (f) =>
                      f.name.toLowerCase().endsWith('.pdf')
                      || f.name.toLowerCase().endsWith('.txt')
                      || f.name.toLowerCase().endsWith('.md'),
                  );
                  if (pdfs.length) addPendingFiles(pdfs);
                  else {
                    toast({
                      title: 'No supported files',
                      description: 'The folder must contain PDF, TXT, or Markdown files.',
                      variant: 'destructive',
                    });
                  }
                }
              }}
            />
          </div>

          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-2">
              <Label>Class *</Label>
              <select
                className="flex h-10 w-full rounded-md border border-input bg-background px-3 text-sm"
                value={meta.academicClassId}
                onChange={(e) => setMeta({
                  ...meta,
                  academicClassId: e.target.value,
                  subjectId: '',
                  chapterId: '',
                  batchId: '',
                })}
              >
                <option value="">Select class</option>
                {(classes ?? []).map((c) => (
                  <option key={c.id} value={c.id}>{formatAcademicClassLabel(c.level, c.name)}</option>
                ))}
              </select>
            </div>
            <div className="space-y-2">
              <Label>Section</Label>
              <select
                className="flex h-10 w-full rounded-md border border-input bg-background px-3 text-sm"
                value={meta.batchId}
                disabled={!meta.academicClassId || sectionsForUpload.length === 0}
                onChange={(e) => setMeta({ ...meta, batchId: e.target.value })}
              >
                <option value="">
                  {sectionsForUpload.length === 0
                    ? (
                      meta.academicClassId
                        ? `No sections for this class in ${meta.academicSession || 'this session'}`
                        : 'Select a class first'
                    )
                    : 'All sections (shared)'}
                </option>
                {sectionsForUpload.map((b) => (
                  <option key={b.id} value={b.id}>{b.name}</option>
                ))}
              </select>
            </div>
            <div className="sm:col-span-2">
              <AcademicSessionField
                value={meta.academicSession}
                onChange={(academicSession) => setMeta({ ...meta, academicSession, batchId: '' })}
                extraOptions={sessionExtraOptions}
              />
            </div>
            {meta.academicClassId && sectionsForUpload.length === 0 && sessionExtraOptions.length > 0 ? (
              <p className="sm:col-span-2 text-xs text-muted-foreground">
                No sections for this class in the selected session. Try
                {' '}
                {sessionExtraOptions.slice(0, 3).join(', ')}
                {sessionExtraOptions.length > 3 ? ', …' : ''}
                {' '}
                if your batches use a different year.
              </p>
            ) : null}
            <p className="sm:col-span-2 text-xs text-muted-foreground">
              Pick a section so documents appear only under that batch in Classes &amp; Batches. Leave shared for
              NCERT books used by every section.
            </p>
            <div className="space-y-2">
              <div className="flex items-center justify-between gap-2">
                <Label>Subject *</Label>
                {canManageCurriculum && meta.academicClassId && (
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    className="h-8 gap-1 px-2 text-xs"
                    onClick={() => setAddSubjectOpen(true)}
                  >
                    <Plus className="h-3.5 w-3.5" />
                    Add subject
                  </Button>
                )}
              </div>
              <select
                className="flex h-10 w-full rounded-md border border-input bg-background px-3 text-sm"
                value={meta.subjectId}
                disabled={!meta.academicClassId}
                onChange={(e) => setMeta({ ...meta, subjectId: e.target.value, chapterId: '' })}
              >
                <option value="">Select subject</option>
                {(selectedClass?.subjects ?? []).map((s) => (
                  <option key={s.id} value={s.id}>{s.name}</option>
                ))}
              </select>
              {canManageCurriculum && meta.academicClassId && !(selectedClass?.subjects.length) && (
                <p className="text-xs text-muted-foreground">
                  No subjects yet for this class. Use Add subject to create one before uploading.
                </p>
              )}
            </div>
            <p className="sm:col-span-2 rounded-lg bg-muted/50 px-3 py-2 text-sm text-muted-foreground">
              Chapters will be detected from your PDF and appear in Classes &amp; Batches after indexing.
              {pendingUploads.length > 1 && (
                <>
                  {' '}
                  Multiple files: subject is auto-detected from each file name (English, Maths, Science…); the
                  dropdown is used only when a name is unclear.
                </>
              )}
            </p>
          </div>

          {uploadBlockReason && pendingUploads.length > 0 ? (
            <p className="text-sm text-amber-600">{uploadBlockReason}</p>
          ) : null}
          <Button
            className="w-full"
            size="lg"
            disabled={!canSubmitUpload || uploadMutation.isPending}
            onClick={() => {
              const block = uploadBlockingReason(pendingUploads, meta);
              if (block) {
                toast({ title: 'Missing details', description: block, variant: 'destructive' });
                return;
              }
              uploadMutation.mutate({
                pending: pendingUploads.map((row) => ({ ...row })),
                meta: { ...meta },
                uploadScope: 'FULL_BOOK',
              });
            }}
          >
            {uploadMutation.isPending
              ? uploadProgress
                ? `Uploading ${uploadProgress.current} of ${uploadProgress.total}…`
                : 'Uploading…'
              : pendingUploads.length > 1
                ? `Upload ${pendingUploads.length} files to knowledge base`
                : 'Upload to knowledge base'}
          </Button>
        </CardContent>
      </Card>
      )}

      {sessionQueue.length > 0 ? (
        <div className="space-y-3">
          <h2 className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">
            Upload queue ({sessionQueue.length})
          </h2>
          {sessionQueue.map((m) => {
            const placeholder = isUploadPlaceholder(m);
            return (
              <Card
                key={m.id}
                className={cn(placeholder && 'border-amber-500/30 bg-amber-500/[0.03]')}
              >
                <CardContent className="flex items-center gap-3 p-4">
                  <FileText className="h-5 w-5 shrink-0 text-primary" />
                  <div className="min-w-0 flex-1">
                    <p className="truncate font-medium">{m.title}</p>
                    <p className="truncate text-xs text-muted-foreground">{queueItemMetaLine(m)}</p>
                    {!m.subject && (
                      <p className="text-xs text-amber-600">
                        Missing tags — re-upload with class and subject
                      </p>
                    )}
                    {m.status === 'FAILED' && m.errorMessage && (
                      <p className="text-xs text-destructive">{m.errorMessage}</p>
                    )}
                  </div>
                  <Badge variant={materialStatusBadgeVariant(m.status)}>
                    {placeholder ? (
                      <>
                        <Loader2 className="h-3 w-3 animate-spin" />
                        {uploadMutation.isPending ? 'Uploading…' : 'Queued…'}
                      </>
                    ) : (
                      <>
                        {(m.status === 'PENDING' || m.status === 'INDEXING') && (
                          <Loader2 className="h-3 w-3 animate-spin" />
                        )}
                        {STATUS_LABEL[m.status] ?? m.status}
                      </>
                    )}
                  </Badge>
                  <Button
                    size="icon"
                    variant="ghost"
                    title="View"
                    disabled={placeholder || openingId === m.id}
                    onClick={async () => {
                      setOpeningId(m.id);
                      try {
                        await materialsApi.openFile(accessToken!, m.id);
                      } catch (e) {
                        toast({
                          title: 'Could not open',
                          description: e instanceof Error ? e.message : '',
                          variant: 'destructive',
                        });
                      } finally {
                        setOpeningId(null);
                      }
                    }}
                  >
                    {openingId === m.id ? (
                      <Loader2 className="h-4 w-4 animate-spin" />
                    ) : (
                      <Eye className="h-4 w-4" />
                    )}
                  </Button>
                  <Button
                    size="icon"
                    variant="ghost"
                    title="Download"
                    disabled={placeholder}
                    onClick={() => materialsApi.downloadFile(accessToken!, m.id, m.fileName)}
                  >
                    <Download className="h-4 w-4" />
                  </Button>
                  {canUpload && (
                    <Button
                      size="icon"
                      variant="ghost"
                      title="Re-index"
                      disabled={placeholder}
                      onClick={async () => {
                        try {
                          const updated = (await materialsApi.reindex(
                            accessToken!,
                            m.id,
                          )) as Partial<Material>;
                          beginReindexWatch(m);
                          patchMaterialOnClient(m.id, {
                            ...updated,
                            status: updated.status ?? 'INDEXING',
                            errorMessage: null,
                          });
                          void queryClient.invalidateQueries({ queryKey: ['materials'] });
                          void queryClient.refetchQueries({ queryKey: ['materials'] });
                          void queryClient.invalidateQueries({ queryKey: ['curriculum-from-uploads'] });
                          toast({
                            title: 'Re-index in progress',
                            description:
                              'Extracting chapters and building the search index. You will be notified when it finishes.',
                          });
                        } catch (e) {
                          toast({
                            title: 'Re-index failed',
                            description: e instanceof Error ? e.message : 'Failed',
                            variant: 'destructive',
                          });
                        }
                      }}
                    >
                      <RefreshCw className="h-4 w-4" />
                    </Button>
                  )}
                  {canDelete && (
                    <Button
                      size="icon"
                      variant="ghost"
                      title="Delete"
                      disabled={
                        placeholder
                        || (deleteMutation.isPending && deleteMutation.variables === m.id)
                      }
                      onClick={() => {
                        if (
                          !window.confirm(
                            `Delete "${m.title}"? This removes indexed chapters for this book.`,
                          )
                        ) {
                          return;
                        }
                        deleteMutation.mutate(m.id);
                      }}
                    >
                      {deleteMutation.isPending && deleteMutation.variables === m.id ? (
                        <Loader2 className="h-4 w-4 animate-spin text-destructive" />
                      ) : (
                        <Trash2 className="h-4 w-4 text-destructive" />
                      )}
                    </Button>
                  )}
                </CardContent>
              </Card>
            );
          })}
        </div>
      ) : null}

      <Dialog open={addSubjectOpen} onOpenChange={setAddSubjectOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Add subject</DialogTitle>
            <DialogDescription>
              {selectedClass
                ? `Create a new subject for ${formatAcademicClassLabel(selectedClass.level, selectedClass.name)}.`
                : 'Select a class first, then add a subject for book uploads.'}
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4 py-2">
            <div className="space-y-2">
              <Label htmlFor="new-subject-name">Subject name *</Label>
              <Input
                id="new-subject-name"
                placeholder="e.g. Computer Science"
                value={newSubjectName}
                onChange={(e) => setNewSubjectName(e.target.value)}
                disabled={!meta.academicClassId || createSubjectMutation.isPending}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="new-subject-code">Short code (optional)</Label>
              <Input
                id="new-subject-code"
                placeholder="Auto-generated from name if empty"
                value={newSubjectCode}
                onChange={(e) => setNewSubjectCode(e.target.value.toUpperCase())}
                disabled={!meta.academicClassId || createSubjectMutation.isPending}
              />
            </div>
          </div>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => setAddSubjectOpen(false)}>
              Cancel
            </Button>
            <Button
              type="button"
              disabled={
                !meta.academicClassId
                || !newSubjectName.trim()
                || createSubjectMutation.isPending
              }
              onClick={() => createSubjectMutation.mutate()}
            >
              {createSubjectMutation.isPending ? (
                <>
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  Saving…
                </>
              ) : (
                'Add subject'
              )}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
