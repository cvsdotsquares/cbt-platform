'use client';

import { useEffect, useMemo, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Check, ChevronDown, RotateCcw, Search, X } from 'lucide-react';
import { PageHeader } from '@/components/layout/page-header';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { rolePermissionsApi, type RolePermissionMatrix } from '@/lib/api';
import { useRequireAuth } from '@/hooks/use-auth';
import { useAuthStore } from '@/stores/auth-store';
import { normalizeRoles } from '@/lib/roles';
import { toast } from '@/hooks/use-toast';
import { TableSkeleton } from '@/components/ui/skeleton';
import { cn } from '@/lib/utils';

const PRIMARY_ACTIONS = ['View', 'Create', 'Edit', 'Delete', 'Approve'] as const;

const ACTION_HELP: Record<string, string> = {
  View: 'Open and see records',
  Create: 'Add new records',
  Edit: 'Change existing records',
  Delete: 'Remove records',
  Approve: 'Sign off or approve',
  Invite: 'Send a student invite',
  'Verify KYC': 'Approve identity documents',
  Publish: 'Release to students',
  Schedule: 'Set the test window',
  Assign: 'Add a class to the test',
  Answers: 'Open submitted answers',
  Grade: 'Score open answers',
  Rank: 'Calculate ranks',
  Upload: 'Add a book or file',
  Topics: 'Open topic progress',
  Manage: 'Change this area',
  Generate: 'Create a class test',
  Monitor: 'Watch a live test',
  Violations: 'Review security alerts',
};

const GROUPS: { key: string; label: string; modules: string[] }[] = [
  { key: 'core', label: 'Core', modules: ['analytics', 'learning'] },
  { key: 'teaching', label: 'Teaching', modules: ['students', 'classes', 'syllabus', 'books'] },
  { key: 'assessment', label: 'Assessments', modules: ['tests', 'questions', 'results', 'ai'] },
  { key: 'monitoring', label: 'Monitoring', modules: ['monitoring'] },
];

type ModuleRow = RolePermissionMatrix['modules'][number];

function sameSet(a: string[], b: string[]) {
  if (a.length !== b.length) return false;
  const right = new Set(b);
  return a.every((code) => right.has(code));
}

function viewCodeFor(modules: ModuleRow[], code: string) {
  const module = modules.find((item) => Object.values(item.cells).includes(code));
  return module?.cells.View;
}

const ROLE_SUBTITLE: Record<string, string> = {
  TEACHER: 'Class teacher',
  INSTITUTE_ADMIN: 'Institute staff',
};

function initialsOf(label: string) {
  const parts = label.trim().split(/\s+/).filter(Boolean);
  if (!parts.length) return '?';
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return `${parts[0][0]}${parts[1][0]}`.toUpperCase();
}

export default function RolePermissionsPage() {
  const { accessToken, ready } = useRequireAuth(true);
  const user = useAuthStore((s) => s.user);
  const router = useRouter();
  const searchParams = useSearchParams();
  const queryClient = useQueryClient();
  const isSuperAdmin = normalizeRoles(user?.roles).includes('SUPER_ADMIN');
  const requestedRole = (searchParams.get('role') || 'TEACHER').toUpperCase();
  const [query, setQuery] = useState('');
  const [closedGroups, setClosedGroups] = useState<Record<string, boolean>>({});
  const [activeGroup, setActiveGroup] = useState<string | null>(null);

  useEffect(() => {
    if (!ready || !user) return;
    if (!isSuperAdmin) router.replace('/dashboard');
  }, [ready, user, isSuperAdmin, router]);

  const { data, isLoading } = useQuery({
    queryKey: ['role-permissions'],
    queryFn: () => rolePermissionsApi.matrix(accessToken!),
    enabled: ready && !!accessToken && isSuperAdmin,
  });

  const selectedRole = data?.roles.some((role) => role.name === requestedRole)
    ? requestedRole
    : 'TEACHER';
  const saved = data?.granted[selectedRole] ?? [];
  const isCustom = !!data?.customized?.[selectedRole];
  const [draft, setDraft] = useState<string[] | null>(null);
  const granted = draft ?? saved;
  const dirty = draft != null && !sameSet(draft, saved);

  useEffect(() => {
    setDraft(null);
  }, [selectedRole]);

  useEffect(() => {
    if (!searchParams.get('teacher')) return;
    const params = new URLSearchParams(searchParams.toString());
    params.delete('teacher');
    const query = params.toString();
    router.replace(query ? `/dashboard/permissions?${query}` : '/dashboard/permissions');
  }, [router, searchParams]);

  const saveMutation = useMutation({
    mutationFn: (permissions: string[]) => rolePermissionsApi.save(accessToken!, selectedRole, permissions),
    onSuccess: (next) => {
      queryClient.setQueryData(['role-permissions'], next);
      queryClient.invalidateQueries({ queryKey: ['effective-permissions'] });
      setDraft(null);
      toast({ title: 'Role permissions saved', variant: 'success' });
    },
    onError: (e: Error) => toast({ title: 'Could not save permissions', description: e.message, variant: 'destructive' }),
  });

  const resetMutation = useMutation({
    mutationFn: () => rolePermissionsApi.reset(accessToken!, selectedRole),
    onSuccess: (next) => {
      queryClient.setQueryData(['role-permissions'], next);
      queryClient.invalidateQueries({ queryKey: ['effective-permissions'] });
      setDraft(null);
      toast({ title: 'Restored default permissions', variant: 'success' });
    },
    onError: (e: Error) => toast({ title: 'Could not reset permissions', description: e.message, variant: 'destructive' }),
  });

  const roleMeta = data?.roles.find((role) => role.name === selectedRole);
  const needle = query.trim().toLowerCase();

  const grouped = useMemo(() => {
    if (!data) return [];
    const byKey = new Map(data.modules.map((module) => [module.key, module]));
    return GROUPS.map((group) => ({
      ...group,
      modules: group.modules
        .map((key) => byKey.get(key))
        .filter((module): module is ModuleRow => !!module)
        .filter((module) => !needle || module.label.toLowerCase().includes(needle) || module.key.includes(needle)),
    })).filter((group) => group.modules.length > 0);
  }, [data, needle]);

  function selectRole(name: string) {
    const params = new URLSearchParams(searchParams.toString());
    params.set('role', name.toLowerCase());
    params.delete('teacher');
    router.replace(`/dashboard/permissions?${params.toString()}`);
  }

  function toggle(code: string, locked: boolean) {
    if (locked) return;
    const current = new Set(draft ?? saved);
    if (current.has(code)) {
      current.delete(code);
    } else {
      current.add(code);
      const view = viewCodeFor(data?.modules ?? [], code);
      if (view) current.add(view);
    }
    setDraft([...current]);
  }

  if (!ready || !isSuperAdmin) return null;

  return (
    <div className="space-y-5">
      <PageHeader
        title="Role Permissions"
        highlight="Permissions"
        badge="Super Admin"
        description={roleMeta?.description || 'Choose what this role can open, create, and change.'}
      >
        <div className="flex flex-wrap gap-2">
          <Button
            variant="outline"
            disabled={!isCustom || resetMutation.isPending || saveMutation.isPending}
            onClick={() => resetMutation.mutate()}
          >
            <RotateCcw className="mr-2 h-4 w-4" />
            Reset defaults
          </Button>
          <Button
            disabled={!dirty || saveMutation.isPending}
            onClick={() => draft && saveMutation.mutate(draft)}
          >
            Save changes
          </Button>
        </div>
      </PageHeader>

      <section className="rounded-2xl border bg-card px-5 py-5 shadow-sm">
        <h2 className="text-base font-semibold">Select role</h2>
        <p className="mt-1 text-sm text-muted-foreground">
          Pick who you are configuring — permissions apply to every user with that role
        </p>
        <div className="mt-4 grid gap-3 sm:grid-cols-2">
          {(data?.roles ?? [{ name: 'TEACHER', label: 'Teacher', description: '' }]).map((role) => (
            <PickCard
              key={role.name}
              title={role.label}
              subtitle={ROLE_SUBTITLE[role.name] || role.description}
              initials={initialsOf(role.label)}
              selected={role.name === selectedRole}
              onClick={() => selectRole(role.name)}
            />
          ))}
        </div>
      </section>

      <section className="rounded-2xl border bg-card px-5 py-4 shadow-sm">
        <h2 className="text-sm font-semibold">What each permission means</h2>
        <div className="mt-3 grid gap-x-8 gap-y-2 text-sm text-muted-foreground sm:grid-cols-2">
          <p><span className="font-semibold text-foreground">View</span> — open and see records. Allowing any other permission in that module turns View on.</p>
          <p><span className="font-semibold text-foreground">Edit</span> — change existing items</p>
          <p><span className="font-semibold text-foreground">Create</span> — add new items</p>
          <p><span className="font-semibold text-foreground">Delete</span> — remove items</p>
          <p className="sm:col-span-2"><span className="font-semibold text-foreground">Approve</span> — sign off a step, such as question approval or KYC. Shown only on modules that support it.</p>
        </div>
      </section>

      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex flex-wrap items-center gap-4 text-sm">
          <LegendMark tone="saved" label="Allowed" />
          <span className="inline-flex items-center gap-2">
            <span className="inline-flex h-4 w-4 items-center justify-center rounded-[4px] border border-rose-300 bg-white text-rose-700">
              <X className="h-3 w-3" />
            </span>
            Not allowed
          </span>
        </div>
        <div className="relative w-full sm:w-64">
          <Search className="absolute left-3 top-2.5 h-4 w-4 text-muted-foreground" />
          <Input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search modules..."
            className="pl-9"
          />
        </div>
      </div>

      {isLoading || !data ? (
        <TableSkeleton rows={6} />
      ) : (
        <div className="space-y-4">
          {grouped.map((group) => {
            const closed = closedGroups[group.key] && !needle;
            const selected = activeGroup === group.key;
            return (
              <section
                key={group.key}
                className={cn(
                  'overflow-visible rounded-2xl border bg-card shadow-sm transition-all duration-200',
                  selected
                    ? 'border-primary bg-primary/[0.07]'
                    : 'border-border',
                )}
              >
                <button
                  type="button"
                  aria-pressed={selected}
                  className="flex w-full items-center justify-between px-5 py-4 text-left"
                  onClick={() => {
                    setActiveGroup(group.key);
                    setClosedGroups((current) => ({ ...current, [group.key]: !current[group.key] }));
                  }}
                >
                  <span>
                    <span className="block text-base font-semibold">{group.label}</span>
                    <span className="text-xs text-muted-foreground">{group.modules.length} modules</span>
                  </span>
                  <ChevronDown className={cn('h-4 w-4 text-muted-foreground transition-transform', closed && '-rotate-90')} />
                </button>
                {!closed && group.modules.map((module) => (
                  <ModuleBlock
                    key={module.key}
                    module={module}
                    granted={granted}
                    onToggle={toggle}
                  />
                ))}
              </section>
            );
          })}
          {!grouped.length && (
            <p className="rounded-2xl border bg-card px-5 py-8 text-center text-sm text-muted-foreground">
              No modules match that search.
            </p>
          )}
        </div>
      )}
    </div>
  );
}

function PickCard({
  title,
  subtitle,
  initials,
  selected,
  tone = 'bg-slate-100 text-slate-600',
  badge,
  onClick,
}: {
  title: string;
  subtitle: string;
  initials: string;
  selected: boolean;
  tone?: string;
  badge?: string;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      aria-pressed={selected}
      onClick={onClick}
      className={cn(
        'flex w-full items-center gap-3 rounded-2xl border px-4 py-3.5 text-left shadow-sm transition-all duration-200',
        'hover:-translate-y-0.5 hover:border-primary/40 hover:shadow-md',
        selected
          ? 'border-primary bg-primary/[0.07] ring-2 ring-primary/15'
          : 'border-border bg-background',
      )}
    >
      <span
        className={cn(
          'flex h-11 w-11 shrink-0 items-center justify-center rounded-full text-xs font-bold tracking-wide',
          selected ? 'bg-emerald-100 text-emerald-700' : tone,
        )}
      >
        {initials}
      </span>
      <span className="min-w-0 flex-1">
        <span className="flex items-center gap-2">
          <span className="truncate text-sm font-semibold">{title}</span>
          {badge && (
            <span className="shrink-0 rounded-full bg-amber-100 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-amber-800">
              {badge}
            </span>
          )}
        </span>
        <span className="mt-0.5 block truncate text-xs text-muted-foreground">{subtitle}</span>
      </span>
      <span
        className={cn(
          'flex h-6 w-6 shrink-0 items-center justify-center rounded-full border transition-colors',
          selected
            ? 'border-primary bg-primary text-primary-foreground'
            : 'border-border bg-card text-transparent',
        )}
        aria-hidden
      >
        <Check className="h-3.5 w-3.5" strokeWidth={3} />
      </span>
    </button>
  );
}

function LegendMark({ tone, label }: { tone: 'default' | 'saved' | 'unsaved'; label: string }) {
  return (
    <span className="inline-flex items-center gap-2">
      <span
        className={cn(
          'inline-flex h-4 w-4 items-center justify-center rounded-[4px] border',
          tone === 'default' && 'border-emerald-500 text-emerald-600',
          tone === 'saved' && 'border-blue-600 bg-blue-600 text-white',
          tone === 'unsaved' && 'border-amber-800 bg-amber-800 text-white',
        )}
      >
        <Check className="h-3 w-3" />
      </span>
      {label}
    </span>
  );
}

function ModuleBlock({
  module,
  granted,
  onToggle,
}: {
  module: ModuleRow;
  granted: string[];
  onToggle: (code: string, locked: boolean) => void;
}) {
  const entries = Object.entries(module.cells);
  const primary = PRIMARY_ACTIONS
    .map((action) => ({ action, code: module.cells[action] }))
    .filter((item): item is { action: typeof PRIMARY_ACTIONS[number]; code: string } => !!item.code);
  const features = entries.filter(([action]) => !PRIMARY_ACTIONS.includes(action as typeof PRIMARY_ACTIONS[number]));
  const accessGranted = entries.some(([, code]) => granted.includes(code));

  return (
    <div className="border-t px-5 py-5">
      <div className="mb-4 flex items-start justify-between gap-3">
        <div>
          <h3 className="font-semibold">{module.label}</h3>
          <p className="text-xs text-muted-foreground">{module.key}</p>
        </div>
        {accessGranted && (
          <span className="rounded-full bg-emerald-50 px-2.5 py-1 text-xs font-semibold text-emerald-700">
            Access granted
          </span>
        )}
      </div>
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 xl:grid-cols-5">
        {primary.map(({ action, code }) => (
          <PermissionCard
            key={code}
            title={action}
            description={ACTION_HELP[action] || action}
            code={code}
            locked={false}
            granted={granted}
            onToggle={onToggle}
          />
        ))}
      </div>
      {features.length > 0 && (
        <div className="mt-4">
          <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">Features</p>
          <div className="flex flex-wrap gap-2">
            {features.map(([action, code]) => {
              const on = granted.includes(code);
              return (
                <button
                  key={code}
                  type="button"
                  onClick={() => onToggle(code, false)}
                  className={cn(
                    'inline-flex items-center gap-1.5 rounded-xl border px-3 py-2 text-xs font-medium shadow-sm transition-all duration-200',
                    'hover:-translate-y-0.5 hover:border-primary/40 hover:shadow-md',
                    on
                      ? 'border-primary/25 bg-primary/[0.06] text-foreground'
                      : 'border-rose-200 bg-rose-50 text-rose-950 dark:border-rose-800 dark:bg-rose-950/70 dark:text-rose-50',
                  )}
                >
                  <span className={cn(
                    'inline-flex h-3.5 w-3.5 items-center justify-center rounded-[3px] border',
                    on ? 'border-blue-600 bg-blue-600 text-white' : 'border-rose-300 bg-white text-rose-700 dark:border-rose-700 dark:bg-rose-950 dark:text-rose-200',
                  )}>
                    {on ? <Check className="h-2.5 w-2.5" /> : <X className="h-2.5 w-2.5" />}
                  </span>
                  {action}
                </button>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}

function PermissionCard({
  title,
  description,
  code,
  locked,
  granted,
  onToggle,
}: {
  title: string;
  description: string;
  code: string;
  locked: boolean;
  granted: string[];
  onToggle: (code: string, locked: boolean) => void;
}) {
  const on = locked || granted.includes(code);

  return (
    <button
      type="button"
      aria-disabled={locked}
      aria-pressed={on}
      onClick={() => onToggle(code, locked)}
      className={cn(
        'flex h-full min-h-[112px] flex-col rounded-2xl border px-4 py-3.5 text-left shadow-sm transition-all duration-200',
        'hover:-translate-y-0.5 hover:border-primary/60 hover:shadow-md',
        locked && 'cursor-default',
        on
          ? 'border-primary/40 bg-background text-card-foreground dark:border-primary/55'
          : 'border-rose-300 bg-rose-50 text-rose-950 dark:border-rose-400/80 dark:bg-rose-950/70 dark:text-rose-50',
      )}
    >
      <span className="flex items-start justify-between gap-2">
        <span className="text-sm font-semibold">{title}</span>
        <span
          className={cn(
            'inline-flex h-6 w-6 shrink-0 items-center justify-center rounded-md border',
            on
              ? 'border-primary bg-primary text-primary-foreground'
              : 'border-rose-300 bg-white text-rose-700 dark:border-rose-700 dark:bg-rose-950 dark:text-rose-200',
          )}
        >
          {on ? <Check className="h-3.5 w-3.5" strokeWidth={3} /> : <X className="h-3.5 w-3.5" />}
        </span>
      </span>
      <span className={cn(
        'mt-1.5 flex-1 text-xs leading-relaxed',
        on ? 'text-muted-foreground' : 'text-rose-800 dark:text-rose-200',
      )}>{description}</span>
      <span
        className={cn(
          'mt-3 inline-flex w-fit rounded-full px-2 py-0.5 text-[11px] font-semibold',
          on ? 'bg-emerald-50 text-emerald-800 dark:bg-emerald-950 dark:text-emerald-200' : 'bg-white text-rose-800 dark:bg-rose-900 dark:text-rose-100',
        )}
      >
        {locked ? 'Always on' : on ? 'Allowed' : 'Not allowed'}
      </span>
    </button>
  );
}
