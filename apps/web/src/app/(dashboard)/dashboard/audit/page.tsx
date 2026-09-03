'use client';

import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Card, CardContent } from '@/components/ui/card';
import { auditApi } from '@/lib/api';
import { useRequireAuth } from '@/hooks/use-auth';
import { PageHeader } from '@/components/layout/page-header';
import { PaginationControls } from '@/components/layout/pagination';
import { TableSkeleton } from '@/components/ui/skeleton';

export default function AuditPage() {
  const { accessToken } = useRequireAuth(true);
  const [page, setPage] = useState(1);

  const { data, isLoading } = useQuery({
    queryKey: ['audit', page],
    queryFn: () => auditApi.list(accessToken!, page),
    enabled: !!accessToken,
  });

  if (isLoading) return <TableSkeleton rows={8} cols={5} />;

  return (
    <div className="space-y-6">
      <PageHeader
        title="Audit Logs"
        highlight="Logs"
        description="Security and compliance audit trail for your institute"
        badge="Compliance"
      />
      <Card>
        <CardContent className="p-0">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b bg-muted/50">
                <th className="p-3 text-left">Time</th>
                <th className="p-3 text-left">User</th>
                <th className="p-3 text-left">Action</th>
                <th className="p-3 text-left">Resource</th>
                <th className="p-3 text-left">IP</th>
              </tr>
            </thead>
            <tbody>
              {(data?.items || []).map((log) => (
                <tr key={log.id} className="border-b">
                  <td className="p-3">{new Date(log.createdAt).toLocaleString()}</td>
                  <td className="p-3">{log.user?.email || 'System'}</td>
                  <td className="p-3 font-mono text-xs">{log.action}</td>
                  <td className="p-3">{log.resourceType ?? log.entityType ?? '—'}</td>
                  <td className="p-3">{log.ipAddress || '-'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </CardContent>
      </Card>
      {data && (
        <PaginationControls page={page} totalPages={data.totalPages ?? 1} onPageChange={setPage} />
      )}
    </div>
  );
}
