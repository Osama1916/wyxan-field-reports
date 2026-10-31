/**
 * App-wide signal: server-backed review data should be refetched via GET /reports.
 *
 * Upload code notifies here on successful delivery. UI screens subscribe without
 * the worker importing any React components or navigation.
 */

type ServerReviewRefreshListener = () => void;

const listeners = new Set<ServerReviewRefreshListener>();

/** Monotonic counter so a newly opened Review screen can detect pending refreshes. */
let refreshGeneration = 0;

export function getServerReviewRefreshGeneration(): number {
  return refreshGeneration;
}

/**
 * Notify subscribers that GET /reports should run again.
 * Safe to call when no listeners are mounted (generation still advances).
 */
export function requestServerReviewRefresh(): void {
  refreshGeneration += 1;
  for (const listener of listeners) {
    try {
      listener();
    } catch {
      // Listener failures must not break upload success handling.
    }
  }
}

export function subscribeServerReviewRefresh(
  listener: ServerReviewRefreshListener,
): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/** Test helper. */
export function resetServerReviewRefreshForTests(): void {
  listeners.clear();
  refreshGeneration = 0;
}
