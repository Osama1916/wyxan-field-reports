import {openOpSqliteDatabase} from './adapters';
import {DatabaseError, wrapDatabaseError} from './errors';
import {runMigrations} from './migrations';
import {
  recoverStaleUploadJobs,
  type RecoverStaleJobsResult,
} from './recoverStaleJobs';
import type {SqlDatabase} from './types';

export const DEFAULT_DATABASE_NAME = 'fieldreports.sqlite';

let activeDatabase: SqlDatabase | null = null;

export type InitializeDatabaseOptions = {
  name?: string;
  location?: string;
  /**
   * When true (default), recover stale in_progress upload jobs after migrations.
   */
  recoverStaleJobs?: boolean;
  /**
   * Inject an already-opened SqlDatabase (used by tests).
   */
  database?: SqlDatabase;
};

export type InitializeDatabaseResult = {
  database: SqlDatabase;
  appliedMigrations: number[];
  staleJobRecovery: RecoverStaleJobsResult | null;
};

/**
 * Opens (or reuses) the local SQLite database, runs versioned migrations,
 * and recovers stale upload jobs. SQLite is the source of truth for local reports.
 */
export async function initializeDatabase(
  options: InitializeDatabaseOptions = {},
): Promise<InitializeDatabaseResult> {
  const ownsConnection = options.database === undefined;
  let database: SqlDatabase | null = null;

  try {
    if (activeDatabase && ownsConnection) {
      await activeDatabase.close();
      activeDatabase = null;
    }

    database =
      options.database ??
      openOpSqliteDatabase({
        name: options.name ?? DEFAULT_DATABASE_NAME,
        location: options.location,
      });

    await database.execute('PRAGMA foreign_keys = ON');
    const appliedMigrations = await runMigrations(database);

    let staleJobRecovery: RecoverStaleJobsResult | null = null;
    if (options.recoverStaleJobs !== false) {
      staleJobRecovery = await recoverStaleUploadJobs(database);
    }

    activeDatabase = database;
    return {database, appliedMigrations, staleJobRecovery};
  } catch (error) {
    // Close only connections we opened. Callers retain ownership of injected DBs.
    // Never assign a failed connection to activeDatabase (assignment is success-only).
    if (
      ownsConnection &&
      database !== null &&
      database !== activeDatabase
    ) {
      try {
        await database.close();
      } catch {
        // Prefer the original initialization error.
      }
    }

    throw wrapDatabaseError(error, 'Failed to initialize local database');
  }
}

export function getDatabase(): SqlDatabase {
  if (!activeDatabase) {
    throw new DatabaseError(
      'Database is not initialized. Call initializeDatabase() first.',
    );
  }
  return activeDatabase;
}

export async function closeDatabase(): Promise<void> {
  if (!activeDatabase) {
    return;
  }
  try {
    await activeDatabase.close();
  } finally {
    activeDatabase = null;
  }
}

/** Test helper: replace the active connection without opening op-sqlite. */
export function setActiveDatabaseForTests(database: SqlDatabase | null): void {
  activeDatabase = database;
}
