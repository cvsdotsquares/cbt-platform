'use client';

import { useState, useEffect, useRef, useMemo } from 'react';
import { useAuthStore } from '@/stores/auth-store';
import { useRouter, usePathname } from 'next/navigation';
import { Button } from '@/components/ui/button';
import { LogOut, Bell, Menu, GraduationCap, Search } from 'lucide-react';
import { authApi, isAdmin } from '@/lib/api';
import { isTeacherOnly, normalizeRoles } from '@/lib/roles';
import { useLiveNotifications } from '@/hooks/use-live-notifications';
import { useNotificationStore } from '@/stores/notification-store';
import { usePermissions } from '@/hooks/use-permissions';
import { MobileNav } from './mobile-nav';
import { ThemeToggle } from './theme-toggle';
import { mainNav, teacherNav, settingsNav } from './sidebar';
import { cn } from '@/lib/utils';

const pageTitles: Record<string, string> = {
  '/dashboard': 'Institute Home',
  '/dashboard/materials': 'NCERT Books',
  '/dashboard/batches': 'Classes & Batches',
  '/dashboard/syllabus': 'Syllabus',
  '/dashboard/ai-tests': 'Create Class Test',
  '/dashboard/exams': 'Class Tests',
  '/dashboard/candidates': 'Students',
  '/dashboard/results': 'Results',
  '/dashboard/teacher': 'Home',
  '/dashboard/questions': 'Question Bank',
  '/dashboard/users': 'Staff & Teachers',
  '/dashboard/analytics': 'Analytics',
  '/dashboard/monitoring': 'Live Monitoring',
  '/dashboard/ai': 'AI Studio',
  '/dashboard/audit': 'Audit Logs',
  '/dashboard/settings': 'Institute Settings',
  '/dashboard/institutes': 'Institutes',
  '/dashboard/guide': 'Help & Guide',
};

export function Header() {
  const { user, logout, accessToken } = useAuthStore();
  const router = useRouter();
  const pathname = usePathname();
  const { can } = usePermissions();
  const [showNotifications, setShowNotifications] = useState(false);
  const [mobileNavOpen, setMobileNavOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [searchOpen, setSearchOpen] = useState(false);
  const panelRef = useRef<HTMLDivElement>(null);
  const searchRef = useRef<HTMLDivElement>(null);

  const notifications = useNotificationStore((s) => s.items);
  const markRead = useNotificationStore((s) => s.markRead);
  const markAllRead = useNotificationStore((s) => s.markAllRead);
  const unreadCount = notifications.filter((n) => !n.read).length;

  useLiveNotifications();

  useEffect(() => {
    function handleClickOutside(e: MouseEvent) {
      if (panelRef.current && !panelRef.current.contains(e.target as Node)) {
        setShowNotifications(false);
      }
      if (searchRef.current && !searchRef.current.contains(e.target as Node)) {
        setSearchOpen(false);
      }
    }
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  useEffect(() => {
    setMobileNavOpen(false);
    setQuery('');
    setSearchOpen(false);
  }, [pathname]);

  const teacherPortal = isTeacherOnly(normalizeRoles(user?.roles));
  const searchable = useMemo(() => {
    const nav = teacherPortal ? teacherNav : mainNav;
    return [...nav, ...settingsNav].filter((i) => can(i.permission));
  }, [teacherPortal, can]);

  const matches = query.trim()
    ? searchable.filter((i) => i.label.toLowerCase().includes(query.trim().toLowerCase()))
    : [];

  const initials = `${user?.firstName?.[0] || ''}${user?.lastName?.[0] || ''}`.toUpperCase();

  async function handleLogout() {
    if (accessToken) {
      try { await authApi.logout(accessToken); } catch { /* ignore */ }
    }
    await logout();
    window.location.href = '/login';
  }

  return (
    <>
      <header
        className={cn(
          'sticky top-0 z-40 flex items-center justify-between gap-3 px-3 sm:px-6 lg:px-8',
          'h-16 sm:h-[76px]',
          'bg-background/40 backdrop-blur-xl dark:bg-transparent',
        )}
      >
        <div className="flex min-w-0 items-center gap-2 sm:gap-4">
          <Button
            variant="ghost"
            size="icon"
            className="h-9 w-9 shrink-0 lg:hidden text-muted-foreground hover:text-foreground"
            onClick={() => setMobileNavOpen(true)}
            aria-label="Open navigation"
          >
            <Menu className="h-5 w-5" />
          </Button>

          <div className="min-w-0">
            <h2 className="truncate text-lg font-bold tracking-tight sm:text-[22px]">
              Hi, {user?.firstName || 'there'}! 👋
            </h2>
            <p className="hidden truncate text-xs text-muted-foreground sm:block">
              {pageTitles[pathname] || 'Institute'}
            </p>
          </div>
        </div>

        <div ref={searchRef} className="relative mx-2 min-w-0 max-w-xl flex-1">
          <Search className="pointer-events-none absolute left-4 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <input
            type="search"
            value={query}
            onChange={(e) => {
              setQuery(e.target.value);
              setSearchOpen(true);
            }}
            onFocus={() => setSearchOpen(true)}
            placeholder="Search pages, tests, students..."
            className={cn(
              'h-11 w-full min-w-[180px] rounded-full border border-border/50 bg-card pl-11 pr-4 text-sm',
              'placeholder:text-muted-foreground/80',
              'shadow-sm outline-none transition-all',
              'focus:border-primary/40 focus:ring-2 focus:ring-primary/20',
              'dark:bg-white/[0.06] dark:focus:bg-white/[0.09]',
            )}
          />
          {searchOpen && matches.length > 0 && (
            <div className="absolute left-0 right-0 top-full z-50 mt-2 overflow-hidden rounded-2xl border border-border/60 bg-card shadow-card">
              {matches.map((item) => {
                const Icon = item.icon;
                return (
                  <button
                    key={item.href}
                    type="button"
                    className="flex w-full items-center gap-3 px-4 py-2.5 text-left text-sm hover:bg-muted/60"
                    onClick={() => router.push(item.href)}
                  >
                    <Icon className="h-4 w-4 text-primary" />
                    {item.label}
                  </button>
                );
              })}
            </div>
          )}
        </div>

        <div className="flex shrink-0 items-center gap-1.5 sm:gap-2">
          <div className="relative" ref={panelRef}>
            <button
              type="button"
              className={cn(
                'relative flex h-10 w-10 items-center justify-center rounded-full',
                'bg-muted/80 text-muted-foreground transition-all duration-200',
                'hover:bg-card hover:text-foreground hover:shadow-sm',
                'dark:bg-white/[0.06] dark:hover:bg-white/[0.1]',
                unreadCount > 0 && 'animate-[border-glow-pulse_2.5s_ease-in-out_infinite]',
              )}
              onClick={() => setShowNotifications((v) => !v)}
              title="Notifications"
            >
              <Bell className={cn('h-[17px] w-[17px] transition-transform', showNotifications && 'rotate-12')} />
              {unreadCount > 0 && (
                <span className="absolute -right-0.5 -top-0.5 flex h-4 min-w-4 items-center justify-center rounded-full bg-primary px-1 text-[9px] font-bold text-primary-foreground ring-2 ring-background">
                  {unreadCount > 9 ? '9+' : unreadCount}
                </span>
              )}
            </button>

            {showNotifications && (
              <div className="absolute right-0 top-full z-50 mt-2 w-[min(22rem,calc(100vw-1.5rem))] overflow-hidden rounded-2xl border border-border/60 bg-card shadow-xl backdrop-blur-xl animate-fade-in-up">
                <div className="flex items-center justify-between border-b border-border/60 px-4 py-3">
                  <p className="text-sm font-semibold">Notifications</p>
                  {unreadCount > 0 && (
                    <button type="button" className="text-xs text-primary hover:underline" onClick={markAllRead}>
                      Mark all read
                    </button>
                  )}
                </div>
                <div className="max-h-80 overflow-y-auto">
                  {notifications.length === 0 ? (
                    <div className="flex flex-col items-center gap-2 px-4 py-10 text-center">
                      <Bell className="h-8 w-8 text-muted-foreground/30" />
                      <p className="text-sm text-muted-foreground">No notifications yet</p>
                    </div>
                  ) : (
                    notifications.map((n) => (
                      <button
                        key={n.id}
                        type="button"
                        className={cn(
                          'flex w-full flex-col gap-0.5 border-b border-border/40 px-4 py-3 text-left transition-all duration-150',
                          'hover:bg-muted/30',
                          !n.read && 'bg-primary/5 border-l-2 border-l-primary',
                        )}
                        onClick={() => markRead(n.id)}
                      >
                        <span className="text-sm font-medium">{n.title}</span>
                        <span className="text-xs text-muted-foreground">{n.message}</span>
                        <span className="text-[10px] text-muted-foreground/70">
                          {new Date(n.timestamp).toLocaleString()}
                        </span>
                      </button>
                    ))
                  )}
                </div>
              </div>
            )}
          </div>

          <ThemeToggle />

          <div className="flex items-center gap-2 rounded-full bg-muted/80 py-1 pl-1 pr-1 sm:pr-3 dark:bg-white/[0.06]">
            <div className="flex h-8 w-8 items-center justify-center rounded-full bg-[#7B8FF7] text-[11px] font-bold text-white shadow-sm">
              {initials || <GraduationCap className="h-3.5 w-3.5" />}
            </div>
            <div className="hidden text-left sm:block">
              <p className="text-[12px] font-semibold leading-none">
                {user?.firstName} {user?.lastName}
              </p>
              <p className="mt-0.5 text-[10px] capitalize text-muted-foreground">
                {user?.roles?.[0]?.replace(/_/g, ' ').toLowerCase()}
              </p>
            </div>
          </div>

          {!isAdmin(normalizeRoles(user?.roles)) && (
            <Button
              variant="outline"
              size="sm"
              className="hidden rounded-full sm:inline-flex text-xs h-8"
              onClick={() => router.push('/my-exams')}
            >
              Student Portal
            </Button>
          )}

          <button
            type="button"
            className={cn(
              'flex h-10 w-10 items-center justify-center rounded-full',
              'text-muted-foreground transition-all duration-200',
              'hover:bg-destructive/10 hover:text-destructive',
            )}
            onClick={handleLogout}
            title="Logout"
          >
            <LogOut className="h-[17px] w-[17px]" />
          </button>
        </div>
      </header>

      <MobileNav open={mobileNavOpen} onOpenChange={setMobileNavOpen} />
    </>
  );
}
