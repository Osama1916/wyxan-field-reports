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
 * `pending` state and align report/photo statuses.
 *
 * In one SQLite transaction:
 * - upload_jobs: in_progress → pending, clear locked_at, schedule next attempt
 * - reports: uploading → pending (same report ids; id + idempotency_key untouched)
 * - report_photos: uploading → pending for those reports
 *
 * Does not delete reports or photos. Does not regenerate idempotency keys.
 * Safe against concurrent claimers: only `in_progress` rows are selected and
 * updated inside the transaction, so a worker claiming `pending` jobs cannot
 * race into partially recovered state.
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

      const jobIds = stale.rows.map(row => Number(row.id));
      const reportIds = [
        ...new Set(stale.rows.map(row => Number(row.report_id))),
      ];
      const jobPlaceholders = jobIds.map(() => '?').join(', ');
      const reportPlaceholders = reportIds.map(() => '?').join(', ');

      await tx.execute(
        `UPDATE upload_jobs
         SET state = 'pending',
             locked_at = NULL,
             next_attempt_at = ?,
             updated_at = ?
         WHERE id IN (${jobPlaceholders})
           AND state = 'in_progress'`,
        [timestamp, timestamp, ...jobIds],
      );

      await tx.execute(
        `UPDATE reports
         SET status = 'pending',
             updated_at = ?
         WHERE id IN (${reportPlaceholders})
           AND status = 'uploading'`,
        [timestamp, ...reportIds],
      );

      await tx.execute(
        `UPDATE report_photos
         SET upload_status = 'pending'
         WHERE report_id IN (${reportPlaceholders})
           AND upload_status = 'uploading'`,
        reportIds,
      );

      const refreshed = await tx.execute(
        `SELECT id, report_id, state, next_attempt_at, locked_at, created_at, updated_at
         FROM upload_jobs
         WHERE id IN (${jobPlaceholders})
         ORDER BY id ASC`,
        jobIds,
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
