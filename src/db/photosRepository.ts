import {wrapDatabaseError} from './errors';
import {mapPhoto} from './mappers';
import type {
  CreatePhotoInput,
  LocalReportPhoto,
  SqlExecutor,
  UpdatePhotoInput,
} from './types';

const PHOTO_COLUMNS = `
  id, report_id, local_uri, sort_order, byte_size, mime_type,
  upload_status, server_photo_id
`;

export async function insertPhoto(
  db: SqlExecutor,
  reportId: number,
  input: CreatePhotoInput,
): Promise<LocalReportPhoto> {
  try {
    const result = await db.execute(
      `INSERT INTO report_photos (
         report_id, local_uri, sort_order, byte_size, mime_type, upload_status, server_photo_id
       ) VALUES (?, ?, ?, ?, ?, 'pending', NULL)`,
      [
        reportId,
        input.localUri,
        input.sortOrder,
        input.byteSize,
        input.mimeType,
      ],
    );

    const id = result.insertId;
    if (id === undefined) {
      const fetched = await listPhotosForReport(db, reportId);
      const match = fetched.find(p => p.sortOrder === input.sortOrder);
      if (!match) {
        throw new Error('Insert succeeded but photo row could not be loaded');
      }
      return match;
    }

    const photo = await getPhotoById(db, id);
    if (!photo) {
      throw new Error(`Inserted photo ${id} could not be loaded`);
    }
    return photo;
  } catch (error) {
    throw wrapDatabaseError(error, `Failed to insert photo for report ${reportId}`);
  }
}

export async function getPhotoById(
  db: SqlExecutor,
  id: number,
): Promise<LocalReportPhoto | null> {
  try {
    const result = await db.execute(
      `SELECT ${PHOTO_COLUMNS} FROM report_photos WHERE id = ?`,
      [id],
    );
    const row = result.rows[0];
    return row ? mapPhoto(row) : null;
  } catch (error) {
    throw wrapDatabaseError(error, `Failed to get photo ${id}`);
  }
}

export async function listPhotosForReport(
  db: SqlExecutor,
  reportId: number,
): Promise<LocalReportPhoto[]> {
  try {
    const result = await db.execute(
      `SELECT ${PHOTO_COLUMNS}
       FROM report_photos
       WHERE report_id = ?
       ORDER BY sort_order ASC`,
      [reportId],
    );
    return result.rows.map(mapPhoto);
  } catch (error) {
    throw wrapDatabaseError(
      error,
      `Failed to list photos for report ${reportId}`,
    );
  }
}

/**
 * Updates photo metadata / upload progress. Does not delete local URI rows
 * when an upload attempt fails.
 */
export async function updatePhoto(
  db: SqlExecutor,
  id: number,
  input: UpdatePhotoInput,
): Promise<LocalReportPhoto | null> {
  try {
    const existing = await getPhotoById(db, id);
    if (!existing) {
      return null;
    }

    await db.execute(
      `UPDATE report_photos
       SET local_uri = ?,
           sort_order = ?,
           byte_size = ?,
           mime_type = ?,
           upload_status = ?,
           server_photo_id = ?
       WHERE id = ?`,
      [
        input.localUri ?? existing.localUri,
        input.sortOrder ?? existing.sortOrder,
        input.byteSize ?? existing.byteSize,
        input.mimeType ?? existing.mimeType,
        input.uploadStatus ?? existing.uploadStatus,
        input.serverPhotoId !== undefined
          ? input.serverPhotoId
          : existing.serverPhotoId,
        id,
      ],
    );

    return getPhotoById(db, id);
  } catch (error) {
    throw wrapDatabaseError(error, `Failed to update photo ${id}`);
  }
}

/**
 * Explicit photo deletion only. Never used solely because upload failed.
 */
export async function deletePhoto(
  db: SqlExecutor,
  id: number,
): Promise<boolean> {
  try {
    const result = await db.execute(
      'DELETE FROM report_photos WHERE id = ?',
      [id],
    );
    return result.rowsAffected > 0;
  } catch (error) {
    throw wrapDatabaseError(error, `Failed to delete photo ${id}`);
  }
}
