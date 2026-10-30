import {DatabaseError, wrapDatabaseError} from './errors';
import {insertPhoto} from './photosRepository';
import {getReportWithDetails} from './reportsRepository';
import {nowIso} from './time';
import type {
  CreateLocalReportInput,
  LocalReportWithPhotos,
  SqlDatabase,
} from './types';
import {insertUploadJob} from './uploadJobsRepository';

/**
 * Atomically creates a report, its photo rows, and a pending upload job.
 * If any step fails, the transaction rolls back and nothing is persisted.
 *
 * The provided idempotencyKey is stored once and must not be regenerated
 * on later upload retries.
 */
export async function createLocalReport(
  db: SqlDatabase,
  input: CreateLocalReportInput,
): Promise<LocalReportWithPhotos> {
  const description = input.description.trim();
  if (!description) {
    throw new DatabaseError('Report description is required');
  }
  if (!input.idempotencyKey.trim()) {
    throw new DatabaseError('Idempotency key is required');
  }
  if (!input.photos.length) {
    throw new DatabaseError('At least one photo is required');
  }

  const sortOrders = new Set(input.photos.map(p => p.sortOrder));
  if (sortOrders.size !== input.photos.length) {
    throw new DatabaseError('Photo sort_order values must be unique');
  }

  try {
    const reportId = await db.transaction(async tx => {
      const timestamp = nowIso();
      const insertResult = await tx.execute(
        `INSERT INTO reports (
           idempotency_key, description, status, server_report_id,
           attempt_count, last_error, created_at, updated_at, uploaded_at
         ) VALUES (?, ?, 'pending', NULL, 0, NULL, ?, ?, NULL)`,
        [input.idempotencyKey, description, timestamp, timestamp],
      );

      let id = insertResult.insertId;
      if (id === undefined) {
        const lookup = await tx.execute(
          'SELECT id FROM reports WHERE idempotency_key = ?',
          [input.idempotencyKey],
        );
        const rowId = lookup.rows[0]?.id;
        if (typeof rowId !== 'number') {
          throw new DatabaseError(
            'Report insert succeeded but id could not be resolved',
          );
        }
        id = rowId;
      }

      const orderedPhotos = [...input.photos].sort(
        (a, b) => a.sortOrder - b.sortOrder,
      );
      for (const photo of orderedPhotos) {
        await insertPhoto(tx, id, photo);
      }

      await insertUploadJob(tx, id, {nextAttemptAt: timestamp});
      return id;
    });

    const created = await getReportWithDetails(db, reportId);
    if (!created) {
      throw new DatabaseError(
        `Created report ${reportId} could not be loaded after commit`,
      );
    }
    return created;
  } catch (error) {
    throw wrapDatabaseError(error, 'Failed to create local report atomically');
  }
}
