import {open, type DB} from '@op-engineering/op-sqlite';
import {DatabaseError, wrapDatabaseError} from './errors';
import type {QueryResult, SqlDatabase, SqlExecutor, SqlParams} from './types';

function toNumberId(value: unknown): number | undefined {
  if (typeof value === 'number' && Number.isFinite(value)) {
    return value;
  }
  if (typeof value === 'bigint') {
    return Number(value);
  }
  if (typeof value === 'string' && value.length > 0) {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : undefined;
  }
  return undefined;
}

function normalizeResult(raw: {
  rows?: Array<Record<string, unknown>>;
  rowsAffected?: number;
  insertId?: number | bigint | string;
}): QueryResult {
  return {
    rows: (raw.rows ?? []) as QueryResult['rows'],
    rowsAffected: raw.rowsAffected ?? 0,
    insertId: toNumberId(raw.insertId),
  };
}

function createExecutorFromOpSqlite(
  execute: (sql: string, params?: SqlParams) => Promise<{
    rows: Array<Record<string, unknown>>;
    rowsAffected: number;
    insertId?: number | bigint | string;
  }>,
): SqlExecutor {
  return {
    async execute(sql, params) {
      try {
        const result = await execute(sql, params);
        return normalizeResult(result);
      } catch (error) {
        throw wrapDatabaseError(error, 'SQLite execute failed');
      }
    },
  };
}

/**
 * Wraps an op-sqlite connection in the shared SqlDatabase interface.
 */
export function wrapOpSqliteDatabase(db: DB): SqlDatabase {
  const root = createExecutorFromOpSqlite(async (sql, params) => {
    const result = await db.execute(sql, params ? [...params] : undefined);
    return {
      rows: result.rows as Array<Record<string, unknown>>,
      rowsAffected: result.rowsAffected,
      insertId: result.insertId,
    };
  });

  return {
    execute: root.execute,
    async transaction<T>(fn: (tx: SqlExecutor) => Promise<T>): Promise<T> {
      let outcome: T | undefined;
      let didRun = false;
      try {
        await db.transaction(async nativeTx => {
          const tx = createExecutorFromOpSqlite(async (sql, params) => {
            const result = await nativeTx.execute(
              sql,
              params ? [...params] : undefined,
            );
            return {
              rows: result.rows as Array<Record<string, unknown>>,
              rowsAffected: result.rowsAffected,
              insertId: result.insertId,
            };
          });
          outcome = await fn(tx);
          didRun = true;
        });
      } catch (error) {
        throw wrapDatabaseError(error, 'SQLite transaction failed');
      }
      if (!didRun) {
        throw new DatabaseError('SQLite transaction completed without running');
      }
      return outcome as T;
    },
    close() {
      db.close();
    },
  };
}

export type OpenLocalDatabaseOptions = {
  name?: string;
  location?: string;
};

/**
 * Opens the on-device SQLite database via @op-engineering/op-sqlite.
 *
 * Important: do not pass `location: undefined`. op-sqlite's native open() uses
 * JSI `hasProperty("location")` then `.asString()` — a present-but-undefined
 * key throws before sqlite3_open (no SQLite logcat line).
 */
export function openOpSqliteDatabase(
  options: OpenLocalDatabaseOptions = {},
): SqlDatabase {
  try {
    const name = options.name ?? 'fieldreports.sqlite';
    // Omit unset location so native code uses the default Android/iOS path.
    const db =
      options.location != null && options.location !== ''
        ? open({name, location: options.location})
        : open({name});
    return wrapOpSqliteDatabase(db);
  } catch (error) {
    throw wrapDatabaseError(error, 'Failed to open SQLite database');
  }
}
