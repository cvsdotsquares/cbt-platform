import { create } from 'zustand';

export interface AppNotification {
  id: string;
  type: 'violation' | 'submission' | 'kyc' | 'registration' | 'exam';
  title: string;
  message: string;
  timestamp: string;
  read: boolean;
  /** In-app navigation target (e.g. Students page with search). */
  href?: string;
}

/** Class filter key for highlighting new registrations (academic class id or unassigned). */
export const UNASSIGNED_CLASS_HIGHLIGHT = 'unassigned';

interface NotificationState {
  items: AppNotification[];
  /** Increments when a new notification is added (for auto-opening the panel). */
  panelOpenSignal: number;
  /** Class tabs to highlight after a new student registration in that class. */
  classRegistrationHighlights: Record<string, true>;
  add: (item: Omit<AppNotification, 'id' | 'read'>) => void;
  markRead: (id: string) => void;
  markAllRead: () => void;
  markClassWithNewStudent: (classKey: string) => void;
  clearClassRegistrationHighlight: (classKey: string) => void;
  clear: () => void;
}

export const useNotificationStore = create<NotificationState>((set) => ({
  items: [],
  panelOpenSignal: 0,
  classRegistrationHighlights: {},
  add: (item) =>
    set((s) => {
      const id = `${item.type}-${item.timestamp}-${item.title}`;
      if (s.items.some((n) => n.id === id)) return s;
      return {
        items: [{ ...item, id, read: false }, ...s.items].slice(0, 50),
        panelOpenSignal: s.panelOpenSignal + 1,
      };
    }),
  markRead: (id) =>
    set((s) => ({
      items: s.items.map((n) => (n.id === id ? { ...n, read: true } : n)),
    })),
  markAllRead: () => set((s) => ({ items: s.items.map((n) => ({ ...n, read: true })) })),
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
  clear: () => set({ items: [], classRegistrationHighlights: {} }),
}));
