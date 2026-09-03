'use client';

import { useEffect, useRef } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useAuthStore } from '@/stores/auth-store';
import { useNotificationStore } from '@/stores/notification-store';
import { dashboardApi } from '@/lib/api';
import { usePermissions } from '@/hooks/use-permissions';
import { Permission } from '@cbt/shared';

type DashboardStats = {
  recentSubmissions?: { id: string; candidateName: string; examTitle: string; submittedAt: string }[];
};

export function useLiveNotifications() {
  const accessToken = useAuthStore((s) => s.accessToken);
  const add = useNotificationStore((s) => s.add);
  const { can } = usePermissions();
  const seenSubmissions = useRef(new Set<string>());
  const submissionsInitialized = useRef(false);
  const canMonitor = can(Permission.PROCTORING_MONITOR);
  const canReadResults = can(Permission.RESULT_READ);

  useEffect(() => {
    if (!accessToken || !canMonitor) return;

    let cancelled = false;
    let off: (() => void) | undefined;

    void import('@/lib/socket').then(({ getProctoringSocket }) => {
      if (cancelled) return;
      const socket = getProctoringSocket();
      if (!socket) return;
      socket.connect();
      socket.emit('proctoring:join-monitoring');

      const onViolation = (data: { sessionId: string; type: string; severity: string; timestamp: string }) => {
        add({
          type: 'violation',
          title: `Proctoring alert: ${data.type}`,
          message: `Session ${data.sessionId.slice(0, 8)} · ${data.severity}`,
          timestamp: data.timestamp,
        });
      };

      socket.on('proctoring:violation', onViolation);
      off = () => socket.off('proctoring:violation', onViolation);
    });

    return () => {
      cancelled = true;
      off?.();
    };
  }, [accessToken, canMonitor, add]);

  const { data } = useQuery({
    queryKey: ['dashboard'],
    queryFn: () => dashboardApi.stats(accessToken!) as Promise<DashboardStats>,
    enabled: !!accessToken && canReadResults,
    staleTime: 60_000,
    refetchInterval: 30_000,
    refetchIntervalInBackground: false,
  });

  useEffect(() => {
    for (const sub of data?.recentSubmissions || []) {
      if (!submissionsInitialized.current) {
        seenSubmissions.current.add(sub.id);
        continue;
      }
      if (seenSubmissions.current.has(sub.id)) continue;
      seenSubmissions.current.add(sub.id);
      if (seenSubmissions.current.size > 100) {
        const first = seenSubmissions.current.values().next().value;
        if (first) seenSubmissions.current.delete(first);
      }
      add({
        type: 'submission',
        title: `${sub.candidateName} submitted`,
        message: sub.examTitle,
        timestamp: sub.submittedAt,
      });
    }
    if (data?.recentSubmissions) submissionsInitialized.current = true;
  }, [data, add]);
}
