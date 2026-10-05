'use client';

import { QueryClientProvider } from '@tanstack/react-query';
import { ThemeProvider } from 'next-themes';
import { Toaster } from '@/components/ui/toaster';
import { AuthHydrationGate } from '@/components/auth/auth-hydration-gate';
import { TenantBranding } from '@/components/layout/tenant-branding';
import { getQueryClient } from '@/lib/query-client';

export function Providers({ children }: { children: React.ReactNode }) {
  const queryClient = getQueryClient();

  return (
    <QueryClientProvider client={queryClient}>
      <ThemeProvider attribute="class" defaultTheme="light" enableSystem disableTransitionOnChange>
        <AuthHydrationGate>
          <TenantBranding />
          {children}
        </AuthHydrationGate>
        <Toaster />
      </ThemeProvider>
    </QueryClientProvider>
  );
}
