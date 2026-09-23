import { ConfigService } from '@nestjs/config';
import { ForbiddenException } from '@nestjs/common';
import { normalizeInviteEmail } from './registration-invite.util';

export function isPublicRegistrationAllowed(config: ConfigService): boolean {
  const explicit = config.get<string>('ALLOW_PUBLIC_REGISTRATION');
  if (explicit === 'true') return true;
  if (explicit === 'false') return false;
  return config.get('NODE_ENV') !== 'production';
}

export function assertAllowedRegistrationEmail(config: ConfigService, email: string) {
  const raw = config.get<string>('ALLOWED_REGISTRATION_EMAIL_DOMAINS');
  if (!raw?.trim()) return;

  const domains = raw
    .split(',')
    .map((d) => d.trim().toLowerCase())
    .filter(Boolean);
  if (domains.length === 0) return;

  const normalized = normalizeInviteEmail(email);
  const at = normalized.lastIndexOf('@');
  if (at < 0) {
    throw new ForbiddenException('Use your school email address to register');
  }
  const domain = normalized.slice(at + 1);
  if (!domains.includes(domain)) {
    throw new ForbiddenException('Registration is limited to approved school email domains');
  }
}
