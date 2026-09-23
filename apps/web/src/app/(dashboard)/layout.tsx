'use client';

import dynamic from 'next/dynamic';
import { useAuthStore } from '@/stores/auth-store';
import { isAdmin, normalizeRoles } from '@/lib/roles';
import { Sidebar } from '@/components/layout/sidebar';
import { Header } from '@/components/layout/header';
import { useRouter, usePathname } from 'next/navigation';
import { useEffect } from 'react';
import { usePermissions } from '@/hooks/use-permissions';
import { getDefaultDashboardPath, getPermissionForPath } from '@/lib/dashboard-nav';
import { useClearNavNotificationsOnVisit } from '@/hooks/use-clear-nav-notifications-on-visit';

const AiAssistant = dynamic(
  () => import('@/components/ai/ai-assistant').then((mod) => mod.AiAssistant),
  { ssr: false },
);

export default function DashboardLayout({ children }: { children: React.ReactNode }) {
  const { isAuthenticated, user, _hasHydrated } = useAuthStore();
  const router = useRouter();
  const pathname = usePathname();
  const { can } = usePermissions();
  const roles = normalizeRoles(user?.roles);
  const staffUser = isAdmin(roles);

  useClearNavNotificationsOnVisit();

  useEffect(() => {
    if (!_hasHydrated) return;

    if (!isAuthenticated || !user) {
      router.replace('/login');
      return;
    }

    if (!staffUser) {
      router.replace('/my-exams');
      return;
    }

    const required = getPermissionForPath(pathname);
    if (required && !can(required)) {
      router.replace(getDefaultDashboardPath(can, roles));
    }
  }, [_hasHydrated, isAuthenticated, user, staffUser, router, pathname, can, roles]);

  if (_hasHydrated && (!isAuthenticated || !user || !staffUser)) return null;

  return (
    <div className="relative flex h-dvh overflow-hidden mesh-bg">
      <div className="relative z-10 hidden h-full p-3 pr-0 lg:block">
        <Sidebar className="h-full" />
      </div>
      <div className="relative z-10 flex min-w-0 flex-1 flex-col overflow-hidden">
        <Header />
        <main className="flex-1 overflow-y-auto overflow-x-hidden px-4 pb-6 pt-1 sm:px-6 lg:px-8 lg:pb-8">
          <div className="page-shell">{children}</div>
        </main>
        <AiAssistant />
      </div>
    </div>
  );
}
