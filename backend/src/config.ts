import path from 'node:path';

export const PORT = Number(process.env.PORT ?? 3000);

export const ROOT_DIR = path.resolve(__dirname, '..');
export const DATA_DIR = path.join(ROOT_DIR, 'data');
export const UPLOADS_DIR = path.join(ROOT_DIR, 'uploads');
export const TMP_DIR = path.join(ROOT_DIR, 'tmp');
export const DB_PATH = path.join(DATA_DIR, 'fieldreports.sqlite');

/** Hard limit for each uploaded image (bytes). Images >= this size are rejected. */
export const MAX_IMAGE_BYTES = 5 * 1024 * 1024;

export const MIN_IMAGES = 1;
export const MAX_IMAGES = 5;
