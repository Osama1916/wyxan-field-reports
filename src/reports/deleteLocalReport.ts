import {
  DatabaseError,
  deleteReport,
  getReportById,
  getReportWithDetails,
  type SqlDatabase,
} from '../db';
import {
  deleteLocalPhotoFiles,
  getPhotoFileSystem,
  type PhotoFileSystem,
} from './photoStorage';

export type ReportDeleteErrorCode =
  | 'not_found'
  | 'uploading'
  | 'uploaded'
  | 'in_flight'
  | 'failed';

export class ReportDeleteError extends Error {
  readonly code: ReportDeleteErrorCode;

  constructor(code: ReportDeleteErrorCode, message: string) {
    super(message);
    this.name = 'ReportDeleteError';
    this.code = code;
  }
}

export type DeleteLocalReportResult = {
  reportId: number;
  removedPhotoUris: string[];
};

/** Per-report lock so double-taps cannot start overlapping deletes. */
const inFlightDeletes = new Set<number>();

export function isReportDeleteInFlight(reportId: number): boolean {
  return inFlightDeletes.has(reportId);
}

/** Test helper. */
export function resetReportDeleteLockForTests(): void {
  inFlightDeletes.clear();
}

function asReportDeleteError(error: unknown): ReportDeleteError | null {
  if (error instanceof ReportDeleteError) {
    return error;
  }
  if (
    error instanceof DatabaseError &&
    error.cause instanceof ReportDeleteError
  ) {
    return error.cause;
  }
  return null;
}

function assertDeletableStatus(
  status: string,
): asserts status is 'pending' | 'failed' {
  if (status === 'uploading') {
    throw new ReportDeleteError(
      'uploading',
      'This report is still uploading. Please wait until the upload finishes, then try again.',
    );
  }
  if (status === 'uploaded') {
    throw new ReportDeleteError(
      'uploaded',
      'This report was already uploaded. Local deletion is disabled so it stays consistent with the server copy.',
    );
  }
  if (status !== 'pending' && status !== 'failed') {
    throw new ReportDeleteError(
      'failed',
      `Cannot delete a report with status "${status}".`,
    );
  }
}

/**
 * Safely deletes a pending or failed local report:
 * - Rejects uploading / uploaded reports
 * - Deletes SQLite report (+ cascaded photos + upload job) in a transaction
 * - Best-effort removes local photo files afterward
 * - Never calls the server or Reset API
 */
export async function deleteLocalReport(
  db: SqlDatabase,
  reportId: number,
  fs: PhotoFileSystem = getPhotoFileSystem(),
): Promise<DeleteLocalReportResult> {
  if (inFlightDeletes.has(reportId)) {
    throw new ReportDeleteError(
      'in_flight',
      'This report is already being deleted.',
    );
  }

  inFlightDeletes.add(reportId);
  try {
    const detailed = await getReportWithDetails(db, reportId);
    if (!detailed) {
      throw new ReportDeleteError('not_found', 'Report not found.');
    }

    assertDeletableStatus(detailed.status);

    const removedPhotoUris = detailed.photos.map(photo => photo.localUri);

    await db.transaction(async tx => {
      // Re-check inside the transaction in case the upload worker raced ahead.
      const fresh = await getReportById(tx, reportId);
      if (!fresh) {
        throw new ReportDeleteError('not_found', 'Report not found.');
      }
      assertDeletableStatus(fresh.status);

      const deleted = await deleteReport(tx, reportId);
      if (!deleted) {
        throw new ReportDeleteError('not_found', 'Report not found.');
      }
    });

    // Files after DB commit: orphan files are preferable to orphan DB rows.
    await deleteLocalPhotoFiles(removedPhotoUris, fs);

    return {reportId, removedPhotoUris};
  } catch (error) {
    const typed = asReportDeleteError(error);
    if (typed) {
      throw typed;
    }
    throw new ReportDeleteError(
      'failed',
      error instanceof Error
        ? error.message
        : 'Could not delete this report. Please try again.',
    );
  } finally {
    inFlightDeletes.delete(reportId);
  }
}
