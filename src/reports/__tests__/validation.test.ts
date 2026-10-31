import {MAX_IMAGE_BYTES} from '../constants';
import type {SelectedPhoto} from '../types';
import {
  isAllowedImageMimeType,
  isImageUnderSizeLimit,
  validateCreateReportInput,
  validateDescription,
  validatePhotoCount,
  validateSelectedPhoto,
} from '../validation';

function photo(
  overrides: Partial<SelectedPhoto> = {},
): SelectedPhoto {
  return {
    selectionId: 'sel-1',
    uri: 'file:///tmp/a.jpg',
    mimeType: 'image/jpeg',
    byteSize: 1024,
    fileName: 'a.jpg',
    fingerprint: 'uri:file:///tmp/a.jpg',
    ...overrides,
  };
}

describe('create report validation', () => {
  test('rejects empty / whitespace-only description', () => {
    expect(validateDescription('')).toEqual({
      field: 'description',
      message: 'Description is required.',
    });
    expect(validateDescription('   \n\t  ')).toEqual({
      field: 'description',
      message: 'Description is required.',
    });
    expect(validateDescription(' Fence down ')).toBeNull();
  });

  test('enforces photo count 1–5', () => {
    expect(validatePhotoCount(0)?.message).toMatch(/at least 1/i);
    expect(validatePhotoCount(1)).toBeNull();
    expect(validatePhotoCount(5)).toBeNull();
    expect(validatePhotoCount(6)?.message).toMatch(/at most 5/i);
  });

  test('rejects exactly 5 MB and larger', () => {
    expect(isImageUnderSizeLimit(MAX_IMAGE_BYTES - 1)).toBe(true);
    expect(isImageUnderSizeLimit(MAX_IMAGE_BYTES)).toBe(false);
    expect(isImageUnderSizeLimit(MAX_IMAGE_BYTES + 1)).toBe(false);

    const issue = validateSelectedPhoto(
      photo({byteSize: MAX_IMAGE_BYTES}),
      0,
    );
    expect(issue?.message).toMatch(/smaller than 5 MB/i);
  });

  test('rejects unsupported or missing MIME types', () => {
    expect(isAllowedImageMimeType('image/jpeg')).toBe(true);
    expect(isAllowedImageMimeType('image/png')).toBe(true);
    expect(isAllowedImageMimeType(undefined)).toBe(false);
    expect(isAllowedImageMimeType('')).toBe(false);
    expect(isAllowedImageMimeType('application/pdf')).toBe(false);

    const issue = validateSelectedPhoto(
      photo({mimeType: 'application/pdf'}),
      2,
    );
    expect(issue?.photoIndex).toBe(2);
    expect(issue?.message).toMatch(/unsupported or missing/i);
  });

  test('aggregates form issues without silently dropping photos', () => {
    const result = validateCreateReportInput('  ', [
      photo({mimeType: 'text/plain', byteSize: MAX_IMAGE_BYTES}),
    ]);
    expect(result.ok).toBe(false);
    if (result.ok) {
      return;
    }
    expect(result.issues.some(i => i.field === 'description')).toBe(true);
    expect(result.issues.some(i => i.field === 'photo')).toBe(true);
  });

  test('accepts a valid description + photos payload', () => {
    const result = validateCreateReportInput('Broken fence', [
      photo(),
      photo({
        selectionId: 'sel-2',
        uri: 'file:///tmp/b.png',
        mimeType: 'image/png',
        fingerprint: 'uri:file:///tmp/b.png',
      }),
    ]);
    expect(result).toEqual({ok: true});
  });
});
