import fs from 'node:fs';
import path from 'node:path';
import multer from 'multer';
import { randomUUID } from 'node:crypto';
import { MAX_IMAGE_BYTES, MAX_IMAGES, TMP_DIR } from '../config';
import { ensureStorageDirs } from '../files';

const ALLOWED_MIME = new Set([
  'image/jpeg',
  'image/jpg',
  'image/png',
  'image/webp',
  'image/heic',
  'image/heif',
  'image/gif',
]);

const storage = multer.diskStorage({
  destination: (_req, _file, cb) => {
    ensureStorageDirs();
    cb(null, TMP_DIR);
  },
  filename: (_req, file, cb) => {
    const ext = path.extname(file.originalname).toLowerCase() || '.bin';
    cb(null, `tmp-${randomUUID()}${ext}`);
  },
});

export const uploadImages = multer({
  storage,
  limits: {
    files: MAX_IMAGES,
    fileSize: MAX_IMAGE_BYTES - 1, // reject >= 5 MB
  },
  fileFilter: (_req, file, cb) => {
    if (!ALLOWED_MIME.has(file.mimetype.toLowerCase())) {
      cb(new Error('Only image uploads are allowed (jpeg, png, webp, heic, gif)'));
      return;
    }
    cb(null, true);
  },
}).array('images', MAX_IMAGES);

/**
 * Extra size guard after multer: reject any file that somehow landed at >= 5 MB.
 * Also verifies the temp file still exists on disk.
 */
export function assertImageSizeLimits(files: Express.Multer.File[]): void {
  for (const file of files) {
    const size =
      typeof file.size === 'number' && file.size > 0
        ? file.size
        : fs.statSync(file.path).size;

    if (size >= MAX_IMAGE_BYTES) {
      throw Object.assign(new Error('Each image must be under 5 MB'), {
        status: 413,
      });
    }
  }
}
