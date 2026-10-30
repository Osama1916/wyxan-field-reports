/** ISO-8601 UTC timestamps for durable local rows. */
export function nowIso(): string {
  return new Date().toISOString();
}
