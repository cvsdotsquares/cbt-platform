/** Allow only same-app relative paths after login (blocks open redirects). */
export function getSafeRedirectPath(value: string | null | undefined): string | null {
  if (!value || typeof value !== 'string') return null;
  const path = value.trim();
  if (!path.startsWith('/') || path.startsWith('//')) return null;
  if (path.startsWith('/login') || path.startsWith('/register')) return null;
  return path;
}
