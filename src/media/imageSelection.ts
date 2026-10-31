import {
  launchCamera,
  launchImageLibrary,
  type Asset,
  type ImagePickerResponse,
} from 'react-native-image-picker';
import {createIdempotencyKey} from '../db/idempotency';
import {ALLOWED_IMAGE_MIME_TYPES, MAX_PHOTOS} from '../reports/constants';
import type {SelectedPhoto} from '../reports/types';
import {isAllowedImageMimeType} from '../reports/validation';
import {
  ImageCompressionError,
  prepareSelectedPhotos,
  type CompressPhotoProgress,
} from './imageCompression';
import {
  ensureCameraPermission,
  ensureGalleryPermission,
} from './permissions';

export class ImageSelectionError extends Error {
  readonly code:
    | 'permission'
    | 'cancelled'
    | 'camera_unavailable'
    | 'invalid'
    | 'limit'
    | 'duplicate'
    | 'compression'
    | 'unknown';

  constructor(
    message: string,
    code: ImageSelectionError['code'],
    options?: {cause?: unknown},
  ) {
    super(message);
    this.name = 'ImageSelectionError';
    this.code = code;
    if (options?.cause !== undefined) {
      (this as Error & {cause?: unknown}).cause = options.cause;
    }
  }
}

export type ImageSelectionResult =
  | {status: 'cancelled'}
  | {status: 'selected'; photos: SelectedPhoto[]};

function guessMimeFromFileName(fileName: string | null | undefined): string | null {
  if (!fileName) {
    return null;
  }
  const lower = fileName.toLowerCase();
  if (lower.endsWith('.jpg') || lower.endsWith('.jpeg')) {
    return 'image/jpeg';
  }
  if (lower.endsWith('.png')) {
    return 'image/png';
  }
  if (lower.endsWith('.webp')) {
    return 'image/webp';
  }
  if (lower.endsWith('.heic')) {
    return 'image/heic';
  }
  if (lower.endsWith('.heif')) {
    return 'image/heif';
  }
  if (lower.endsWith('.gif')) {
    return 'image/gif';
  }
  return null;
}

function resolveMimeType(asset: Asset): string | null {
  const raw = asset.type?.trim().toLowerCase();
  if (raw && isAllowedImageMimeType(raw)) {
    return raw === 'image/jpg' ? 'image/jpeg' : raw;
  }
  if (raw) {
    return raw;
  }
  return guessMimeFromFileName(asset.fileName);
}

function buildFingerprint(asset: Asset, uri: string): string {
  if (asset.id) {
    return `id:${asset.id}`;
  }
  if (asset.originalPath) {
    return `path:${asset.originalPath}`;
  }
  const name = asset.fileName ?? '';
  const size = asset.fileSize ?? 0;
  if (name && size > 0) {
    return `name:${name}|size:${size}`;
  }
  return `uri:${uri}`;
}

/**
 * Converts a picker asset into a SelectedPhoto, or throws with a clear error.
 * Invalid assets are never silently discarded.
 */
export function selectedPhotoFromAsset(asset: Asset): SelectedPhoto {
  const uri = asset.uri?.trim();
  if (!uri) {
    throw new ImageSelectionError(
      'Selected image is missing a local URI.',
      'invalid',
    );
  }

  const mimeType = resolveMimeType(asset);
  if (!mimeType || !isAllowedImageMimeType(mimeType)) {
    throw new ImageSelectionError(
      `Unsupported or missing image type${
        mimeType ? ` (${mimeType})` : ''
      }. Use JPEG, PNG, WebP, HEIC, or GIF.`,
      'invalid',
    );
  }

  const byteSize = asset.fileSize;
  if (typeof byteSize !== 'number' || !Number.isFinite(byteSize) || byteSize <= 0) {
    throw new ImageSelectionError(
      'Could not determine the selected image file size.',
      'invalid',
    );
  }

  // Oversized images are accepted here and compressed before attach/save.
  const normalizedMime = mimeType === 'image/jpg' ? 'image/jpeg' : mimeType;

  return {
    selectionId: createIdempotencyKey(),
    uri,
    mimeType: normalizedMime,
    byteSize,
    fileName: asset.fileName ?? null,
    fingerprint: buildFingerprint(asset, uri),
  };
}

function mapPickerFailure(response: ImagePickerResponse): never {
  if (response.didCancel) {
    throw new ImageSelectionError('Photo selection was cancelled.', 'cancelled');
  }

  if (response.errorCode === 'permission') {
    throw new ImageSelectionError(
      response.errorMessage ??
        'Permission was denied for camera or photo library.',
      'permission',
    );
  }

  if (response.errorCode === 'camera_unavailable') {
    throw new ImageSelectionError(
      response.errorMessage ?? 'Camera is not available on this device.',
      'camera_unavailable',
    );
  }

  throw new ImageSelectionError(
    response.errorMessage ?? 'Could not select a photo.',
    'unknown',
  );
}

function parsePickerResponse(
  response: ImagePickerResponse,
  existing: readonly SelectedPhoto[],
  remainingSlots: number,
): ImageSelectionResult {
  if (response.didCancel) {
    return {status: 'cancelled'};
  }

  if (response.errorCode) {
    mapPickerFailure(response);
  }

  const assets = response.assets ?? [];
  if (assets.length === 0) {
    return {status: 'cancelled'};
  }

  if (assets.length > remainingSlots) {
    throw new ImageSelectionError(
      `You can attach at most ${MAX_PHOTOS} photos.`,
      'limit',
    );
  }

  const existingFingerprints = new Set(existing.map(p => p.fingerprint));
  const selected: SelectedPhoto[] = [];

  for (const asset of assets) {
    const photo = selectedPhotoFromAsset(asset);
    if (
      existingFingerprints.has(photo.fingerprint) ||
      selected.some(p => p.fingerprint === photo.fingerprint)
    ) {
      throw new ImageSelectionError(
        'That image is already selected.',
        'duplicate',
      );
    }
    selected.push(photo);
  }

  return {status: 'selected', photos: selected};
}

const LIBRARY_OPTIONS = {
  mediaType: 'photo' as const,
  selectionLimit: MAX_PHOTOS,
  includeBase64: false,
  includeExtra: true,
  quality: 1 as const,
  restrictMimeTypes: [...ALLOWED_IMAGE_MIME_TYPES],
};

const CAMERA_OPTIONS = {
  mediaType: 'photo' as const,
  includeBase64: false,
  includeExtra: true,
  quality: 1 as const,
  saveToPhotos: false,
  cameraType: 'back' as const,
};

async function finalizeSelection(
  parsed: ImageSelectionResult,
  onProgress?: (progress: CompressPhotoProgress) => void,
): Promise<ImageSelectionResult> {
  if (parsed.status !== 'selected') {
    return parsed;
  }

  try {
    const photos = await prepareSelectedPhotos(parsed.photos, {onProgress});
    return {status: 'selected', photos};
  } catch (error) {
    if (error instanceof ImageCompressionError) {
      throw new ImageSelectionError(error.message, 'compression', {
        cause: error,
      });
    }
    throw new ImageSelectionError(
      error instanceof Error
        ? error.message
        : 'Could not prepare the selected photos.',
      'compression',
      {cause: error},
    );
  }
}

export async function pickPhotosFromGallery(
  existing: readonly SelectedPhoto[],
  onProgress?: (progress: CompressPhotoProgress) => void,
): Promise<ImageSelectionResult> {
  const remaining = MAX_PHOTOS - existing.length;
  if (remaining <= 0) {
    throw new ImageSelectionError(
      `You can attach at most ${MAX_PHOTOS} photos.`,
      'limit',
    );
  }

  const permission = await ensureGalleryPermission();
  if (!permission.granted) {
    throw new ImageSelectionError(permission.message, 'permission');
  }

  const response = await launchImageLibrary({
    ...LIBRARY_OPTIONS,
    selectionLimit: remaining,
  });

  return finalizeSelection(
    parsePickerResponse(response, existing, remaining),
    onProgress,
  );
}

export async function capturePhotoWithCamera(
  existing: readonly SelectedPhoto[],
  onProgress?: (progress: CompressPhotoProgress) => void,
): Promise<ImageSelectionResult> {
  const remaining = MAX_PHOTOS - existing.length;
  if (remaining <= 0) {
    throw new ImageSelectionError(
      `You can attach at most ${MAX_PHOTOS} photos.`,
      'limit',
    );
  }

  const permission = await ensureCameraPermission();
  if (!permission.granted) {
    throw new ImageSelectionError(permission.message, 'permission');
  }

  const response = await launchCamera(CAMERA_OPTIONS);
  return finalizeSelection(
    parsePickerResponse(response, existing, remaining),
    onProgress,
  );
}
