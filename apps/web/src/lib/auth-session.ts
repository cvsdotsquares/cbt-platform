import { getSafeRedirectPath } from './safe-redirect';
import type { AuthUser } from '@cbt/shared';

export async function syncAuthSession(
  accessToken: string,
  refreshToken: string,
): Promise<boolean> {
  const res = await fetch('/api/auth/session', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ accessToken, refreshToken }),
    credentials: 'include',
  });
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    const message =
      typeof body.error === 'string'
        ? body.error
        : 'Failed to sync session';
    throw new Error(message);
  }
  const data = await res.json();
  return Boolean(data.isAdmin);
}

export async function hydrateAuthSession(): Promise<{
  user: AuthUser;
  accessToken: string;
  refreshToken?: string;
  isAdmin: boolean;
} | null> {
  const res = await fetch('/api/auth/session', {
    method: 'GET',
    credentials: 'include',
  });
  if (!res.ok) return null;
  const data = await res.json();
  if (!data.authenticated || !data.user) return null;
  return {
    user: data.user as AuthUser,
    accessToken: data.accessToken as string,
    isAdmin: Boolean(data.isAdmin),
  };
}

export async function clearAuthSession(): Promise<void> {
  await fetch('/api/auth/session', { method: 'DELETE', credentials: 'include' });
}

export function redirectAfterLogin(
  isAdminUser: boolean,
  redirectTo?: string | null,
) {
  const safe = getSafeRedirectPath(redirectTo ?? null);
  const target = safe ?? (isAdminUser ? '/dashboard' : '/my-exams');
  window.location.assign(target);
}
