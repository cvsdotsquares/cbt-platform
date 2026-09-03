import { create } from 'zustand';

export interface AppNotification {
  id: string;
  type: 'violation' | 'submission';
  title: string;
  message: string;
  timestamp: string;
  read: boolean;
}

interface NotificationState {
  items: AppNotification[];
  add: (item: Omit<AppNotification, 'id' | 'read'>) => void;
  markRead: (id: string) => void;
  markAllRead: () => void;
  clear: () => void;
}

export const useNotificationStore = create<NotificationState>((set) => ({
  items: [],
  add: (item) =>
    set((s) => {
      const id = `${item.type}-${item.timestamp}-${item.title}`;
      if (s.items.some((n) => n.id === id)) return s;
      return {
        items: [{ ...item, id, read: false }, ...s.items].slice(0, 50),
      };
    }),
  markRead: (id) =>
    set((s) => ({
      items: s.items.map((n) => (n.id === id ? { ...n, read: true } : n)),
    })),
  markAllRead: () => set((s) => ({ items: s.items.map((n) => ({ ...n, read: true })) })),
  clear: () => set({ items: [] }),
}));
