export function getAllowedOrigins(): Set<string> {
  const origins = new Set([
    process.env.APP_URL || 'http://localhost:3002',
    'http://localhost:3002',
    'http://localhost:3000',
  ]);

  for (const origin of process.env.CORS_ORIGINS?.split(',') ?? []) {
    const trimmed = origin.trim();
    if (trimmed) origins.add(trimmed);
  }

  return origins;
}

export function isOriginAllowed(origin: string | undefined): boolean {
  if (!origin) return true;

  const allowed = getAllowedOrigins();
  if (allowed.has(origin)) return true;

  // Vercel production / preview deployments
  if (/^https:\/\/[\w-]+\.vercel\.app$/.test(origin)) return true;

  // Local dev over LAN: http://192.168.*.*:3002 or http://10.*.*.*:3002
  return /^http:\/\/(192\.168|10)\.\d{1,3}\.\d{1,3}:(3000|3002)$/.test(origin);
}

export function getPrimaryCorsOrigin(): string {
  return process.env.APP_URL || 'http://localhost:3002';
}
