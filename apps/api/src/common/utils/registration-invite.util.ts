import { createHash, randomBytes } from 'crypto';

export function hashRegistrationInviteToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

export function generateRegistrationInviteToken(): string {
  return randomBytes(32).toString('base64url');
}

export function normalizeInviteEmail(email: string): string {
  return email.trim().toLowerCase();
}
