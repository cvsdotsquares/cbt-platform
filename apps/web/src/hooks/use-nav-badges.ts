'use client';

import { useMemo } from 'react';
import { useNotificationStore } from '@/stores/notification-store';
import { countUnreadByNavHref } from '@/lib/nav-notification-routes';

/** Unread in-app notification counts per sidebar href (matches the header bell). */
export function useNavBadges(): Record<string, number> {
  const items = useNotificationStore((s) => s.items);

  return useMemo(() => countUnreadByNavHref(items), [items]);
}
