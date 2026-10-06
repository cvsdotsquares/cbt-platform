import { NextResponse } from 'next/server';
import { cookies } from 'next/headers';
import {
  ACCESS_TOKEN_COOKIE,
  REFRESH_TOKEN_COOKIE,
  AUTH_FLAG_COOKIE,
  ADMIN_FLAG_COOKIE,
  accessCookieOptions,
  refreshCookieOptions,
  clearCookieOptions,
  verifyAccessToken,
} from '@/lib/auth-cookies';
import { isAdmin, normalizeRoles } from '@/lib/roles';
import { resolveApiProxyBase } from '@/lib/api-proxy-base';
import { tenantIdForRequestHeader } from '@/lib/tenant-header';

export async function POST() {
  const cookieStore = await cookies();
  const refreshToken = cookieStore.get(REFRESH_TOKEN_COOKIE)?.value;

  if (!refreshToken) {
    return NextResponse.json({ error: 'No refresh token' }, { status: 401 });
  }

  const apiBase = resolveApiProxyBase();
  const tenantHeader = tenantIdForRequestHeader(process.env.NEXT_PUBLIC_TENANT_ID);
  const refreshHeaders: Record<string, string> = { 'Content-Type': 'application/json' };
  if (tenantHeader) refreshHeaders['X-Tenant-ID'] = tenantHeader;

  let upstream: Response;
  try {
    upstream = await fetch(`${apiBase}/api/v1/auth/refresh`, {
      method: 'POST',
      headers: refreshHeaders,
      body: JSON.stringify({ refreshToken }),
    });
  } catch {
    return NextResponse.json({ error: 'API unavailable' }, { status: 502 });
  }

  const data = await upstream.json().catch(() => ({}));
  if (!upstream.ok) {
    const res = NextResponse.json({ error: 'Refresh failed' }, { status: 401 });
    const clear = clearCookieOptions();
    res.cookies.set(ACCESS_TOKEN_COOKIE, '', clear);
    res.cookies.set(REFRESH_TOKEN_COOKIE, '', clear);
    res.cookies.set(AUTH_FLAG_COOKIE, '', clear);
    res.cookies.set(ADMIN_FLAG_COOKIE, '', clear);
    return res;
  }

  const payload = data.data ?? data;
  const accessToken = (payload.accessToken ?? payload.access_token) as string;
  const newRefreshToken = (payload.refreshToken ?? payload.refresh_token ?? refreshToken) as string;

  if (!accessToken || !newRefreshToken) {
    return NextResponse.json({ error: 'Invalid refresh response' }, { status: 502 });
  }

  const verified = await verifyAccessToken(accessToken);
  if (!verified?.sub) {
    return NextResponse.json({ error: 'Invalid access token' }, { status: 502 });
  }

  const roles = normalizeRoles(verified.roles);
  const admin = isAdmin(roles);

  const res = NextResponse.json({
    accessToken,
    refreshToken: newRefreshToken,
    user: payload.user,
    isAdmin: admin,
  });

  res.cookies.set(ACCESS_TOKEN_COOKIE, accessToken, accessCookieOptions());
  res.cookies.set(REFRESH_TOKEN_COOKIE, newRefreshToken, refreshCookieOptions());
  res.cookies.set(AUTH_FLAG_COOKIE, '1', refreshCookieOptions());
  res.cookies.set(ADMIN_FLAG_COOKIE, admin ? '1' : '0', refreshCookieOptions());

  return res;
}
