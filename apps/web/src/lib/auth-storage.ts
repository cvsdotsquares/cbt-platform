export const REMEMBER_ME_KEY = 'cbt-remember-me';
const AUTH_PERSIST_KEY = 'cbt-auth';

export function isRememberMeEnabled(): boolean {
  if (typeof window === 'undefined') return false;
  return localStorage.getItem(REMEMBER_ME_KEY) === '1';
}

export function setRememberMePreference(enabled: boolean): void {
  if (typeof window === 'undefined') return;
  if (enabled) {
    localStorage.setItem(REMEMBER_ME_KEY, '1');
    return;
  }
  localStorage.removeItem(REMEMBER_ME_KEY);
  localStorage.removeItem(AUTH_PERSIST_KEY);
}

/** Zustand persist target — localStorage when Remember Me is on, else session-only. */
export function getAuthPersistStorage(): Storage {
  if (typeof window === 'undefined') return sessionStorage;
  return isRememberMeEnabled() ? localStorage : sessionStorage;
}

export function migrateAuthPersistToActiveStorage(serialized: string): void {
  if (typeof window === 'undefined') return;
  getAuthPersistStorage().setItem(AUTH_PERSIST_KEY, serialized);
  const inactive = isRememberMeEnabled() ? sessionStorage : localStorage;
  inactive.removeItem(AUTH_PERSIST_KEY);
}
