import type { AppNotification } from '@/stores/notification-store';

/** Maps in-app notification types to sidebar routes for badge counts. */
export const notificationTypeToNavHref: Record<AppNotification['type'], string> = {
  submission: '/dashboard/results',
  violation: '/dashboard/results',
  kyc: '/dashboard/candidates',
  registration: '/dashboard/candidates',
  exam: '/dashboard/exams',
};

export function countUnreadByNavHref(items: AppNotification[]): Record<string, number> {
  const counts: Record<string, number> = {};
  for (const item of items) {
    if (item.read) continue;
    const href = notificationTypeToNavHref[item.type];
    counts[href] = (counts[href] ?? 0) + 1;
  }
  return counts;
}

/** Mark unread notifications for a sidebar route as read (e.g. after opening that page). */
export function navHrefForPathname(pathname: string): string | null {
  const base = pathname.split('?')[0];
  const routes = [...new Set(Object.values(notificationTypeToNavHref))].sort(
    (a, b) => b.length - a.length,
  );
  for (const href of routes) {
    if (base === href || base.startsWith(`${href}/`)) return href;
  }
  return null;
}
