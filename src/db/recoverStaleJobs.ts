import {wrapDatabaseError} from './errors';
import {mapUploadJob} from './mappers';
import {nowIso} from './time';
import type {SqlDatabase, UploadJob} from './types';

export type RecoverStaleJobsResult = {
  /** Jobs that were `in_progress` and are now retryable (`pending`). */
  recovered: UploadJob[];
  recoveredCount: number;
};

/**
 * On app startup, return stale `in_progress` upload jobs to a retryable
 * `pending` state. Clears locks and schedules an immediate next attempt.
 *
 * Does not delete reports or photos. Does not regenerate idempotency keys.
 */
export async function recoverStaleUploadJobs(
  db: SqlDatabase,
): Promise<RecoverStaleJobsResult> {
  try {
    const timestamp = nowIso();

    const recovered = await db.transaction(async tx => {
      const stale = await tx.execute(
        `SELECT id, report_id, state, next_attempt_at, locked_at, created_at, updated_at
         FROM upload_jobs
         WHERE state = 'in_progress'`,
      );

      if (stale.rows.length === 0) {
        return [] as UploadJob[];
      }

      await tx.execute(
        `UPDATE upload_jobs
         SET state = 'pending',
             locked_at = NULL,
             next_attempt_at = ?,
             updated_at = ?
         WHERE state = 'in_progress'`,
        [timestamp, timestamp],
      );

      const ids = stale.rows.map(row => Number(row.id));
      const placeholders = ids.map(() => '?').join(', ');
      const refreshed = await tx.execute(
        `SELECT id, report_id, state, next_attempt_at, locked_at, created_at, updated_at
         FROM upload_jobs
         WHERE id IN (${placeholders})
         ORDER BY id ASC`,
        ids,
      );

      return refreshed.rows.map(mapUploadJob);
    });

    return {
      recovered,
      recoveredCount: recovered.length,
    };
  } catch (error) {
    throw wrapDatabaseError(error, 'Failed to recover stale upload jobs');
  }
}
