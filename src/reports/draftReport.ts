import {
  getReportDraft,
  replaceDraftPhotos,
  upsertDraftDescription,
  type DraftPhotoInput,
} from '../db/draftRepository';
import type {SqlDatabase} from '../db/types';
import {
  cleanupPersistedPhotos,
  deleteLocalPhotoFiles,
  getPhotoFileSystem,
  persistSelectedPhoto,
  stripFileScheme,
  type PhotoFileSystem,
  PhotoStorageError,
} from './photoStorage';
import type {SelectedPhoto} from './types';

export class DraftReportError extends Error {
  readonly code: 'storage' | 'database' | 'busy' | 'unknown';

  constructor(
    message: string,
    code: DraftReportError['code'],
    options?: {cause?: unknown},
  ) {
    super(message);
    this.name = 'DraftReportError';
    this.code = code;
    if (options?.cause !== undefined) {
      (this as Error & {cause?: unknown}).cause = options.cause;
    }
  }
}

export type RestoredReportDraft = {
  description: string;
  photos: SelectedPhoto[];
  /** Human-readable notice when some draft files were missing/invalid. */
  recoveryNotice: string | null;
};

/** Process mutex so overlapping draft photo writes cannot interleave. */
let draftPhotoWriteInFlight = false;

export function isDraftPhotoWriteInFlight(): boolean {
  return draftPhotoWriteInFlight;
}

/** Test helper. */
export function resetDraftPhotoWriteLockForTests(): void {
  draftPhotoWriteInFlight = false;
}

function toDraftPhotoInput(
  photo: SelectedPhoto,
  sortOrder: number,
): DraftPhotoInput {
  return {
    selectionId: photo.selectionId,
    localUri: photo.uri,
    sortOrder,
    byteSize: photo.byteSize,
    mimeType: photo.mimeType,
    fileName: photo.fileName,
    fingerprint: photo.fingerprint,
  };
}

function draftRowToSelectedPhoto(row: {
  selectionId: string;
  localUri: string;
  byteSize: number;
  mimeType: string;
  fileName: string | null;
  fingerprint: string;
}): SelectedPhoto {
  return {
    selectionId: row.selectionId,
    uri: row.localUri,
    mimeType: row.mimeType,
    byteSize: row.byteSize,
    fileName: row.fileName,
    fingerprint: row.fingerprint,
    draftPersisted: true,
    ownedTempPath: null,
    wasCompressed: false,
  };
}

async function fileLooksValid(
  fs: PhotoFileSystem,
  uri: string,
  expectedByteSize: number,
): Promise<boolean> {
  const path = stripFileScheme(uri);
  if (!(await fs.exists(path))) {
    return false;
  }
  try {
    const size = await fs.statSize(path);
    return size > 0 && size === expectedByteSize;
  } catch {
    return false;
  }
}

/**
 * Restores the last successfully persisted draft for Create Report.
 * Missing/invalid photo files are dropped from the draft (metadata + best-effort
 * unlink) and surfaced via recoveryNotice — never throws for missing files.
 */
export async function loadReportDraft(
  db: SqlDatabase,
  fs: PhotoFileSystem = getPhotoFileSystem(),
): Promise<RestoredReportDraft> {
  const draft = await getReportDraft(db);
  if (!draft) {
    return {description: '', photos: [], recoveryNotice: null};
  }

  const kept: SelectedPhoto[] = [];
  const removedUris: string[] = [];
  let missingCount = 0;

  for (const photo of draft.photos) {
    const ok = await fileLooksValid(fs, photo.localUri, photo.byteSize);
    if (!ok) {
      missingCount += 1;
      removedUris.push(photo.localUri);
      continue;
    }
    kept.push(draftRowToSelectedPhoto(photo));
  }

  if (missingCount > 0) {
    await replaceDraftPhotos(
      db,
      kept.map((photo, index) => toDraftPhotoInput(photo, index)),
    );
    await deleteLocalPhotoFiles(removedUris, fs);
  }

  const recoveryNotice =
    missingCount > 0
      ? missingCount === 1
        ? 'One draft photo was missing and was removed. Re-attach it if needed.'
        : `${missingCount} draft photos were missing and were removed. Re-attach them if needed.`
      : null;

  return {
    description: draft.description,
    photos: kept,
    recoveryNotice,
  };
}

/** Persists description text into the singleton draft (no upload job). */
export async function persistDraftDescription(
  db: SqlDatabase,
  description: string,
): Promise<void> {
  try {
    await upsertDraftDescription(db, description);
  } catch (error) {
    throw new DraftReportError(
      error instanceof Error
        ? error.message
        : 'Could not save the draft description.',
      'database',
      {cause: error},
    );
  }
}

/**
 * Copies newly selected photos into durable app storage and updates draft
 * photo rows. Already draft-persisted photos are not copied again.
 */
export async function persistDraftPhotos(
  db: SqlDatabase,
  photos: readonly SelectedPhoto[],
  fs: PhotoFileSystem = getPhotoFileSystem(),
): Promise<SelectedPhoto[]> {
  if (draftPhotoWriteInFlight) {
    throw new DraftReportError(
      'Draft photos are already being updated. Please wait.',
      'busy',
    );
  }

  draftPhotoWriteInFlight = true;
  const newlyCopied: Array<{absolutePath: string}> = [];

  try {
    const next: SelectedPhoto[] = [];

    for (let i = 0; i < photos.length; i += 1) {
      const photo = photos[i];
      if (photo.draftPersisted) {
        const stillValid = await fileLooksValid(fs, photo.uri, photo.byteSize);
        if (stillValid) {
          next.push({
            ...photo,
            draftPersisted: true,
            ownedTempPath: null,
          });
          continue;
        }
      }

      const persisted = await persistSelectedPhoto(photo, i, fs);
      newlyCopied.push({absolutePath: persisted.absolutePath});
      next.push({
        selectionId: photo.selectionId,
        uri: persisted.localUri,
        mimeType: persisted.mimeType,
        byteSize: persisted.byteSize,
        fileName: photo.fileName ?? persisted.absolutePath.split('/').pop() ?? null,
        fingerprint: photo.fingerprint,
        draftPersisted: true,
        ownedTempPath: null,
        wasCompressed: photo.wasCompressed,
      });
    }

    await replaceDraftPhotos(
      db,
      next.map((photo, index) => toDraftPhotoInput(photo, index)),
    );

    return next;
  } catch (error) {
    if (newlyCopied.length > 0) {
      await cleanupPersistedPhotos(newlyCopied, fs);
    }
    if (error instanceof DraftReportError) {
      throw error;
    }
    if (error instanceof PhotoStorageError) {
      throw new DraftReportError(error.message, 'storage', {cause: error});
    }
    throw new DraftReportError(
      error instanceof Error
        ? error.message
        : 'Could not save draft photos.',
      'database',
      {cause: error},
    );
  } finally {
    draftPhotoWriteInFlight = false;
  }
}

/**
 * Removes one draft photo from SQLite and deletes its draft-owned file.
 * Reindexes remaining photos. Never touches report_photos files.
 */
export async function removeDraftPhoto(
  db: SqlDatabase,
  photos: readonly SelectedPhoto[],
  selectionId: string,
  fs: PhotoFileSystem = getPhotoFileSystem(),
): Promise<SelectedPhoto[]> {
  if (draftPhotoWriteInFlight) {
    throw new DraftReportError(
      'Draft photos are already being updated. Please wait.',
      'busy',
    );
  }

  draftPhotoWriteInFlight = true;
  try {
    const removed = photos.find(photo => photo.selectionId === selectionId);
    const remaining = photos.filter(photo => photo.selectionId !== selectionId);

    await replaceDraftPhotos(
      db,
      remaining.map((photo, index) => toDraftPhotoInput(photo, index)),
    );

    if (removed?.draftPersisted) {
      await deleteLocalPhotoFiles([removed.uri], fs);
    }

    return remaining.map((photo, index) => ({
      ...photo,
      // sort order is implicit in array order after reindex
      draftPersisted: photo.draftPersisted === true,
    }));
  } catch (error) {
    if (error instanceof DraftReportError) {
      throw error;
    }
    throw new DraftReportError(
      error instanceof Error
        ? error.message
        : 'Could not remove the draft photo.',
      'database',
      {cause: error},
    );
  } finally {
    draftPhotoWriteInFlight = false;
  }
}

/**
 * True when every photo is already a durable draft copy on disk.
 * Used by saveLocalReport to skip a second copy into report-photos/.
 */
export async function arePhotosDraftPersistedOnDisk(
  photos: readonly SelectedPhoto[],
  fs: PhotoFileSystem = getPhotoFileSystem(),
): Promise<boolean> {
  if (photos.length === 0) {
    return false;
  }
  for (const photo of photos) {
    if (!photo.draftPersisted) {
      return false;
    }
    if (!(await fileLooksValid(fs, photo.uri, photo.byteSize))) {
      return false;
    }
  }
  return true;
}
