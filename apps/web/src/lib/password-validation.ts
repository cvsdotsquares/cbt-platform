export type PasswordValidationResult = { ok: true } | { ok: false; message: string };

/** School signup password policy: length, mixed case, digit, special char. */
export function validatePassword(password: string): PasswordValidationResult {
  if (password.length < 8) {
    return { ok: false, message: 'Password must be at least 8 characters.' };
  }
  if (password.length > 128) {
    return { ok: false, message: 'Password must be at most 128 characters.' };
  }
  if (!/[a-z]/.test(password)) {
    return { ok: false, message: 'Include at least one lowercase letter.' };
  }
  if (!/[A-Z]/.test(password)) {
    return { ok: false, message: 'Include at least one uppercase letter.' };
  }
  if (!/[0-9]/.test(password)) {
    return { ok: false, message: 'Include at least one number.' };
  }
  if (!/[^A-Za-z0-9]/.test(password)) {
    return { ok: false, message: 'Include at least one special character (e.g. !@#$).' };
  }
  return { ok: true };
}

export function validatePasswordConfirmation(password: string, confirm: string): PasswordValidationResult {
  if (password !== confirm) {
    return { ok: false, message: 'Passwords do not match.' };
  }
  return validatePassword(password);
}
