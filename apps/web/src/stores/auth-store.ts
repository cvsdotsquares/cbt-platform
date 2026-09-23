import { create } from 'zustand';
import { createJSONStorage, persist } from 'zustand/middleware';
import type { AuthUser } from '@cbt/shared';
import { Permission, getPermissionsForRoles } from '@cbt/shared';
import { normalizeRoles, isAdmin, isTeacherOnly } from '@/lib/roles';
import { syncAuthSession, hydrateAuthSession, clearAuthSession } from '@/lib/auth-session';
import { clearMaterialsUploadSession } from '@/lib/materials-upload-session';
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
        clearMaterialsUploadSession();
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
        clearMaterialsUploadSession();
        const { accessToken } = useAuthStore.getState();
        await clearAuthSession(accessToken);
        set({ user: null, accessToken: null, refreshToken: null, isAuthenticated: false });
      },
    }),
    {
      name: 'cbt-auth',
      storage: createJSONStorage(() => sessionStorage),
      partialize: (state) => ({
        user: state.user,
        accessToken: state.accessToken,
        refreshToken: state.refreshToken,
        isAuthenticated: state.isAuthenticated,
      }),
    },
  ),
);

export async function syncSessionFromStore() {
  const state = useAuthStore.getState();
  const hydrated = await hydrateAuthSession(state.accessToken);
  if (hydrated) {
    useAuthStore.setState({
      user: hydrated.user,
      accessToken: hydrated.accessToken,
      refreshToken: hydrated.refreshToken ?? state.refreshToken,
      isAuthenticated: true,
    });
    return hydrated.isAdmin;
  }

  // Access token may be expired while the 3-hour refresh token is still valid.
  if (state.isAuthenticated && state.refreshToken) {
    return false;
  }

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
