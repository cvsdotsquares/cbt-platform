'use client';

import Link from 'next/link';
import { ArrowLeft, LogOut } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Logo } from '@/components/layout/logo';
import { ThemeToggle } from '@/components/layout/theme-toggle';
import { UserGuide } from '@/components/guide/user-guide';
import { CANDIDATE_GUIDE } from '@/components/guide/guide-content';
import { useRequireCandidate } from '@/hooks/use-auth';
import { useAuthStore } from '@/stores/auth-store';
import { authApi } from '@/lib/api';

export default function CandidateHelpPage() {
  const { ready } = useRequireCandidate();
  const { logout, accessToken } = useAuthStore();

  if (!ready) return null;

  return (
    <div className="min-h-screen mesh-bg">
      <header className="sticky top-0 z-40 border-b border-border/60 bg-card/60 backdrop-blur-xl">
        <div className="mx-auto flex max-w-6xl items-center justify-between gap-2 px-4 py-3 sm:px-6 sm:py-4">
          <Logo />
          <div className="flex items-center gap-1 sm:gap-2">
            <Button variant="outline" size="sm" asChild>
              <Link href="/my-exams">
                <ArrowLeft className="mr-1.5 h-4 w-4" />
                Portal
              </Link>
            </Button>
            <ThemeToggle />
            <Button
              variant="ghost"
              size="sm"
              className="px-2 sm:px-3"
              onClick={async () => {
                if (accessToken) await authApi.logout(accessToken).catch(() => {});
                await logout();
                window.location.href = '/login';
              }}
            >
              <LogOut className="h-4 w-4 sm:mr-2" />
              <span className="hidden sm:inline">Sign out</span>
            </Button>
          </div>
        </div>
      </header>

      <main className="mx-auto max-w-6xl px-4 py-6 animate-fade-in sm:px-6 sm:py-10">
        <UserGuide guide={CANDIDATE_GUIDE} showHeader={false} />
      </main>
    </div>
  );
}
