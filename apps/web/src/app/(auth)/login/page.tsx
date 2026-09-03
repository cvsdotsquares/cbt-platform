'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { authApi } from '@/lib/api';
import { useAuthStore } from '@/stores/auth-store';
import { normalizeRoles } from '@/lib/roles';
import { getSafeRedirectPath } from '@/lib/safe-redirect';
import { Logo } from '@/components/layout/logo';
import { ThemeToggle } from '@/components/layout/theme-toggle';
import { Eye, EyeOff } from 'lucide-react';

export default function LoginPage() {
  const router = useRouter();
  const [redirectTo, setRedirectTo] = useState<string | null>(null);
  const setAuth = useAuthStore((s) => s.setAuth);
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    setRedirectTo(getSafeRedirectPath(params.get('redirect')));
    const isLocal =
      window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1';
    if (isLocal) return;
    fetch('/api/v1/health/ready', { cache: 'no-store' }).catch(() => {});
  }, []);

  function readCredentials(form: HTMLFormElement) {
    const formData = new FormData(form);
    return {
      email: String(formData.get('email') ?? email).trim().toLowerCase(),
      password: String(formData.get('password') ?? password),
    };
  }

  async function loginWithCredentials(credentials: { email: string; password: string }) {
    setEmail(credentials.email);
    setPassword(credentials.password);
    setError('');
    setLoading(true);
    try {
      const store = useAuthStore.getState();
      if (store.isAuthenticated) {
        useAuthStore.setState({
          user: null,
          accessToken: null,
          refreshToken: null,
          isAuthenticated: false,
        });
        import('@/lib/auth-session').then(({ clearAuthSession }) => clearAuthSession().catch(() => {}));
      }
      const result = await authApi.login(credentials) as {
        mfaRequired?: boolean;
        mfaToken?: string;
        accessToken?: string;
        refreshToken?: string;
        user?: { id: string; email: string; firstName: string; lastName: string; roles: string[]; tenantId: string; mfaEnabled: boolean };
      };
      if (result.mfaRequired && result.mfaToken) {
        sessionStorage.setItem('mfa-token', result.mfaToken);
        router.push('/mfa');
        return;
      }
      if (result.accessToken && result.refreshToken && result.user) {
        const roles = normalizeRoles(result.user.roles);
        const isAdminUser = await setAuth({ ...result.user, roles } as never, result.accessToken, result.refreshToken);
        router.replace(redirectTo ?? (isAdminUser ? '/dashboard' : '/my-exams'));
        return;
      }
      setError('Login failed. Please try again.');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Login failed');
    } finally {
      setLoading(false);
    }
  }

  async function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    await loginWithCredentials(readCredentials(e.currentTarget));
  }

  async function fillDemo(role: 'teacher' | 'candidate') {
    const credentials =
      role === 'teacher'
        ? { email: 'teacher@example.com', password: 'Teacher@123' }
        : { email: 'candidate@example.com', password: 'Candidate@123' };
    await loginWithCredentials(credentials);
  }

  return (
    <div className="relative flex min-h-screen items-center justify-center mesh-bg p-4 sm:p-6">
      <div className="absolute right-4 top-4">
        <ThemeToggle />
      </div>
      <div className="w-full max-w-md space-y-6 sm:space-y-8">
        <div className="flex justify-center"><Logo /></div>
        <div className="space-y-2 text-center">
          <h2 className="text-2xl font-bold tracking-tight">Sign in</h2>
          <p className="text-muted-foreground">Use your institute email and password</p>
        </div>
        <form onSubmit={handleSubmit} className="space-y-5 rounded-xl border bg-card p-5 shadow-card sm:p-8">
          {error && (
            <div className="rounded-lg border border-destructive/20 bg-destructive/10 px-4 py-3 text-sm text-destructive">{error}</div>
          )}
          <div className="space-y-2">
            <Label htmlFor="email">Email</Label>
            <Input
              id="email"
              name="email"
              type="email"
              autoComplete="username"
              placeholder="you@institute.edu"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              required
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="password">Password</Label>
            <div className="relative">
              <Input
                id="password"
                name="password"
                type={showPassword ? 'text' : 'password'}
                autoComplete="current-password"
                placeholder="Min. 8 characters"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                className="pr-10"
                required
              />
              <button
                type="button"
                className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground"
                onClick={() => setShowPassword((v) => !v)}
                tabIndex={-1}
                aria-label={showPassword ? 'Hide password' : 'Show password'}
              >
                {showPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
              </button>
            </div>
          </div>
          <Button type="submit" className="w-full shadow-sm" size="lg" disabled={loading}>
            {loading ? 'Signing in…' : 'Sign in'}
          </Button>
          {process.env.NODE_ENV !== 'production' && (
            <div className="grid grid-cols-2 gap-2">
              <button type="button" disabled={loading} onClick={() => fillDemo('teacher')} className="rounded-lg border px-3 py-2 text-xs font-medium hover:bg-muted">
                Teacher demo
              </button>
              <button type="button" disabled={loading} onClick={() => fillDemo('candidate')} className="rounded-lg border px-3 py-2 text-xs font-medium hover:bg-muted">
                Student demo
              </button>
            </div>
          )}
        </form>
        {(process.env.NEXT_PUBLIC_ALLOW_PUBLIC_REGISTRATION === 'true' ||
          process.env.NODE_ENV !== 'production') && (
          <p className="text-center text-sm text-muted-foreground">
            Don&apos;t have an account?{' '}
            <Link href="/register" className="font-medium text-primary hover:underline">Create account</Link>
          </p>
        )}
      </div>
    </div>
  );
}
