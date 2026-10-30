import fs from 'node:fs';
import path from 'node:path';
import { TMP_DIR, UPLOADS_DIR } from './config';

export function ensureStorageDirs(): void {
  fs.mkdirSync(UPLOADS_DIR, { recursive: true });
  fs.mkdirSync(TMP_DIR, { recursive: true });
}

export function removeFileQuietly(filePath: string | undefined): void {
  if (!filePath) {
    return;
  }
  try {
    if (fs.existsSync(filePath)) {
      fs.unlinkSync(filePath);
    }
  } catch {
    // Best-effort cleanup; never fail the request because of cleanup.
  }
}

export function cleanupTempFiles(
  files: Array<Express.Multer.File> | undefined,
): void {
  if (!files) {
    return;
  }
  for (const file of files) {
    removeFileQuietly(file.path);
  }
}

export function moveTempToUploads(
  tempPath: string,
  filename: string,
): string {
  const destination = path.join(UPLOADS_DIR, filename);
  fs.renameSync(tempPath, destination);
  return destination;
}

/** Deletes every file in uploads/ that is not listed in keepFilenames. */
export function purgeUploadsExcept(keepFilenames: Set<string>): number {
  if (!fs.existsSync(UPLOADS_DIR)) {
    return 0;
  }

  let removed = 0;
  for (const name of fs.readdirSync(UPLOADS_DIR)) {
    if (name === '.gitkeep') {
      continue;
    }
    if (keepFilenames.has(name)) {
      continue;
    }
    removeFileQuietly(path.join(UPLOADS_DIR, name));
    removed += 1;
  }
  return removed;
}

/** Removes all uploaded image files (used by admin reset). */
export function purgeAllUploads(): number {
  return purgeUploadsExcept(new Set());
}

/** Best-effort wipe of leftover multer temp files. */
export function purgeTmpDir(): number {
  if (!fs.existsSync(TMP_DIR)) {
    return 0;
  }
  let removed = 0;
  for (const name of fs.readdirSync(TMP_DIR)) {
    if (name === '.gitkeep') {
      continue;
    }
    removeFileQuietly(path.join(TMP_DIR, name));
    removed += 1;
  }
  return removed;
}
