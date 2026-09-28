'use client';

import { useEffect } from 'react';
import { refreshAccessToken } from '@/lib/api';
import { isAccessTokenExpiringSoon, msUntilAccessTokenRefresh } from '@/lib/jwt';
import { useAuthStore } from '@/stores/auth-store';

export function useSessionKeepAlive(enabled: boolean) {
  const isAuthenticated = useAuthStore((s) => s.isAuthenticated);
  const accessToken = useAuthStore((s) => s.accessToken);

  useEffect(() => {
    if (!enabled || !isAuthenticated) return;

    let timer: number | undefined;
    let cancelled = false;

    const schedule = () => {
      if (cancelled) return;
      const token = useAuthStore.getState().accessToken;
      const delay = msUntilAccessTokenRefresh(token);
      timer = window.setTimeout(async () => {
        if (cancelled) return;
        const { isAuthenticated: stillIn, refreshToken } = useAuthStore.getState();
        if (!stillIn || !refreshToken) return;
        await refreshAccessToken();
        if (!cancelled) schedule();
      }, delay);
    };

    const refreshIfDue = () => {
      if (document.visibilityState === 'hidden') return;
      const { isAuthenticated: stillIn, refreshToken, accessToken: token } = useAuthStore.getState();
      if (!stillIn || !refreshToken) return;
      if (!isAccessTokenExpiringSoon(token)) return;
      void refreshAccessToken().then(() => {
        if (timer != null) window.clearTimeout(timer);
        schedule();
      });
    };

    schedule();
    document.addEventListener('visibilitychange', refreshIfDue);
    window.addEventListener('focus', refreshIfDue);

    return () => {
      cancelled = true;
      if (timer != null) window.clearTimeout(timer);
      document.removeEventListener('visibilitychange', refreshIfDue);
      window.removeEventListener('focus', refreshIfDue);
    };
  }, [enabled, isAuthenticated, accessToken]);
}
