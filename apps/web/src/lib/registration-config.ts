export function isPublicRegistrationAllowed(): boolean {
  return (
    process.env.NEXT_PUBLIC_ALLOW_PUBLIC_REGISTRATION === 'true'
    || process.env.ALLOW_PUBLIC_REGISTRATION === 'true'
    || process.env.NODE_ENV !== 'production'
  );
}

export function isInviteOnlyRegistration(): boolean {
  return !isPublicRegistrationAllowed();
}
