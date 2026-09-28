'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import {
  LayoutDashboard, Users, Upload, Sparkles, Award, Settings, UserCog, ClipboardList,
  BookOpen, School, CircleHelp, GraduationCap, ShieldCheck,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { usePermissions } from '@/hooks/use-permissions';
import { Permission } from '@cbt/shared';
import { Logo } from './logo';
import { useAuthStore } from '@/stores/auth-store';
import { isTeacherOnly, normalizeRoles } from '@/lib/roles';
import { useNavBadges } from '@/hooks/use-nav-badges';

/** NCERT institute workflow — books → classes → syllabus → tests → students → results */
export const mainNav = [
  { href: '/dashboard', label: 'Home', icon: LayoutDashboard, permission: Permission.ANALYTICS_VIEW, exact: true },
  { href: '/dashboard/materials', label: 'NCERT Books', icon: Upload, permission: Permission.MATERIAL_READ },
  { href: '/dashboard/batches', label: 'Classes & Batches', icon: School, permission: Permission.BATCH_READ },
  { href: '/dashboard/syllabus', label: 'Syllabus', icon: BookOpen, permission: Permission.CURRICULUM_READ },
  { href: '/dashboard/ai-tests', label: 'Create Class Test', icon: Sparkles, permission: Permission.AI_GENERATE_TEST },
  { href: '/dashboard/exams', label: 'Class Tests', icon: ClipboardList, permission: Permission.EXAM_READ },
  { href: '/dashboard/candidates', label: 'Students', icon: Users, permission: Permission.CANDIDATE_READ },
  { href: '/dashboard/results', label: 'Results', icon: Award, permission: Permission.RESULT_READ },
];

/** Simplified teacher portal. NCERT Books appears only after an admin grants book upload. */
export const teacherNav = [
  { href: '/dashboard/teacher', label: 'Home', icon: LayoutDashboard, permission: Permission.LEARNING_MANAGE, exact: true },
  { href: '/dashboard/materials', label: 'NCERT Books', icon: Upload, permission: Permission.MATERIAL_UPLOAD },
  { href: '/dashboard/syllabus', label: 'Syllabus', icon: BookOpen, permission: Permission.CURRICULUM_READ },
  { href: '/dashboard/batches', label: 'Topic Progress', icon: School, permission: Permission.SYLLABUS_READ },
  { href: '/dashboard/ai-tests', label: 'Create Class Test', icon: Sparkles, permission: Permission.AI_GENERATE_TEST },
  { href: '/dashboard/exams', label: 'Class Tests', icon: ClipboardList, permission: Permission.EXAM_READ },
  { href: '/dashboard/candidates', label: 'My Students', icon: Users, permission: Permission.CANDIDATE_READ },
  { href: '/dashboard/results', label: 'Results', icon: Award, permission: Permission.RESULT_READ },
];

export const settingsNav = [
  { href: '/dashboard/users', label: 'Staff & Teachers', icon: UserCog, permission: Permission.USER_READ },
  { href: '/dashboard/permissions', label: 'Role Permissions', icon: ShieldCheck, permission: Permission.TENANT_DELETE },
  { href: '/dashboard/settings', label: 'Institute Settings', icon: Settings, permission: Permission.TENANT_READ },
];

interface SidebarProps {
  className?: string;
  onNavigate?: () => void;
  compact?: boolean;
}

export function Sidebar({ className, onNavigate, compact = false }: SidebarProps) {
  const pathname = usePathname();
  const { can } = usePermissions();
  const { user } = useAuthStore();
  const navBadges = useNavBadges();
  const teacherPortal = isTeacherOnly(normalizeRoles(user?.roles));
  const nav = teacherPortal ? teacherNav : mainNav;
  const showSettings = !teacherPortal && settingsNav.some((i) => can(i.permission));

  const initials = `${user?.firstName?.[0] || ''}${user?.lastName?.[0] || ''}`.toUpperCase();
  const roleName = user?.roles?.[0]?.replace(/_/g, ' ') ?? 'Staff';

  const renderLink = (item: {
    href: string;
    label: string;
    icon: typeof CircleHelp;
    exact?: boolean;
  }) => {
    const Icon = item.icon;
    const isActive = item.exact
      ? pathname === item.href
      : pathname === item.href || pathname.startsWith(item.href + '/');
    const badge = navBadges[item.href] ?? 0;

    return (
      <Link
        key={item.href}
        href={item.href}
        onClick={onNavigate}
        title={badge > 0 ? `${item.label} (${badge} notification${badge === 1 ? '' : 's'})` : item.label}
        className={cn(
          'group relative flex items-center font-medium transition-all duration-200',
          compact
            ? 'h-11 w-11 justify-center rounded-2xl'
            : 'gap-3 rounded-xl px-3 py-2.5 text-[13px]',
          isActive
            ? compact
              ? 'bg-[#7B8FF7]/25 text-white shadow-sm'
              : 'bg-[#7B8FF7]/25 text-white shadow-sm'
            : compact
              ? 'text-white/55 hover:bg-white/10 hover:text-white'
              : 'text-sidebar-muted hover:bg-white/[0.08] hover:text-sidebar-foreground',
        )}
      >
        <Icon
          className={cn(
            'shrink-0 transition-all duration-200',
            compact ? 'h-[18px] w-[18px]' : 'h-[17px] w-[17px]',
            isActive ? 'text-white' : 'text-current group-hover:scale-110',
          )}
        />
        {!compact && <span className="min-w-0 flex-1 truncate">{item.label}</span>}
        {badge > 0 && (
          compact ? (
            <span className="absolute right-1 top-1 flex h-4 min-w-4 items-center justify-center rounded-full bg-[#FF5C5C] px-1 text-[9px] font-bold leading-none text-white ring-2 ring-sidebar">
              {badge > 9 ? '9+' : badge}
            </span>
          ) : (
            <span className="ml-auto flex h-5 min-w-5 shrink-0 items-center justify-center rounded-full bg-[#FF5C5C] px-1.5 text-[10px] font-bold tabular-nums text-white">
              {badge > 99 ? '99+' : badge}
            </span>
          )
        )}
        {!compact && isActive && (
          <span className="absolute left-0 top-1/2 h-5 w-[3px] -translate-y-1/2 rounded-r-full bg-white/90" />
        )}
      </Link>
    );
  };

  return (
    <aside
      className={cn(
        'relative flex h-full flex-col bg-sidebar text-sidebar-foreground overflow-hidden',
        compact
          ? 'w-[76px] rounded-[28px] border border-white/10 bg-sidebar/80 shadow-sidebar backdrop-blur-xl'
          : 'w-[min(260px,85vw)] border-r border-white/10 bg-sidebar shadow-sidebar',
        className,
      )}
    >
      <div className="pointer-events-none absolute -right-10 -top-10 h-36 w-36 rounded-full bg-[#7B8FF7]/20 blur-3xl" />
      <div className="pointer-events-none absolute -bottom-16 -left-8 h-40 w-40 rounded-full bg-[#4c3cc9]/20 blur-3xl" />

      <div
        className={cn(
          'flex items-center',
          compact ? 'justify-center px-3 pt-5 pb-4' : 'h-[64px] border-b border-white/10 px-5 sm:h-[72px] sm:px-6',
        )}
      >
        <Logo variant="light" compact={compact} />
      </div>

      <nav
        className={cn(
          'flex flex-1 flex-col overflow-y-auto',
          compact ? 'items-center gap-1 px-3 py-1' : 'px-3 py-4 sm:px-4 sm:py-5',
        )}
      >
        <div className={cn('flex-1', compact ? 'flex flex-col items-center gap-1' : 'space-y-5')}>
          <div className={cn(compact ? 'flex flex-col items-center gap-1' : 'space-y-0.5')}>
            {nav.filter((i) => can(i.permission)).map(renderLink)}
          </div>

          {showSettings && (
            <div className={cn(compact ? 'mt-3 flex flex-col items-center gap-1' : '')}>
              {!compact && (
                <p className="mb-1.5 px-3 text-[10px] font-bold uppercase tracking-[0.18em] text-sidebar-muted/60">
                  Configuration
                </p>
              )}
              <div className={cn(compact ? 'flex flex-col items-center gap-1' : 'space-y-0.5')}>
                {settingsNav.filter((i) => can(i.permission)).map(renderLink)}
              </div>
            </div>
          )}
        </div>

        <div className={cn(compact ? 'mt-2 flex flex-col items-center' : 'mt-4 space-y-0.5 border-t border-white/10 pt-3')}>
          {renderLink({
            href: '/dashboard/guide',
            label: 'Help & Guide',
            icon: CircleHelp,
          })}
        </div>
      </nav>

      <div className={cn(compact ? 'flex justify-center px-3 pb-5 pt-2' : 'border-t border-white/10 p-3')}>
        {compact ? (
          <div
            className="flex h-10 w-10 items-center justify-center rounded-2xl bg-[#7B8FF7] text-[11px] font-bold text-white"
            title={`${user?.firstName ?? ''} ${user?.lastName ?? ''}`.trim()}
          >
            {initials || <GraduationCap className="h-4 w-4" />}
          </div>
        ) : (
          <div className="flex items-center gap-3 rounded-xl bg-white/[0.06] border border-white/[0.08] px-3 py-2.5">
            <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-[#7B8FF7] text-[11px] font-bold text-white">
              {initials || <GraduationCap className="h-4 w-4" />}
            </div>
            <div className="min-w-0 flex-1">
              <p className="truncate text-[12px] font-semibold text-sidebar-foreground">
                {user?.firstName} {user?.lastName}
              </p>
              <p className="truncate text-[10px] text-sidebar-muted/80 capitalize">
                {roleName.toLowerCase()}
              </p>
            </div>
          </div>
        )}
      </div>
    </aside>
  );
}
