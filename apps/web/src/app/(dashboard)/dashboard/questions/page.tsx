'use client';

import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from '@/components/ui/dialog';
import { questionsApi } from '@/lib/api';
import { useRequireAuth } from '@/hooks/use-auth';
import { useDebounce } from '@/hooks/use-debounce';
import { usePermissions } from '@/hooks/use-permissions';
import { Permission } from '@cbt/shared';
import { toast } from '@/hooks/use-toast';
import Link from 'next/link';
import { Search, Sparkles, Plus, HelpCircle } from 'lucide-react';
import { PageHeader } from '@/components/layout/page-header';
import { DataTable, DataTableHeader, DataTableHead, DataTableRow, DataTableCell, EmptyState } from '@/components/layout/data-table';
import { PaginationControls } from '@/components/layout/pagination';
import { TableSkeleton } from '@/components/ui/skeleton';

const EMPTY_QUESTION_FORM = {
  title: '',
  type: 'MCQ',
  difficulty: 'MEDIUM',
  content: '',
  optionA: '',
  optionB: '',
  optionC: '',
  optionD: '',
  correctAnswer: 'a',
  correctAnswers: [] as string[],
};

export default function QuestionsPage() {
  const { accessToken } = useRequireAuth(true);
  const { can } = usePermissions();
  const queryClient = useQueryClient();
  const [showCreate, setShowCreate] = useState(false);
  const [search, setSearch] = useState('');
  const [page, setPage] = useState(1);
  const debouncedSearch = useDebounce(search);
  const [deleteTarget, setDeleteTarget] = useState<{ id: string; title: string } | null>(null);
  const [form, setForm] = useState(EMPTY_QUESTION_FORM);

  const { data, isLoading, isFetching } = useQuery({
    queryKey: ['questions', debouncedSearch, page],
    queryFn: () => questionsApi.list(accessToken!, page, { search: debouncedSearch }),
    enabled: !!accessToken,
    placeholderData: (prev) => prev,
  });

  const createMutation = useMutation({
    mutationFn: () => {
      if (form.type === 'MSQ' && form.correctAnswers.length === 0) {
        throw new Error('Select at least one correct answer for MSQ');
      }
      if (!form.title.trim() || !form.content.trim()) {
        throw new Error('Title and question text are required');
      }
      return questionsApi.create(accessToken!, {
      title: form.title,
      type: form.type,
      difficulty: form.difficulty,
      content: { text: form.content },
      options: { a: form.optionA, b: form.optionB, c: form.optionC, d: form.optionD },
      correctAnswer: form.type === 'MSQ'
        ? { value: form.correctAnswers }
        : { value: form.correctAnswer },
      marks: 2,
      negativeMarks: 0,
    });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['questions'] });
      setForm(EMPTY_QUESTION_FORM);
      setShowCreate(false);
      toast({ title: 'Question saved', variant: 'success' });
    },
    onError: (e: Error) =>
      toast({ title: 'Save failed', description: e.message, variant: 'destructive' }),
  });

  const approveMutation = useMutation({
    mutationFn: (id: string) => questionsApi.approve(accessToken!, id),
    onMutate: async (id) => {
      await queryClient.cancelQueries({ queryKey: ['questions', debouncedSearch] });
      const previous = queryClient.getQueryData<{ items: { id: string; status: string }[] }>(['questions', debouncedSearch]);
      queryClient.setQueryData(['questions', debouncedSearch], (old: typeof previous) => {
        if (!old) return old;
        return {
          ...old,
          items: old.items.map((q) => (q.id === id ? { ...q, status: 'APPROVED' } : q)),
        };
      });
      return { previous };
    },
    onSuccess: () => toast({ title: 'Question approved', variant: 'success' }),
    onError: (e: Error, _, context) => {
      if (context?.previous) queryClient.setQueryData(['questions', debouncedSearch], context.previous);
      toast({ title: 'Failed', description: e.message, variant: 'destructive' });
    },
    onSettled: () => queryClient.invalidateQueries({ queryKey: ['questions'] }),
  });

  const deleteMutation = useMutation({
    mutationFn: (id: string) => questionsApi.remove(accessToken!, id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['questions'] });
      setDeleteTarget(null);
      toast({ title: 'Question deleted from bank', variant: 'success' });
    },
    onError: (e: Error) => toast({ title: 'Cannot delete', description: e.message, variant: 'destructive' }),
  });

  if (isLoading) return <TableSkeleton rows={5} cols={5} />;

  const items = data?.items || [];

  return (
    <div className="space-y-8">
      <PageHeader
        title="Question Bank"
        highlight="Bank"
        description="MCQ & MSQ questions with approval workflow"
        badge={data?.total != null ? `${data.total} total` : 'Question bank'}
      >
        <div className="relative w-56">
          <Search className="absolute left-3 top-2.5 h-4 w-4 text-muted-foreground" />
          <Input placeholder="Search questions..." className="pl-9" value={search} onChange={(e) => setSearch(e.target.value)} />
        </div>
        <Button variant="outline" asChild>
          <Link href="/dashboard/ai"><Sparkles className="mr-2 h-4 w-4" />Generate with AI</Link>
        </Button>
        {can(Permission.QUESTION_CREATE) && (
        <Button
          onClick={() => {
            if (showCreate) {
              setShowCreate(false);
            } else {
              setForm(EMPTY_QUESTION_FORM);
              setShowCreate(true);
            }
          }}
        >
          <Plus className="mr-2 h-4 w-4" />
          {showCreate ? 'Cancel' : 'Add Question'}
        </Button>
        )}
      </PageHeader>

      {showCreate && (
        <Card className="surface-card border-primary/20">
          <CardHeader className="border-b border-border/60">
            <CardTitle className="text-base font-bold">New Question</CardTitle>
          </CardHeader>
          <CardContent className="space-y-5 pt-6">
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              <div className="space-y-2"><Label>Title</Label><Input value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} /></div>
              <div className="space-y-2"><Label>Type</Label>
                <select className="form-select" value={form.type} onChange={(e) => setForm({ ...form, type: e.target.value })}>
                  <option value="MCQ">MCQ (Single Answer)</option>
                  <option value="MSQ">MSQ (Multiple Answers)</option>
                </select>
              </div>
            </div>
            <div className="space-y-2"><Label>Question Text</Label><Textarea value={form.content} onChange={(e) => setForm({ ...form, content: e.target.value })} /></div>
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              {(['A', 'B', 'C', 'D'] as const).map((l) => (
                <div key={l} className="space-y-2"><Label>Option {l}</Label><Input value={form[`option${l}` as keyof typeof form] as string} onChange={(e) => setForm({ ...form, [`option${l}`]: e.target.value })} /></div>
              ))}
            </div>
            {form.type === 'MSQ' ? (
              <div className="space-y-2"><Label>Correct Answers</Label>
                <div className="flex gap-4">
                  {(['a', 'b', 'c', 'd'] as const).map((l) => (
                    <label key={l} className="flex items-center gap-2 text-sm font-medium">
                      <input type="checkbox" className="rounded border-input" checked={form.correctAnswers.includes(l)}
                        onChange={(e) => setForm({
                          ...form,
                          correctAnswers: e.target.checked
                            ? [...form.correctAnswers, l]
                            : form.correctAnswers.filter((x) => x !== l),
                        })} />
                      {l.toUpperCase()}
                    </label>
                  ))}
                </div>
              </div>
            ) : (
              <div className="space-y-2"><Label>Correct Answer</Label>
                <select className="form-select" value={form.correctAnswer} onChange={(e) => setForm({ ...form, correctAnswer: e.target.value })}>
                  <option value="a">A</option><option value="b">B</option><option value="c">C</option><option value="d">D</option>
                </select>
              </div>
            )}
            <Button onClick={() => createMutation.mutate()} disabled={createMutation.isPending}>Save Question</Button>
          </CardContent>
        </Card>
      )}

      <DataTable>
        <table className="w-full">
          <DataTableHeader>
            <DataTableHead>Title</DataTableHead>
            <DataTableHead>Type</DataTableHead>
            <DataTableHead>Difficulty</DataTableHead>
            <DataTableHead>Status</DataTableHead>
            <DataTableHead>Approve</DataTableHead>
            <DataTableHead>Delete</DataTableHead>
          </DataTableHeader>
          <tbody>
            {items.map((q) => (
              <DataTableRow key={q.id}>
                <DataTableCell className="font-medium">{q.title || 'Untitled'}</DataTableCell>
                <DataTableCell><Badge variant="outline">{q.type}</Badge></DataTableCell>
                <DataTableCell className="text-muted-foreground">{q.difficulty}</DataTableCell>
                <DataTableCell><Badge variant={q.status === 'APPROVED' ? 'success' : 'warning'}>{q.status}</Badge></DataTableCell>
                <DataTableCell>
                  {can(Permission.QUESTION_APPROVE) && q.status !== 'APPROVED' ? (
                    <Button size="sm" variant="outline" onClick={() => approveMutation.mutate(q.id)}>Approve</Button>
                  ) : (
                    <span className="text-sm text-muted-foreground">—</span>
                  )}
                </DataTableCell>
                <DataTableCell>
                  {can(Permission.QUESTION_DELETE) ? (
                    <Button
                      size="sm"
                      variant="outline"
                      className="text-destructive hover:text-destructive"
                      onClick={() => setDeleteTarget({ id: q.id, title: q.title || 'Untitled' })}
                    >
                      Delete
                    </Button>
                  ) : (
                    <span className="text-sm text-muted-foreground">—</span>
                  )}
                </DataTableCell>
              </DataTableRow>
            ))}
          </tbody>
        </table>
        {!items.length && <EmptyState icon={HelpCircle} title="No questions found" description={debouncedSearch ? 'Try a different search term.' : 'Add questions manually or generate with AI.'} />}
      </DataTable>

      <PaginationControls
        page={page}
        totalPages={data?.totalPages ?? 1}
        total={data?.total}
        onPageChange={setPage}
      />

      {isFetching && !isLoading && (
        <p className="text-center text-xs text-muted-foreground">Updating...</p>
      )}

      <Dialog open={!!deleteTarget} onOpenChange={(open) => !open && setDeleteTarget(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Delete question?</DialogTitle>
            <DialogDescription>
              Permanently delete <span className="font-medium text-foreground">{deleteTarget?.title}</span> from the question bank.
              Cannot be undone if used in a published exam or already answered by candidates.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDeleteTarget(null)}>Cancel</Button>
            <Button
              variant="destructive"
              disabled={deleteMutation.isPending}
              onClick={() => deleteTarget && deleteMutation.mutate(deleteTarget.id)}
            >
              {deleteMutation.isPending ? 'Deleting...' : 'Delete from bank'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
