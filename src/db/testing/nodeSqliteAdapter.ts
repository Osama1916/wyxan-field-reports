/**
 * Test-only SqlDatabase backed by Node's built-in node:sqlite.
 * Keeps Jest verification free of native RN modules and better-sqlite3.
 */
import {DatabaseSync} from 'node:sqlite';
import {DatabaseError, wrapDatabaseError} from '../errors';
import type {QueryResult, SqlDatabase, SqlExecutor, SqlParams} from '../types';

function normalizeParams(params?: SqlParams): SqlParams {
  return params ?? [];
}

function runStatement(
  db: DatabaseSync,
  sql: string,
  params?: SqlParams,
): QueryResult {
  const trimmed = sql.trim();
  const upper = trimmed.toUpperCase();
  const isSelect =
    upper.startsWith('SELECT') ||
    upper.startsWith('PRAGMA') && upper.includes('TABLE_INFO');

  // PRAGMA foreign_keys and similar are executed via exec / prepare.run
  if (upper.startsWith('PRAGMA') && !upper.includes('TABLE_INFO')) {
    db.prepare(trimmed).run(...normalizeParams(params));
    return {rows: [], rowsAffected: 0};
  }

  const statement = db.prepare(trimmed);

  if (
    isSelect ||
    upper.startsWith('WITH') ||
    upper.startsWith('EXPLAIN')
  ) {
    const rows = statement.all(...normalizeParams(params)) as Array<
      Record<string, string | number | null>
    >;
    return {rows, rowsAffected: 0};
  }

  const info = statement.run(...normalizeParams(params));
  return {
    rows: [],
    rowsAffected: Number(info.changes ?? 0),
    insertId:
      typeof info.lastInsertRowid === 'bigint'
        ? Number(info.lastInsertRowid)
        : typeof info.lastInsertRowid === 'number'
          ? info.lastInsertRowid
          : undefined,
  };
}

function createExecutor(db: DatabaseSync): SqlExecutor {
  return {
    async execute(sql, params) {
      try {
        return runStatement(db, sql, params);
      } catch (error) {
        throw wrapDatabaseError(error, 'node:sqlite execute failed');
      }
    },
  };
}

export function openNodeSqliteDatabase(
  path: string = ':memory:',
): SqlDatabase {
  const db = new DatabaseSync(path);
  db.exec('PRAGMA foreign_keys = ON');
  const root = createExecutor(db);

  return {
    execute: root.execute,
    async transaction<T>(fn: (tx: SqlExecutor) => Promise<T>): Promise<T> {
      db.exec('BEGIN IMMEDIATE');
      try {
        const tx = createExecutor(db);
        const result = await fn(tx);
        db.exec('COMMIT');
        return result;
      } catch (error) {
        try {
          db.exec('ROLLBACK');
        } catch {
          // Ignore rollback failures after a failed transaction.
        }
        throw wrapDatabaseError(error, 'node:sqlite transaction failed');
      }
    },
    close() {
      try {
        db.close();
      } catch (error) {
        throw new DatabaseError('Failed to close node:sqlite database', {
          cause: error,
        });
      }
    },
  };
}
