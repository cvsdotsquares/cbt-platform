/** Upstream FastAPI origin for Next.js route handlers (server-side proxy). */
export function resolveApiProxyBase(): string {
  if (process.env.API_PROXY_URL?.trim()) {
    return process.env.API_PROXY_URL.trim().replace(/\/$/, '');
  }
  const publicUrl = process.env.NEXT_PUBLIC_API_URL?.trim();
  if (publicUrl) {
    return publicUrl.replace(/\/api\/v1\/?$/i, '').replace(/\/$/, '');
  }
  if (process.env.NODE_ENV === 'production') {
    return 'https://cbt-api-ktkr.onrender.com';
  }
  return 'http://localhost:8000';
}

export function isLocalApiProxyBase(base: string): boolean {
  try {
    const { hostname } = new URL(base);
    return hostname === 'localhost' || hostname === '127.0.0.1';
  } catch {
    return false;
  }
}
