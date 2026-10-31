import {CachesDirectoryPath, exists, stat, unlink} from '@dr.pogodin/react-native-fs';
import {
  compressImage,
  type CompressionResult,
} from 'react-native-image-compression-kit';
import {MAX_IMAGE_BYTES} from '../reports/constants';
import type {SelectedPhoto} from '../reports/types';
import {isImageUnderSizeLimit} from '../reports/validation';
import {stripFileScheme, toFileUri} from '../reports/photoStorage';
import {
  COMPRESSION_MAX_BYTES,
  COMPRESSION_MAX_EDGE_STEPS,
  COMPRESSION_OUTPUT_EXT,
  COMPRESSION_OUTPUT_MIME,
  COMPRESSION_QUALITY_STEPS,
} from './compressionConstants';

export class ImageCompressionError extends Error {
  readonly code: 'failed' | 'oversized' | 'invalid' | 'cancelled';

  constructor(
    message: string,
    code: ImageCompressionError['code'],
    options?: {cause?: unknown},
  ) {
    super(message);
    this.name = 'ImageCompressionError';
    this.code = code;
    if (options?.cause !== undefined) {
      (this as Error & {cause?: unknown}).cause = options.cause;
    }
  }
}

export type CompressEngineRequest = {
  uri: string;
  maxWidth: number;
  maxHeight: number;
  /** JPEG quality 0–100. */
  quality: number;
  maxBytes: number;
};

export type CompressEngineResult = {
  uri: string;
  byteSize: number;
  width: number;
  height: number;
};

/** Injectable native compressor — keeps screens free of kit details. */
export type CompressEngine = {
  compress(request: CompressEngineRequest): Promise<CompressEngineResult>;
};

export type CompressionFileSystem = {
  cachesDirectory: string;
  exists(path: string): Promise<boolean>;
  unlink(path: string): Promise<void>;
  statSize(path: string): Promise<number>;
};

export type CompressPhotoProgress = {
  index: number;
  total: number;
  phase: 'checking' | 'compressing' | 'verifying' | 'done';
  /** Human-readable status for UI. */
  message: string;
};

export type PreparedPhoto = SelectedPhoto & {
  /**
   * Absolute path of an app-owned compressed temp file.
   * Safe to delete after permanent persist; never a gallery original.
   */
  ownedTempPath?: string | null;
  wasCompressed?: boolean;
};

/**
 * Scales to fit inside maxWidth×maxHeight while preserving aspect ratio.
 * Never upscales.
 */
export function computeContainDimensions(
  sourceWidth: number,
  sourceHeight: number,
  maxWidth: number,
  maxHeight: number,
): {width: number; height: number} {
  if (
    !Number.isFinite(sourceWidth) ||
    !Number.isFinite(sourceHeight) ||
    sourceWidth <= 0 ||
    sourceHeight <= 0
  ) {
    return {
      width: Math.max(1, Math.round(maxWidth)),
      height: Math.max(1, Math.round(maxHeight)),
    };
  }

  const scale = Math.min(1, maxWidth / sourceWidth, maxHeight / sourceHeight);
  return {
    width: Math.max(1, Math.round(sourceWidth * scale)),
    height: Math.max(1, Math.round(sourceHeight * scale)),
  };
}

export function jpegFileNameFrom(original: string | null | undefined): string {
  if (!original || original.trim() === '') {
    return `photo${COMPRESSION_OUTPUT_EXT}`;
  }
  const trimmed = original.trim();
  if (/\.jpe?g$/i.test(trimmed)) {
    return trimmed.replace(/\.jpe?g$/i, COMPRESSION_OUTPUT_EXT);
  }
  return trimmed.replace(/\.[^.]+$/, COMPRESSION_OUTPUT_EXT);
}

function createNativeCompressEngine(): CompressEngine {
  return {
    async compress(request) {
      const result: CompressionResult = await compressImage({
        source: {uri: request.uri},
        resize: {
          maxWidth: request.maxWidth,
          maxHeight: request.maxHeight,
          mode: 'contain',
        },
        output: {
          format: 'jpeg',
          quality: request.quality,
          maxBytes: request.maxBytes,
        },
        metadata: 'safe',
      });
      return {
        uri: result.uri,
        byteSize: result.byteSize,
        width: result.width,
        height: result.height,
      };
    },
  };
}

function createNativeCompressionFileSystem(): CompressionFileSystem {
  return {
    cachesDirectory: CachesDirectoryPath,
    exists: path => exists(path),
    unlink: path => unlink(path),
    statSize: async path => {
      const info = await stat(path);
      return Number(info.size);
    },
  };
}

let activeEngine: CompressEngine | null = null;
let activeFs: CompressionFileSystem | null = null;

export function getCompressEngine(): CompressEngine {
  if (!activeEngine) {
    activeEngine = createNativeCompressEngine();
  }
  return activeEngine;
}

export function getCompressionFileSystem(): CompressionFileSystem {
  if (!activeFs) {
    activeFs = createNativeCompressionFileSystem();
  }
  return activeFs;
}

/** Test helpers. */
export function setCompressEngineForTests(engine: CompressEngine | null): void {
  activeEngine = engine;
}

export function setCompressionFileSystemForTests(
  fs: CompressionFileSystem | null,
): void {
  activeFs = fs;
}

async function safeUnlink(
  fs: CompressionFileSystem,
  path: string | null | undefined,
): Promise<void> {
  if (!path) {
    return;
  }
  try {
    if (await fs.exists(path)) {
      await fs.unlink(path);
    }
  } catch {
    // Best-effort cleanup only.
  }
}

/**
 * Deletes app-owned compression temps. Never touches gallery/camera originals.
 */
export async function cleanupOwnedCompressionTemps(
  photos: readonly Pick<PreparedPhoto, 'ownedTempPath'>[],
  fs: CompressionFileSystem = getCompressionFileSystem(),
): Promise<void> {
  for (const photo of photos) {
    await safeUnlink(fs, photo.ownedTempPath);
  }
}

async function measureOutputBytes(
  fs: CompressionFileSystem,
  uri: string,
  reportedBytes: number,
): Promise<{byteSize: number; absolutePath: string}> {
  const absolutePath = stripFileScheme(uri);
  try {
    if (await fs.exists(absolutePath)) {
      const measured = await fs.statSize(absolutePath);
      if (Number.isFinite(measured) && measured > 0) {
        return {byteSize: measured, absolutePath};
      }
    }
  } catch {
    // Fall through to reported size.
  }
  if (Number.isFinite(reportedBytes) && reportedBytes > 0) {
    return {byteSize: reportedBytes, absolutePath};
  }
  throw new ImageCompressionError(
    'Could not verify compressed image size.',
    'failed',
  );
}

/**
 * Compresses one photo until the on-disk size is strictly below MAX_IMAGE_BYTES.
 * Always encodes oversized inputs as JPEG. Never modifies the source URI file.
 */
export async function ensurePhotoUnderSizeLimit(
  photo: SelectedPhoto,
  options?: {
    engine?: CompressEngine;
    fs?: CompressionFileSystem;
    maxBytes?: number;
  },
): Promise<PreparedPhoto> {
  const engine = options?.engine ?? getCompressEngine();
  const fs = options?.fs ?? getCompressionFileSystem();
  const limit = options?.maxBytes ?? MAX_IMAGE_BYTES;

  if (!(photo.byteSize > 0)) {
    throw new ImageCompressionError(
      'Selected image has an invalid file size.',
      'invalid',
    );
  }

  if (photo.byteSize < limit) {
    return {
      ...photo,
      ownedTempPath: photo.ownedTempPath ?? null,
      wasCompressed: photo.wasCompressed === true,
    };
  }

  const attemptTemps: string[] = [];
  let lastError: unknown;

  try {
    for (const maxEdge of COMPRESSION_MAX_EDGE_STEPS) {
      for (const quality of COMPRESSION_QUALITY_STEPS) {
        try {
          const compressed = await engine.compress({
            uri: photo.uri,
            maxWidth: maxEdge,
            maxHeight: maxEdge,
            quality,
            maxBytes: Math.min(COMPRESSION_MAX_BYTES, limit - 1),
          });

          const measured = await measureOutputBytes(
            fs,
            compressed.uri,
            compressed.byteSize,
          );
          attemptTemps.push(measured.absolutePath);

          if (measured.byteSize > 0 && measured.byteSize < limit) {
            // Keep the accepted temp; delete earlier failed attempts.
            for (const temp of attemptTemps) {
              if (temp !== measured.absolutePath) {
                await safeUnlink(fs, temp);
              }
            }

            return {
              ...photo,
              uri: toFileUri(measured.absolutePath),
              mimeType: COMPRESSION_OUTPUT_MIME,
              byteSize: measured.byteSize,
              fileName: jpegFileNameFrom(photo.fileName),
              ownedTempPath: measured.absolutePath,
              wasCompressed: true,
            };
          }
        } catch (error) {
          lastError = error;
        }
      }
    }

    for (const temp of attemptTemps) {
      await safeUnlink(fs, temp);
    }

    throw new ImageCompressionError(
      'Could not compress this image below 5 MB while keeping usable quality. Try a smaller photo.',
      'oversized',
      {cause: lastError},
    );
  } catch (error) {
    for (const temp of attemptTemps) {
      await safeUnlink(fs, temp);
    }
    if (error instanceof ImageCompressionError) {
      throw error;
    }
    throw new ImageCompressionError(
      error instanceof Error
        ? error.message
        : 'Image compression failed. Please try another photo.',
      'failed',
      {cause: error},
    );
  }
}

/**
 * Ensures every selected photo is strictly under the size limit.
 * Oversized inputs are compressed asynchronously; already-small images pass through.
 */
export async function prepareSelectedPhotos(
  photos: readonly SelectedPhoto[],
  options?: {
    engine?: CompressEngine;
    fs?: CompressionFileSystem;
    maxBytes?: number;
    onProgress?: (progress: CompressPhotoProgress) => void;
  },
): Promise<PreparedPhoto[]> {
  const prepared: PreparedPhoto[] = [];
  const total = photos.length;

  try {
    for (let index = 0; index < photos.length; index += 1) {
      const photo = photos[index];
      const needsCompression = !isImageUnderSizeLimit(photo.byteSize);

      options?.onProgress?.({
        index,
        total,
        phase: needsCompression ? 'compressing' : 'checking',
        message: needsCompression
          ? `Optimizing photo ${index + 1} of ${total}…`
          : `Checking photo ${index + 1} of ${total}…`,
      });

      const result = await ensurePhotoUnderSizeLimit(photo, {
        engine: options?.engine,
        fs: options?.fs,
        maxBytes: options?.maxBytes,
      });

      if (!isImageUnderSizeLimit(result.byteSize)) {
        throw new ImageCompressionError(
          `Photo ${index + 1} is still ${result.byteSize} bytes after compression (must be under 5 MB).`,
          'oversized',
        );
      }

      options?.onProgress?.({
        index,
        total,
        phase: 'done',
        message: `Ready photo ${index + 1} of ${total}`,
      });

      prepared.push(result);
    }
    return prepared;
  } catch (error) {
    await cleanupOwnedCompressionTemps(prepared, options?.fs);
    throw error;
  }
}

/** Exactly 5 MB is never acceptable. */
export function isAcceptableCompressedByteSize(byteSize: number): boolean {
  return isImageUnderSizeLimit(byteSize);
}
