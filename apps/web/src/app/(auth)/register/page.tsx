'use client';

import { Suspense, useEffect, useState } from 'react';
import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { authApi } from '@/lib/api';
import { useAuthStore } from '@/stores/auth-store';
import { redirectAfterLogin } from '@/lib/auth-session';
import { normalizeRoles } from '@/lib/roles';
import { Logo } from '@/components/layout/logo';
import { UserPlus } from 'lucide-react';
import { isInviteOnlyRegistration, isPublicRegistrationAllowed } from '@/lib/registration-config';
import { validatePasswordConfirmation } from '@/lib/password-validation';

function RegisterForm() {
  const searchParams = useSearchParams();
  const inviteCode = searchParams.get('invite')?.trim() ?? '';
  const setAuth = useAuthStore((s) => s.setAuth);
  const [form, setForm] = useState({ firstName: '', lastName: '', email: '', password: '', confirmPassword: '' });
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const [inviteLoading, setInviteLoading] = useState(Boolean(inviteCode));
  const [inviteValid, setInviteValid] = useState(!isInviteOnlyRegistration());
  const [emailLocked, setEmailLocked] = useState(false);

  useEffect(() => {
    if (!inviteCode) {
      if (isInviteOnlyRegistration()) {
        setInviteValid(false);
        setInviteLoading(false);
      }
      return;
    }

    let cancelled = false;
    const controller = new AbortController();
    const timeout = window.setTimeout(() => controller.abort(), 20_000);
    setInviteLoading(true);
    authApi
      .validateInvite(inviteCode, { signal: controller.signal })
      .then((data) => {
        if (cancelled) return;
        setInviteValid(true);
        setForm((prev) => ({
          ...prev,
          email: data.email,
          firstName: data.firstName?.trim() || prev.firstName,
          lastName: data.lastName?.trim() || prev.lastName,
        }));
        setEmailLocked(true);
      })
      .catch((err: unknown) => {
        if (cancelled) return;
        setInviteValid(false);
        const aborted = err instanceof DOMException && err.name === 'AbortError';
        setError(
          aborted
            ? 'Could not reach the server to verify your invite. Ensure the API is running on port 8000, then refresh this page.'
            : 'This invite link is invalid or has expired. Ask your school for a new one.',
        );
      })
      .finally(() => {
        window.clearTimeout(timeout);
        setInviteLoading(false);
      });

    return () => {
      cancelled = true;
      controller.abort();
      window.clearTimeout(timeout);
    };
  }, [inviteCode]);

  function validateForm() {
    const firstName = form.firstName.trim();
    const lastName = form.lastName.trim();

    if (!firstName || !lastName) {
      setError('First name and last name are required.');
      return false;
    }

    if (isInviteOnlyRegistration() && !inviteCode) {
      setError('You need an invite link from your school to create an account.');
      return false;
    }

    const passwordCheck = validatePasswordConfirmation(form.password, form.confirmPassword);
    if (!passwordCheck.ok) {
      setError(passwordCheck.message);
      return false;
    }

    return true;
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError('');

    if (!validateForm() || !inviteValid) {
      return;
    }

    setLoading(true);
    try {
      const payload = {
        firstName: form.firstName.trim(),
        lastName: form.lastName.trim(),
        email: form.email.trim().toLowerCase(),
        password: form.password,
        inviteCode: inviteCode || undefined,
      };

      await authApi.register(payload);
      const result = await authApi.login({
        email: payload.email,
        password: payload.password,
      });
      if (!result.accessToken || !result.refreshToken || !result.user) {
        throw new Error('Account created, but sign-in failed. Please sign in manually.');
      }
      const roles = normalizeRoles(result.user.roles);
      await setAuth({ ...result.user, roles } as never, result.accessToken, result.refreshToken);
      redirectAfterLogin(roles);
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Unable to create student';
      const normalized = message.toLowerCase();
      setError(
        normalized.includes('email') && normalized.includes('already')
          ? 'Email already exists.'
          : message,
      );
    } finally {
      setLoading(false);
    }
  }

  if (inviteLoading) {
    return (
      <p className="text-center text-sm text-muted-foreground">Checking your invite…</p>
    );
  }

  if (!inviteValid) {
    return (
      <div className="space-y-4 rounded-xl border bg-card p-6 text-center shadow-card sm:p-8">
        <p className="text-sm text-muted-foreground">
          {isInviteOnlyRegistration()
            ? 'Student signup is invite-only. Use the link from your school or contact the administrator.'
            : 'Unable to open registration.'}
        </p>
        <Button asChild variant="outline" className="w-full">
          <Link href="/login">Back to sign in</Link>
        </Button>
      </div>
    );
  }

  return (
    <>
      <div className="space-y-2 text-center">
        <h2 className="text-2xl font-bold tracking-tight">Create your account</h2>
        <p className="text-muted-foreground">
          {inviteCode
            ? 'Complete signup with your school invite'
            : isPublicRegistrationAllowed()
              ? 'Register as a student to access examinations'
              : 'Register with your school invite'}
        </p>
      </div>

      <form onSubmit={handleSubmit} className="space-y-5 rounded-xl border bg-card p-5 shadow-card sm:p-8">
        {error && (
          <div className="rounded-lg border border-destructive/20 bg-destructive/10 px-4 py-3 text-sm text-destructive">{error}</div>
        )}
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <div className="space-y-2">
            <Label>
              First name
              <span className="ml-1 text-destructive">*</span>
            </Label>
            <Input placeholder="John" value={form.firstName} onChange={(e) => setForm({ ...form, firstName: e.target.value })} required aria-required="true" />
          </div>
          <div className="space-y-2">
            <Label>
              Last name
              <span className="ml-1 text-destructive">*</span>
            </Label>
            <Input placeholder="Doe" value={form.lastName} onChange={(e) => setForm({ ...form, lastName: e.target.value })} required aria-required="true" />
          </div>
        </div>
        <div className="space-y-2">
          <Label>Email</Label>
          <Input
            type="email"
            placeholder="you@school.edu"
            value={form.email}
            onChange={(e) => setForm({ ...form, email: e.target.value })}
            required
            readOnly={emailLocked}
            className={emailLocked ? 'bg-muted/50' : undefined}
          />
        </div>
        <div className="space-y-2">
          <Label>Password</Label>
          <Input
            type="password"
            placeholder="8+ chars, upper, lower, number, symbol"
            value={form.password}
            onChange={(e) => setForm({ ...form, password: e.target.value })}
            required
            minLength={8}
            autoComplete="new-password"
          />
          <p className="text-xs text-muted-foreground">
            Use at least 8 characters with uppercase, lowercase, a number, and a special character.
          </p>
        </div>
        <div className="space-y-2">
          <Label>Confirm password</Label>
          <Input
            type="password"
            placeholder="Re-enter your password"
            value={form.confirmPassword}
            onChange={(e) => setForm({ ...form, confirmPassword: e.target.value })}
            required
            minLength={8}
            autoComplete="new-password"
          />
        </div>
        <Button type="submit" className="w-full shadow-sm" size="lg" disabled={loading}>
          <UserPlus className="mr-2 h-4 w-4" />
          {loading ? 'Creating account...' : 'Create account'}
        </Button>
      </form>

      <p className="text-center text-sm text-muted-foreground">
        Already have an account?{' '}
        <Link href="/login" className="font-medium text-primary hover:underline">Sign in</Link>
      </p>
    </>
  );
}

export default function RegisterPage() {
  return (
    <div className="flex min-h-screen items-center justify-center mesh-bg p-4 sm:p-6">
      <div className="w-full max-w-md space-y-6 sm:space-y-8">
        <div className="flex justify-center"><Logo /></div>
        <Suspense fallback={<p className="text-center text-sm text-muted-foreground">Loading…</p>}>
          <RegisterForm />
        </Suspense>
      </div>
    </div>
  );
}
