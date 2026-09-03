import { NextRequest, NextResponse } from 'next/server';
import { ACCESS_TOKEN_COOKIE, verifyAccessToken } from '@/lib/auth-cookies';
import { isAdmin, isTeacherOnly, normalizeRoles } from '@/lib/roles';

const PUBLIC_PATHS = ['/login', '/register', '/mfa', '/verify'];

function isPublicPath(pathname: string) {
  return PUBLIC_PATHS.some((p) => pathname === p || pathname.startsWith(`${p}/`));
}

function registrationAllowed(): boolean {
  return (
    process.env.ALLOW_PUBLIC_REGISTRATION === 'true'
    || process.env.NODE_ENV !== 'production'
  );
}

function staffHome(roles: string[]) {
  return isTeacherOnly(roles) ? '/dashboard/teacher' : '/dashboard';
}

const STATIC_FILE = /\.(?:svg|png|jpg|jpeg|gif|webp|ico|woff2?)$/i;

export async function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl;

  if (pathname.startsWith('/api/') || STATIC_FILE.test(pathname)) {
    return NextResponse.next();
  }

  if (pathname === '/register' && !registrationAllowed()) {
    return NextResponse.redirect(new URL('/login', request.url));
  }

  const accessToken = request.cookies.get(ACCESS_TOKEN_COOKIE)?.value;
  let isAuthenticated = false;
  let isAdminUser = false;
  let roles: string[] = [];

  if (accessToken) {
    const payload = await verifyAccessToken(accessToken);
    if (payload?.sub) {
      isAuthenticated = true;
      roles = normalizeRoles(payload.roles);
      isAdminUser = isAdmin(roles);
    }
  }

  if (pathname === '/') {
    if (isAuthenticated) {
      return NextResponse.redirect(new URL(isAdminUser ? staffHome(roles) : '/my-exams', request.url));
    }
    return NextResponse.redirect(new URL('/login', request.url));
  }

  if (isPublicPath(pathname)) {
    return NextResponse.next();
  }

  if (!isAuthenticated) {
    const loginUrl = new URL('/login', request.url);
    loginUrl.searchParams.set('redirect', pathname);
    return NextResponse.redirect(loginUrl);
  }

  if (pathname.startsWith('/dashboard') && !isAdminUser) {
    return NextResponse.redirect(new URL('/my-exams', request.url));
  }

  if ((pathname === '/my-exams' || pathname.startsWith('/exam/')) && isAdminUser) {
    return NextResponse.redirect(new URL(staffHome(roles), request.url));
  }

  if (pathname === '/help' || pathname.startsWith('/help/')) {
    if (isAdminUser) {
      return NextResponse.redirect(new URL('/dashboard/guide', request.url));
    }
  }

  if (pathname === '/dashboard/guide' && !isAdminUser) {
    return NextResponse.redirect(new URL('/help', request.url));
  }

  return NextResponse.next();
}

export const config = {
  matcher: ['/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp|ico)$).*)'],
};
