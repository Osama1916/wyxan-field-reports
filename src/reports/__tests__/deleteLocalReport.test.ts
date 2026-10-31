jest.mock('@op-engineering/op-sqlite', () => ({
  open: jest.fn(() => {
    throw new Error('op-sqlite open should not be called in unit tests');
  }),
}));

jest.mock('@dr.pogodin/react-native-fs', () => ({
  DocumentDirectoryPath: '/tmp/fieldreports-docs',
  copyFile: jest.fn(),
  exists: jest.fn(),
  mkdir: jest.fn(),
  stat: jest.fn(),
  unlink: jest.fn(),
  writeFile: jest.fn(),
}));

import {
  closeDatabase,
  createIdempotencyKey,
  createLocalReport,
  getReportById,
  getReportWithDetails,
  initializeDatabase,
  listPhotosForReport,
  listReports,
  listUploadJobs,
  updateReport,
} from '../../db';
import {openNodeSqliteDatabase} from '../../db/testing/nodeSqliteAdapter';
import {
  deleteLocalReport,
  isReportDeleteInFlight,
  ReportDeleteError,
  resetReportDeleteLockForTests,
} from '../deleteLocalReport';
import {
  setPhotoFileSystemForTests,
  stripFileScheme,
  type PhotoFileSystem,
} from '../photoStorage';

function makeMemoryFs(initialPaths: string[] = []): {
  fs: PhotoFileSystem;
  files: Set<string>;
  unlinked: string[];
} {
  const files = new Set(initialPaths);
  const unlinked: string[] = [];
  const fs: PhotoFileSystem = {
    documentDirectory: '/docs',
    exists: async path => files.has(path),
    mkdir: async () => undefined,
    copyFile: async () => undefined,
    writeFileBase64: async () => undefined,
    unlink: async path => {
      files.delete(path);
      unlinked.push(path);
    },
    statSize: async () => 1,
  };
  return {fs, files, unlinked};
}

describe('deleteLocalReport', () => {
  afterEach(async () => {
    resetReportDeleteLockForTests();
    setPhotoFileSystemForTests(null);
    await closeDatabase();
  });

  async function setup() {
    const database = openNodeSqliteDatabase(':memory:');
    await initializeDatabase({database, recoverStaleJobs: false});
    return database;
  }

  test('deletes a pending report with photos and upload job', async () => {
    const database = await setup();
    const photoA = 'file:///docs/report-photos/a.jpg';
    const photoB = 'file:///docs/report-photos/b.jpg';
    const {fs, files, unlinked} = makeMemoryFs([
      stripFileScheme(photoA),
      stripFileScheme(photoB),
    ]);
    setPhotoFileSystemForTests(fs);

    const created = await createLocalReport(database, {
      idempotencyKey: createIdempotencyKey(),
      description: 'Pending fence damage',
      photos: [
        {
          localUri: photoA,
          sortOrder: 0,
          byteSize: 10,
          mimeType: 'image/jpeg',
        },
        {
          localUri: photoB,
          sortOrder: 1,
          byteSize: 20,
          mimeType: 'image/jpeg',
        },
      ],
    });
    expect(created.status).toBe('pending');

    const result = await deleteLocalReport(database, created.id, fs);

    expect(result.reportId).toBe(created.id);
    expect(result.removedPhotoUris).toEqual([photoA, photoB]);
    expect(await getReportById(database, created.id)).toBeNull();
    expect(await listPhotosForReport(database, created.id)).toEqual([]);
    expect(
      (await listUploadJobs(database)).filter(j => j.reportId === created.id),
    ).toEqual([]);
    expect(unlinked.sort()).toEqual(
      [stripFileScheme(photoA), stripFileScheme(photoB)].sort(),
    );
    expect(files.size).toBe(0);
  });

  test('deletes a failed report', async () => {
    const database = await setup();
    const photo = 'file:///docs/report-photos/failed.jpg';
    const {fs} = makeMemoryFs([stripFileScheme(photo)]);

    const created = await createLocalReport(database, {
      idempotencyKey: createIdempotencyKey(),
      description: 'Failed upload report',
      photos: [
        {
          localUri: photo,
          sortOrder: 0,
          byteSize: 50,
          mimeType: 'image/jpeg',
        },
      ],
    });
    await updateReport(database, created.id, {
      status: 'failed',
      lastError: 'network',
    });

    await deleteLocalReport(database, created.id, fs);

    expect(await getReportById(database, created.id)).toBeNull();
    expect(await listPhotosForReport(database, created.id)).toEqual([]);
  });

  test('rejects deletion of an uploading report', async () => {
    const database = await setup();
    const {fs} = makeMemoryFs();
    const created = await createLocalReport(database, {
      idempotencyKey: createIdempotencyKey(),
      description: 'Uploading now',
      photos: [
        {
          localUri: 'file:///docs/report-photos/up.jpg',
          sortOrder: 0,
          byteSize: 10,
          mimeType: 'image/jpeg',
        },
      ],
    });
    await updateReport(database, created.id, {status: 'uploading'});

    await expect(deleteLocalReport(database, created.id, fs)).rejects.toEqual(
      expect.objectContaining({
        name: 'ReportDeleteError',
        code: 'uploading',
      }),
    );

    expect(await getReportById(database, created.id)).not.toBeNull();
    expect(await listPhotosForReport(database, created.id)).toHaveLength(1);
  });

  test('rejects deletion of an uploaded report', async () => {
    const database = await setup();
    const {fs} = makeMemoryFs();
    const created = await createLocalReport(database, {
      idempotencyKey: createIdempotencyKey(),
      description: 'Already synced',
      photos: [
        {
          localUri: 'file:///docs/report-photos/done.jpg',
          sortOrder: 0,
          byteSize: 10,
          mimeType: 'image/jpeg',
        },
      ],
    });
    await updateReport(database, created.id, {
      status: 'uploaded',
      serverReportId: 'server-1',
      uploadedAt: new Date().toISOString(),
    });

    await expect(deleteLocalReport(database, created.id, fs)).rejects.toEqual(
      expect.objectContaining({
        name: 'ReportDeleteError',
        code: 'uploaded',
      }),
    );

    const stillThere = await getReportWithDetails(database, created.id);
    expect(stillThere?.status).toBe('uploaded');
    expect(stillThere?.photos).toHaveLength(1);
    expect(stillThere?.uploadJob).not.toBeNull();
  });

  test('cleans up associated local photos and tolerates missing files', async () => {
    const database = await setup();
    const present = 'file:///docs/report-photos/present.jpg';
    const missing = 'file:///docs/report-photos/missing.jpg';
    const {fs, files, unlinked} = makeMemoryFs([stripFileScheme(present)]);
    // missing path intentionally absent from files set

    const created = await createLocalReport(database, {
      idempotencyKey: createIdempotencyKey(),
      description: 'Partial disk files',
      photos: [
        {
          localUri: present,
          sortOrder: 0,
          byteSize: 10,
          mimeType: 'image/jpeg',
        },
        {
          localUri: missing,
          sortOrder: 1,
          byteSize: 10,
          mimeType: 'image/jpeg',
        },
      ],
    });

    await expect(
      deleteLocalReport(database, created.id, fs),
    ).resolves.toMatchObject({reportId: created.id});

    expect(await getReportById(database, created.id)).toBeNull();
    expect(unlinked).toEqual([stripFileScheme(present)]);
    expect(files.has(stripFileScheme(missing))).toBe(false);
  });

  test('prevents duplicate deletion requests while one is in flight', async () => {
    const database = await setup();
    const photo = 'file:///docs/report-photos/slow.jpg';
    let releaseUnlink!: () => void;
    const unlinkGate = new Promise<void>(resolve => {
      releaseUnlink = resolve;
    });

    const base = makeMemoryFs([stripFileScheme(photo)]);
    const fs: PhotoFileSystem = {
      ...base.fs,
      unlink: async path => {
        await unlinkGate;
        await base.fs.unlink(path);
      },
    };

    const created = await createLocalReport(database, {
      idempotencyKey: createIdempotencyKey(),
      description: 'Slow delete',
      photos: [
        {
          localUri: photo,
          sortOrder: 0,
          byteSize: 10,
          mimeType: 'image/jpeg',
        },
      ],
    });

    const first = deleteLocalReport(database, created.id, fs);
    // Lock is acquired synchronously before the first await.
    expect(isReportDeleteInFlight(created.id)).toBe(true);

    await expect(deleteLocalReport(database, created.id, fs)).rejects.toEqual(
      expect.objectContaining({code: 'in_flight'}),
    );

    // Let the first delete finish file cleanup.
    await Promise.resolve();
    releaseUnlink();
    await first;
    expect(isReportDeleteInFlight(created.id)).toBe(false);
    expect(await getReportById(database, created.id)).toBeNull();
  });

  test('preserves other reports and upload jobs', async () => {
    const database = await setup();
    const {fs} = makeMemoryFs([
      '/docs/report-photos/keep.jpg',
      '/docs/report-photos/drop.jpg',
    ]);

    const keep = await createLocalReport(database, {
      idempotencyKey: createIdempotencyKey(),
      description: 'Keep me',
      photos: [
        {
          localUri: 'file:///docs/report-photos/keep.jpg',
          sortOrder: 0,
          byteSize: 10,
          mimeType: 'image/jpeg',
        },
      ],
    });
    const drop = await createLocalReport(database, {
      idempotencyKey: createIdempotencyKey(),
      description: 'Drop me',
      photos: [
        {
          localUri: 'file:///docs/report-photos/drop.jpg',
          sortOrder: 0,
          byteSize: 10,
          mimeType: 'image/jpeg',
        },
      ],
    });

    await deleteLocalReport(database, drop.id, fs);

    expect(await listReports(database)).toHaveLength(1);
    expect(await getReportById(database, keep.id)).not.toBeNull();
    expect(await listPhotosForReport(database, keep.id)).toHaveLength(1);
    const jobs = await listUploadJobs(database);
    expect(jobs).toHaveLength(1);
    expect(jobs[0]?.reportId).toBe(keep.id);
  });

  test('ReportDeleteError remains typed after transaction wrap', async () => {
    const database = await setup();
    const {fs} = makeMemoryFs();
    const created = await createLocalReport(database, {
      idempotencyKey: createIdempotencyKey(),
      description: 'Uploading typed',
      photos: [
        {
          localUri: 'file:///docs/x.jpg',
          sortOrder: 0,
          byteSize: 1,
          mimeType: 'image/jpeg',
        },
      ],
    });
    await updateReport(database, created.id, {status: 'uploading'});

    try {
      await deleteLocalReport(database, created.id, fs);
      throw new Error('expected throw');
    } catch (error) {
      expect(error).toBeInstanceOf(ReportDeleteError);
      expect((error as ReportDeleteError).code).toBe('uploading');
    }
  });
});
