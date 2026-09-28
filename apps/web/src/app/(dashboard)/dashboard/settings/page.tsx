'use client';

import { useState, useEffect } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { useAuthStore } from '@/stores/auth-store';
import { useRequireAuth } from '@/hooks/use-auth';
import { tenantsApi } from '@/lib/api';
import { applyTenantPrimaryColor } from '@/lib/tenant-branding';
import { Permission } from '@cbt/shared';
import { usePermissions } from '@/hooks/use-permissions';
import { PageHeader } from '@/components/layout/page-header';
import { toast } from '@/hooks/use-toast';
import {
  Settings, User, Palette, Building2, Mail, Shield, Check,
  Loader2, Sparkles,
} from 'lucide-react';

const COLOR_PRESETS = [
  { label: 'Royal Blue', value: '#2563eb' },
  { label: 'Violet', value: '#7c3aed' },
  { label: 'Emerald', value: '#059669' },
  { label: 'Rose', value: '#e11d48' },
  { label: 'Amber', value: '#d97706' },
  { label: 'Slate', value: '#475569' },
];

type TenantData = {
  name?: string;
  slug?: string;
  branding?: { primaryColor?: string };
};

function InfoRow({
  icon: Icon,
  label,
  value,
  mono,
}: {
  icon: React.ComponentType<{ className?: string }>;
  label: string;
  value: string;
  mono?: boolean;
}) {
  return (
    <div className="flex items-start gap-4 rounded-xl border border-border/50 bg-muted/20 px-4 py-3.5 transition-colors hover:bg-muted/30">
      <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-primary/10">
        <Icon className="h-4 w-4 text-primary" />
      </div>
      <div className="min-w-0 flex-1">
        <p className="text-[11px] font-bold uppercase tracking-wider text-muted-foreground">{label}</p>
        <p className={`mt-0.5 truncate text-sm font-semibold ${mono ? 'font-mono text-xs' : ''}`}>{value}</p>
      </div>
    </div>
  );
}

export default function SettingsPage() {
  const { accessToken } = useRequireAuth(true);
  const { user } = useAuthStore();
  const { can } = usePermissions();
  const queryClient = useQueryClient();
  const [primaryColor, setPrimaryColor] = useState('#2563eb');

  const canManageBranding = can(Permission.TENANT_BRANDING);

  const { data: tenant, isLoading: tenantLoading } = useQuery({
    queryKey: ['tenant', user?.tenantId],
    queryFn: () => tenantsApi.get(accessToken!, user!.tenantId) as Promise<TenantData>,
    enabled: !!accessToken && !!user?.tenantId && canManageBranding,
  });

  useEffect(() => {
    const color = tenant?.branding?.primaryColor;
    if (color) setPrimaryColor(color);
  }, [tenant]);

  const saveMutation = useMutation({
    mutationFn: () => {
      if (!accessToken || !user?.tenantId) {
        throw new Error('You must be signed in to save branding.');
      }
      return tenantsApi.updateBranding(accessToken, user.tenantId, { primaryColor });
    },
    onSuccess: async () => {
      applyTenantPrimaryColor(primaryColor);
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ['tenant', user?.tenantId] }),
        queryClient.invalidateQueries({ queryKey: ['tenant-branding'] }),
      ]);
      toast({
        title: 'Branding saved',
        description: 'Primary color applied across admin, teacher, and student portals.',
        variant: 'success',
      });
    },
    onError: (e: Error) =>
      toast({ title: 'Save failed', description: e.message, variant: 'destructive' }),
  });

  const initials = `${user?.firstName?.[0] || ''}${user?.lastName?.[0] || ''}`.toUpperCase();
  const roleCount = user?.roles?.length ?? 0;

  return (
    <div className="space-y-8">
      <PageHeader
        title="Institute Settings"
        highlight="Settings"
        description="Manage your profile, institute identity, and branding preferences"
        badge="Institute"
      />

      {/* Profile hero */}
      <div className="hero-banner">
        <div className="relative flex flex-col gap-6 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex items-center gap-5">
            <div className="flex h-16 w-16 items-center justify-center rounded-2xl gradient-primary text-xl font-bold text-white shadow-lg shadow-primary/25">
              {initials || 'U'}
            </div>
            <div className="space-y-2">
              <h2 className="text-xl font-bold tracking-tight sm:text-2xl">
                {user?.firstName} {user?.lastName}
              </h2>
              <p className="flex items-center gap-2 text-sm text-muted-foreground">
                <Mail className="h-3.5 w-3.5" />
                {user?.email}
              </p>
              <div className="flex flex-wrap gap-1.5">
                {user?.roles?.map((role) => (
                  <Badge key={role} variant="secondary" className="normal-case">
                    {role.replace(/_/g, ' ')}
                  </Badge>
                ))}
              </div>
            </div>
          </div>
          <div className="flex items-center gap-2 rounded-xl border border-emerald-500/20 bg-emerald-500/5 px-4 py-3">
            <span className="status-dot scale-90" />
            <div>
              <p className="text-xs font-bold text-emerald-600 dark:text-emerald-400">Account Active</p>
              <p className="text-[11px] text-muted-foreground">Signed in securely</p>
            </div>
          </div>
        </div>
      </div>

      {/* Quick stats */}
      <div className="grid grid-cols-2 gap-3 sm:gap-4 lg:grid-cols-3">
        {[
          { icon: Building2, label: 'Organization', value: tenant?.name || user?.tenantId || '—', accent: 'bg-blue-500/10 text-blue-600' },
          { icon: Shield, label: 'Assigned Roles', value: String(roleCount), accent: 'bg-violet-500/10 text-violet-600' },
          { icon: Settings, label: 'Tenant ID', value: user?.tenantId?.slice(0, 8) + '…' || '—', accent: 'bg-amber-500/10 text-amber-600' },
        ].map((stat) => (
          <Card key={stat.label} className="surface-card">
            <CardContent className="flex items-center gap-3 p-3 sm:gap-4 sm:p-5">
              <div className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-xl sm:h-11 sm:w-11 ${stat.accent}`}>
                <stat.icon className="h-4 w-4 sm:h-5 sm:w-5" />
              </div>
              <div className="min-w-0">
                <p className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground sm:text-[11px]">{stat.label}</p>
                <p className="truncate text-base font-bold sm:text-lg">{tenantLoading && stat.label === 'Organization' ? '…' : stat.value}</p>
              </div>
            </CardContent>
          </Card>
        ))}
      </div>

      <div className="grid gap-6 lg:grid-cols-5">
        {/* Account details */}
        <Card className="surface-card lg:col-span-2">
          <CardHeader className="border-b border-border/60 pb-4">
            <CardTitle className="flex items-center gap-2.5 text-base font-bold">
              <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-primary/10">
                <User className="h-4 w-4 text-primary" />
              </div>
              Account Details
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-3 pt-5">
            <InfoRow icon={User} label="Full Name" value={`${user?.firstName || ''} ${user?.lastName || ''}`.trim() || '—'} />
            <InfoRow icon={Mail} label="Email Address" value={user?.email || '—'} />
            <InfoRow icon={Building2} label="Organization Slug" value={tenant?.slug || user?.tenantId || '—'} mono />
            <InfoRow icon={Shield} label="Permissions" value={`${roleCount} role${roleCount !== 1 ? 's' : ''} assigned`} />
          </CardContent>
        </Card>

        {/* Branding */}
        <Card className="surface-card border-primary/20 lg:col-span-3">
          <CardHeader className="border-b border-border/60 pb-4">
            <CardTitle className="flex items-center gap-2.5 text-base font-bold">
              <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-violet-500/10">
                <Palette className="h-4 w-4 text-violet-600" />
              </div>
              Branding & Theme
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-6 pt-6">
            {!canManageBranding ? (
              <p className="rounded-xl border border-border/60 bg-muted/30 px-4 py-8 text-center text-sm text-muted-foreground">
                You don&apos;t have permission to update organization branding.
              </p>
            ) : (
              <>
                <div className="space-y-3">
                  <Label className="text-xs font-bold uppercase tracking-wider text-muted-foreground">Color Presets</Label>
                  <div className="flex flex-wrap gap-2.5">
                    {COLOR_PRESETS.map((preset) => (
                      <button
                        key={preset.value}
                        type="button"
                        title={preset.label}
                        onClick={() => setPrimaryColor(preset.value)}
                        className={`group relative h-10 w-10 rounded-xl border-2 transition-all hover:scale-105 ${
                          primaryColor === preset.value
                            ? 'border-foreground ring-2 ring-foreground/20 ring-offset-2 ring-offset-background'
                            : 'border-transparent hover:border-border'
                        }`}
                        style={{ backgroundColor: preset.value }}
                      >
                        {primaryColor === preset.value && (
                          <Check className="absolute inset-0 m-auto h-4 w-4 text-white drop-shadow" />
                        )}
                      </button>
                    ))}
                  </div>
                </div>

                <div className="grid gap-4 sm:grid-cols-2">
                  <div className="space-y-2">
                    <Label htmlFor="primary-color">Custom Color</Label>
                    <div className="flex items-center gap-3">
                      <div
                        className="h-12 w-12 shrink-0 rounded-xl border border-border shadow-sm"
                        style={{ backgroundColor: primaryColor }}
                      />
                      <Input
                        id="primary-color"
                        type="color"
                        value={primaryColor}
                        onChange={(e) => setPrimaryColor(e.target.value)}
                        className="h-12 flex-1 cursor-pointer p-1"
                      />
                    </div>
                    <p className="font-mono text-xs text-muted-foreground">{primaryColor.toUpperCase()}</p>
                  </div>

                  {/* Live preview */}
                  <div className="space-y-2">
                    <Label>Live Preview</Label>
                    <div className="overflow-hidden rounded-xl border border-border/60 bg-muted/20">
                      <div
                        className="flex items-center justify-between px-4 py-3 text-white"
                        style={{ background: `linear-gradient(135deg, ${primaryColor} 0%, ${primaryColor}cc 100%)` }}
                      >
                        <span className="text-sm font-bold">{tenant?.name || 'Your Organization'}</span>
                        <Sparkles className="h-4 w-4 opacity-80" />
                      </div>
                      <div className="space-y-3 p-4">
                        <div className="h-2 w-3/4 rounded-full bg-muted" />
                        <div className="h-2 w-1/2 rounded-full bg-muted" />
                        <button
                          type="button"
                          className="rounded-lg px-4 py-2 text-sm font-semibold text-white shadow-sm"
                          style={{ backgroundColor: primaryColor }}
                        >
                          Primary Button
                        </button>
                      </div>
                    </div>
                  </div>
                </div>

                <div className="flex items-center justify-between rounded-xl border border-border/50 bg-muted/20 px-4 py-3">
                  <p className="text-sm text-muted-foreground">
                    Applies to headers, buttons, and accent elements across your tenant portal.
                  </p>
                  <Button
                    onClick={() => saveMutation.mutate()}
                    disabled={saveMutation.isPending}
                    className="shrink-0"
                  >
                    {saveMutation.isPending ? (
                      <><Loader2 className="mr-2 h-4 w-4 animate-spin" /> Saving…</>
                    ) : (
                      'Save Branding'
                    )}
                  </Button>
                </div>
              </>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
