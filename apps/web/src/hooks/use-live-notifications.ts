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
import { isTeacherOnly, normalizeRoles } from '@/lib/roles';

const KYC_SEEN_KEY = 'cbt-seen-kyc-submissions';

function loadSeenKyc() {
  if (typeof window === 'undefined') return new Set<string>();
  try {
    const raw = window.sessionStorage.getItem(KYC_SEEN_KEY);
    const parsed = raw ? JSON.parse(raw) : [];
    return new Set<string>(Array.isArray(parsed) ? parsed.filter((item) => typeof item === 'string') : []);
  } catch {
    return new Set<string>();
  }
}

function saveSeenKyc(seen: Set<string>) {
  if (typeof window === 'undefined') return;
  window.sessionStorage.setItem(KYC_SEEN_KEY, JSON.stringify([...seen].slice(-100)));
}

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
    kycPending?: {
      id: string;
      candidateName: string;
      email: string;
      submittedAt: string;
      status?: string;
    }[];
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
    teacherAssignments?: {
      id: string;
      subjectName?: string;
      batchName?: string;
      className?: string;
      classLevel?: number | null;
      assignedAt: string;
    }[];
  };
};

export function useLiveNotifications() {
  const accessToken = useAuthStore((s) => s.accessToken);
  const user = useAuthStore((s) => s.user);
  const teacherPortal = isTeacherOnly(normalizeRoles(user?.roles));
  const queryClient = useQueryClient();
  const add = useNotificationStore((s) => s.add);
  const ensureHistory = useNotificationStore((s) => s.ensureHistory);
  const markClassWithNewStudent = useNotificationStore((s) => s.markClassWithNewStudent);
  const pruneByTypes = useNotificationStore((s) => s.pruneByTypes);
  const { can } = usePermissions();
  const seenSubmissions = useRef(new Set<string>());
  const seenKyc = useRef(new Set<string>());
  const seenStudents = useRef(new Set<string>());
  const seenTests = useRef(new Set<string>());
  const seenAssignments = useRef(new Set<string>());
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
    canReadResults
    || canManageStudents
    || canReadExams
    || canViewViolations
    || (teacherPortal && can(Permission.LEARNING_MANAGE));

  useEffect(() => {
    feedInitialized.current = false;
    seenSubmissions.current.clear();
    seenKyc.current.clear();
    seenStudents.current.clear();
    seenTests.current.clear();
    seenAssignments.current.clear();
    seenViolations.current.clear();
    violationSocketKeys.current.clear();
  }, [user?.id]);

  useEffect(() => {
    if (teacherPortal) pruneByTypes(['exam']);
  }, [teacherPortal, user?.id, pruneByTypes]);

  useEffect(() => {
    if (!accessToken || !canMonitor || teacherPortal) return;

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
  }, [accessToken, canMonitor, teacherPortal, add]);

  const { data } = useQuery({
    queryKey: ['dashboard', user?.id],
    queryFn: () => dashboardApi.stats(accessToken!) as Promise<DashboardStats>,
    enabled: !!accessToken && !!user?.id && canUseFeed,
    staleTime: 60_000,
    refetchInterval: 30_000,
    refetchIntervalInBackground: false,
  });

  useEffect(() => {
    if (canReadResults) {
      for (const sub of data?.recentSubmissions || []) {
        const payload = {
          type: 'submission' as const,
          title: `${sub.candidateName} attempted a test`,
          message: sub.examTitle,
          timestamp: sub.submittedAt,
        };
        if (!feedInitialized.current) {
          seenSubmissions.current.add(sub.id);
          ensureHistory(payload);
          continue;
        }
        if (seenSubmissions.current.has(sub.id)) {
          ensureHistory(payload);
          continue;
        }
        seenSubmissions.current.add(sub.id);
        add(payload);
      }
    }

    const feed = data?.notificationFeed;
    if (canManageStudents && feed?.kycPending) {
      const seen = seenKyc.current.size ? seenKyc.current : loadSeenKyc();
      if (!seenKyc.current.size) seenKyc.current = seen;
      let added = false;
      for (const item of feed.kycPending) {
        const key = `${item.id}:${item.submittedAt}`;
        const payload = {
          type: 'kyc' as const,
          title: item.status === 'VERIFIED' ? 'KYC verified' : 'KYC pending review',
          message: `${item.candidateName} (${item.email})`,
          timestamp: item.submittedAt,
          href: `/dashboard/candidates?kycReview=${encodeURIComponent(item.id)}`,
        };
        if (!feedInitialized.current) {
          seen.add(key);
          ensureHistory(payload);
          continue;
        }
        if (seen.has(key)) {
          ensureHistory(payload);
          continue;
        }
        seen.add(key);
        added = true;
        add(payload);
        markClassWithNewStudent(UNASSIGNED_CLASS_HIGHLIGHT);
        void queryClient.invalidateQueries({ queryKey: ['candidates'] });
        void queryClient.invalidateQueries({ queryKey: ['candidates-stats'] });
      }
      if (added) saveSeenKyc(seen);
    }

    if (canManageStudents && feed?.newStudents) {
      for (const item of feed.newStudents) {
        const payload = {
          type: 'registration' as const,
          title: 'New student registered',
          message: formatRegistrationNotificationMessage(item),
          timestamp: item.registeredAt,
          href: `/dashboard/candidates?q=${encodeURIComponent(item.email)}`,
        };
        if (!feedInitialized.current) {
          seenStudents.current.add(item.id);
          ensureHistory(payload);
          continue;
        }
        if (seenStudents.current.has(item.id)) {
          ensureHistory(payload);
          continue;
        }
        seenStudents.current.add(item.id);
        add(payload);
        markClassWithNewStudent(item.academicClassId ?? UNASSIGNED_CLASS_HIGHLIGHT);
        void queryClient.invalidateQueries({ queryKey: ['candidates'] });
        void queryClient.invalidateQueries({ queryKey: ['candidates-stats'] });
      }
    }

    if (teacherPortal && feed?.teacherAssignments) {
      for (const item of feed.teacherAssignments) {
        const classLabel = item.className
          ?? (item.classLevel != null ? `Class ${item.classLevel}` : 'Class');
        const payload = {
          type: 'assignment' as const,
          title: 'New class assignment',
          message: `${item.subjectName ?? 'Subject'} · ${classLabel}${item.batchName ? ` · ${item.batchName}` : ''}`,
          timestamp: item.assignedAt,
          href: '/dashboard/batches',
        };
        if (!feedInitialized.current) {
          seenAssignments.current.add(item.id);
          ensureHistory(payload);
          continue;
        }
        if (seenAssignments.current.has(item.id)) {
          ensureHistory(payload);
          continue;
        }
        seenAssignments.current.add(item.id);
        add(payload);
        void queryClient.invalidateQueries({ queryKey: ['batches'] });
      }
    }

    if (!teacherPortal && (canReadResults || canReadExams) && feed?.testsCreated) {
      for (const item of feed.testsCreated) {
        const payload = {
          type: 'exam' as const,
          title: 'Class test created',
          message: `${item.title} (${item.code}) · ${item.status}`,
          timestamp: item.createdAt,
        };
        if (!feedInitialized.current) {
          seenTests.current.add(item.id);
          ensureHistory(payload);
          continue;
        }
        if (seenTests.current.has(item.id)) {
          ensureHistory(payload);
          continue;
        }
        seenTests.current.add(item.id);
        add(payload);
      }
    }

    if (canViewViolations) {
      for (const v of data?.recentViolations || []) {
        const id = String(v.id);
        const dedupeKey = violationDedupeKey(v.sessionId, v.eventType, v.occurredAt);
        const payload = {
          type: 'violation' as const,
          title: `Integrity alert: ${v.label}`,
          message: `${v.candidateName} · ${v.examTitle} · ${v.severity}`,
          timestamp: v.occurredAt,
        };
        if (!feedInitialized.current) {
          seenViolations.current.add(id);
          if (dedupeKey) violationSocketKeys.current.add(dedupeKey);
          ensureHistory(payload);
          continue;
        }
        if (seenViolations.current.has(id)) {
          ensureHistory(payload);
          continue;
        }
        if (dedupeKey && violationSocketKeys.current.has(dedupeKey)) {
          seenViolations.current.add(id);
          ensureHistory(payload);
          continue;
        }
        seenViolations.current.add(id);
        if (dedupeKey) violationSocketKeys.current.add(dedupeKey);
        add(payload);
      }
    }

    if (data) feedInitialized.current = true;
  }, [
    data,
    add,
    ensureHistory,
    markClassWithNewStudent,
    queryClient,
    canManageStudents,
    canReadResults,
    canReadExams,
    canViewViolations,
    teacherPortal,
    user?.id,
    can,
  ]);
}
