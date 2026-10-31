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

import {MAX_IMAGE_BYTES} from '../../reports/constants';
import type {SelectedPhoto} from '../../reports/types';
import {
  cleanupOwnedCompressionTemps,
  computeContainDimensions,
  ensurePhotoUnderSizeLimit,
  ImageCompressionError,
  isAcceptableCompressedByteSize,
  jpegFileNameFrom,
  prepareSelectedPhotos,
  setCompressEngineForTests,
  setCompressionFileSystemForTests,
  type CompressEngine,
  type CompressionFileSystem,
} from '../imageCompression';

function makePhoto(
  overrides: Partial<SelectedPhoto> & Pick<SelectedPhoto, 'uri' | 'byteSize'>,
): SelectedPhoto {
  return {
    selectionId: overrides.selectionId ?? 'sel-1',
    mimeType: overrides.mimeType ?? 'image/jpeg',
    fileName: overrides.fileName ?? 'photo.jpg',
    fingerprint: overrides.fingerprint ?? `fp-${overrides.uri}`,
    ...overrides,
  };
}

function makeMemoryFs(initial: Record<string, number> = {}): {
  fs: CompressionFileSystem;
  files: Map<string, number>;
  unlinked: string[];
} {
  const files = new Map<string, number>(Object.entries(initial));
  const unlinked: string[] = [];
  const fs: CompressionFileSystem = {
    cachesDirectory: '/cache',
    exists: async path => files.has(path),
    unlink: async path => {
      files.delete(path);
      unlinked.push(path);
    },
    statSize: async path => {
      const size = files.get(path);
      if (size == null) {
        throw new Error(`missing ${path}`);
      }
      return size;
    },
  };
  return {fs, files, unlinked};
}

describe('imageCompression helpers', () => {
  test('preserves aspect ratio when fitting inside bounds', () => {
    expect(computeContainDimensions(4000, 3000, 2000, 2000)).toEqual({
      width: 2000,
      height: 1500,
    });
    expect(computeContainDimensions(3000, 4000, 2000, 2000)).toEqual({
      width: 1500,
      height: 2000,
    });
    expect(computeContainDimensions(800, 600, 2000, 2000)).toEqual({
      width: 800,
      height: 600,
    });
  });

  test('jpegFileNameFrom replaces extensions safely', () => {
    expect(jpegFileNameFrom('gate.HEIC')).toBe('gate.jpg');
    expect(jpegFileNameFrom('shot.jpeg')).toBe('shot.jpg');
    expect(jpegFileNameFrom(null)).toBe('photo.jpg');
  });

  test('accepts sizes strictly below 5 MB and rejects exactly 5 MB', () => {
    expect(isAcceptableCompressedByteSize(MAX_IMAGE_BYTES - 1)).toBe(true);
    expect(isAcceptableCompressedByteSize(MAX_IMAGE_BYTES)).toBe(false);
    expect(isAcceptableCompressedByteSize(MAX_IMAGE_BYTES + 1)).toBe(false);
  });
});

describe('ensurePhotoUnderSizeLimit', () => {
  afterEach(() => {
    setCompressEngineForTests(null);
    setCompressionFileSystemForTests(null);
  });

  test('passes through images already below 5 MB without compressing', async () => {
    const calls: unknown[] = [];
    const engine: CompressEngine = {
      compress: async request => {
        calls.push(request);
        return {
          uri: 'file:///cache/should-not-run.jpg',
          byteSize: 10,
          width: 10,
          height: 10,
        };
      },
    };
    setCompressEngineForTests(engine);

    const photo = makePhoto({
      uri: 'file:///gallery/original.jpg',
      byteSize: 2 * 1024 * 1024,
      fileName: 'original.jpg',
    });
    const result = await ensurePhotoUnderSizeLimit(photo);
    expect(result.uri).toBe(photo.uri);
    expect(result.byteSize).toBe(photo.byteSize);
    expect(result.wasCompressed).toBe(false);
    expect(calls).toHaveLength(0);
  });

  test('compresses images above 5 MB and accepts output strictly below the limit', async () => {
    const {fs, files} = makeMemoryFs();
    let attempt = 0;
    const engine: CompressEngine = {
      compress: async () => {
        attempt += 1;
        const path = `/cache/out-${attempt}.jpg`;
        const byteSize =
          attempt === 1 ? MAX_IMAGE_BYTES + 1000 : MAX_IMAGE_BYTES - 50;
        files.set(path, byteSize);
        return {
          uri: `file://${path}`,
          byteSize,
          width: 1600,
          height: 1200,
        };
      },
    };

    const result = await ensurePhotoUnderSizeLimit(
      makePhoto({
        uri: 'content://media/huge',
        byteSize: 12 * 1024 * 1024,
        mimeType: 'image/heic',
        fileName: 'huge.heic',
      }),
      {engine, fs},
    );

    expect(attempt).toBeGreaterThanOrEqual(2);
    expect(result.wasCompressed).toBe(true);
    expect(result.mimeType).toBe('image/jpeg');
    expect(result.fileName).toBe('huge.jpg');
    expect(result.byteSize).toBe(MAX_IMAGE_BYTES - 50);
    expect(result.byteSize).toBeLessThan(MAX_IMAGE_BYTES);
    expect(result.ownedTempPath).toBe('/cache/out-2.jpg');
    expect(files.has('/cache/out-1.jpg')).toBe(false);
    expect(files.has('/cache/out-2.jpg')).toBe(true);
  });

  test('requires multiple quality reductions before accepting', async () => {
    const {fs, files} = makeMemoryFs();
    const qualities: number[] = [];
    const engine: CompressEngine = {
      compress: async request => {
        qualities.push(request.quality);
        const path = `/cache/q-${request.quality}.jpg`;
        const byteSize =
          request.quality > 55 ? MAX_IMAGE_BYTES + 5000 : MAX_IMAGE_BYTES - 1;
        files.set(path, byteSize);
        return {
          uri: `file://${path}`,
          byteSize,
          width: request.maxWidth,
          height: Math.round(request.maxWidth * 0.75),
        };
      },
    };

    const result = await ensurePhotoUnderSizeLimit(
      makePhoto({uri: 'file:///big.jpg', byteSize: 9_000_000}),
      {engine, fs},
    );

    expect(qualities[0]).toBe(85);
    expect(qualities).toContain(55);
    expect(result.byteSize).toBe(MAX_IMAGE_BYTES - 1);
    expect(result.wasCompressed).toBe(true);
  });

  test('rejects output that remains exactly 5 MB after compression', async () => {
    const {fs, files, unlinked} = makeMemoryFs();
    const engine: CompressEngine = {
      compress: async request => {
        const path = `/cache/exact-${request.quality}-${request.maxWidth}.jpg`;
        files.set(path, MAX_IMAGE_BYTES);
        return {
          uri: `file://${path}`,
          byteSize: MAX_IMAGE_BYTES,
          width: request.maxWidth,
          height: request.maxHeight,
        };
      },
    };

    await expect(
      ensurePhotoUnderSizeLimit(
        makePhoto({uri: 'file:///exact.jpg', byteSize: 8_000_000}),
        {engine, fs},
      ),
    ).rejects.toBeInstanceOf(ImageCompressionError);

    expect(unlinked.length).toBeGreaterThan(0);
    expect(files.size).toBe(0);
  });

  test('cleans up temps when compression engine fails', async () => {
    const {fs, files, unlinked} = makeMemoryFs();
    let calls = 0;
    const engine: CompressEngine = {
      compress: async () => {
        calls += 1;
        if (calls === 1) {
          const path = '/cache/partial.jpg';
          files.set(path, MAX_IMAGE_BYTES + 10);
          return {
            uri: `file://${path}`,
            byteSize: MAX_IMAGE_BYTES + 10,
            width: 100,
            height: 100,
          };
        }
        throw new Error('native compressor crashed');
      },
    };

    await expect(
      ensurePhotoUnderSizeLimit(
        makePhoto({uri: 'file:///crash.jpg', byteSize: 7_000_000}),
        {engine, fs},
      ),
    ).rejects.toThrow(/could not compress|crashed|5 MB/i);

    expect(files.size).toBe(0);
    expect(unlinked).toContain('/cache/partial.jpg');
  });
});

describe('prepareSelectedPhotos', () => {
  afterEach(() => {
    setCompressEngineForTests(null);
    setCompressionFileSystemForTests(null);
  });

  test('handles multiple images with correct MIME and extensions', async () => {
    const {fs, files} = makeMemoryFs();
    const engine: CompressEngine = {
      compress: async request => {
        const path = `/cache/${request.maxWidth}-${request.quality}.jpg`;
        files.set(path, 400_000);
        return {
          uri: `file://${path}`,
          byteSize: 400_000,
          width: 1280,
          height: 960,
        };
      },
    };

    const progress: string[] = [];
    const prepared = await prepareSelectedPhotos(
      [
        makePhoto({
          selectionId: 'a',
          uri: 'file:///small.jpg',
          byteSize: 1000,
          mimeType: 'image/jpeg',
          fileName: 'small.jpg',
        }),
        makePhoto({
          selectionId: 'b',
          uri: 'content://media/large',
          byteSize: 10_000_000,
          mimeType: 'image/png',
          fileName: 'large.png',
        }),
      ],
      {
        engine,
        fs,
        onProgress: event => progress.push(event.message),
      },
    );

    expect(prepared).toHaveLength(2);
    expect(prepared[0].wasCompressed).toBe(false);
    expect(prepared[0].mimeType).toBe('image/jpeg');
    expect(prepared[1].wasCompressed).toBe(true);
    expect(prepared[1].mimeType).toBe('image/jpeg');
    expect(prepared[1].fileName).toBe('large.jpg');
    expect(prepared[1].byteSize).toBeLessThan(MAX_IMAGE_BYTES);
    expect(progress.some(message => /Optimizing photo 2/i.test(message))).toBe(
      true,
    );
  });

  test('cleans prepared temps if a later photo fails', async () => {
    const {fs, files, unlinked} = makeMemoryFs();
    let calls = 0;
    const engine: CompressEngine = {
      compress: async () => {
        calls += 1;
        if (calls === 1) {
          files.set('/cache/ok.jpg', 1000);
          return {
            uri: 'file:///cache/ok.jpg',
            byteSize: 1000,
            width: 100,
            height: 100,
          };
        }
        throw new Error('second failed');
      },
    };

    await expect(
      prepareSelectedPhotos(
        [
          makePhoto({
            selectionId: '1',
            uri: 'file:///a.jpg',
            byteSize: 6_000_000,
          }),
          makePhoto({
            selectionId: '2',
            uri: 'file:///b.jpg',
            byteSize: 7_000_000,
          }),
        ],
        {engine, fs},
      ),
    ).rejects.toThrow(/second failed|Could not compress/i);

    expect(unlinked).toContain('/cache/ok.jpg');
    expect(files.size).toBe(0);
  });
});

describe('cleanupOwnedCompressionTemps', () => {
  test('only unlinks owned temps', async () => {
    const {fs, files, unlinked} = makeMemoryFs({
      '/cache/owned.jpg': 10,
      '/gallery/leave-me.jpg': 10,
    });

    await cleanupOwnedCompressionTemps(
      [
        {ownedTempPath: '/cache/owned.jpg'},
        {ownedTempPath: null},
        {},
      ],
      fs,
    );

    expect(unlinked).toEqual(['/cache/owned.jpg']);
    expect(files.has('/gallery/leave-me.jpg')).toBe(true);
  });
});
