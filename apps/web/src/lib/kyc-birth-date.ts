/** How a KYC birth value should be shown. Always the year, never a placeholder day. */
export function kycBirthDateDisplay(
  value?: string | null,
  _precision?: string | null,
): { label: string; text: string } | null {
  const trimmed = value?.trim() ?? '';
  if (!trimmed) return null;

  const iso = /^(\d{4})-\d{2}-\d{2}$/.exec(trimmed);
  if (iso) return { label: 'Year of birth', text: iso[1] };

  const year = /\b(19\d{2}|20\d{2})\b/.exec(trimmed);
  if (year) return { label: 'Year of birth', text: year[1] };

  return { label: 'Year of birth', text: trimmed };
}
