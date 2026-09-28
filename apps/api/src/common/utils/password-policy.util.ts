import { BadRequestException } from '@nestjs/common';

export function assertStrongPassword(password: string) {
  if (password.length < 8 || password.length > 128) {
    throw new BadRequestException('Password must be 8–128 characters.');
  }
  if (!/[a-z]/.test(password)) {
    throw new BadRequestException('Password must include a lowercase letter.');
  }
  if (!/[A-Z]/.test(password)) {
    throw new BadRequestException('Password must include an uppercase letter.');
  }
  if (!/[0-9]/.test(password)) {
    throw new BadRequestException('Password must include a number.');
  }
  if (!/[^A-Za-z0-9]/.test(password)) {
    throw new BadRequestException('Password must include a special character.');
  }
}
