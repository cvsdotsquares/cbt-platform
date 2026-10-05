/** Turn API / validation error payloads into a single user-facing string. */
export function formatErrorDetail(value: unknown): string | null {
  if (value == null) return null;
  if (typeof value === 'string') {
    const trimmed = value.trim();
    return trimmed.length > 0 ? trimmed : null;
  }
  if (typeof value === 'number' || typeof value === 'boolean') {
    return String(value);
  }
  if (Array.isArray(value)) {
    const parts = value
      .map((item) => formatErrorDetail(item))
      .filter((part): part is string => Boolean(part));
    return parts.length > 0 ? parts.join(' ') : null;
  }
  if (typeof value === 'object') {
    const record = value as Record<string, unknown>;
    if (typeof record.msg === 'string') return formatErrorDetail(record.msg);
    if (typeof record.message === 'string') return formatErrorDetail(record.message);
  }
  return null;
}

export function formatApiErrorPayload(data: unknown): string {
  if (!data || typeof data !== 'object') return 'Request failed';
  const record = data as Record<string, unknown>;
  const nested =
    record.error && typeof record.error === 'object'
      ? (record.error as Record<string, unknown>).message
      : undefined;
  for (const candidate of [nested, record.message, record.detail, record.title]) {
    const text = formatErrorDetail(candidate);
    if (text) return text;
  }
  return 'Request failed';
}

const GENERIC_REACT_PREFIX = /^Minified React error #/i;

/** Message safe to show in UI (error boundary, toasts). */
export function getDisplayErrorMessage(error: unknown, fallback = 'Something went wrong'): string {
  if (typeof error === 'string') {
    const trimmed = error.trim();
    if (trimmed && !GENERIC_REACT_PREFIX.test(trimmed)) return trimmed;
  }
  if (error instanceof Error) {
    const trimmed = error.message?.trim();
    if (trimmed && !GENERIC_REACT_PREFIX.test(trimmed)) return trimmed;
  }
  return fallback;
}
