'use client';

import { useEffect } from 'react';
import { usePathname } from 'next/navigation';
import { useQuery } from '@tanstack/react-query';
import { useAuthStore } from '@/stores/auth-store';
import { tenantsApi } from '@/lib/api';
import { applyTenantPrimaryColor } from '@/lib/tenant-branding';
import { TENANT_BRANDING_ENABLED } from '@cbt/shared';

type TenantBrandingData = {
  branding?: { primaryColor?: string };
};

/**
 * Loads institute branding for any signed-in user (admin, teacher, student)
 * and applies primary color CSS variables across the app.
 */
export function TenantBranding() {
  const pathname = usePathname();
  const accessToken = useAuthStore((s) => s.accessToken);
  const isAuthenticated = useAuthStore((s) => s.isAuthenticated);
  const tenantId = useAuthStore((s) => s.user?.tenantId);
  const isPublicAuth = pathname === '/login' || pathname === '/register';

  const { data: tenant } = useQuery({
    queryKey: ['tenant-branding', tenantId],
    queryFn: () => tenantsApi.getMyBranding(accessToken!) as Promise<TenantBrandingData>,
    enabled: TENANT_BRANDING_ENABLED && !isPublicAuth && !!accessToken && !!tenantId && isAuthenticated,
    staleTime: 5 * 60_000,
  });

  useEffect(() => {
    applyTenantPrimaryColor(tenant?.branding?.primaryColor);
  }, [tenant?.branding?.primaryColor]);

  return null;
}
