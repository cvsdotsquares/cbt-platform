'use client';

import { useEffect } from 'react';
import { usePathname } from 'next/navigation';
import { useNotificationStore } from '@/stores/notification-store';
import { navHrefForPathname, notificationTypeToNavHref } from '@/lib/nav-notification-routes';

/** Clears sidebar badge counts when the user opens the related dashboard page. */
export function useClearNavNotificationsOnVisit() {
  const pathname = usePathname();
  const markRead = useNotificationStore((s) => s.markRead);

  useEffect(() => {
    const navHref = navHrefForPathname(pathname);
    if (!navHref) return;

    const items = useNotificationStore.getState().items;
    for (const item of items) {
      if (item.read) continue;
      if (notificationTypeToNavHref[item.type] === navHref) {
        markRead(item.id);
      }
    }
  }, [pathname, markRead]);
}
