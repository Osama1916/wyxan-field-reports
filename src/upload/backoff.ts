/** Bounded exponential backoff with full-jitter. */

export const MAX_UPLOAD_ATTEMPTS = 8;
export const BACKOFF_BASE_MS = 1_000;
export const BACKOFF_MAX_MS = 5 * 60_000;

export function computeBackoffDelayMs(
  attemptCount: number,
  random: () => number = Math.random,
): number {
  const exponent = Math.max(0, attemptCount - 1);
  const raw = Math.min(
    BACKOFF_MAX_MS,
    BACKOFF_BASE_MS * 2 ** exponent,
  );
  // Full jitter in [0, raw], inclusive. Clamp so random() === 1 cannot exceed.
  return Math.min(raw, Math.floor(random() * (raw + 1)));
}

export function addMsToIso(iso: string, delayMs: number): string {
  return new Date(new Date(iso).getTime() + delayMs).toISOString();
}
