'use client';

import { useAuthStore } from '@/stores/auth-store';
import { isAdmin, normalizeRoles } from '@/lib/roles';
import { useRouter } from 'next/navigation';
import { useEffect } from 'react';

export function useRequireAuth(adminOnly = false) {
  const { isAuthenticated, user, accessToken, _hasHydrated } = useAuthStore();
  const router = useRouter();
  const roles = normalizeRoles(user?.roles);

  useEffect(() => {
    if (!_hasHydrated) return;

    if (!isAuthenticated || !accessToken) {
      router.replace('/login');
      return;
    }

    if (adminOnly && user && !isAdmin(roles)) {
      router.replace('/my-exams');
    }
  }, [_hasHydrated, isAuthenticated, accessToken, adminOnly, user, roles, router]);

  return { user, accessToken, isAuthenticated, ready: _hasHydrated };
}

export function useRequireCandidate() {
  const { isAuthenticated, user, accessToken, _hasHydrated } = useAuthStore();
  const router = useRouter();
  const roles = normalizeRoles(user?.roles);

  useEffect(() => {
    if (!_hasHydrated) return;

    if (!isAuthenticated || !accessToken) {
      router.replace('/login');
      return;
    }

    if (user && isAdmin(roles)) {
      router.replace('/dashboard');
    }
  }, [_hasHydrated, isAuthenticated, accessToken, user, roles, router]);

  return { user, accessToken, isAuthenticated, ready: _hasHydrated };
}
