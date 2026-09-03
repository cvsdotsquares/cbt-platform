'use client';

import { useEffect } from 'react';
import { useAuthStore, syncSessionFromStore } from '@/stores/auth-store';

export function AuthHydrationGate({ children }: { children: React.ReactNode }) {
  const setHasHydrated = useAuthStore((s) => s.setHasHydrated);

  useEffect(() => {
    let cancelled = false;

    const markHydrated = async () => {
      try {
        await syncSessionFromStore();
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

  return <>{children}</>;
}
