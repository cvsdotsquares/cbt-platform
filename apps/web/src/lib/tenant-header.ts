const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

/** FastAPI rejects non-UUID X-Tenant-ID (e.g. literal "default"). Omit unless valid. */
export function tenantIdForRequestHeader(raw: string | undefined | null): string | undefined {
  const id = (raw ?? '').trim();
  if (!id || id === 'default') return undefined;
  return UUID_RE.test(id) ? id : undefined;
}
