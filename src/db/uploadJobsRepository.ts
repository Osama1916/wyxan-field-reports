import {wrapDatabaseError} from './errors';
import {mapUploadJob} from './mappers';
import {nowIso} from './time';
import type {SqlExecutor, UpdateUploadJobInput, UploadJob} from './types';

const JOB_COLUMNS = `
  id, report_id, state, next_attempt_at, locked_at, created_at, updated_at
`;

export async function insertUploadJob(
  db: SqlExecutor,
  reportId: number,
  options: {nextAttemptAt?: string | null} = {},
): Promise<UploadJob> {
  try {
    const timestamp = nowIso();
    const nextAttemptAt =
      options.nextAttemptAt === undefined ? timestamp : options.nextAttemptAt;

    const result = await db.execute(
      `INSERT INTO upload_jobs (
         report_id, state, next_attempt_at, locked_at, created_at, updated_at
       ) VALUES (?, 'pending', ?, NULL, ?, ?)`,
      [reportId, nextAttemptAt, timestamp, timestamp],
    );

    const id = result.insertId;
    if (id === undefined) {
      const byReport = await getUploadJobByReportId(db, reportId);
      if (!byReport) {
        throw new Error('Insert succeeded but upload job could not be loaded');
      }
      return byReport;
    }

    const job = await getUploadJobById(db, id);
    if (!job) {
      throw new Error(`Inserted upload job ${id} could not be loaded`);
    }
    return job;
  } catch (error) {
    throw wrapDatabaseError(
      error,
      `Failed to insert upload job for report ${reportId}`,
    );
  }
}

export async function getUploadJobById(
  db: SqlExecutor,
  id: number,
): Promise<UploadJob | null> {
  try {
    const result = await db.execute(
      `SELECT ${JOB_COLUMNS} FROM upload_jobs WHERE id = ?`,
      [id],
    );
    const row = result.rows[0];
    return row ? mapUploadJob(row) : null;
  } catch (error) {
    throw wrapDatabaseError(error, `Failed to get upload job ${id}`);
  }
}

export async function getUploadJobByReportId(
  db: SqlExecutor,
  reportId: number,
): Promise<UploadJob | null> {
  try {
    const result = await db.execute(
      `SELECT ${JOB_COLUMNS} FROM upload_jobs WHERE report_id = ?`,
      [reportId],
    );
    const row = result.rows[0];
    return row ? mapUploadJob(row) : null;
  } catch (error) {
    throw wrapDatabaseError(
      error,
      `Failed to get upload job for report ${reportId}`,
    );
  }
}

export async function listUploadJobs(
  db: SqlExecutor,
  options: {state?: UploadJob['state']} = {},
): Promise<UploadJob[]> {
  try {
    const params: Array<string> = [];
    let sql = `SELECT ${JOB_COLUMNS} FROM upload_jobs`;
    if (options.state) {
      sql += ' WHERE state = ?';
      params.push(options.state);
    }
    sql += ' ORDER BY created_at ASC';
    const result = await db.execute(sql, params);
    return result.rows.map(mapUploadJob);
  } catch (error) {
    throw wrapDatabaseError(error, 'Failed to list upload jobs');
  }
}

export async function updateUploadJob(
  db: SqlExecutor,
  id: number,
  input: UpdateUploadJobInput,
): Promise<UploadJob | null> {
  try {
    const existing = await getUploadJobById(db, id);
    if (!existing) {
      return null;
    }

    const updatedAt = nowIso();
    await db.execute(
      `UPDATE upload_jobs
       SET state = ?,
           next_attempt_at = ?,
           locked_at = ?,
           updated_at = ?
       WHERE id = ?`,
      [
        input.state ?? existing.state,
        input.nextAttemptAt !== undefined
          ? input.nextAttemptAt
          : existing.nextAttemptAt,
        input.lockedAt !== undefined ? input.lockedAt : existing.lockedAt,
        updatedAt,
        id,
      ],
    );

    return getUploadJobById(db, id);
  } catch (error) {
    throw wrapDatabaseError(error, `Failed to update upload job ${id}`);
  }
}

export async function deleteUploadJob(
  db: SqlExecutor,
  id: number,
): Promise<boolean> {
  try {
    const result = await db.execute('DELETE FROM upload_jobs WHERE id = ?', [
      id,
    ]);
    return result.rowsAffected > 0;
  } catch (error) {
    throw wrapDatabaseError(error, `Failed to delete upload job ${id}`);
  }
}
