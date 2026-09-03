const STAFF_ROLES = [
  'SUPER_ADMIN', 'ORG_ADMIN', 'INSTITUTE_ADMIN', 'TEACHER',
  'EXAM_MANAGER', 'QUESTION_MODERATOR', 'PROCTOR', 'EVALUATOR', 'AUDITOR',
];

const ELEVATED_STAFF_ROLES = [
  'SUPER_ADMIN', 'ORG_ADMIN', 'INSTITUTE_ADMIN', 'EXAM_MANAGER',
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

/** Pure teacher — TEACHER without elevated admin roles. Uses the simplified teacher portal. */
export function isTeacherOnly(roles: unknown) {
  const normalized = normalizeRoles(roles);
  return normalized.includes('TEACHER') && !normalized.some((role) => ELEVATED_STAFF_ROLES.includes(role));
}

/** Pure candidate/student — has CANDIDATE or STUDENT role and no staff roles. */
export function isCandidate(roles: unknown) {
  const normalized = normalizeRoles(roles);
  return (normalized.includes('CANDIDATE') || normalized.includes('STUDENT')) && !isAdmin(normalized);
}

export function isStaff(roles: unknown) {
  return isAdmin(roles);
}
