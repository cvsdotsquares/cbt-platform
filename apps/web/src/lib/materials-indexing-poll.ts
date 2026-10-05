export const MATERIALS_INDEXING_STATUSES = new Set(['PENDING', 'INDEXING']);

export const MATERIALS_INDEX_POLL_MS = 3000;

export function materialsNeedLivePoll(
  materials: { status?: string | null }[] | null | undefined,
): boolean {
  if (!materials?.length) return false;
  return materials.some((m) => MATERIALS_INDEXING_STATUSES.has(m.status ?? ''));
}
