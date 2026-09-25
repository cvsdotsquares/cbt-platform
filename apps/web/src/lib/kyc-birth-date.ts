/** How a KYC birth value should be shown. A year is not turned into 1 January. */
export function kycBirthDateDisplay(
  value?: string | null,
  precision?: string | null,
): { label: string; text: string } | null {
  const trimmed = value?.trim() ?? '';
  if (!trimmed) return null;

  if (precision === 'year' || /^\d{4}$/.test(trimmed)) {
    const year = trimmed.slice(0, 4);
    return { label: 'Year of birth', text: year };
  }

  const iso = /^(\d{4})-(\d{2})-(\d{2})$/.exec(trimmed);
  if (iso) {
    const [, year, month, day] = iso;
    if (precision !== 'full' && month === '01' && day === '01') {
      return { label: 'Year of birth', text: year };
    }
    return { label: 'Date of birth', text: `${day}/${month}/${year}` };
  }

  const placeholder = /^(?:0?1[./-]0?1[./-](\d{4})|(\d{4})[./-]0?1[./-]0?1)$/.exec(trimmed);
  if (precision !== 'full' && placeholder) {
    return { label: 'Year of birth', text: placeholder[1] ?? placeholder[2] };
  }

  return { label: 'Date of birth', text: trimmed };
}
