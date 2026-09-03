import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import type { AuthUser } from '@cbt/shared';
import { Permission, getPermissionsForRoles } from '@cbt/shared';
import { normalizeRoles, isAdmin, isTeacherOnly } from '@/lib/roles';
import { syncAuthSession, clearAuthSession, hydrateAuthSession } from '@/lib/auth-session';
import { getDefaultDashboardPath } from '@/lib/dashboard-nav';

interface AuthState {
  user: AuthUser | null;
  accessToken: string | null;
  refreshToken: string | null;
  isAuthenticated: boolean;
  _hasHydrated: boolean;
  setHasHydrated: (value: boolean) => void;
  setAuth: (user: AuthUser, accessToken: string, refreshToken: string) => Promise<boolean>;
  updateTokens: (accessToken: string, refreshToken: string) => Promise<void>;
  logout: () => Promise<void>;
}

export const useAuthStore = create<AuthState>()(
  persist(
    (set) => ({
      user: null,
      accessToken: null,
      refreshToken: null,
      isAuthenticated: false,
      _hasHydrated: false,
      setHasHydrated: (value) => set({ _hasHydrated: value }),
      setAuth: async (user, accessToken, refreshToken) => {
        const roles = normalizeRoles(user.roles);
        const isAdminUser = await syncAuthSession(accessToken, refreshToken);
        set({
          user: { ...user, roles: roles as AuthUser['roles'] },
          accessToken,
          refreshToken,
          isAuthenticated: true,
        });
        return isAdminUser;
      },
      updateTokens: async (accessToken, refreshToken) => {
        await syncAuthSession(accessToken, refreshToken);
        set({ accessToken, refreshToken });
      },
      logout: async () => {
        await clearAuthSession();
        set({ user: null, accessToken: null, refreshToken: null, isAuthenticated: false });
      },
    }),
    {
      name: 'cbt-auth',
      // Tokens live in HttpOnly cookies — only cache non-sensitive user display data.
      partialize: (state) => ({
        user: state.user,
        isAuthenticated: state.isAuthenticated,
      }),
    },
  ),
);

export async function syncSessionFromStore() {
  const hydrated = await hydrateAuthSession();
  if (hydrated) {
    useAuthStore.setState({
      user: hydrated.user,
      accessToken: hydrated.accessToken,
      refreshToken: hydrated.refreshToken ?? null,
      isAuthenticated: true,
    });
    return hydrated.isAdmin;
  }

  const state = useAuthStore.getState();
  if (state.isAuthenticated && state.accessToken && state.refreshToken) {
    return syncAuthSession(state.accessToken, state.refreshToken);
  }

  await clearAuthSession();
  useAuthStore.setState({
    user: null,
    accessToken: null,
    refreshToken: null,
    isAuthenticated: false,
  });
  return false;
}

export function getPostLoginPath(roles: unknown) {
  const normalized = normalizeRoles(roles);
  if (isTeacherOnly(normalized)) {
    const permissions = getPermissionsForRoles(normalized as never);
    const can = (p: Permission | string) => permissions.includes(p as never);
    return getDefaultDashboardPath(can, normalized);
  }
  return isAdmin(normalized) ? '/dashboard' : '/my-exams';
}
