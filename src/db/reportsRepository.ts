import {wrapDatabaseError} from './errors';
import {mapPhoto, mapReport, mapUploadJob} from './mappers';
import {nowIso} from './time';
import type {
  LocalReport,
  LocalReportWithPhotos,
  SqlDatabase,
  SqlExecutor,
  UpdateReportInput,
} from './types';

const REPORT_COLUMNS = `
  id, idempotency_key, description, status, server_report_id,
  attempt_count, last_error, created_at, updated_at, uploaded_at
`;

export async function getReportById(
  db: SqlExecutor,
  id: number,
): Promise<LocalReport | null> {
  try {
    const result = await db.execute(
      `SELECT ${REPORT_COLUMNS} FROM reports WHERE id = ?`,
      [id],
    );
    const row = result.rows[0];
    return row ? mapReport(row) : null;
  } catch (error) {
    throw wrapDatabaseError(error, `Failed to get report ${id}`);
  }
}

export async function getReportByIdempotencyKey(
  db: SqlExecutor,
  idempotencyKey: string,
): Promise<LocalReport | null> {
  try {
    const result = await db.execute(
      `SELECT ${REPORT_COLUMNS} FROM reports WHERE idempotency_key = ?`,
      [idempotencyKey],
    );
    const row = result.rows[0];
    return row ? mapReport(row) : null;
  } catch (error) {
    throw wrapDatabaseError(
      error,
      `Failed to get report by idempotency key`,
    );
  }
}

export async function listReports(
  db: SqlExecutor,
  options: {status?: LocalReport['status']; limit?: number} = {},
): Promise<LocalReport[]> {
  try {
    const params: Array<string | number> = [];
    let sql = `SELECT ${REPORT_COLUMNS} FROM reports`;
    if (options.status) {
      sql += ' WHERE status = ?';
      params.push(options.status);
    }
    sql += ' ORDER BY created_at DESC';
    if (options.limit !== undefined) {
      sql += ' LIMIT ?';
      params.push(options.limit);
    }
    const result = await db.execute(sql, params);
    return result.rows.map(mapReport);
  } catch (error) {
    throw wrapDatabaseError(error, 'Failed to list reports');
  }
}

export async function getReportWithDetails(
  db: SqlExecutor,
  id: number,
): Promise<LocalReportWithPhotos | null> {
  try {
    const report = await getReportById(db, id);
    if (!report) {
      return null;
    }

    const photosResult = await db.execute(
      `SELECT id, report_id, local_uri, sort_order, byte_size, mime_type,
              upload_status, server_photo_id
       FROM report_photos
       WHERE report_id = ?
       ORDER BY sort_order ASC`,
      [id],
    );
    const jobResult = await db.execute(
      `SELECT id, report_id, state, next_attempt_at, locked_at, created_at, updated_at
       FROM upload_jobs
       WHERE report_id = ?`,
      [id],
    );

    return {
      ...report,
      photos: photosResult.rows.map(mapPhoto),
      uploadJob: jobResult.rows[0] ? mapUploadJob(jobResult.rows[0]) : null,
    };
  } catch (error) {
    throw wrapDatabaseError(error, `Failed to load report details ${id}`);
  }
}

/**
 * Updates mutable report fields. Never touches idempotency_key.
 * Failed uploads should update status / last_error / attempt_count only —
 * local rows and photos are retained.
 */
export async function updateReport(
  db: SqlExecutor,
  id: number,
  input: UpdateReportInput,
): Promise<LocalReport | null> {
  try {
    const existing = await getReportById(db, id);
    if (!existing) {
      return null;
    }

    const updatedAt = nowIso();
    const description = input.description ?? existing.description;
    const status = input.status ?? existing.status;
    const serverReportId =
      input.serverReportId !== undefined
        ? input.serverReportId
        : existing.serverReportId;
    const attemptCount =
      input.attemptCount !== undefined
        ? input.attemptCount
        : existing.attemptCount;
    const lastError =
      input.lastError !== undefined ? input.lastError : existing.lastError;
    const uploadedAt =
      input.uploadedAt !== undefined ? input.uploadedAt : existing.uploadedAt;

    await db.execute(
      `UPDATE reports
       SET description = ?,
           status = ?,
           server_report_id = ?,
           attempt_count = ?,
           last_error = ?,
           updated_at = ?,
           uploaded_at = ?
       WHERE id = ?`,
      [
        description,
        status,
        serverReportId,
        attemptCount,
        lastError,
        updatedAt,
        uploadedAt,
        id,
      ],
    );

    return getReportById(db, id);
  } catch (error) {
    throw wrapDatabaseError(error, `Failed to update report ${id}`);
  }
}

/**
 * Deletes a local report. Cascades to photos and upload_jobs via FK.
 * Do not call this merely because an upload attempt failed.
 */
export async function deleteReport(
  db: SqlDatabase,
  id: number,
): Promise<boolean> {
  try {
    const result = await db.execute('DELETE FROM reports WHERE id = ?', [id]);
    return result.rowsAffected > 0;
  } catch (error) {
    throw wrapDatabaseError(error, `Failed to delete report ${id}`);
  }
}
