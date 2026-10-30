import fs from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import { DATA_DIR, DB_PATH } from './config';
import type { ChaosConfig, Report, ReportImage, ReportSummary } from './types';

let db: DatabaseSync;

export function initDb(): DatabaseSync {
  fs.mkdirSync(DATA_DIR, { recursive: true });
  db = new DatabaseSync(DB_PATH);
  db.exec('PRAGMA journal_mode = WAL;');
  db.exec('PRAGMA foreign_keys = ON;');

  db.exec(`
    CREATE TABLE IF NOT EXISTS reports (
      id TEXT PRIMARY KEY,
      idempotency_key TEXT NOT NULL UNIQUE,
      description TEXT NOT NULL,
      created_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS report_images (
      id TEXT PRIMARY KEY,
      report_id TEXT NOT NULL REFERENCES reports(id) ON DELETE CASCADE,
      filename TEXT NOT NULL,
      original_name TEXT NOT NULL,
      mime_type TEXT NOT NULL,
      size_bytes INTEGER NOT NULL,
      sort_order INTEGER NOT NULL,
      UNIQUE (report_id, sort_order)
    );

    CREATE TABLE IF NOT EXISTS chaos_config (
      id INTEGER PRIMARY KEY CHECK (id = 1),
      latency_ms INTEGER NOT NULL DEFAULT 0,
      fail_next_n INTEGER NOT NULL DEFAULT 0,
      fail_rate REAL NOT NULL DEFAULT 0,
      hang INTEGER NOT NULL DEFAULT 0
    );

    INSERT OR IGNORE INTO chaos_config (id, latency_ms, fail_next_n, fail_rate, hang)
    VALUES (1, 0, 0, 0, 0);
  `);

  return db;
}

export function getDb(): DatabaseSync {
  if (!db) {
    throw new Error('Database not initialized. Call initDb() first.');
  }
  return db;
}

function mapImage(row: {
  id: string;
  report_id: string;
  filename: string;
  original_name: string;
  mime_type: string;
  size_bytes: number;
  sort_order: number;
}): ReportImage {
  return {
    id: row.id,
    reportId: row.report_id,
    filename: row.filename,
    originalName: row.original_name,
    mimeType: row.mime_type,
    sizeBytes: row.size_bytes,
    sortOrder: row.sort_order,
    url: `/uploads/${row.filename}`,
  };
}

function loadImages(reportId: string): ReportImage[] {
  const rows = getDb()
    .prepare(
      `SELECT id, report_id, filename, original_name, mime_type, size_bytes, sort_order
       FROM report_images
       WHERE report_id = ?
       ORDER BY sort_order ASC`,
    )
    .all(reportId) as Array<{
    id: string;
    report_id: string;
    filename: string;
    original_name: string;
    mime_type: string;
    size_bytes: number;
    sort_order: number;
  }>;

  return rows.map(mapImage);
}

function mapReport(row: {
  id: string;
  idempotency_key: string;
  description: string;
  created_at: string;
}): Report {
  return {
    id: row.id,
    idempotencyKey: row.idempotency_key,
    description: row.description,
    createdAt: row.created_at,
    images: loadImages(row.id),
  };
}

export function findReportByIdempotencyKey(key: string): Report | null {
  const row = getDb()
    .prepare(
      `SELECT id, idempotency_key, description, created_at
       FROM reports WHERE idempotency_key = ?`,
    )
    .get(key) as
    | {
        id: string;
        idempotency_key: string;
        description: string;
        created_at: string;
      }
    | undefined;

  return row ? mapReport(row) : null;
}

export function findReportById(id: string): Report | null {
  const row = getDb()
    .prepare(
      `SELECT id, idempotency_key, description, created_at
       FROM reports WHERE id = ?`,
    )
    .get(id) as
    | {
        id: string;
        idempotency_key: string;
        description: string;
        created_at: string;
      }
    | undefined;

  return row ? mapReport(row) : null;
}

export function listReports(): ReportSummary[] {
  const rows = getDb()
    .prepare(
      `SELECT r.id, r.description, r.created_at,
              (SELECT COUNT(*) FROM report_images i WHERE i.report_id = r.id) AS image_count
       FROM reports r
       ORDER BY r.created_at DESC`,
    )
    .all() as Array<{
    id: string;
    description: string;
    created_at: string;
    image_count: number;
  }>;

  return rows.map(row => ({
    id: row.id,
    description: row.description,
    createdAt: row.created_at,
    imageCount: row.image_count,
  }));
}

export type NewImageInput = {
  id: string;
  filename: string;
  originalName: string;
  mimeType: string;
  sizeBytes: number;
  sortOrder: number;
};

export type CreateReportInput = {
  id: string;
  idempotencyKey: string;
  description: string;
  createdAt: string;
  images: NewImageInput[];
};

/**
 * Inserts a report and its images atomically.
 * Throws on duplicate idempotency_key (UNIQUE constraint).
 */
export function createReport(input: CreateReportInput): Report {
  const insertReport = getDb().prepare(
    `INSERT INTO reports (id, idempotency_key, description, created_at)
     VALUES (?, ?, ?, ?)`,
  );

  const insertImage = getDb().prepare(
    `INSERT INTO report_images
      (id, report_id, filename, original_name, mime_type, size_bytes, sort_order)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
  );

  getDb().exec('BEGIN');
  try {
    insertReport.run(
      input.id,
      input.idempotencyKey,
      input.description,
      input.createdAt,
    );

    for (const image of input.images) {
      insertImage.run(
        image.id,
        input.id,
        image.filename,
        image.originalName,
        image.mimeType,
        image.sizeBytes,
        image.sortOrder,
      );
    }

    getDb().exec('COMMIT');
  } catch (err) {
    getDb().exec('ROLLBACK');
    throw err;
  }

  return findReportById(input.id)!;
}

export function getChaosConfig(): ChaosConfig {
  const row = getDb()
    .prepare(
      `SELECT latency_ms, fail_next_n, fail_rate, hang FROM chaos_config WHERE id = 1`,
    )
    .get() as {
    latency_ms: number;
    fail_next_n: number;
    fail_rate: number;
    hang: number;
  };

  return {
    latencyMs: row.latency_ms,
    failNextN: row.fail_next_n,
    failRate: row.fail_rate,
    hang: row.hang === 1,
  };
}

export function updateChaosConfig(patch: Partial<ChaosConfig>): ChaosConfig {
  const current = getChaosConfig();
  const next: ChaosConfig = {
    latencyMs: patch.latencyMs ?? current.latencyMs,
    failNextN: patch.failNextN ?? current.failNextN,
    failRate: patch.failRate ?? current.failRate,
    hang: patch.hang ?? current.hang,
  };

  if (!Number.isInteger(next.latencyMs) || next.latencyMs < 0) {
    throw new Error('latencyMs must be a non-negative integer');
  }
  if (!Number.isInteger(next.failNextN) || next.failNextN < 0) {
    throw new Error('failNextN must be a non-negative integer');
  }
  if (
    typeof next.failRate !== 'number' ||
    Number.isNaN(next.failRate) ||
    next.failRate < 0 ||
    next.failRate > 1
  ) {
    throw new Error('failRate must be a number between 0 and 1');
  }
  if (typeof next.hang !== 'boolean') {
    throw new Error('hang must be a boolean');
  }

  getDb()
    .prepare(
      `UPDATE chaos_config
       SET latency_ms = ?, fail_next_n = ?, fail_rate = ?, hang = ?
       WHERE id = 1`,
    )
    .run(next.latencyMs, next.failNextN, next.failRate, next.hang ? 1 : 0);

  return getChaosConfig();
}

/** Decrements failNextN by 1 if > 0. Returns true if a forced failure was consumed. */
export function consumeFailNext(): boolean {
  const result = getDb()
    .prepare(
      `UPDATE chaos_config
       SET fail_next_n = fail_next_n - 1
       WHERE id = 1 AND fail_next_n > 0`,
    )
    .run();

  return Number(result.changes) > 0;
}

export function listAllImageFilenames(): string[] {
  const rows = getDb()
    .prepare(`SELECT filename FROM report_images`)
    .all() as Array<{ filename: string }>;
  return rows.map(r => r.filename);
}

export function resetAllReports(): { deletedReports: number } {
  const countRow = getDb()
    .prepare(`SELECT COUNT(*) AS count FROM reports`)
    .get() as { count: number };
  getDb().prepare(`DELETE FROM reports`).run();
  return { deletedReports: countRow.count };
}
