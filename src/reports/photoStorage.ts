import {
  copyFile,
  DocumentDirectoryPath,
  exists,
  mkdir,
  readDir,
  stat,
  unlink,
  writeFile,
} from '@dr.pogodin/react-native-fs';
import {createIdempotencyKey} from '../db/idempotency';
import {MAX_IMAGE_BYTES, REPORT_PHOTOS_DIR_NAME} from './constants';
import type {PersistPhotoResult, SelectedPhoto} from './types';
import {isAllowedImageMimeType} from './validation';

export class PhotoStorageError extends Error {
  constructor(message: string, options?: {cause?: unknown}) {
    super(message);
    this.name = 'PhotoStorageError';
    if (options?.cause !== undefined) {
      (this as Error & {cause?: unknown}).cause = options.cause;
    }
  }
}

/** Injectable FS surface so unit tests do not need native modules. */
export type PhotoFileSystem = {
  documentDirectory: string;
  exists(path: string): Promise<boolean>;
  mkdir(path: string): Promise<void>;
  copyFile(from: string, into: string): Promise<void>;
  writeFileBase64(path: string, base64: string): Promise<void>;
  unlink(path: string): Promise<void>;
  statSize(path: string): Promise<number>;
  /** Optional: list filenames for wipe helpers. */
  readDirNames?(path: string): Promise<string[]>;
  /** Copy content:// (and similar) URIs when native copyFile cannot. */
  readUriAsBase64?(uri: string): Promise<string>;
};

const MIME_TO_EXT: Record<string, string> = {
  'image/jpeg': '.jpg',
  'image/jpg': '.jpg',
  'image/png': '.png',
  'image/webp': '.webp',
  'image/heic': '.heic',
  'image/heif': '.heif',
  'image/gif': '.gif',
};

export function extensionForMimeType(mimeType: string): string {
  const normalized = mimeType.trim().toLowerCase();
  return MIME_TO_EXT[normalized] ?? '.bin';
}

export function toFileUri(absolutePath: string): string {
  if (absolutePath.startsWith('file://')) {
    return absolutePath;
  }
  return absolutePath.startsWith('/')
    ? `file://${absolutePath}`
    : `file:///${absolutePath}`;
}

export function stripFileScheme(uriOrPath: string): string {
  if (uriOrPath.startsWith('file://')) {
    return decodeURIComponent(uriOrPath.replace(/^file:\/\//, ''));
  }
  return uriOrPath;
}

function createNativePhotoFileSystem(): PhotoFileSystem {
  return {
    documentDirectory: DocumentDirectoryPath,
    exists: path => exists(path),
    mkdir: async path => {
      await mkdir(path);
    },
    copyFile: (from, into) => copyFile(from, into),
    writeFileBase64: (path, base64) => writeFile(path, base64, 'base64'),
    unlink: path => unlink(path),
    statSize: async path => {
      const info = await stat(path);
      return Number(info.size);
    },
    readDirNames: async path => {
      const entries = await readDir(path);
      return entries.map(entry => entry.name);
    },
    readUriAsBase64: async uri => {
      const response = await fetch(uri);
      if (!response.ok) {
        throw new PhotoStorageError(
          `Failed to read image (${response.status}).`,
        );
      }
      const buffer = await response.arrayBuffer();
      return arrayBufferToBase64(buffer);
    },
  };
}

function arrayBufferToBase64(buffer: ArrayBuffer): string {
  const bytes = new Uint8Array(buffer);
  const chunkSize = 0x8000;
  let binary = '';
  for (let i = 0; i < bytes.length; i += chunkSize) {
    const chunk = bytes.subarray(i, i + chunkSize);
    binary += String.fromCharCode(...chunk);
  }
  if (typeof globalThis.btoa !== 'function') {
    throw new PhotoStorageError('Base64 encoding is unavailable in this runtime.');
  }
  return globalThis.btoa(binary);
}

let activeFileSystem: PhotoFileSystem | null = null;

export function getPhotoFileSystem(): PhotoFileSystem {
  if (!activeFileSystem) {
    activeFileSystem = createNativePhotoFileSystem();
  }
  return activeFileSystem;
}

/** Test helper: inject a fake filesystem. Pass null to restore native. */
export function setPhotoFileSystemForTests(
  fileSystem: PhotoFileSystem | null,
): void {
  activeFileSystem = fileSystem;
}

export async function ensureReportPhotosDirectory(
  fs: PhotoFileSystem = getPhotoFileSystem(),
): Promise<string> {
  const dir = `${fs.documentDirectory.replace(/\/$/, '')}/${REPORT_PHOTOS_DIR_NAME}`;
  const already = await fs.exists(dir);
  if (!already) {
    await fs.mkdir(dir);
  }
  return dir;
}

async function copySourceToDestination(
  fs: PhotoFileSystem,
  sourceUri: string,
  destPath: string,
): Promise<void> {
  if (sourceUri.startsWith('content://')) {
    if (!fs.readUriAsBase64) {
      throw new PhotoStorageError(
        'Cannot copy content URI without a content reader.',
      );
    }
    const base64 = await fs.readUriAsBase64(sourceUri);
    await fs.writeFileBase64(destPath, base64);
    return;
  }

  const fromPath = stripFileScheme(sourceUri);
  try {
    await fs.copyFile(fromPath, destPath);
  } catch (copyError) {
    // Fallback for odd schemes / picker cache paths.
    if (!fs.readUriAsBase64) {
      throw new PhotoStorageError('Failed to copy photo into app storage.', {
        cause: copyError,
      });
    }
    try {
      const base64 = await fs.readUriAsBase64(sourceUri);
      await fs.writeFileBase64(destPath, base64);
    } catch (readError) {
      throw new PhotoStorageError('Failed to copy photo into app storage.', {
        cause: readError,
      });
    }
  }
}

/**
 * Copies one selected photo into app-controlled persistent storage.
 * Verifies the copy exists and its size is valid before returning.
 */
export async function persistSelectedPhoto(
  photo: SelectedPhoto,
  sortOrder: number,
  fs: PhotoFileSystem = getPhotoFileSystem(),
): Promise<PersistPhotoResult> {
  if (!isAllowedImageMimeType(photo.mimeType)) {
    throw new PhotoStorageError(
      `Unsupported or missing image type${
        photo.mimeType ? ` (${photo.mimeType})` : ''
      }.`,
    );
  }
  if (!(photo.byteSize > 0 && photo.byteSize < MAX_IMAGE_BYTES)) {
    throw new PhotoStorageError('Each image must be smaller than 5 MB.');
  }

  const dir = await ensureReportPhotosDirectory(fs);
  const ext = extensionForMimeType(photo.mimeType);
  const fileName = `${createIdempotencyKey()}${ext}`;
  const absolutePath = `${dir}/${fileName}`;

  try {
    await copySourceToDestination(fs, photo.uri, absolutePath);

    const fileExists = await fs.exists(absolutePath);
    if (!fileExists) {
      throw new PhotoStorageError('Copied photo is missing on disk.');
    }

    const copiedSize = await fs.statSize(absolutePath);
    if (!(copiedSize > 0 && copiedSize < MAX_IMAGE_BYTES)) {
      await safeUnlink(fs, absolutePath);
      throw new PhotoStorageError(
        'Copied photo failed size verification (must be under 5 MB).',
      );
    }

    return {
      localUri: toFileUri(absolutePath),
      absolutePath,
      byteSize: copiedSize,
      mimeType: photo.mimeType.trim().toLowerCase(),
      sortOrder,
    };
  } catch (error) {
    await safeUnlink(fs, absolutePath);
    if (error instanceof PhotoStorageError) {
      throw error;
    }
    throw new PhotoStorageError('Failed to copy photo into app storage.', {
      cause: error,
    });
  }
}

export async function persistSelectedPhotos(
  photos: readonly SelectedPhoto[],
  fs: PhotoFileSystem = getPhotoFileSystem(),
): Promise<PersistPhotoResult[]> {
  const persisted: PersistPhotoResult[] = [];
  try {
    for (let i = 0; i < photos.length; i += 1) {
      const result = await persistSelectedPhoto(photos[i], i, fs);
      persisted.push(result);
    }
    return persisted;
  } catch (error) {
    await cleanupPersistedPhotos(persisted, fs);
    throw error;
  }
}

export async function cleanupPersistedPhotos(
  photos: readonly Pick<PersistPhotoResult, 'absolutePath'>[],
  fs: PhotoFileSystem = getPhotoFileSystem(),
): Promise<void> {
  for (const photo of photos) {
    await safeUnlink(fs, photo.absolutePath);
  }
}

/**
 * Best-effort delete of on-disk photo files referenced by local URIs.
 * Missing files and unlink failures are ignored (no throw).
 */
export async function deleteLocalPhotoFiles(
  uris: readonly string[],
  fs: PhotoFileSystem = getPhotoFileSystem(),
): Promise<void> {
  for (const uri of uris) {
    await safeUnlink(fs, stripFileScheme(uri));
  }
}

/**
 * Best-effort wipe of the app-owned report-photos directory.
 * Missing directory / files are ignored. Never touches the gallery.
 */
export async function wipeReportPhotosDirectory(
  fs: PhotoFileSystem = getPhotoFileSystem(),
): Promise<number> {
  const dir = `${fs.documentDirectory.replace(/\/$/, '')}/${REPORT_PHOTOS_DIR_NAME}`;
  if (!(await fs.exists(dir))) {
    return 0;
  }
  if (!fs.readDirNames) {
    return 0;
  }

  let removed = 0;
  try {
    const names = await fs.readDirNames(dir);
    for (const name of names) {
      const absolutePath = `${dir}/${name}`;
      const before = await fs.exists(absolutePath);
      await safeUnlink(fs, absolutePath);
      if (before && !(await fs.exists(absolutePath))) {
        removed += 1;
      }
    }
  } catch {
    // Best-effort only.
  }
  return removed;
}

async function safeUnlink(fs: PhotoFileSystem, path: string): Promise<void> {
  try {
    if (await fs.exists(path)) {
      await fs.unlink(path);
    }
  } catch {
    // Best-effort cleanup only.
  }
}
