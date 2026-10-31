import {
  ALLOWED_IMAGE_MIME_TYPES,
  MAX_IMAGE_BYTES,
  MAX_PHOTOS,
  MIN_PHOTOS,
} from './constants';
import type {
  ReportValidationIssue,
  ReportValidationResult,
  SelectedPhoto,
} from './types';

const ALLOWED_MIME_SET = new Set<string>(
  ALLOWED_IMAGE_MIME_TYPES.map(m => m.toLowerCase()),
);

export function isAllowedImageMimeType(mimeType: string | null | undefined): boolean {
  if (mimeType == null || mimeType.trim() === '') {
    return false;
  }
  return ALLOWED_MIME_SET.has(mimeType.trim().toLowerCase());
}

export function isImageUnderSizeLimit(byteSize: number): boolean {
  return Number.isFinite(byteSize) && byteSize > 0 && byteSize < MAX_IMAGE_BYTES;
}

export function validateDescription(
  description: string,
): ReportValidationIssue | null {
  if (description.trim() === '') {
    return {
      field: 'description',
      message: 'Description is required.',
    };
  }
  return null;
}

export function validatePhotoCount(
  count: number,
): ReportValidationIssue | null {
  if (count < MIN_PHOTOS) {
    return {
      field: 'photos',
      message: `Add at least ${MIN_PHOTOS} photo.`,
    };
  }
  if (count > MAX_PHOTOS) {
    return {
      field: 'photos',
      message: `You can attach at most ${MAX_PHOTOS} photos.`,
    };
  }
  return null;
}

export function validateSelectedPhoto(
  photo: SelectedPhoto,
  index: number,
): ReportValidationIssue | null {
  if (!isAllowedImageMimeType(photo.mimeType)) {
    return {
      field: 'photo',
      photoIndex: index,
      message: `Photo ${index + 1}: unsupported or missing image type${
        photo.mimeType ? ` (${photo.mimeType})` : ''
      }. Use JPEG, PNG, WebP, HEIC, or GIF.`,
    };
  }

  if (!Number.isFinite(photo.byteSize) || photo.byteSize <= 0) {
    return {
      field: 'photo',
      photoIndex: index,
      message: `Photo ${index + 1}: file size could not be determined.`,
    };
  }

  if (photo.byteSize >= MAX_IMAGE_BYTES) {
    return {
      field: 'photo',
      photoIndex: index,
      message: `Photo ${index + 1}: each image must be smaller than 5 MB.`,
    };
  }

  return null;
}

/**
 * Full form validation. Collects all issues (does not silently drop photos).
 */
export function validateCreateReportInput(
  description: string,
  photos: readonly SelectedPhoto[],
): ReportValidationResult {
  const issues: ReportValidationIssue[] = [];

  const descriptionIssue = validateDescription(description);
  if (descriptionIssue) {
    issues.push(descriptionIssue);
  }

  const countIssue = validatePhotoCount(photos.length);
  if (countIssue) {
    issues.push(countIssue);
  }

  photos.forEach((photo, index) => {
    const photoIssue = validateSelectedPhoto(photo, index);
    if (photoIssue) {
      issues.push(photoIssue);
    }
  });

  if (issues.length > 0) {
    return {ok: false, issues};
  }
  return {ok: true};
}

export function formatValidationIssues(
  issues: readonly ReportValidationIssue[],
): string {
  return issues.map(issue => issue.message).join('\n');
}
