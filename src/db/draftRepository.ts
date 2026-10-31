import {wrapDatabaseError} from './errors';
import {nowIso} from './time';
import type {SqlDatabase, SqlExecutor} from './types';

/** Singleton draft row id — only one unsaved compose draft exists. */
export const DRAFT_SINGLETON_ID = 1;

export type DraftPhotoRow = {
  id: number;
  selectionId: string;
  localUri: string;
  sortOrder: number;
  byteSize: number;
  mimeType: string;
  fileName: string | null;
  fingerprint: string;
};

export type ReportDraft = {
  description: string;
  updatedAt: string;
  photos: DraftPhotoRow[];
};

export type DraftPhotoInput = {
  selectionId: string;
  localUri: string;
  sortOrder: number;
  byteSize: number;
  mimeType: string;
  fileName: string | null;
  fingerprint: string;
};

function mapDraftPhoto(row: Record<string, unknown>): DraftPhotoRow {
  return {
    id: Number(row.id),
    selectionId: String(row.selection_id),
    localUri: String(row.local_uri),
    sortOrder: Number(row.sort_order),
    byteSize: Number(row.byte_size),
    mimeType: String(row.mime_type),
    fileName:
      row.file_name == null || row.file_name === ''
        ? null
        : String(row.file_name),
    fingerprint: String(row.fingerprint),
  };
}

async function ensureDraftRow(tx: SqlExecutor): Promise<void> {
  const existing = await tx.execute(
    'SELECT id FROM report_drafts WHERE id = ?',
    [DRAFT_SINGLETON_ID],
  );
  if (existing.rows.length > 0) {
    return;
  }
  await tx.execute(
    `INSERT INTO report_drafts (id, description, updated_at)
     VALUES (?, '', ?)`,
    [DRAFT_SINGLETON_ID, nowIso()],
  );
}

/**
 * Loads the singleton unsaved draft (description + ordered photos).
 * Returns null when no draft row exists yet (fresh install / after clear).
 */
export async function getReportDraft(
  db: SqlExecutor,
): Promise<ReportDraft | null> {
  try {
    const draftResult = await db.execute(
      `SELECT description, updated_at FROM report_drafts WHERE id = ?`,
      [DRAFT_SINGLETON_ID],
    );
    const draftRow = draftResult.rows[0];
    if (!draftRow) {
      return null;
    }

    const photosResult = await db.execute(
      `SELECT id, selection_id, local_uri, sort_order, byte_size, mime_type,
              file_name, fingerprint
       FROM report_draft_photos
       ORDER BY sort_order ASC, id ASC`,
    );

    return {
      description: String(draftRow.description ?? ''),
      updatedAt: String(draftRow.updated_at),
      photos: photosResult.rows.map(mapDraftPhoto),
    };
  } catch (error) {
    throw wrapDatabaseError(error, 'Failed to load report draft');
  }
}

/** Updates draft description only (creates the singleton row if needed). */
export async function upsertDraftDescription(
  db: SqlDatabase,
  description: string,
): Promise<void> {
  try {
    await db.transaction(async tx => {
      await ensureDraftRow(tx);
      await tx.execute(
        `UPDATE report_drafts
         SET description = ?, updated_at = ?
         WHERE id = ?`,
        [description, nowIso(), DRAFT_SINGLETON_ID],
      );
    });
  } catch (error) {
    throw wrapDatabaseError(error, 'Failed to save draft description');
  }
}

/**
 * Replaces the full ordered draft photo set in one transaction.
 * Does not touch on-disk files — callers own file create/delete.
 */
export async function replaceDraftPhotos(
  db: SqlDatabase,
  photos: readonly DraftPhotoInput[],
): Promise<void> {
  try {
    await db.transaction(async tx => {
      await ensureDraftRow(tx);
      await tx.execute('DELETE FROM report_draft_photos');
      for (const photo of photos) {
        await tx.execute(
          `INSERT INTO report_draft_photos (
             selection_id, local_uri, sort_order, byte_size, mime_type,
             file_name, fingerprint
           ) VALUES (?, ?, ?, ?, ?, ?, ?)`,
          [
            photo.selectionId,
            photo.localUri,
            photo.sortOrder,
            photo.byteSize,
            photo.mimeType,
            photo.fileName,
            photo.fingerprint,
          ],
        );
      }
      await tx.execute(
        `UPDATE report_drafts SET updated_at = ? WHERE id = ?`,
        [nowIso(), DRAFT_SINGLETON_ID],
      );
    });
  } catch (error) {
    throw wrapDatabaseError(error, 'Failed to save draft photos');
  }
}

/**
 * Removes draft metadata only. Does not delete photo files.
 * Safe to call after a successful save that now owns those files via reports.
 */
export async function clearReportDraft(db: SqlDatabase): Promise<void> {
  try {
    await db.transaction(async tx => {
      await tx.execute('DELETE FROM report_draft_photos');
      await tx.execute('DELETE FROM report_drafts');
    });
  } catch (error) {
    throw wrapDatabaseError(error, 'Failed to clear report draft');
  }
}

/** Lists every draft photo URI (for cleanup / reset). */
export async function listDraftPhotoLocalUris(
  db: SqlExecutor,
): Promise<string[]> {
  try {
    const result = await db.execute(
      'SELECT local_uri FROM report_draft_photos ORDER BY sort_order ASC',
    );
    return result.rows.map(row => String(row.local_uri));
  } catch (error) {
    throw wrapDatabaseError(error, 'Failed to list draft photo URIs');
  }
}
