import {cleanupOwnedCompressionTemps} from '../media/imageCompression';
import {createIdempotencyKey} from '../db/idempotency';
import {createLocalReport} from '../db/createLocalReport';
import {formatDatabaseErrorForDisplay} from '../db/errors';
import type {LocalReportWithPhotos, SqlDatabase} from '../db/types';
import {arePhotosDraftPersistedOnDisk} from './draftReport';
import {
  cleanupPersistedPhotos,
  getPhotoFileSystem,
  persistSelectedPhotos,
  stripFileScheme,
  type PhotoFileSystem,
  PhotoStorageError,
} from './photoStorage';
import type {PersistPhotoResult, SelectedPhoto} from './types';
import {
  formatValidationIssues,
  validateCreateReportInput,
} from './validation';

export class ReportSaveError extends Error {
  readonly code:
    | 'validation'
    | 'busy'
    | 'storage'
    | 'database'
    | 'unknown';

  constructor(
    message: string,
    code: ReportSaveError['code'],
    options?: {cause?: unknown},
  ) {
    super(message);
    this.name = 'ReportSaveError';
    this.code = code;
    if (options?.cause !== undefined) {
      (this as Error & {cause?: unknown}).cause = options.cause;
    }
  }
}

export type SaveLocalReportInput = {
  description: string;
  photos: readonly SelectedPhoto[];
  /**
   * Optional pre-generated idempotency key. When omitted, a new key is created
   * once for this save attempt.
   */
  idempotencyKey?: string;
};

export type SaveLocalReportResult = LocalReportWithPhotos;

/**
 * Process-level mutex so rapid Save taps cannot create duplicate reports.
 * Only one in-flight save is allowed app-wide.
 */
let saveInFlight = false;

export function isReportSaveInFlight(): boolean {
  return saveInFlight;
}

/** Test helper. */
export function resetReportSaveLockForTests(): void {
  saveInFlight = false;
}

function draftPhotosAsPersistResults(
  photos: readonly SelectedPhoto[],
): PersistPhotoResult[] {
  return photos.map((photo, index) => ({
    localUri: photo.uri,
    absolutePath: stripFileScheme(photo.uri),
    byteSize: photo.byteSize,
    mimeType: photo.mimeType.trim().toLowerCase(),
    sortOrder: index,
  }));
}

/**
 * Validates input, ensures photos are in permanent storage, then atomically
 * creates the report + photos + pending upload job via createLocalReport.
 *
 * When photos are already durable draft copies, they are reused (no second
 * copy). The draft is cleared only after the report transaction succeeds.
 * On failure the draft (and its files) remain intact.
 */
export async function saveLocalReport(
  db: SqlDatabase,
  input: SaveLocalReportInput,
  fs: PhotoFileSystem = getPhotoFileSystem(),
): Promise<SaveLocalReportResult> {
  if (saveInFlight) {
    throw new ReportSaveError(
      'A report is already being saved. Please wait.',
      'busy',
    );
  }

  const validation = validateCreateReportInput(input.description, input.photos);
  if (!validation.ok) {
    throw new ReportSaveError(
      formatValidationIssues(validation.issues),
      'validation',
    );
  }

  saveInFlight = true;
  let persisted: PersistPhotoResult[] = [];
  let reusedDraftFiles = false;

  try {
    reusedDraftFiles = await arePhotosDraftPersistedOnDisk(input.photos, fs);
    if (reusedDraftFiles) {
      persisted = draftPhotosAsPersistResults(input.photos);
    } else {
      persisted = await persistSelectedPhotos(input.photos, fs);
    }

    const idempotencyKey =
      input.idempotencyKey?.trim() || createIdempotencyKey();

    const created = await createLocalReport(
      db,
      {
        description: input.description,
        idempotencyKey,
        photos: persisted.map(photo => ({
          localUri: photo.localUri,
          sortOrder: photo.sortOrder,
          byteSize: photo.byteSize,
          mimeType: photo.mimeType,
        })),
      },
      // Clear draft in the same transaction so Save cannot leave a stale draft.
      {clearDraft: true},
    );

    // Permanent copies exist — drop app-owned compression temps only.
    // Never delete gallery/camera originals (they are not ownedTempPath).
    await cleanupOwnedCompressionTemps(input.photos);

    return created;
  } catch (error) {
    // Only delete files we copied during this failed save attempt.
    // Never delete reused draft files — draft still owns them.
    if (!reusedDraftFiles && persisted.length > 0) {
      await cleanupPersistedPhotos(persisted, fs);
    }

    if (error instanceof ReportSaveError) {
      throw error;
    }
    if (error instanceof PhotoStorageError) {
      throw new ReportSaveError(error.message, 'storage', {cause: error});
    }

    const message = formatDatabaseErrorForDisplay(error);
    throw new ReportSaveError(
      message.startsWith('Local database')
        ? 'Could not save the report to the local database.'
        : message,
      'database',
      {cause: error},
    );
  } finally {
    saveInFlight = false;
  }
}
