import { Permission } from '@cbt/shared';
import { isTeacherOnly, normalizeRoles } from '@/lib/roles';

const PERMISSION_LABELS: Partial<Record<Permission, string>> = {
  [Permission.MATERIAL_UPLOAD]: 'Books',
  [Permission.MATERIAL_READ]: 'Books',
  [Permission.CURRICULUM_READ]: 'Syllabus',
  [Permission.SYLLABUS_READ]: 'Progress',
  [Permission.BATCH_READ]: 'Classes',
  [Permission.AI_GENERATE_TEST]: 'Tests',
  [Permission.EXAM_READ]: 'Exams',
  [Permission.CANDIDATE_READ]: 'Students',
  [Permission.RESULT_READ]: 'Results',
  [Permission.QUESTION_READ]: 'Questions',
  [Permission.PROCTORING_MONITOR]: 'Monitoring',
  [Permission.ANALYTICS_VIEW]: 'Analytics',
  [Permission.USER_READ]: 'Staff',
  [Permission.TENANT_READ]: 'Settings',
};

/** Short subtitle for header/sidebar based on role and effective permissions. */
export function getStaffProfileLabel(
  roles: unknown,
  can: (permission: Permission | string) => boolean,
): string {
  const normalized = normalizeRoles(roles);
  if (isTeacherOnly(normalized)) {
    const caps: string[] = [];
    if (can(Permission.MATERIAL_UPLOAD)) caps.push('Books');
    if (can(Permission.CURRICULUM_READ)) caps.push('Syllabus');
    if (can(Permission.AI_GENERATE_TEST)) caps.push('Tests');
    if (can(Permission.EXAM_READ)) caps.push('Exams');
    if (can(Permission.CANDIDATE_READ)) caps.push('Students');
    if (can(Permission.RESULT_READ)) caps.push('Results');
    if (caps.length) return `Teacher · ${caps.slice(0, 4).join(', ')}`;
    return 'Teacher';
  }

  const primary = normalized[0]?.replace(/_/g, ' ').toLowerCase() ?? 'staff';
  const extras = (Object.entries(PERMISSION_LABELS) as [Permission, string][])
    .filter(([perm]) => can(perm))
    .map(([, label]) => label)
    .filter((label, i, arr) => arr.indexOf(label) === i)
    .slice(0, 3);
  if (extras.length) return `${primary} · ${extras.join(', ')}`;
  return primary;
}
