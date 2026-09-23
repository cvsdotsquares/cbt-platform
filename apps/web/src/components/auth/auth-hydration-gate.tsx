'use client';

import { useEffect } from 'react';
import { useAuthStore, syncSessionFromStore } from '@/stores/auth-store';
import { refreshAccessToken } from '@/lib/api';
import { isAccessTokenExpiringSoon } from '@/lib/jwt';
import { useSessionKeepAlive } from '@/hooks/use-session-keep-alive';

export function AuthHydrationGate({ children }: { children: React.ReactNode }) {
  const setHasHydrated = useAuthStore((s) => s.setHasHydrated);
  const hasHydrated = useAuthStore((s) => s._hasHydrated);

  useEffect(() => {
    let cancelled = false;

    const markHydrated = async () => {
      try {
        await syncSessionFromStore();
        const { isAuthenticated, refreshToken, accessToken } = useAuthStore.getState();
        if (isAuthenticated && refreshToken && isAccessTokenExpiringSoon(accessToken)) {
          await refreshAccessToken();
        }
      } catch {
        /* cookies sync is best-effort on hydrate */
      }
      if (!cancelled) setHasHydrated(true);
    };

    void markHydrated();
    return () => {
      cancelled = true;
    };
  }, [setHasHydrated]);

  useSessionKeepAlive(hasHydrated);

  return <>{children}</>;
}
