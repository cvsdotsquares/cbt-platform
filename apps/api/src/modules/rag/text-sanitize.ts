/**
 * Sanitize text before PostgreSQL storage.
 * PDF parsers can emit null bytes (0x00) which Postgres rejects in UTF-8 text columns.
 */
export function sanitizeTextForDb(text: string): string {
  if (!text) return '';

  const bytes = Buffer.from(text, 'utf8');
  const clean = Buffer.alloc(bytes.length);
  let j = 0;
  for (let i = 0; i < bytes.length; i++) {
    if (bytes[i] !== 0) clean[j++] = bytes[i];
  }

  return clean
    .subarray(0, j)
    .toString('utf8')
    .replace(/[\x01-\x08\x0B\x0C\x0E-\x1F\x7F]/g, ' ')
    .replace(/\uFFFD/g, '')
    .replace(/\uFEFF/g, '');
}

/** Sanitize strings stored in JSON metadata fields. */
export function sanitizeMetadataValue(value: unknown): unknown {
  if (typeof value === 'string') return sanitizeTextForDb(value);
  if (Array.isArray(value)) return value.map(sanitizeMetadataValue);
  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>).map(([k, v]) => [k, sanitizeMetadataValue(v)]),
    );
  }
  return value;
}
