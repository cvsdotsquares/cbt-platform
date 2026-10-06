/** Institute Admin role is disabled in the product — users keep staff access but use the teacher portal. */
export const INSTITUTE_ADMIN_ENABLED = false;

const STAFF_ROLES = [
  'SUPER_ADMIN', 'ORG_ADMIN', 'INSTITUTE_ADMIN', 'TEACHER',
  'EXAM_MANAGER', 'QUESTION_MODERATOR', 'PROCTOR', 'EVALUATOR', 'AUDITOR',
];

const ELEVATED_STAFF_ROLES = [
  'SUPER_ADMIN', 'ORG_ADMIN', 'EXAM_MANAGER',
  ...(INSTITUTE_ADMIN_ENABLED ? (['INSTITUTE_ADMIN'] as const) : []),
];

export function normalizeRoles(roles: unknown): string[] {
  if (!Array.isArray(roles)) return [];
  return roles
    .map((role) => (typeof role === 'string' ? role : (role as { name?: string })?.name))
    .filter((role): role is string => typeof role === 'string' && role.length > 0);
}

/** Staff portal access — must have an explicit staff role. */
export function isAdmin(roles: unknown) {
  const normalized = normalizeRoles(roles);
  return normalized.some((role) => STAFF_ROLES.includes(role));
}

/** Pure teacher portal — TEACHER (or disabled Institute Admin) without elevated admin roles. */
export function isTeacherOnly(roles: unknown) {
  const normalized = normalizeRoles(roles);
  if (normalized.some((role) => ELEVATED_STAFF_ROLES.includes(role))) return false;
  if (normalized.includes('TEACHER')) return true;
  if (!INSTITUTE_ADMIN_ENABLED && normalized.includes('INSTITUTE_ADMIN')) return true;
  return false;
}

/** Pure candidate/student — has CANDIDATE or STUDENT role and no staff roles. */
export function isCandidate(roles: unknown) {
  const normalized = normalizeRoles(roles);
  return (normalized.includes('CANDIDATE') || normalized.includes('STUDENT')) && !isAdmin(normalized);
}

export function isStaff(roles: unknown) {
  return isAdmin(roles);
}
