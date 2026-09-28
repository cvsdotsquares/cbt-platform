import { PrismaService } from '../../prisma/prisma.service';

const TENANT_CACHE_TTL_MS = 5 * 60 * 1000;

type CachedTenant = { id: string; slug: string };

const cache = new Map<string, { tenant: CachedTenant; expiresAt: number }>();

function cacheKey(slugOrId: string): string {
  return slugOrId.toLowerCase();
}

function getFromCache(key: string): CachedTenant | null {
  const entry = cache.get(key);
  if (!entry || entry.expiresAt <= Date.now()) {
    cache.delete(key);
    return null;
  }
  return entry.tenant;
}

function setCache(slugOrId: string, tenant: CachedTenant): void {
  const key = cacheKey(slugOrId);
  const entry = { tenant, expiresAt: Date.now() + TENANT_CACHE_TTL_MS };
  cache.set(key, entry);
  cache.set(cacheKey(tenant.id), entry);
  cache.set(cacheKey(tenant.slug), entry);
}

export async function resolveTenantCached(
  prisma: PrismaService,
  tenantId?: string,
): Promise<CachedTenant | null> {
  const lookup = tenantId || 'default';
  const cached = getFromCache(lookup);
  if (cached) return cached;

  const tenant = tenantId
    ? await prisma.tenant.findFirst({
        where: { OR: [{ id: tenantId }, { slug: tenantId }] },
        select: { id: true, slug: true },
      })
    : await prisma.tenant.findFirst({
        where: { slug: 'default' },
        select: { id: true, slug: true },
      });

  if (tenant) setCache(tenant.slug, tenant);
  return tenant;
}

export async function resolveTenantByHeaderCached(
  prisma: PrismaService,
  tenantHeader: string,
): Promise<CachedTenant | null> {
  const cached = getFromCache(tenantHeader);
  if (cached) return cached;

  const tenant = await prisma.tenant.findFirst({
    where: { OR: [{ slug: tenantHeader }, { id: tenantHeader }] },
    select: { id: true, slug: true },
  });
  if (tenant) setCache(tenant.slug, tenant);
  return tenant;
}
