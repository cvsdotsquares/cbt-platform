'use client';

import { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { authApi } from '@/lib/api';
import { useAuthStore } from '@/stores/auth-store';
import { redirectAfterLogin } from '@/lib/auth-session';
import { normalizeRoles } from '@/lib/roles';

export default function MfaPage() {
  const router = useRouter();
  const setAuth = useAuthStore((s) => s.setAuth);
  const [mfaToken, setMfaToken] = useState('');
  const [totpCode, setTotpCode] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    const stored = sessionStorage.getItem('mfa-token');
    if (stored) setMfaToken(stored);
    else router.replace('/login');
  }, [router]);

  async function handleVerify(e: React.FormEvent) {
    e.preventDefault();
    if (!mfaToken) return;
    setError('');
    setLoading(true);
    try {
      const result = await authApi.verifyMfa({ mfaToken, totpCode }) as {
        accessToken: string;
        refreshToken: string;
        user: { id: string; email: string; firstName: string; lastName: string; roles: string[]; tenantId: string; mfaEnabled: boolean };
      };
      sessionStorage.removeItem('mfa-token');
      const roles = normalizeRoles(result.user.roles);
      const isAdminUser = await setAuth({ ...result.user, roles } as never, result.accessToken, result.refreshToken);
      redirectAfterLogin(isAdminUser);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Verification failed');
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-background p-4">
      <Card className="w-full max-w-md">
        <CardHeader className="text-center">
          <CardTitle className="text-2xl">Two-Factor Authentication</CardTitle>
          <CardDescription>Enter the 6-digit code from your authenticator app</CardDescription>
        </CardHeader>
        <CardContent>
          <form onSubmit={handleVerify} className="space-y-4">
            {error && <div className="rounded-md bg-destructive/10 p-3 text-sm text-destructive">{error}</div>}
            <Input
              type="text"
              inputMode="numeric"
              pattern="[0-9]{6}"
              maxLength={6}
              placeholder="000000"
              value={totpCode}
              onChange={(e) => setTotpCode(e.target.value.replace(/\D/g, ''))}
              className="text-center text-2xl tracking-widest"
              required
              autoFocus
            />
            <Button type="submit" className="w-full" disabled={loading || totpCode.length !== 6}>
              {loading ? 'Verifying...' : 'Verify & Continue'}
            </Button>
          </form>
        </CardContent>
      </Card>
    </div>
  );
}
