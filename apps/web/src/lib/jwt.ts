/** Decode JWT payload without verification (used only to read roles from our own API token). */
export function decodeJwtPayload<T = Record<string, unknown>>(token: string): T | null {
  try {
    const segment = token.split('.')[1];
    if (!segment) return null;
    const base64 = segment.replace(/-/g, '+').replace(/_/g, '/');
    const json =
      typeof window !== 'undefined'
        ? atob(base64.padEnd(base64.length + ((4 - (base64.length % 4)) % 4), '='))
        : Buffer.from(base64, 'base64').toString('utf8');
    return JSON.parse(json) as T;
  } catch {
    return null;
  }
}
