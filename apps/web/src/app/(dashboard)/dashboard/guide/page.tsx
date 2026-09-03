'use client';

import { useAuthStore } from '@/stores/auth-store';
import { isTeacherOnly, normalizeRoles } from '@/lib/roles';
import { getGuideForRole } from '@/components/guide/guide-content';
import { UserGuide } from '@/components/guide/user-guide';

export default function GuidePage() {
  const { user } = useAuthStore();
  const roles = normalizeRoles(user?.roles);
  const guide = getGuideForRole(isTeacherOnly(roles) ? 'teacher' : 'admin');

  return <UserGuide guide={guide} />;
}
