import { jwtVerify, type JWTPayload } from 'jose';

export const ACCESS_TOKEN_COOKIE = 'cbt-access-token';
export const REFRESH_TOKEN_COOKIE = 'cbt-refresh-token';
export const AUTH_FLAG_COOKIE = 'cbt-auth';
export const ADMIN_FLAG_COOKIE = 'cbt-is-admin';

const ACCESS_MAX_AGE = 15 * 60; // 15 minutes
const REFRESH_MAX_AGE = 7 * 24 * 60 * 60; // 7 days

export function isProduction(): boolean {
  return process.env.NODE_ENV === 'production';
}

export function getJwtSecret(): Uint8Array | null {
  const secret = process.env.JWT_ACCESS_SECRET;
  if (!secret || secret.length < 32) return null;
  return new TextEncoder().encode(secret);
}

export function baseCookieOptions(maxAge: number) {
  return {
    path: '/',
    maxAge,
    sameSite: 'lax' as const,
    httpOnly: true,
    secure: isProduction(),
  };
}

export function accessCookieOptions() {
  return baseCookieOptions(ACCESS_MAX_AGE);
}

export function refreshCookieOptions() {
  return baseCookieOptions(REFRESH_MAX_AGE);
}

export function clearCookieOptions() {
  return { path: '/', maxAge: 0, httpOnly: true, secure: isProduction(), sameSite: 'lax' as const };
}

export type AccessTokenPayload = JWTPayload & {
  sub?: string;
  roles?: string[];
  tenantId?: string;
  email?: string;
  sessionId?: string;
};

export async function verifyAccessToken(token: string): Promise<AccessTokenPayload | null> {
  const secret = getJwtSecret();
  if (!secret) return null;
  try {
    const { payload } = await jwtVerify(token, secret);
    if (!payload.sub) return null;
    return payload as AccessTokenPayload;
  } catch {
    return null;
  }
}
