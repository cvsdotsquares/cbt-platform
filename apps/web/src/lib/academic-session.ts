/** Indian-style academic session label, e.g. 2025-26 (April–March). */
export function defaultAcademicSession(reference = new Date()): string {
  const year = reference.getFullYear();
  const month = reference.getMonth();
  const startYear = month >= 3 ? year : year - 1;
  const endShort = (startYear + 1) % 100;
  return `${startYear}-${String(endShort).padStart(2, '0')}`;
}

function sessionFromStartYear(startYear: number): string {
  const endShort = (startYear + 1) % 100;
  return `${startYear}-${String(endShort).padStart(2, '0')}`;
}

/** Preset sessions around the current year plus any values already used in the app. */
export function academicSessionOptions(extra: string[] = []): string[] {
  const current = defaultAcademicSession();
  const startYear = parseInt(current.split('-')[0]!, 10);
  const set = new Set<string>();
  for (let y = startYear - 3; y <= startYear + 4; y += 1) {
    set.add(sessionFromStartYear(y));
  }
  for (const raw of extra) {
    const v = raw.trim();
    if (v) set.add(v);
  }
  return [...set].sort((a, b) => {
    const ay = parseInt(a.split('-')[0]!, 10);
    const by = parseInt(b.split('-')[0]!, 10);
    return by - ay;
  });
}

export function normalizeAcademicSession(value: string | null | undefined): string {
  return (value ?? '').trim();
}

export function sessionsMatch(a: string | null | undefined, b: string | null | undefined): boolean {
  const left = normalizeAcademicSession(a);
  const right = normalizeAcademicSession(b);
  if (!left || !right) return true;
  return left === right;
}
