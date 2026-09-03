'use client';

import { useAuthStore } from '@/stores/auth-store';
import { getPermissionsForRoles } from '@cbt/shared';
import type { Permission } from '@cbt/shared';

export function usePermissions() {
  const user = useAuthStore((s) => s.user);
  const roles = user?.roles ?? [];
  const permissions = getPermissionsForRoles(roles as never);

  const can = (permission: Permission | string) => permissions.includes(permission as Permission);

  return { roles, permissions, can, isAdmin: roles.some((r) =>
    ['SUPER_ADMIN', 'ORG_ADMIN', 'EXAM_MANAGER'].includes(r),
  ) };
}
