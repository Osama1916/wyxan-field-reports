jest.mock('react-native-image-picker', () => ({
  launchCamera: jest.fn(),
  launchImageLibrary: jest.fn(),
}));

jest.mock('@dr.pogodin/react-native-fs', () => ({
  CachesDirectoryPath: '/cache',
  exists: jest.fn(),
  mkdir: jest.fn(),
  stat: jest.fn(),
  unlink: jest.fn(),
}));

jest.mock('react-native-image-compression-kit', () => ({
  compressImage: jest.fn(),
}));

jest.mock('../permissions', () => ({
  ensureCameraPermission: jest.fn(async () => ({granted: true})),
  ensureGalleryPermission: jest.fn(async () => ({granted: true})),
}));

import {MAX_IMAGE_BYTES} from '../../reports/constants';
import {
  ImageSelectionError,
  selectedPhotoFromAsset,
} from '../imageSelection';

describe('selectedPhotoFromAsset', () => {
  test('accepts a valid jpeg asset', () => {
    const photo = selectedPhotoFromAsset({
      uri: 'file:///tmp/ok.jpg',
      type: 'image/jpeg',
      fileSize: 2048,
      fileName: 'ok.jpg',
      id: 'asset-1',
    });
    expect(photo.uri).toBe('file:///tmp/ok.jpg');
    expect(photo.mimeType).toBe('image/jpeg');
    expect(photo.byteSize).toBe(2048);
    expect(photo.fingerprint).toBe('id:asset-1');
  });

  test('rejects missing URI', () => {
    expect(() =>
      selectedPhotoFromAsset({
        type: 'image/jpeg',
        fileSize: 100,
      }),
    ).toThrow(ImageSelectionError);
  });

  test('rejects unsupported MIME type (does not discard silently)', () => {
    expect(() =>
      selectedPhotoFromAsset({
        uri: 'file:///tmp/doc.pdf',
        type: 'application/pdf',
        fileSize: 100,
      }),
    ).toThrow(/unsupported or missing/i);
  });

  test('accepts images at or above 5 MB for later compression', () => {
    const photo = selectedPhotoFromAsset({
      uri: 'file:///tmp/big.jpg',
      type: 'image/jpeg',
      fileSize: MAX_IMAGE_BYTES,
      fileName: 'big.jpg',
    });
    expect(photo.byteSize).toBe(MAX_IMAGE_BYTES);
    expect(photo.uri).toBe('file:///tmp/big.jpg');
  });
});
