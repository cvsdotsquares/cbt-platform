/** Exponential backoff delays for Render free-tier cold starts (total ~41s max). */
export const COLD_START_DELAYS_MS = [2_000, 4_000, 8_000, 12_000, 15_000] as const;
export const COLD_START_MAX_ATTEMPTS = COLD_START_DELAYS_MS.length;

function isRetryableStatus(status: number, raw: string): boolean {
  if (status >= 502 || status === 503) return true;
  const trimmed = raw.trimStart();
  return trimmed.startsWith('<!DOCTYPE') || trimmed.startsWith('<html');
}

export async function fetchWithColdStartRetry(
  url: string,
  init: RequestInit,
  isRetryable: (status: number, raw: string) => boolean = isRetryableStatus,
): Promise<Response> {
  let lastResponse: Response | null = null;
  for (let attempt = 0; attempt < COLD_START_MAX_ATTEMPTS; attempt++) {
    try {
      const response = await fetch(url, { ...init, cache: 'no-store' });
      lastResponse = response;
      if (response.ok) return response;
      const raw = await response.clone().text();
      if (!isRetryable(response.status, raw) || attempt === COLD_START_MAX_ATTEMPTS - 1) {
        return response;
      }
    } catch {
      if (attempt === COLD_START_MAX_ATTEMPTS - 1) throw new Error('upstream unavailable');
    }
    await new Promise((resolve) => setTimeout(resolve, COLD_START_DELAYS_MS[attempt]));
  }
  return lastResponse!;
}
