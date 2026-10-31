import {resetServerReports, type AdminResetResponse} from '../api';
import {listDraftPhotoLocalUris} from '../db/draftRepository';
import {
  deleteAllReports,
  formatDatabaseErrorForDisplay,
  listAllPhotoLocalUris,
  listUploadJobs,
  type SqlDatabase,
} from '../db';
import {
  isUploadWorkerRunning,
  pauseUploadWorker,
  resumeUploadWorker,
} from '../upload';
import {
  deleteLocalPhotoFiles,
  getPhotoFileSystem,
  type PhotoFileSystem,
  wipeReportPhotosDirectory,
} from './photoStorage';

export type ResetAllReportsErrorCode =
  | 'busy'
  | 'server'
  | 'local'
  | 'partial'
  | 'unknown';

export class ResetAllReportsError extends Error {
  readonly code: ResetAllReportsErrorCode;
  readonly serverResetCompleted: boolean;

  constructor(
    code: ResetAllReportsErrorCode,
    message: string,
    options?: {cause?: unknown; serverResetCompleted?: boolean},
  ) {
    super(message);
    this.name = 'ResetAllReportsError';
    this.code = code;
    this.serverResetCompleted = options?.serverResetCompleted === true;
    if (options?.cause !== undefined) {
      (this as Error & {cause?: unknown}).cause = options.cause;
    }
  }
}

export type ResetAllReportsResult = {
  deletedLocalReports: number;
  deletedLocalPhotoFiles: number;
  server: AdminResetResponse;
};

export type ResetServerFn = () => Promise<AdminResetResponse>;

let resetInFlight = false;

export function isResetAllReportsInFlight(): boolean {
  return resetInFlight;
}

/** Test helper. */
export function resetResetAllReportsLockForTests(): void {
  resetInFlight = false;
}

/**
 * Full blast-radius reset:
 * 1. Refuse if the upload worker is actively running.
 * 2. Pause the worker so no new upload pass can start.
 * 3. Reset the server first (requires network). On failure, leave local data intact.
 * 4. Wipe local reports/jobs/photos in one SQLite transaction, then best-effort files.
 * 5. Resume the worker.
 *
 * Never claims success unless both server and local scopes completed.
 * Preserves schema_migrations and does not call per-report Delete APIs.
 */
export async function resetAllLocalAndServerReports(
  db: SqlDatabase,
  options?: {
    fs?: PhotoFileSystem;
    resetServer?: ResetServerFn;
  },
): Promise<ResetAllReportsResult> {
  if (resetInFlight) {
    throw new ResetAllReportsError(
      'busy',
      'A reset is already in progress. Please wait.',
    );
  }
  if (isUploadWorkerRunning()) {
    throw new ResetAllReportsError(
      'busy',
      'Uploads are currently running. Wait until they finish, then try Reset again.',
    );
  }

  const inProgress = await listUploadJobs(db, {state: 'in_progress'});
  if (inProgress.length > 0) {
    throw new ResetAllReportsError(
      'busy',
      'An upload is still marked in progress. Wait for it to finish or restart the app, then try Reset again.',
    );
  }

  resetInFlight = true;
  pauseUploadWorker();

  const fs = options?.fs ?? getPhotoFileSystem();
  const resetServer = options?.resetServer ?? resetServerReports;

  try {
    if (isUploadWorkerRunning()) {
      throw new ResetAllReportsError(
        'busy',
        'Uploads started while preparing reset. Wait until they finish, then try again.',
      );
    }

    let server: AdminResetResponse;
    try {
      server = await resetServer();
    } catch (error) {
      throw new ResetAllReportsError(
        'server',
        error instanceof Error
          ? `Server reset failed: ${error.message}. Local reports were not deleted.`
          : 'Server reset failed. Local reports were not deleted.',
        {cause: error, serverResetCompleted: false},
      );
    }

    let deletedLocalReports = 0;
    let photoUris: string[] = [];
    try {
      const reportUris = await listAllPhotoLocalUris(db);
      const draftUris = await listDraftPhotoLocalUris(db);
      photoUris = [...reportUris, ...draftUris];
      const local = await db.transaction(async tx => {
        const result = await deleteAllReports(tx);
        // Draft rows are wiped in the same transaction as reports.
        await tx.execute('DELETE FROM report_draft_photos');
        await tx.execute('DELETE FROM report_drafts');
        return result;
      });
      deletedLocalReports = local.deletedReports;
    } catch (error) {
      throw new ResetAllReportsError(
        'partial',
        `Server data was reset, but clearing local reports failed: ${
          formatDatabaseErrorForDisplay(error) || 'unknown database error'
        }. Try Reset again once the device is ready.`,
        {cause: error, serverResetCompleted: true},
      );
    }

    try {
      await deleteLocalPhotoFiles(photoUris, fs);
      await wipeReportPhotosDirectory(fs);
    } catch {
      // File cleanup is best-effort; DB wipe already succeeded.
    }

    return {
      deletedLocalReports,
      deletedLocalPhotoFiles: photoUris.length,
      server,
    };
  } finally {
    resumeUploadWorker();
    resetInFlight = false;
  }
}
