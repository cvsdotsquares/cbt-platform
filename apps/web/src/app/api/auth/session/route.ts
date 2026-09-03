import { NextResponse } from 'next/server';
import { cookies } from 'next/headers';
import { isAdmin, normalizeRoles } from '@/lib/roles';
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

function setAuthCookies(
  res: NextResponse,
  accessToken: string,
  refreshToken: string,
  admin: boolean,
) {
  res.cookies.set(ACCESS_TOKEN_COOKIE, accessToken, accessCookieOptions());
  res.cookies.set(REFRESH_TOKEN_COOKIE, refreshToken, refreshCookieOptions());
  res.cookies.set(AUTH_FLAG_COOKIE, '1', refreshCookieOptions());
  res.cookies.set(ADMIN_FLAG_COOKIE, admin ? '1' : '0', refreshCookieOptions());
}

function clearAuthCookies(res: NextResponse) {
  const clear = clearCookieOptions();
  res.cookies.set(ACCESS_TOKEN_COOKIE, '', clear);
  res.cookies.set(REFRESH_TOKEN_COOKIE, '', clear);
  res.cookies.set(AUTH_FLAG_COOKIE, '', clear);
  res.cookies.set(ADMIN_FLAG_COOKIE, '', clear);
}

export async function GET() {
  const cookieStore = await cookies();
  const accessToken = cookieStore.get(ACCESS_TOKEN_COOKIE)?.value;

  if (!accessToken) {
    return NextResponse.json({ authenticated: false }, { status: 401 });
  }

  const payload = await verifyAccessToken(accessToken);
  if (!payload?.sub) {
    return NextResponse.json({ authenticated: false }, { status: 401 });
  }

  const roles = normalizeRoles(payload.roles);
  return NextResponse.json({
    authenticated: true,
    isAdmin: isAdmin(roles),
    user: {
      id: payload.sub,
      email: payload.email as string,
      tenantId: payload.tenantId as string,
      roles,
      firstName: (payload.firstName as string) || '',
      lastName: (payload.lastName as string) || '',
      mfaEnabled: false,
    },
    accessToken,
  });
}

export async function POST(request: Request) {
  const body = await request.json().catch(() => ({}));
  const accessToken = typeof body.accessToken === 'string' ? body.accessToken : '';
  const refreshToken = typeof body.refreshToken === 'string' ? body.refreshToken : '';

  if (!accessToken || !refreshToken) {
    return NextResponse.json({ error: 'Missing tokens' }, { status: 400 });
  }

  const payload = await verifyAccessToken(accessToken);
  if (!payload?.sub) {
    const secretConfigured = Boolean(process.env.JWT_ACCESS_SECRET && process.env.JWT_ACCESS_SECRET.length >= 32);
    return NextResponse.json(
      {
        error: secretConfigured ? 'Invalid access token' : 'JWT_ACCESS_SECRET is not configured on the web server',
      },
      { status: 401 },
    );
  }

  const roles = normalizeRoles(payload.roles);
  const admin = isAdmin(roles);

  const res = NextResponse.json({ ok: true, isAdmin: admin });
  setAuthCookies(res, accessToken, refreshToken, admin);
  return res;
}

export async function DELETE() {
  const res = NextResponse.json({ ok: true });
  clearAuthCookies(res);
  return res;
}
