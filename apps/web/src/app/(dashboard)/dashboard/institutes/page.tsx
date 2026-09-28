'use client';

import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { PageHeader } from '@/components/layout/page-header';
import { tenantsApi } from '@/lib/api';
import { useRequireAuth } from '@/hooks/use-auth';
import { toast } from '@/hooks/use-toast';
import { Building2 } from 'lucide-react';
import { TableSkeleton } from '@/components/ui/skeleton';

type Tenant = { id: string; name: string; slug: string; isActive: boolean; domain?: string };

export default function InstitutesPage() {
  const { accessToken } = useRequireAuth(true);
  const queryClient = useQueryClient();
  const [showCreate, setShowCreate] = useState(false);
  const [form, setForm] = useState({ name: '', slug: '' });

  const { data, isLoading } = useQuery({
    queryKey: ['tenants'],
    queryFn: () => tenantsApi.list(accessToken!) as Promise<{ items: Tenant[]; total: number }>,
    enabled: !!accessToken,
  });

  const createMutation = useMutation({
    mutationFn: () => tenantsApi.create(accessToken!, form),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['tenants'] });
      setShowCreate(false);
      setForm({ name: '', slug: '' });
      toast({ title: 'Institute created' });
    },
    onError: (e: Error) => toast({ title: 'Error', description: e.message, variant: 'destructive' }),
  });

  return (
    <div className="space-y-6">
      <PageHeader
        title="Institutes"
        description="Manage coaching institutes and schools on the platform"
        badge="Platform"
      >
        <Button onClick={() => setShowCreate(!showCreate)}>Add Institute</Button>
      </PageHeader>

      {showCreate && (
        <Card>
          <CardContent className="grid gap-4 pt-6 md:grid-cols-2">
            <div>
              <Label>Institute Name</Label>
              <Input
                value={form.name}
                onChange={(e) => setForm({ name: e.target.value, slug: e.target.value.toLowerCase().replace(/\s+/g, '-') })}
                placeholder="ABC Coaching Institute"
              />
            </div>
            <div>
              <Label>Slug</Label>
              <Input value={form.slug} onChange={(e) => setForm({ ...form, slug: e.target.value })} />
            </div>
            <Button className="md:col-span-2" disabled={!form.name || !form.slug} onClick={() => createMutation.mutate()}>
              Create Institute
            </Button>
          </CardContent>
        </Card>
      )}

      {isLoading ? (
        <TableSkeleton rows={3} />
      ) : (
        <div className="space-y-2">
          {(data?.items ?? []).map((t) => (
            <Card key={t.id}>
              <CardContent className="flex items-center gap-4 p-4">
                <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-primary/10">
                  <Building2 className="h-5 w-5 text-primary" />
                </div>
                <div className="flex-1">
                  <p className="font-semibold">{t.name}</p>
                  <p className="text-sm text-muted-foreground">{t.slug}{t.domain ? ` · ${t.domain}` : ''}</p>
                </div>
                <Badge variant={t.isActive ? 'success' : 'outline'}>{t.isActive ? 'Active' : 'Inactive'}</Badge>
              </CardContent>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}
