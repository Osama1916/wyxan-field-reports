import {
  BACKOFF_BASE_MS,
  BACKOFF_MAX_MS,
  addMsToIso,
  computeBackoffDelayMs,
} from '../backoff';

describe('upload backoff', () => {
  test('computes bounded exponential delay with jitter in range', () => {
    const delay0 = computeBackoffDelayMs(1, () => 0);
    const delayMax = computeBackoffDelayMs(1, () => 0.999);
    expect(delay0).toBe(0);
    expect(delayMax).toBeLessThanOrEqual(BACKOFF_BASE_MS);

    const large = computeBackoffDelayMs(20, () => 1);
    expect(large).toBeLessThanOrEqual(BACKOFF_MAX_MS);
  });

  test('addMsToIso advances timestamps', () => {
    const base = '2026-01-01T00:00:00.000Z';
    expect(addMsToIso(base, 1500)).toBe('2026-01-01T00:00:01.500Z');
  });
});
