import { NextRequest, NextResponse } from 'next/server';

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

function registrationPageAllowed(request: NextRequest): boolean {
  if (registrationAllowed()) return true;
  const invite = request.nextUrl.searchParams.get('invite');
  return Boolean(invite?.trim());
}

const STATIC_FILE = /\.(?:svg|png|jpg|jpeg|gif|webp|ico|woff2?)$/i;

export async function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl;

  if (pathname.startsWith('/api/') || STATIC_FILE.test(pathname)) {
    return NextResponse.next();
  }

  if (pathname === '/register' && !registrationPageAllowed(request)) {
    return NextResponse.redirect(new URL('/login', request.url));
  }

  if (pathname === '/') {
    return NextResponse.redirect(new URL('/login', request.url));
  }

  if (isPublicPath(pathname)) {
    return NextResponse.next();
  }

  // Browser auth is tab-scoped in sessionStorage, which middleware cannot read.
  // Client layouts and auth hooks enforce authentication and role access.
  return NextResponse.next();
}

export const config = {
  matcher: ['/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp|ico)$).*)'],
};
