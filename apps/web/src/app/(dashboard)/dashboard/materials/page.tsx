'use client';

import { useRef, useState, useMemo, useEffect } from 'react';
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
import { Permission } from '@cbt/shared';
import { toast } from '@/hooks/use-toast';
import {
  Upload, FileText, RefreshCw, Trash2, Loader2, Eye, Download, BookOpen, Shield, X,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { TableSkeleton } from '@/components/ui/skeleton';
import { useAuthStore } from '@/stores/auth-store';
import { isTeacherOnly, normalizeRoles } from '@/lib/roles';

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
  INDEXING: 'Processing…',
  PENDING: 'Queued',
  FAILED: 'Failed',
};

const DOC_TYPES = [
  { value: 'NCERT', label: 'NCERT PDF' },
  { value: 'INSTITUTE_NOTES', label: 'Institute Notes' },
  { value: 'WORKSHEET', label: 'Worksheet' },
  { value: 'TEACHER_NOTES', label: 'Teacher Notes' },
  { value: 'QUESTION_BANK', label: 'Question Bank' },
];

const MAX_UPLOAD_BYTES = 100 * 1024 * 1024;

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
  const [openingId, setOpeningId] = useState<string | null>(null);
  const [pendingFiles, setPendingFiles] = useState<File[]>([]);
  const [uploadProgress, setUploadProgress] = useState<{ current: number; total: number } | null>(null);
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

  const { data: materials, isLoading } = useQuery({
    queryKey: ['materials'],
    queryFn: () => materialsApi.list(accessToken!) as Promise<Material[]>,
    enabled: !!accessToken,
    refetchInterval: (q) => {
      const items = q.state.data as Material[] | undefined;
      return items?.some((m) => m.status === 'PENDING' || m.status === 'INDEXING') ? 3000 : false;
    },
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

  const uploadMutation = useMutation({
    mutationFn: async () => {
      if (!pendingFiles.length) throw new Error('Choose at least one file');
      const results: { fileName: string; ok: boolean; error?: string }[] = [];
      const total = pendingFiles.length;
      const useSharedTitle = total === 1;

      for (let i = 0; i < pendingFiles.length; i++) {
        const file = pendingFiles[i];
        setUploadProgress({ current: i + 1, total });
        const fd = new FormData();
        fd.append('file', file);
        fd.append(
          'title',
          useSharedTitle && meta.title.trim()
            ? meta.title.trim()
            : file.name.replace(/\.[^.]+$/, ''),
        );
        fd.append('type', meta.type);
        fd.append('academicClassId', meta.academicClassId);
        fd.append('subjectId', meta.subjectId);
        if (uploadScope === 'CHAPTER' && total === 1 && meta.chapterId) {
          fd.append('chapterId', meta.chapterId);
        }
        fd.append('academicSession', meta.academicSession);
        fd.append('fullBook', uploadScope === 'FULL_BOOK' ? 'true' : 'false');
        try {
          await materialsApi.upload(accessToken!, fd);
          results.push({ fileName: file.name, ok: true });
        } catch (e) {
          results.push({
            fileName: file.name,
            ok: false,
            error: e instanceof Error ? e.message : 'Upload failed',
          });
        }
      }

      setUploadProgress(null);
      const failed = results.filter((r) => !r.ok);
      if (failed.length === results.length) {
        throw new Error(failed[0]?.error ?? 'All uploads failed');
      }
      return results;
    },
    onSuccess: (results) => {
      queryClient.invalidateQueries({ queryKey: ['materials'] });
      queryClient.invalidateQueries({ queryKey: ['curriculum-from-uploads'] });
      queryClient.invalidateQueries({ queryKey: ['syllabus-progress'] });
      setPendingFiles([]);
      setMeta((m) => ({ ...m, title: '', chapterId: '' }));
      if (fileRef.current) fileRef.current.value = '';
      const succeeded = results.filter((r) => r.ok).length;
      const failed = results.filter((r) => !r.ok);
      if (failed.length === 0) {
        toast({
          title: succeeded === 1 ? 'Document uploaded' : `${succeeded} documents uploaded`,
          description: 'Extracting chapters from your PDFs. Syllabus updates when indexing completes.',
        });
      } else {
        toast({
          title: `${succeeded} uploaded, ${failed.length} failed`,
          description: failed.map((f) => `${f.fileName}: ${f.error}`).join('; '),
          variant: 'destructive',
        });
      }
    },
    onError: (e: Error) => {
      setUploadProgress(null);
      toast({ title: 'Upload failed', description: e.message, variant: 'destructive' });
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
            onClick={() => uploadMutation.mutate()}
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

      {isLoading ? (
        <TableSkeleton rows={3} />
      ) : (materials ?? []).length > 0 ? (
        <div className="space-y-3">
          <h2 className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">
            {teacherPortal ? 'Books for your subjects' : 'Your documents'} ({materials?.length})
          </h2>
          {(materials ?? []).map((m) => (
            <Card key={m.id}>
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
                <Badge variant={m.status === 'READY' ? 'success' : m.status === 'FAILED' ? 'destructive' : 'outline'}>
                  {STATUS_LABEL[m.status] ?? m.status}
                </Badge>
                <Button size="icon" variant="ghost" title="View" disabled={openingId === m.id} onClick={async () => {
                  setOpeningId(m.id);
                  try { await materialsApi.openFile(accessToken!, m.id); }
                  catch (e) { toast({ title: 'Could not open', description: e instanceof Error ? e.message : '', variant: 'destructive' }); }
                  finally { setOpeningId(null); }
                }}>
                  {openingId === m.id ? <Loader2 className="h-4 w-4 animate-spin" /> : <Eye className="h-4 w-4" />}
                </Button>
                <Button size="icon" variant="ghost" title="Download" onClick={() => materialsApi.downloadFile(accessToken!, m.id, m.fileName)}>
                  <Download className="h-4 w-4" />
                </Button>
                {canUpload && (
                <Button size="icon" variant="ghost" title="Re-index" onClick={async () => {
                  try {
                    await materialsApi.reindex(accessToken!, m.id);
                    queryClient.invalidateQueries({ queryKey: ['materials'] });
                    toast({ title: 'Re-index queued', description: 'Document marked ready. Full PDF chapter extraction needs the NestJS API.' });
                  } catch (e) {
                    toast({ title: 'Re-index failed', description: e instanceof Error ? e.message : 'Failed', variant: 'destructive' });
                  }
                }}>
                  <RefreshCw className="h-4 w-4" />
                </Button>
                )}
                {canDelete && (
                <Button size="icon" variant="ghost" onClick={() => materialsApi.delete(accessToken!, m.id).then(() => queryClient.invalidateQueries({ queryKey: ['materials'] }))}>
                  <Trash2 className="h-4 w-4 text-destructive" />
                </Button>
                )}
              </CardContent>
            </Card>
          ))}
        </div>
      ) : (
        <Card className="border-dashed">
          <CardContent className="py-12 text-center text-muted-foreground">
            {teacherPortal
              ? 'No books for your assigned subjects yet. Ask your admin to upload NCERT books for your class and subject.'
              : 'No documents yet. Upload a book for a class and subject — chapters will be extracted automatically.'}
          </CardContent>
        </Card>
      )}
    </div>
  );
}
