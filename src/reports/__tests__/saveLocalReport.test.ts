jest.mock('@op-engineering/op-sqlite', () => ({
  open: jest.fn(() => {
    throw new Error('op-sqlite open should not be called in unit tests');
  }),
}));

jest.mock('@dr.pogodin/react-native-fs', () => ({
  DocumentDirectoryPath: '/tmp/fieldreports-docs',
  CachesDirectoryPath: '/tmp/fieldreports-cache',
  copyFile: jest.fn(),
  exists: jest.fn(),
  mkdir: jest.fn(),
  stat: jest.fn(),
  unlink: jest.fn(),
  writeFile: jest.fn(),
}));

jest.mock('react-native-image-compression-kit', () => ({
  compressImage: jest.fn(),
}));

import {
  closeDatabase,
  createLocalReport,
  getReportWithDetails,
  initializeDatabase,
  listReports,
} from '../../db';
import {openNodeSqliteDatabase} from '../../db/testing/nodeSqliteAdapter';
import {MAX_IMAGE_BYTES} from '../constants';
import {
  setPhotoFileSystemForTests,
  type PhotoFileSystem,
} from '../photoStorage';
import {
  isReportSaveInFlight,
  resetReportSaveLockForTests,
  ReportSaveError,
  saveLocalReport,
} from '../saveLocalReport';
import type {SelectedPhoto} from '../types';

function makeMemoryFs(initial: Record<string, Buffer> = {}): {
  fs: PhotoFileSystem;
  files: Map<string, Buffer>;
  unlinked: string[];
} {
  const files = new Map<string, Buffer>(
    Object.entries(initial).map(([path, buf]) => [path, buf]),
  );
  const unlinked: string[] = [];
  const dirs = new Set<string>();

  const fs: PhotoFileSystem = {
    documentDirectory: '/docs',
    exists: async path => files.has(path) || dirs.has(path),
    mkdir: async path => {
      dirs.add(path);
    },
    copyFile: async (from, into) => {
      const data = files.get(from);
      if (!data) {
        throw new Error(`missing source ${from}`);
      }
      files.set(into, Buffer.from(data));
    },
    writeFileBase64: async (path, base64) => {
      files.set(path, Buffer.from(base64, 'base64'));
    },
    unlink: async path => {
      files.delete(path);
      unlinked.push(path);
    },
    statSize: async path => {
      const data = files.get(path);
      if (!data) {
        throw new Error(`missing ${path}`);
      }
      return data.length;
    },
  };

  return {fs, files, unlinked};
}

function selected(
  overrides: Partial<SelectedPhoto> & {bytes?: number} = {},
): SelectedPhoto {
  const bytes = overrides.bytes ?? 128;
  const uri = overrides.uri ?? 'file:///cache/shot.jpg';
  return {
    selectionId: overrides.selectionId ?? 'sel-1',
    uri,
    mimeType: overrides.mimeType ?? 'image/jpeg',
    byteSize: overrides.byteSize ?? bytes,
    fileName: overrides.fileName ?? 'shot.jpg',
    fingerprint: overrides.fingerprint ?? `uri:${uri}`,
  };
}

describe('saveLocalReport', () => {
  afterEach(async () => {
    resetReportSaveLockForTests();
    setPhotoFileSystemForTests(null);
    await closeDatabase();
  });

  async function setupDb() {
    const database = openNodeSqliteDatabase(':memory:');
    await initializeDatabase({database, recoverStaleJobs: false});
    return database;
  }

  test('creates a local report with permanent photo paths and pending upload job', async () => {
    const database = await setupDb();
    const sourcePath = '/cache/shot.jpg';
    const {fs, files} = makeMemoryFs({
      [sourcePath]: Buffer.alloc(200, 1),
    });
    setPhotoFileSystemForTests(fs);

    const created = await saveLocalReport(
      database,
      {
        description: '  Gate hinge broken  ',
        photos: [selected({uri: `file://${sourcePath}`, byteSize: 200})],
        idempotencyKey: 'idem-phase3-1',
      },
      fs,
    );

    expect(created.description).toBe('Gate hinge broken');
    expect(created.status).toBe('pending');
    expect(created.idempotencyKey).toBe('idem-phase3-1');
    expect(created.uploadJob?.state).toBe('pending');
    expect(created.photos).toHaveLength(1);
    expect(created.photos[0].localUri.startsWith('file:///docs/report-photos/')).toBe(
      true,
    );
    expect(created.photos[0].mimeType).toBe('image/jpeg');
    expect(created.photos[0].byteSize).toBe(200);
    expect(created.photos[0].uploadStatus).toBe('pending');

    const absolute = created.photos[0].localUri.replace('file://', '');
    expect(files.has(absolute)).toBe(true);

    const reloaded = await getReportWithDetails(database, created.id);
    expect(reloaded?.photos[0].localUri).toBe(created.photos[0].localUri);
  });

  test('rejects validation failures before touching storage', async () => {
    const database = await setupDb();
    const {fs, files} = makeMemoryFs();
    setPhotoFileSystemForTests(fs);

    await expect(
      saveLocalReport(
        database,
        {
          description: '   ',
          photos: [
            selected({byteSize: MAX_IMAGE_BYTES, mimeType: 'image/jpeg'}),
          ],
        },
        fs,
      ),
    ).rejects.toBeInstanceOf(ReportSaveError);

    expect(files.size).toBe(0);
    expect(await listReports(database)).toHaveLength(0);
  });

  test('cleans up newly copied files when SQLite transaction fails', async () => {
    const database = await setupDb();
    const sourcePath = '/cache/a.jpg';
    const {fs, files, unlinked} = makeMemoryFs({
      [sourcePath]: Buffer.alloc(64, 2),
    });
    setPhotoFileSystemForTests(fs);

    // Pre-create a report with the same idempotency key so insert fails unique.
    await createLocalReport(database, {
      description: 'Existing',
      idempotencyKey: 'dup-key',
      photos: [
        {
          localUri: 'file:///docs/report-photos/existing.jpg',
          sortOrder: 0,
          byteSize: 10,
          mimeType: 'image/jpeg',
        },
      ],
    });

    const beforeFiles = new Set(files.keys());

    await expect(
      saveLocalReport(
        database,
        {
          description: 'New attempt',
          photos: [selected({uri: `file://${sourcePath}`, byteSize: 64})],
          idempotencyKey: 'dup-key',
        },
        fs,
      ),
    ).rejects.toBeInstanceOf(ReportSaveError);

    // Newly copied files should be removed; the pre-existing map entry for the
    // source cache file may remain, but no new report-photos copies should linger.
    const leftoverCopies = [...files.keys()].filter(
      path =>
        path.includes('/report-photos/') &&
        !beforeFiles.has(path) &&
        path !== '/docs/report-photos/existing.jpg',
    );
    expect(leftoverCopies).toEqual([]);
    expect(unlinked.length).toBeGreaterThan(0);

    const reports = await listReports(database);
    expect(reports).toHaveLength(1);
    expect(reports[0].description).toBe('Existing');
  });

  test('prevents concurrent duplicate Save attempts', async () => {
    const database = await setupDb();
    const sourcePath = '/cache/slow.jpg';
    const {fs} = makeMemoryFs({
      [sourcePath]: Buffer.alloc(32, 3),
    });

    let releaseCopy!: () => void;
    const blockedCopy = new Promise<void>(resolve => {
      releaseCopy = resolve;
    });
    let enteredCopy = false;

    const slowFs: PhotoFileSystem = {
      ...fs,
      copyFile: async (from, into) => {
        enteredCopy = true;
        await blockedCopy;
        await fs.copyFile(from, into);
      },
    };
    setPhotoFileSystemForTests(slowFs);

    const first = saveLocalReport(
      database,
      {
        description: 'First',
        photos: [selected({uri: `file://${sourcePath}`, byteSize: 32})],
        idempotencyKey: 'key-a',
      },
      slowFs,
    );

    for (let i = 0; i < 20 && !enteredCopy; i += 1) {
      await new Promise<void>(resolve => setImmediate(resolve));
    }
    expect(enteredCopy).toBe(true);
    expect(isReportSaveInFlight()).toBe(true);

    await expect(
      saveLocalReport(
        database,
        {
          description: 'Second',
          photos: [selected({uri: `file://${sourcePath}`, byteSize: 32})],
          idempotencyKey: 'key-b',
        },
        slowFs,
      ),
    ).rejects.toMatchObject({
      name: 'ReportSaveError',
      code: 'busy',
    });

    releaseCopy();
    const created = await first;
    expect(created.idempotencyKey).toBe('key-a');
    expect(await listReports(database)).toHaveLength(1);
  });

  test('stores persisted photo paths that are not the temporary picker URI', async () => {
    const database = await setupDb();
    const tempUri = 'file:///data/user/0/com.fieldreports/cache/picker-temp.jpg';
    const sourcePath = '/data/user/0/com.fieldreports/cache/picker-temp.jpg';
    const {fs} = makeMemoryFs({
      [sourcePath]: Buffer.alloc(40, 4),
    });

    const created = await saveLocalReport(
      database,
      {
        description: 'Persistent path check',
        photos: [selected({uri: tempUri, byteSize: 40})],
      },
      fs,
    );

    expect(created.photos[0].localUri).not.toBe(tempUri);
    expect(created.photos[0].localUri).toContain('/report-photos/');
  });
});
