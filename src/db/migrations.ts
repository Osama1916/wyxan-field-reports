import type {SqlDatabase, SqlExecutor} from './types';
import {wrapDatabaseError} from './errors';

export type Migration = {
  version: number;
  name: string;
  sql: string;
};

/**
 * Versioned schema migrations. Applied in order; each version runs once.
 * Keep statements single-command when possible (native drivers may run only
 * the first prepared statement from a multi-statement string).
 */
export const MIGRATIONS: readonly Migration[] = [
  {
    version: 1,
    name: 'initial_local_reports_schema',
    sql: `
PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS schema_migrations (
  version INTEGER PRIMARY KEY NOT NULL,
  name TEXT NOT NULL,
  applied_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS reports (
  id INTEGER PRIMARY KEY AUTOINCREMENT NOT NULL,
  idempotency_key TEXT NOT NULL,
  description TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'uploading', 'uploaded', 'failed')),
  server_report_id TEXT,
  attempt_count INTEGER NOT NULL DEFAULT 0
    CHECK (attempt_count >= 0),
  last_error TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  uploaded_at TEXT,
  CONSTRAINT reports_idempotency_key_unique UNIQUE (idempotency_key)
);

CREATE TABLE IF NOT EXISTS report_photos (
  id INTEGER PRIMARY KEY AUTOINCREMENT NOT NULL,
  report_id INTEGER NOT NULL,
  local_uri TEXT NOT NULL,
  sort_order INTEGER NOT NULL
    CHECK (sort_order >= 0),
  byte_size INTEGER NOT NULL
    CHECK (byte_size >= 0),
  mime_type TEXT NOT NULL,
  upload_status TEXT NOT NULL DEFAULT 'pending'
    CHECK (upload_status IN ('pending', 'uploading', 'uploaded', 'failed')),
  server_photo_id TEXT,
  CONSTRAINT report_photos_report_id_fk
    FOREIGN KEY (report_id) REFERENCES reports(id) ON DELETE CASCADE,
  CONSTRAINT report_photos_report_sort_unique UNIQUE (report_id, sort_order)
);

CREATE TABLE IF NOT EXISTS upload_jobs (
  id INTEGER PRIMARY KEY AUTOINCREMENT NOT NULL,
  report_id INTEGER NOT NULL,
  state TEXT NOT NULL DEFAULT 'pending'
    CHECK (state IN ('pending', 'in_progress', 'succeeded', 'failed')),
  next_attempt_at TEXT,
  locked_at TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  CONSTRAINT upload_jobs_report_id_fk
    FOREIGN KEY (report_id) REFERENCES reports(id) ON DELETE CASCADE,
  CONSTRAINT upload_jobs_report_id_unique UNIQUE (report_id)
);

CREATE INDEX IF NOT EXISTS idx_reports_status ON reports(status);
CREATE INDEX IF NOT EXISTS idx_reports_created_at ON reports(created_at);
CREATE INDEX IF NOT EXISTS idx_report_photos_report_id ON report_photos(report_id);
CREATE INDEX IF NOT EXISTS idx_upload_jobs_state_next_attempt
  ON upload_jobs(state, next_attempt_at);
CREATE INDEX IF NOT EXISTS idx_upload_jobs_locked_at ON upload_jobs(locked_at);
`.trim(),
  },
];

const BOOTSTRAP_SQL = `
CREATE TABLE IF NOT EXISTS schema_migrations (
  version INTEGER PRIMARY KEY NOT NULL,
  name TEXT NOT NULL,
  applied_at TEXT NOT NULL
);
`.trim();

async function executeStatements(
  db: SqlExecutor,
  sqlBlock: string,
): Promise<void> {
  const statements = sqlBlock
    .split(';')
    .map(part => part.trim())
    .filter(part => part.length > 0 && !part.startsWith('--'));

  for (const statement of statements) {
    await db.execute(statement);
  }
}

export async function getAppliedMigrationVersions(
  db: SqlExecutor,
): Promise<number[]> {
  try {
    await db.execute(BOOTSTRAP_SQL);
    const result = await db.execute(
      'SELECT version FROM schema_migrations ORDER BY version ASC',
    );
    return result.rows.map(row => Number(row.version));
  } catch (error) {
    throw wrapDatabaseError(error, 'Failed to read schema_migrations');
  }
}

/**
 * Applies any pending migrations in version order.
 * Each migration runs inside a transaction so a failed version leaves no
 * partial schema / migration-bookkeeping changes.
 */
export async function runMigrations(db: SqlDatabase): Promise<number[]> {
  try {
    await db.execute('PRAGMA foreign_keys = ON');
    const applied = new Set(await getAppliedMigrationVersions(db));
    const newlyApplied: number[] = [];

    for (const migration of MIGRATIONS) {
      if (applied.has(migration.version)) {
        continue;
      }

      await db.transaction(async tx => {
        await executeStatements(tx, migration.sql);
        const appliedAt = new Date().toISOString();
        await tx.execute(
          `INSERT INTO schema_migrations (version, name, applied_at)
           VALUES (?, ?, ?)`,
          [migration.version, migration.name, appliedAt],
        );
      });
      newlyApplied.push(migration.version);
    }

    return newlyApplied;
  } catch (error) {
    throw wrapDatabaseError(error, 'Failed to run database migrations');
  }
}

export function getLatestMigrationVersion(): number {
  if (MIGRATIONS.length === 0) {
    return 0;
  }
  return Math.max(...MIGRATIONS.map(m => m.version));
}
