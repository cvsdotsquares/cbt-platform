import { getSafeRedirectPath } from './safe-redirect';
import { getPostLoginPath } from './dashboard-nav';
import type { AuthUser } from '@cbt/shared';

export async function syncAuthSession(
  accessToken: string,
  refreshToken: string,
  rememberMe = false,
): Promise<boolean> {
  const res = await fetch('/api/auth/session', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ accessToken, refreshToken, rememberMe }),
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

export async function hydrateAuthSession(accessToken?: string | null): Promise<{
  user: AuthUser;
  accessToken: string;
  refreshToken?: string;
  isAdmin: boolean;
} | null> {
  const res = await fetch('/api/auth/session', {
    method: 'GET',
    headers: accessToken ? { Authorization: `Bearer ${accessToken}` } : undefined,
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

/** Clears HttpOnly auth cookies. Pass this tab's access token so other tabs' cookies are not wiped. */
export async function clearAuthSession(accessToken?: string | null): Promise<void> {
  const headers: Record<string, string> = {};
  if (accessToken) headers.Authorization = `Bearer ${accessToken}`;
  await fetch('/api/auth/session', {
    method: 'DELETE',
    headers: Object.keys(headers).length ? headers : undefined,
    credentials: 'include',
  }).catch(() => {});
}

export function redirectAfterLogin(roles: unknown, redirectTo?: string | null) {
  const safe = getSafeRedirectPath(redirectTo ?? null);
  const target = safe ?? getPostLoginPath(roles);
  window.location.assign(target);
}
