'use client';

import { useQuery } from '@tanstack/react-query';
import { useAuthStore } from '@/stores/auth-store';
import { authApi } from '@/lib/api';
import { getPermissionsForRoles } from '@cbt/shared';
import type { Permission } from '@cbt/shared';

export function usePermissions() {
  const user = useAuthStore((s) => s.user);
  const accessToken = useAuthStore((s) => s.accessToken);
  const roles = user?.roles ?? [];
  const fallback = getPermissionsForRoles(roles as never);

  const { data, isSuccess } = useQuery({
    queryKey: ['effective-permissions', user?.id],
    queryFn: () => authApi.effectivePermissions(accessToken!),
    enabled: !!accessToken && !!user?.id,
    staleTime: 0,
    refetchOnWindowFocus: true,
  });

  const permissions = (isSuccess && data ? data.permissions : fallback) as Permission[];

  const can = (permission: Permission | string) => permissions.includes(permission as Permission);

  return { roles, permissions, can, synced: isSuccess, isAdmin: roles.some((r) =>
    ['SUPER_ADMIN', 'ORG_ADMIN', 'EXAM_MANAGER'].includes(r),
  ) };
}
