'use client';

import { useRef, useState, useMemo, useEffect, type ComponentProps } from 'react';
import { useRouter } from 'next/navigation';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { PageHeader } from '@/components/layout/page-header';
import { materialsApi, curriculumApi } from '@/lib/api';
import { useRequireAuth } from '@/hooks/use-auth';
import { usePermissions } from '@/hooks/use-permissions';
import { Permission, guessSubjectId } from '@cbt/shared';
import { toast } from '@/hooks/use-toast';
import {
  Upload, FileText, RefreshCw, Trash2, Loader2, Eye, Download, BookOpen, Shield, X,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { useAuthStore } from '@/stores/auth-store';
import { isTeacherOnly, normalizeRoles } from '@/lib/roles';
import {
  readMaterialsUploadSession,
  writeMaterialsUploadSession,
} from '@/lib/materials-upload-session';

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
  academicClass?: { level: number; name: string } | null;
  subject?: { name: string; code: string } | null;
  chapter?: { title: string; number: number } | null;
  topic?: { title: string } | null;
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

const DOC_TYPES = [
  { value: 'NCERT', label: 'NCERT PDF' },
  { value: 'INSTITUTE_NOTES', label: 'Institute Notes' },
  { value: 'WORKSHEET', label: 'Worksheet' },
  { value: 'TEACHER_NOTES', label: 'Teacher Notes' },
  { value: 'QUESTION_BANK', label: 'Question Bank' },
];

const MAX_UPLOAD_BYTES = 100 * 1024 * 1024;
const UPLOAD_PARALLEL_BATCHES = 4;
const FILES_PER_BATCH = 6;

type UploadJobPayload = {
  files: File[];
  meta: {
    title: string;
    type: string;
    academicClassId: string;
    subjectId: string;
    chapterId: string;
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

function enrichUploadedMaterial(api: Material, placeholder?: Material): Material {
  if (!placeholder) return api;
  return {
    ...api,
    academicClass: api.academicClass ?? placeholder.academicClass,
    subject: api.subject ?? placeholder.subject,
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

function chunkFiles(files: File[], size: number): File[][] {
  const batches: File[][] = [];
  for (let i = 0; i < files.length; i += size) batches.push(files.slice(i, i + size));
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

export default function MaterialsPage() {
  const { accessToken } = useRequireAuth(true);
  const { can } = usePermissions();
  const { user } = useAuthStore();
  const router = useRouter();
  const teacherPortal = isTeacherOnly(normalizeRoles(user?.roles));
  const canUpload = can(Permission.MATERIAL_UPLOAD);
  const canDelete = can(Permission.MATERIAL_DELETE);
  const queryClient = useQueryClient();
  const fileRef = useRef<HTMLInputElement>(null);
  /** Match queue rows to server materials only after upload HTTP completes (by id, not filename). */
  const sessionMaterialIdsRef = useRef<string[]>([]);
  const uploadSessionHydratedRef = useRef(false);

  const syncUploadSessionStorage = (queue: Material[], ids: string[]) => {
    if (!user?.id) return;
    writeMaterialsUploadSession(user.id, ids, queue);
  };
  const [openingId, setOpeningId] = useState<string | null>(null);
  const [pendingFiles, setPendingFiles] = useState<File[]>([]);
  const [uploadProgress, setUploadProgress] = useState<{ current: number; total: number } | null>(null);
  /** Only documents from the current upload batch — not full server history. */
  const [sessionQueue, setSessionQueue] = useState<Material[]>([]);
  const [uploadScope, setUploadScope] = useState<'FULL_BOOK' | 'CHAPTER'>('FULL_BOOK');
  const [meta, setMeta] = useState({
    title: '',
    type: 'NCERT',
    academicClassId: '',
    subjectId: '',
    chapterId: '',
    academicSession: '2025-26',
  });

  // Teachers view/download books inside Syllabus — no separate NCERT panel
  useEffect(() => {
    if (teacherPortal) router.replace('/dashboard/syllabus');
  }, [teacherPortal, router]);

  if (teacherPortal) return null;

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

  const { data: materials } = useQuery({
    queryKey: ['materials'],
    queryFn: () => materialsApi.list(accessToken!) as Promise<Material[]>,
    enabled: !!accessToken && sessionQueue.length > 0,
    staleTime: 0,
    refetchInterval: sessionQueue.some((m) => m.status === 'PENDING' || m.status === 'INDEXING')
      ? 3000
      : false,
  });

  const { data: classes } = useQuery({
    queryKey: ['curriculum-classes'],
    queryFn: () => curriculumApi.getClasses(accessToken!) as Promise<AcademicClass[]>,
    enabled: !!accessToken,
  });

  const { data: extractedSyllabus } = useQuery({
    queryKey: ['curriculum-from-uploads'],
    queryFn: () => curriculumApi.getClasses(accessToken!, { uploadedOnly: true }) as Promise<AcademicClass[]>,
    enabled: !!accessToken && !!meta.academicClassId,
  });

  const selectedClass = (classes ?? []).find((c) => c.id === meta.academicClassId);
  const selectedSubject = selectedClass?.subjects.find((s) => s.id === meta.subjectId);
  const extractedChapters = useMemo(() => {
    const extractedClass = (extractedSyllabus ?? []).find((c) => c.id === meta.academicClassId);
    const extractedSubject = extractedClass?.subjects.find((s) => s.id === meta.subjectId);
    return extractedSubject?.books.flatMap((b) => b.chapters) ?? [];
  }, [extractedSyllabus, meta.academicClassId, meta.subjectId]);
  const chapters = extractedChapters;

  const addPendingFiles = (incoming: FileList | File[]) => {
    const next = Array.from(incoming);
    if (!next.length) return;
    const tooLarge = next.filter((f) => f.size > MAX_UPLOAD_BYTES);
    if (tooLarge.length) {
      toast({
        title: 'File too large',
        description: `${tooLarge.map((f) => f.name).join(', ')} exceeds the 100 MB limit.`,
        variant: 'destructive',
      });
    }
    const accepted = next.filter((f) => f.size <= MAX_UPLOAD_BYTES);
    if (!accepted.length) return;
    setPendingFiles((prev) => {
      const seen = new Set(prev.map((f) => `${f.name}:${f.size}:${f.lastModified}`));
      const merged = [...prev];
      for (const file of accepted) {
        const key = `${file.name}:${file.size}:${file.lastModified}`;
        if (!seen.has(key)) {
          seen.add(key);
          merged.push(file);
        }
      }
      return merged;
    });
    if (accepted.length === 1) {
      setMeta((m) => ({ ...m, title: accepted[0].name.replace(/\.[^.]+$/, '') }));
    }
  };

  const removePendingFile = (index: number) => {
    setPendingFiles((prev) => {
      const next = prev.filter((_, i) => i !== index);
      if (next.length === 1) {
        setMeta((m) => ({ ...m, title: next[0].name.replace(/\.[^.]+$/, '') }));
      } else if (next.length === 0) {
        setMeta((m) => ({ ...m, title: '' }));
      }
      return next;
    });
    if (fileRef.current) fileRef.current.value = '';
  };

  const uploadMutation = useMutation<
    UploadMutationResult,
    Error,
    UploadJobPayload,
    UploadMutateContext
  >({
    mutationFn: async ({ files, meta: uploadMeta, uploadScope: scope }: UploadJobPayload) => {
      if (!files.length) throw new Error('Choose at least one file');
      const fileResults: UploadFileResult[] = [];
      const uploadedMaterials: Material[] = [];

      const appendSharedMeta = (fd: FormData) => {
        fd.append('type', uploadMeta.type);
        fd.append('academicClassId', uploadMeta.academicClassId);
        fd.append('subjectId', uploadMeta.subjectId);
        fd.append('academicSession', uploadMeta.academicSession);
        fd.append('fullBook', scope === 'FULL_BOOK' ? 'true' : 'false');
        if (scope === 'CHAPTER' && files.length === 1 && uploadMeta.chapterId) {
          fd.append('chapterId', uploadMeta.chapterId);
        }
      };

      if (files.length === 1) {
        const file = files[0];
        const fd = new FormData();
        fd.append('file', file);
        fd.append(
          'title',
          uploadMeta.title.trim() ? uploadMeta.title.trim() : file.name.replace(/\.[^.]+$/, ''),
        );
        appendSharedMeta(fd);
        const created = (await materialsApi.upload(accessToken!, fd)) as Material;
        uploadedMaterials.push(created);
        return {
          materials: uploadedMaterials,
          fileResults: [{ fileName: file.name, ok: true }],
        };
      }

      const batches = chunkFiles(files, FILES_PER_BATCH);
      setUploadProgress({ current: 0, total: batches.length });
      let completedBatches = 0;
      await runPool(batches, UPLOAD_PARALLEL_BATCHES, async (batch) => {
        const fd = new FormData();
        for (const file of batch) fd.append('files', file);
        fd.append('titles', batch.map((f) => f.name.replace(/\.[^.]+$/, '')).join('\n'));
        appendSharedMeta(fd);
        try {
          const batchRes = (await materialsApi.uploadBatch(accessToken!, fd)) as {
            materials?: Material[];
          };
          for (const row of batchRes.materials ?? []) uploadedMaterials.push(row);
          for (const file of batch) fileResults.push({ fileName: file.name, ok: true });
        } catch (e) {
          const msg = e instanceof Error ? e.message : 'Upload failed';
          for (const file of batch) fileResults.push({ fileName: file.name, ok: false, error: msg });
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
    onMutate: ({ files, meta: uploadMeta }) => {
      setUploadProgress(null);
      const cls = (classes ?? []).find((c) => c.id === uploadMeta.academicClassId);
      const subjectHints = (cls?.subjects ?? []).map((s) => ({
        id: s.id,
        name: s.name,
        code: s.code,
      }));
      const placeholders: Material[] = files.map((file, index) => {
        const title =
          uploadMeta.title.trim() && files.length === 1
            ? uploadMeta.title.trim()
            : file.name.replace(/\.[^.]+$/, '');
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
          type: uploadMeta.type,
          fileName: file.name,
          fileSize: file.size,
          mimeType: file.type || 'application/pdf',
          status: 'PENDING',
          chunkCount: 0,
          academicSession: uploadMeta.academicSession,
          createdAt: new Date().toISOString(),
          academicClass: cls ? { level: cls.level, name: cls.name } : null,
          subject: subject ? { name: subject.name, code: subject.code } : null,
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
      setPendingFiles([]);
      setMeta((m) => ({ ...m, title: '', chapterId: '' }));
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
        toast({
          title: 'Upload complete',
          description: 'Indexing in the background — status updates in the queue below.',
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
    }
  }, [materials, queryClient, uploadMutation.isPending, user?.id]);

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

  const canSubmitUpload = pendingFiles.length > 0 && meta.academicClassId && meta.subjectId;

  return (
    <div className="space-y-8">
      <PageHeader
        title="NCERT Books & Notes"
        highlight="Books & Notes"
        description={
          teacherPortal
            ? 'View and download NCERT books uploaded for your assigned class and subject.'
            : 'Upload Class 9–12 NCERT PDFs — complete books or chapter files. Chapters are extracted from your files and power AI class tests.'
        }
        badge={teacherPortal ? 'Teacher · Assigned subjects' : 'NCERT · Classes 9–12'}
      />

      {canUpload && (
      <Card className="border-primary/20 bg-primary/[0.03]">
        <CardContent className="flex gap-3 p-4 text-sm">
          <Shield className="mt-0.5 h-5 w-5 shrink-0 text-primary" />
          <div>
            <p className="font-medium">Strict document-only AI</p>
            <p className="mt-1 text-muted-foreground">
              Upload a <strong>complete book</strong> to auto-detect all chapters, or upload one or more chapter PDFs at once.
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
          <div
            className="cursor-pointer rounded-xl border-2 border-dashed p-8 text-center transition-colors hover:border-primary/50"
            onClick={() => fileRef.current?.click()}
          >
            {pendingFiles.length > 0 ? (
              <div className="space-y-2 text-left">
                <p className="text-center text-sm font-medium text-muted-foreground">
                  {pendingFiles.length} file{pendingFiles.length > 1 ? 's' : ''} selected
                  {' · '}
                  <button
                    type="button"
                    className="text-primary underline-offset-2 hover:underline"
                    onClick={(e) => {
                      e.stopPropagation();
                      fileRef.current?.click();
                    }}
                  >
                    Add more
                  </button>
                </p>
                <ul className="max-h-48 space-y-1 overflow-y-auto">
                  {pendingFiles.map((file, index) => (
                    <li
                      key={`${file.name}-${file.size}-${file.lastModified}`}
                      className="flex items-center gap-2 rounded-lg border bg-background px-3 py-2"
                    >
                      <FileText className="h-4 w-4 shrink-0 text-primary" />
                      <span className="min-w-0 flex-1 truncate text-sm font-medium">{file.name}</span>
                      <Badge variant="outline" className="shrink-0">{formatFileSize(file.size)}</Badge>
                      <Button
                        type="button"
                        size="icon"
                        variant="ghost"
                        className="h-7 w-7 shrink-0"
                        onClick={(e) => {
                          e.stopPropagation();
                          removePendingFile(index);
                        }}
                      >
                        <X className="h-4 w-4" />
                      </Button>
                    </li>
                  ))}
                </ul>
              </div>
            ) : (
              <>
                <BookOpen className="mx-auto h-8 w-8 text-muted-foreground" />
                <p className="mt-2 font-medium">Choose PDF or text files</p>
                <p className="text-sm text-muted-foreground">Select multiple files · Max 100 MB each</p>
              </>
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
          </div>

          <div className="grid grid-cols-2 gap-2 rounded-lg border bg-muted/30 p-1">
            <button
              type="button"
              className={cn(
                'rounded-md py-2 text-sm font-medium transition-colors',
                uploadScope === 'FULL_BOOK' ? 'bg-background shadow-sm' : 'text-muted-foreground',
              )}
              onClick={() => setUploadScope('FULL_BOOK')}
            >
              Complete book
            </button>
            <button
              type="button"
              className={cn(
                'rounded-md py-2 text-sm font-medium transition-colors',
                uploadScope === 'CHAPTER' ? 'bg-background shadow-sm' : 'text-muted-foreground',
              )}
              onClick={() => setUploadScope('CHAPTER')}
            >
              Single chapter
            </button>
          </div>

          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-2 sm:col-span-2">
              <Label>
                Title
                {pendingFiles.length > 1 && (
                  <span className="ml-2 font-normal text-muted-foreground">(each file uses its filename)</span>
                )}
              </Label>
              <Input
                placeholder={uploadScope === 'FULL_BOOK' ? 'e.g. NCERT Social Science Class 9' : 'e.g. NCERT SST Ch.2'}
                value={meta.title}
                disabled={pendingFiles.length > 1}
                onChange={(e) => setMeta({ ...meta, title: e.target.value })}
              />
            </div>
            <div className="space-y-2">
              <Label>Document type</Label>
              <select
                className="flex h-10 w-full rounded-md border border-input bg-background px-3 text-sm"
                value={meta.type}
                onChange={(e) => setMeta({ ...meta, type: e.target.value })}
              >
                {DOC_TYPES.map((t) => (
                  <option key={t.value} value={t.value}>{t.label}</option>
                ))}
              </select>
            </div>
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
                })}
              >
                <option value="">Select class</option>
                {(classes ?? []).map((c) => (
                  <option key={c.id} value={c.id}>Class {c.level} — {c.name}</option>
                ))}
              </select>
            </div>
            <div className="space-y-2">
              <Label>Subject *</Label>
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
            </div>
            {uploadScope === 'FULL_BOOK' && (
              <p className="sm:col-span-2 rounded-lg bg-muted/50 px-3 py-2 text-sm text-muted-foreground">
                Chapters will be detected from your PDF and appear in Classes &amp; Batches after indexing.
                {pendingFiles.length > 1 && (
                  <>
                    {' '}
                    Multiple files: subject is auto-detected from each file name (English, Maths, Science…); the
                    dropdown is used only when a name is unclear.
                  </>
                )}
              </p>
            )}
            {uploadScope === 'CHAPTER' && (
              <p className="sm:col-span-2 rounded-lg bg-muted/50 px-3 py-2 text-sm text-muted-foreground">
                Use this mode when uploading one or more individual chapter PDFs. Chapter titles are auto-detected from each file.
              </p>
            )}
            {uploadScope === 'CHAPTER' && pendingFiles.length === 1 && chapters.length > 0 && (
            <div className="space-y-2 sm:col-span-2">
              <Label>Link to extracted chapter (optional)</Label>
              <select
                className="flex h-10 w-full rounded-md border border-input bg-background px-3 text-sm"
                value={meta.chapterId}
                disabled={!meta.subjectId}
                onChange={(e) => setMeta({ ...meta, chapterId: e.target.value })}
              >
                <option value="">Auto-detect from PDF</option>
                {chapters.map((ch) => (
                  <option key={ch.id} value={ch.id}>Ch. {ch.number}: {ch.title}</option>
                ))}
              </select>
            </div>
            )}
            <div className="space-y-2 sm:col-span-2">
              <Label>Academic session</Label>
              <Input
                value={meta.academicSession}
                onChange={(e) => setMeta({ ...meta, academicSession: e.target.value })}
              />
            </div>
          </div>

          <Button
            className="w-full"
            size="lg"
            disabled={!canSubmitUpload || uploadMutation.isPending}
            onClick={() =>
              uploadMutation.mutate({
                files: [...pendingFiles],
                meta: { ...meta },
                uploadScope,
              })
            }
          >
            {uploadMutation.isPending
              ? uploadProgress
                ? `Uploading ${uploadProgress.current} of ${uploadProgress.total}…`
                : 'Uploading…'
              : pendingFiles.length > 1
                ? `Upload ${pendingFiles.length} files to knowledge base`
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
            <Card key={m.id} className={cn(placeholder && 'border-amber-500/30 bg-amber-500/[0.03]')}>
              <CardContent className="flex items-center gap-3 p-4">
                <FileText className="h-5 w-5 shrink-0 text-primary" />
                <div className="min-w-0 flex-1">
                  <p className="truncate font-medium">{m.title}</p>
                  <p className="truncate text-xs text-muted-foreground">
                    {m.academicClass ? `Class ${m.academicClass.level}` : 'Untagged'}
                    {m.subject ? ` · ${m.subject.name}` : ''}
                    {m.chapter
                      ? ` · Ch.${m.chapter.number} ${m.chapter.title}`
                      : m.subject
                        ? ' · Complete book'
                        : ''}
                    {' · '}{formatFileSize(m.fileSize)}
                    {m.status === 'READY' && m.chunkCount > 0 ? ` · ${m.chunkCount} chunks` : ''}
                  </p>
                  {!m.subject && (
                    <p className="text-xs text-amber-600">Missing tags — re-upload with class and subject</p>
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
                <Button size="icon" variant="ghost" title="View" disabled={placeholder || openingId === m.id} onClick={async () => {
                  setOpeningId(m.id);
                  try { await materialsApi.openFile(accessToken!, m.id); }
                  catch (e) { toast({ title: 'Could not open', description: e instanceof Error ? e.message : '', variant: 'destructive' }); }
                  finally { setOpeningId(null); }
                }}>
                  {openingId === m.id ? <Loader2 className="h-4 w-4 animate-spin" /> : <Eye className="h-4 w-4" />}
                </Button>
                <Button size="icon" variant="ghost" title="Download" disabled={placeholder} onClick={() => materialsApi.downloadFile(accessToken!, m.id, m.fileName)}>
                  <Download className="h-4 w-4" />
                </Button>
                {canUpload && (
                <Button size="icon" variant="ghost" title="Re-index" disabled={placeholder} onClick={async () => {
                  try {
                    await materialsApi.reindex(accessToken!, m.id);
                    queryClient.invalidateQueries({ queryKey: ['materials'] });
                    toast({
                      title: 'Re-index started',
                      description: 'Processing in the background. Refresh status here when it shows Indexed or Failed.',
                    });
                  } catch (e) {
                    toast({ title: 'Re-index failed', description: e instanceof Error ? e.message : 'Failed', variant: 'destructive' });
                  }
                }}>
                  <RefreshCw className="h-4 w-4" />
                </Button>
                )}
                {canDelete && (
                <Button
                  size="icon"
                  variant="ghost"
                  title="Delete"
                  disabled={placeholder || (deleteMutation.isPending && deleteMutation.variables === m.id)}
                  onClick={() => {
                    if (!window.confirm(`Delete "${m.title}"? This removes indexed chapters for this book.`)) return;
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
    </div>
  );
}
