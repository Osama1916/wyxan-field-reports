import {
  closeDatabase,
  initializeDatabase,
  type InitializeDatabaseResult,
} from './database';

/**
 * Process-wide startup gate so cold-start init (migrations + stale-job recovery)
 * runs at most once per JS process, even under React Strict Mode double-mount.
 */
let startupPromise: Promise<InitializeDatabaseResult> | null = null;

/**
 * Initialize the native local database exactly once per app process.
 * Stale upload-job recovery runs only inside this first successful init
 * (via initializeDatabase defaults) — not on later awaits of the same promise.
 */
export function startDatabase(): Promise<InitializeDatabaseResult> {
  if (!startupPromise) {
    startupPromise = initializeDatabase()
      .then(result => result)
      .catch(error => {
        startupPromise = null;
        throw error;
      });
  }
  return startupPromise;
}

/**
 * Clears the process-wide startup gate so a user Retry can open a fresh
 * connection. Closes any active connection first.
 */
export async function resetDatabaseStartup(): Promise<void> {
  startupPromise = null;
  await closeDatabase();
}
