import { NextResponse } from 'next/server';
import { cookies } from 'next/headers';
import { ACCESS_TOKEN_COOKIE, verifyAccessToken } from '@/lib/auth-cookies';

export async function GET(request: Request) {
  const headerToken = request.headers.get('authorization')?.replace(/^Bearer\s+/i, '');
  const cookieToken = (await cookies()).get(ACCESS_TOKEN_COOKIE)?.value;
  const accessToken = headerToken || cookieToken;

  if (!accessToken) {
    return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });
  }

  const payload = await verifyAccessToken(accessToken);
  if (!payload?.sub) {
    return NextResponse.json({ error: 'Invalid token' }, { status: 401 });
  }

  return NextResponse.json({
    token: accessToken,
    tenantId: payload.tenantId || process.env.NEXT_PUBLIC_TENANT_ID || 'default',
  });
}
