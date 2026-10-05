import { Permission, getPermissionsForRoles } from '@cbt/shared';
import { isAdmin, isTeacherOnly, normalizeRoles } from '@/lib/roles';

export interface DashboardRoute {
  path: string;
  permission: Permission;
  exact?: boolean;
}

/** Institute workflow order — used for default landing and access checks */
export const DASHBOARD_ROUTES: DashboardRoute[] = [
  { path: '/dashboard', permission: Permission.ANALYTICS_VIEW, exact: true },
  { path: '/dashboard/materials', permission: Permission.MATERIAL_READ },
  { path: '/dashboard/batches', permission: Permission.BATCH_READ },
  { path: '/dashboard/syllabus', permission: Permission.CURRICULUM_READ },
  { path: '/dashboard/ai-tests', permission: Permission.AI_GENERATE_TEST },
  { path: '/dashboard/exams', permission: Permission.EXAM_READ },
  { path: '/dashboard/candidates', permission: Permission.CANDIDATE_READ },
  { path: '/dashboard/results', permission: Permission.RESULT_READ },
  { path: '/dashboard/teacher', permission: Permission.LEARNING_MANAGE },
  { path: '/dashboard/monitoring', permission: Permission.PROCTORING_MONITOR },
  { path: '/dashboard/analytics', permission: Permission.ANALYTICS_VIEW },
  { path: '/dashboard/questions', permission: Permission.QUESTION_READ },
  { path: '/dashboard/ai', permission: Permission.QUESTION_CREATE },
  { path: '/dashboard/institutes', permission: Permission.TENANT_CREATE },
  { path: '/dashboard/users', permission: Permission.USER_READ },
  { path: '/dashboard/permissions', permission: Permission.TENANT_DELETE },
  { path: '/dashboard/audit', permission: Permission.AUDIT_READ },
  { path: '/dashboard/settings', permission: Permission.TENANT_READ },
];

export function getPermissionForPath(pathname: string): Permission | null {
  if (pathname === '/dashboard') {
    return Permission.ANALYTICS_VIEW;
  }
  const match = DASHBOARD_ROUTES.find(
    (route) => route.path !== '/dashboard' && pathname.startsWith(route.path),
  );
  return match?.permission ?? null;
}

export function getDefaultDashboardPath(
  can: (permission: Permission | string) => boolean,
  roles?: string[],
): string {
  // Teacher portal (including Institute Admin while that role is disabled)
  if (roles && isTeacherOnly(roles) && can(Permission.LEARNING_MANAGE)) {
    return '/dashboard/teacher';
  }

  // Narrow staff roles without dashboard home access
  if (can(Permission.PROCTORING_MONITOR) && !can(Permission.ANALYTICS_VIEW)) {
    return '/dashboard/monitoring';
  }
  if (can(Permission.RESULT_EVALUATE) && !can(Permission.ANALYTICS_VIEW) && !can(Permission.AI_GENERATE_TEST)) {
    return '/dashboard/results';
  }
  if (can(Permission.QUESTION_READ) && !can(Permission.ANALYTICS_VIEW) && !can(Permission.AI_GENERATE_TEST)) {
    return '/dashboard/questions';
  }

  for (const route of DASHBOARD_ROUTES) {
    if (can(route.permission)) return route.path;
  }
  return '/my-exams';
}

/** Staff landing route after login (respects teacher portal vs institute home). */
export function getPostLoginPath(roles: unknown) {
  const normalized = normalizeRoles(roles);
  if (!isAdmin(normalized)) return '/my-exams';
  const permissions = getPermissionsForRoles(normalized as never);
  const can = (p: Permission | string) => permissions.includes(p as never);
  return getDefaultDashboardPath(can, normalized);
}
