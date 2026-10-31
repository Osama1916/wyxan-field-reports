/** Align with backend image limits. */

export const MIN_PHOTOS = 1;
export const MAX_PHOTOS = 5;

/** Images must be strictly smaller than this (exactly 5 MB is rejected). */
export const MAX_IMAGE_BYTES = 5 * 1024 * 1024;

export const ALLOWED_IMAGE_MIME_TYPES = [
  'image/jpeg',
  'image/jpg',
  'image/png',
  'image/webp',
  'image/heic',
  'image/heif',
  'image/gif',
] as const;

export type AllowedImageMimeType = (typeof ALLOWED_IMAGE_MIME_TYPES)[number];

export const REPORT_PHOTOS_DIR_NAME = 'report-photos';
