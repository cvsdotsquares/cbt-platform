import { create } from 'zustand';
import { createJSONStorage, persist } from 'zustand/middleware';

export interface AppNotification {
  id: string;
  type: 'violation' | 'submission' | 'kyc' | 'registration' | 'exam' | 'assignment';
  title: string;
  message: string;
  timestamp: string;
  read: boolean;
  /** In-app navigation target (e.g. Students page with search). */
  href?: string;
}

/** Class filter key for highlighting new registrations (academic class id or unassigned). */
export const UNASSIGNED_CLASS_HIGHLIGHT = 'unassigned';

type NotificationInput = Omit<AppNotification, 'id' | 'read'>;

function notificationId(item: NotificationInput) {
  return `${item.type}-${item.timestamp}-${item.title}`;
}

interface NotificationState {
  items: AppNotification[];
  /** Class tabs to highlight after a new student registration in that class. */
  classRegistrationHighlights: Record<string, true>;
  add: (item: NotificationInput) => void;
  /** Keeps a read copy in the bell list without opening the panel or resetting read state. */
  ensureHistory: (item: NotificationInput) => void;
  markRead: (id: string) => void;
  markAllRead: () => void;
  /** Permanently remove one notification (stays dismissed across live feed refreshes). */
  remove: (id: string) => void;
  markClassWithNewStudent: (classKey: string) => void;
  clearClassRegistrationHighlight: (classKey: string) => void;
  /** Drop notification types that do not apply to the current portal (e.g. institute exam feed for teachers). */
  pruneByTypes: (types: AppNotification['type'][]) => void;
  clear: () => void;
  /** Notification ids the user dismissed — prevents the poll feed from re-adding them. */
  dismissedIds: Record<string, true>;
}

export const useNotificationStore = create<NotificationState>()(
  persist(
    (set) => ({
      items: [],
      dismissedIds: {},
      classRegistrationHighlights: {},
      add: (item) =>
        set((s) => {
          const id = notificationId(item);
          if (s.dismissedIds[id] || s.items.some((n) => n.id === id)) return s;
          return {
            items: [{ ...item, id, read: false }, ...s.items].slice(0, 50),
          };
        }),
      ensureHistory: (item) =>
        set((s) => {
          const id = notificationId(item);
          if (s.dismissedIds[id] || s.items.some((n) => n.id === id)) return s;
          return {
            items: [{ ...item, id, read: true }, ...s.items].slice(0, 50),
          };
        }),
      markRead: (id) =>
        set((s) => ({
          items: s.items.map((n) => (n.id === id ? { ...n, read: true } : n)),
        })),
      markAllRead: () => set((s) => ({ items: s.items.map((n) => ({ ...n, read: true })) })),
      remove: (id) =>
        set((s) => ({
          dismissedIds: { ...s.dismissedIds, [id]: true },
          items: s.items.filter((n) => n.id !== id),
        })),
      markClassWithNewStudent: (classKey) =>
        set((s) => ({
          classRegistrationHighlights: { ...s.classRegistrationHighlights, [classKey]: true },
        })),
      clearClassRegistrationHighlight: (classKey) =>
        set((s) => {
          if (!s.classRegistrationHighlights[classKey]) return s;
          const next = { ...s.classRegistrationHighlights };
          delete next[classKey];
          return { classRegistrationHighlights: next };
        }),
      pruneByTypes: (types) =>
        set((s) => {
          const drop = new Set(types);
          const items = s.items.filter((n) => !drop.has(n.type));
          return items.length === s.items.length ? s : { items };
        }),
      clear: () => set({ items: [], dismissedIds: {}, classRegistrationHighlights: {} }),
    }),
    {
      name: 'cbt-notifications',
      storage: createJSONStorage(() => sessionStorage),
      partialize: (state) => ({ items: state.items, dismissedIds: state.dismissedIds }),
    },
  ),
);
