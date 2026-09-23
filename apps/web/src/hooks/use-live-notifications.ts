'use client';

import { useEffect, useRef } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useAuthStore } from '@/stores/auth-store';
import {
  UNASSIGNED_CLASS_HIGHLIGHT,
  useNotificationStore,
} from '@/stores/notification-store';
import { dashboardApi } from '@/lib/api';
import { usePermissions } from '@/hooks/use-permissions';
import { formatViolationLabel, Permission } from '@cbt/shared';

function formatRegistrationNotificationMessage(item: {
  candidateName: string;
  email: string;
  classLevel?: number | null;
  className?: string | null;
  batchName?: string | null;
}) {
  const parts = [item.candidateName, item.email];
  if (item.classLevel != null) {
    parts.push(`Class ${item.classLevel}`);
  } else if (item.className) {
    parts.push(item.className);
  }
  if (item.batchName) parts.push(item.batchName);
  return parts.join(' · ');
}

type DashboardStats = {
  recentSubmissions?: { id: string; candidateName: string; examTitle: string; submittedAt: string }[];
  recentViolations?: {
    id: string;
    sessionId?: string;
    label: string;
    severity: string;
    candidateName: string;
    examTitle: string;
    occurredAt: string;
    eventType?: string;
  }[];
  notificationFeed?: {
    kycPending?: { id: string; candidateName: string; email: string; submittedAt: string }[];
    newStudents?: {
      id: string;
      candidateName: string;
      email: string;
      registeredAt: string;
      academicClassId?: string | null;
      classLevel?: number | null;
      className?: string | null;
      batchName?: string | null;
    }[];
    testsCreated?: { id: string; title: string; code: string; status: string; createdAt: string }[];
  };
};

export function useLiveNotifications() {
  const accessToken = useAuthStore((s) => s.accessToken);
  const queryClient = useQueryClient();
  const add = useNotificationStore((s) => s.add);
  const markClassWithNewStudent = useNotificationStore((s) => s.markClassWithNewStudent);
  const { can } = usePermissions();
  const seenSubmissions = useRef(new Set<string>());
  const seenKyc = useRef(new Set<string>());
  const seenStudents = useRef(new Set<string>());
  const seenTests = useRef(new Set<string>());
  const seenViolations = useRef(new Set<string>());
  const violationSocketKeys = useRef(new Set<string>());
  const feedInitialized = useRef(false);

  const violationDedupeKey = (
    sessionId: string | undefined,
    eventType: string | undefined,
    occurredAt: string,
  ) => (sessionId && eventType ? `${sessionId}:${eventType}:${occurredAt}` : '');
  const canMonitor = can(Permission.PROCTORING_MONITOR);
  const canViewViolations =
    canMonitor || can(Permission.SECURITY_VIEW_VIOLATIONS);
  const canReadResults = can(Permission.RESULT_READ);
  const canManageStudents = can(Permission.CANDIDATE_READ);
  const canReadExams = can(Permission.EXAM_READ);
  const canUseFeed =
    canReadResults || canManageStudents || canReadExams || canViewViolations;

  useEffect(() => {
    if (!accessToken || !canMonitor) return;

    let cancelled = false;
    let off: (() => void) | undefined;

    void import('@/lib/socket').then(({ connectProctoringSocket }) => {
      if (cancelled) return;
      void connectProctoringSocket().then((socket) => {
        if (cancelled || !socket) return;
        socket.emit('proctoring:join-monitoring');

      const onViolation = (data: {
        sessionId: string;
        type: string;
        severity: string;
        timestamp: string;
        candidateName?: string;
        examTitle?: string;
      }) => {
        const label = formatViolationLabel(data.type);
        const dedupeKey = violationDedupeKey(data.sessionId, data.type, data.timestamp);
        if (dedupeKey) violationSocketKeys.current.add(dedupeKey);
        add({
          type: 'violation',
          title: `Integrity alert: ${label}`,
          message: data.candidateName
            ? `${data.candidateName}${data.examTitle ? ` · ${data.examTitle}` : ''} · ${data.severity}`
            : `Session ${data.sessionId.slice(0, 8)} · ${data.severity}`,
          timestamp: data.timestamp,
        });
      };

        socket.on('proctoring:violation', onViolation);
        off = () => socket.off('proctoring:violation', onViolation);
      });
    });

    return () => {
      cancelled = true;
      off?.();
    };
  }, [accessToken, canMonitor, add]);

  const { data } = useQuery({
    queryKey: ['dashboard'],
    queryFn: () => dashboardApi.stats(accessToken!) as Promise<DashboardStats>,
    enabled: !!accessToken && canUseFeed,
    staleTime: 60_000,
    refetchInterval: 30_000,
    refetchIntervalInBackground: false,
  });

  useEffect(() => {
    if (canReadResults) {
      for (const sub of data?.recentSubmissions || []) {
        if (!feedInitialized.current) {
          seenSubmissions.current.add(sub.id);
          continue;
        }
        if (seenSubmissions.current.has(sub.id)) continue;
        seenSubmissions.current.add(sub.id);
        add({
          type: 'submission',
          title: `${sub.candidateName} attempted a test`,
          message: sub.examTitle,
          timestamp: sub.submittedAt,
        });
      }
    }

    const feed = data?.notificationFeed;
    if (canManageStudents && feed?.kycPending) {
      for (const item of feed.kycPending) {
        if (!feedInitialized.current) {
          seenKyc.current.add(item.id);
          continue;
        }
        if (seenKyc.current.has(item.id)) continue;
        seenKyc.current.add(item.id);
        add({
          type: 'kyc',
          title: 'KYC pending review',
          message: `${item.candidateName} (${item.email})`,
          timestamp: item.submittedAt,
          href: `/dashboard/candidates?kycReview=${encodeURIComponent(item.id)}`,
        });
      }
    }

    if (canManageStudents && feed?.newStudents) {
      for (const item of feed.newStudents) {
        if (!feedInitialized.current) {
          seenStudents.current.add(item.id);
          continue;
        }
        if (seenStudents.current.has(item.id)) continue;
        seenStudents.current.add(item.id);
        add({
          type: 'registration',
          title: 'New student registered',
          message: formatRegistrationNotificationMessage(item),
          timestamp: item.registeredAt,
          href: `/dashboard/candidates?q=${encodeURIComponent(item.email)}`,
        });
        markClassWithNewStudent(item.academicClassId ?? UNASSIGNED_CLASS_HIGHLIGHT);
        void queryClient.invalidateQueries({ queryKey: ['candidates'] });
        void queryClient.invalidateQueries({ queryKey: ['candidates-stats'] });
      }
    }

    if ((canReadResults || canReadExams) && feed?.testsCreated) {
      for (const item of feed.testsCreated) {
        if (!feedInitialized.current) {
          seenTests.current.add(item.id);
          continue;
        }
        if (seenTests.current.has(item.id)) continue;
        seenTests.current.add(item.id);
        add({
          type: 'exam',
          title: 'Class test created',
          message: `${item.title} (${item.code}) · ${item.status}`,
          timestamp: item.createdAt,
        });
      }
    }

    if (canViewViolations) {
      for (const v of data?.recentViolations || []) {
        const id = String(v.id);
        const dedupeKey = violationDedupeKey(v.sessionId, v.eventType, v.occurredAt);
        if (!feedInitialized.current) {
          seenViolations.current.add(id);
          if (dedupeKey) violationSocketKeys.current.add(dedupeKey);
          continue;
        }
        if (seenViolations.current.has(id)) continue;
        if (dedupeKey && violationSocketKeys.current.has(dedupeKey)) {
          seenViolations.current.add(id);
          continue;
        }
        seenViolations.current.add(id);
        if (dedupeKey) violationSocketKeys.current.add(dedupeKey);
        add({
          type: 'violation',
          title: `Integrity alert: ${v.label}`,
          message: `${v.candidateName} · ${v.examTitle} · ${v.severity}`,
          timestamp: v.occurredAt,
        });
      }
    }

    if (data) feedInitialized.current = true;
  }, [data, add, markClassWithNewStudent, queryClient, canManageStudents, canReadResults, canReadExams, canViewViolations]);
}
