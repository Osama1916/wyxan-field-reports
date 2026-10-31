jest.mock('@op-engineering/op-sqlite', () => ({
  open: jest.fn(() => {
    throw new Error('op-sqlite open should not be called in unit tests');
  }),
}));

jest.mock('@react-native-community/netinfo', () => ({
  __esModule: true,
  default: {
    addEventListener: jest.fn(() => jest.fn()),
    fetch: jest.fn(async () => ({
      isConnected: true,
      isInternetReachable: true,
    })),
  },
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

import type {AdminResetResponse} from '../../api';
import {
  closeDatabase,
  createIdempotencyKey,
  createLocalReport,
  getDatabase,
  initializeDatabase,
  listPhotosForReport,
  listReports,
  listUploadJobs,
  updateUploadJob,
} from '../../db';
import {openNodeSqliteDatabase} from '../../db/testing/nodeSqliteAdapter';
import {setUploadTransportForTests} from '../../upload/processJob';
import {
  isUploadWorkerPaused,
  isUploadWorkerRunning,
  kickUploadWorker,
  pauseUploadWorker,
  resetUploadWorkerForTests,
  resumeUploadWorker,
} from '../../upload/worker';
import {
  setPhotoFileSystemForTests,
  type PhotoFileSystem,
} from '../photoStorage';
import {
  isResetAllReportsInFlight,
  resetAllLocalAndServerReports,
  ResetAllReportsError,
  resetResetAllReportsLockForTests,
} from '../resetAllReports';

function serverResetOk(
  overrides: Partial<AdminResetResponse> = {},
): AdminResetResponse {
  return {
    message:
      'Deleted all report metadata from SQLite and all files in uploads/ and tmp/. Chaos settings were left unchanged.',
    deletedReports: 2,
    deletedTrackedImageFiles: 3,
    deletedUploadFiles: 3,
    deletedTempFiles: 0,
    ...overrides,
  };
}

function makeMemoryFs(initialPaths: string[] = []): {
  fs: PhotoFileSystem;
  files: Set<string>;
  unlinked: string[];
} {
  const files = new Set(initialPaths);
  const unlinked: string[] = [];
  const fs: PhotoFileSystem = {
    documentDirectory: '/docs',
    exists: async path => files.has(path) || path === '/docs/report-photos',
    mkdir: async () => undefined,
    copyFile: async () => undefined,
    writeFileBase64: async () => undefined,
    unlink: async path => {
      files.delete(path);
      unlinked.push(path);
    },
    statSize: async () => 1,
    readDirNames: async () =>
      [...files]
        .filter(p => p.startsWith('/docs/report-photos/'))
        .map(p => p.slice('/docs/report-photos/'.length)),
  };
  files.add('/docs/report-photos');
  return {fs, files, unlinked};
}

describe('resetAllLocalAndServerReports', () => {
  afterEach(async () => {
    resetResetAllReportsLockForTests();
    resetUploadWorkerForTests();
    setUploadTransportForTests(null);
    setPhotoFileSystemForTests(null);
    await closeDatabase();
  });

  async function setup() {
    const database = openNodeSqliteDatabase(':memory:');
    await initializeDatabase({database, recoverStaleJobs: false});
    return database;
  }

  async function seedLocalReport(photoPaths: string[]) {
    return createLocalReport(getDatabase(), {
      description: 'reset me',
      idempotencyKey: createIdempotencyKey(),
      photos: photoPaths.map((localUri, sortOrder) => ({
        localUri,
        sortOrder,
        byteSize: 1200,
        mimeType: 'image/jpeg',
      })),
    });
  }

  test('successful reset clears local reports, photos, upload jobs and reports server wipe', async () => {
    await setup();
    const photoA = 'file:///docs/report-photos/a.jpg';
    const photoB = 'file:///docs/report-photos/b.jpg';
    const {fs, files} = makeMemoryFs([
      '/docs/report-photos/a.jpg',
      '/docs/report-photos/b.jpg',
      '/docs/other-app-file.txt',
    ]);
    setPhotoFileSystemForTests(fs);

    await seedLocalReport([photoA, photoB]);
    await seedLocalReport(['file:///docs/report-photos/c.jpg']);
    files.add('/docs/report-photos/c.jpg');

    expect(await listReports(getDatabase())).toHaveLength(2);
    expect(await listUploadJobs(getDatabase())).toHaveLength(2);

    const resetServer = jest.fn(async () => serverResetOk({deletedReports: 5}));
    const result = await resetAllLocalAndServerReports(getDatabase(), {
      fs,
      resetServer,
    });

    expect(resetServer).toHaveBeenCalledTimes(1);
    expect(result.deletedLocalReports).toBe(2);
    expect(result.server.deletedReports).toBe(5);
    expect(await listReports(getDatabase())).toHaveLength(0);
    expect(await listUploadJobs(getDatabase())).toHaveLength(0);
    expect(files.has('/docs/report-photos/a.jpg')).toBe(false);
    expect(files.has('/docs/report-photos/b.jpg')).toBe(false);
    expect(files.has('/docs/report-photos/c.jpg')).toBe(false);
    expect(files.has('/docs/other-app-file.txt')).toBe(true);
    expect(isUploadWorkerPaused()).toBe(false);
    expect(isResetAllReportsInFlight()).toBe(false);
  });

  test('network failure does not clear local data or claim success', async () => {
    await setup();
    const photo = 'file:///docs/report-photos/keep.jpg';
    const {fs, files} = makeMemoryFs(['/docs/report-photos/keep.jpg']);
    setPhotoFileSystemForTests(fs);
    const created = await seedLocalReport([photo]);

    await expect(
      resetAllLocalAndServerReports(getDatabase(), {
        fs,
        resetServer: async () => {
          throw new Error('Network request failed');
        },
      }),
    ).rejects.toMatchObject({
      name: 'ResetAllReportsError',
      code: 'server',
      serverResetCompleted: false,
    });

    expect(await listReports(getDatabase())).toHaveLength(1);
    expect(await listUploadJobs(getDatabase())).toHaveLength(1);
    expect(await listPhotosForReport(getDatabase(), created.id)).toHaveLength(
      1,
    );
    expect(files.has('/docs/report-photos/keep.jpg')).toBe(true);
    expect(isUploadWorkerPaused()).toBe(false);
  });

  test('refuses reset while upload worker is running', async () => {
    await setup();
    await seedLocalReport(['file:///docs/report-photos/x.jpg']);

    let release!: () => void;
    const gate = new Promise<void>(resolve => {
      release = resolve;
    });
    setUploadTransportForTests({
      uploadReport: async () => {
        await gate;
        throw new Error('should not finish');
      },
    });

    const workerPromise = kickUploadWorker({database: getDatabase()});
    expect(isUploadWorkerRunning()).toBe(true);

    await expect(
      resetAllLocalAndServerReports(getDatabase(), {
        resetServer: async () => serverResetOk(),
      }),
    ).rejects.toMatchObject({code: 'busy'});

    expect(await listReports(getDatabase())).toHaveLength(1);
    release();
    await workerPromise.catch(() => undefined);
  });

  test('worker cannot start a new upload while reset is in progress', async () => {
    await setup();
    await seedLocalReport(['file:///docs/report-photos/y.jpg']);

    let resolveServer!: (value: AdminResetResponse) => void;
    const serverPromise = new Promise<AdminResetResponse>(resolve => {
      resolveServer = resolve;
    });

    const resetPromise = resetAllLocalAndServerReports(getDatabase(), {
      fs: makeMemoryFs(['/docs/report-photos/y.jpg']).fs,
      resetServer: () => serverPromise,
    });

    // Allow the reset async body to pause the worker before kicking.
    for (let i = 0; i < 10 && !isResetAllReportsInFlight(); i += 1) {
      await Promise.resolve();
    }
    expect(isResetAllReportsInFlight()).toBe(true);
    expect(isUploadWorkerPaused()).toBe(true);

    const uploadReport = jest.fn(async () => {
      throw new Error('must not upload during reset');
    });
    setUploadTransportForTests({uploadReport});
    await kickUploadWorker({database: getDatabase()});
    expect(uploadReport).not.toHaveBeenCalled();
    expect(isUploadWorkerRunning()).toBe(false);

    resolveServer(serverResetOk({deletedReports: 1}));
    await resetPromise;
    expect(isUploadWorkerPaused()).toBe(false);
  });

  test('refuses reset when an upload job is marked in_progress', async () => {
    await setup();
    const created = await seedLocalReport(['file:///docs/report-photos/z.jpg']);
    const jobs = await listUploadJobs(getDatabase());
    await updateUploadJob(getDatabase(), jobs[0]!.id, {state: 'in_progress'});

    await expect(
      resetAllLocalAndServerReports(getDatabase(), {
        resetServer: async () => serverResetOk(),
      }),
    ).rejects.toMatchObject({code: 'busy'});

    expect(await listReports(getDatabase())).toHaveLength(1);
    expect((await getDatabase().execute(
      'SELECT COUNT(*) AS c FROM reports WHERE id = ?',
      [created.id],
    )).rows[0]?.c).toBe(1);
  });

  test('repeated reset is safe on an empty database', async () => {
    await setup();
    const {fs} = makeMemoryFs();
    const resetServer = jest.fn(async () =>
      serverResetOk({deletedReports: 0}),
    );

    const first = await resetAllLocalAndServerReports(getDatabase(), {
      fs,
      resetServer,
    });
    const second = await resetAllLocalAndServerReports(getDatabase(), {
      fs,
      resetServer,
    });

    expect(first.deletedLocalReports).toBe(0);
    expect(second.deletedLocalReports).toBe(0);
    expect(resetServer).toHaveBeenCalledTimes(2);
    expect(await listReports(getDatabase())).toHaveLength(0);
  });

  test('preserves schema_migrations and does not touch non-report tables', async () => {
    await setup();
    const before = await getDatabase().execute(
      'SELECT version, name FROM schema_migrations ORDER BY version ASC',
    );
    expect(before.rows.length).toBeGreaterThan(0);

    await seedLocalReport(['file:///docs/report-photos/m.jpg']);
    await resetAllLocalAndServerReports(getDatabase(), {
      fs: makeMemoryFs(['/docs/report-photos/m.jpg']).fs,
      resetServer: async () => serverResetOk({deletedReports: 1}),
    });

    const after = await getDatabase().execute(
      'SELECT version, name FROM schema_migrations ORDER BY version ASC',
    );
    expect(after.rows).toEqual(before.rows);
  });

  test('server success message documents chaos preservation contract', async () => {
    await setup();
    const response = serverResetOk();
    expect(response.message).toMatch(/Chaos settings were left unchanged/i);

    const result = await resetAllLocalAndServerReports(getDatabase(), {
      fs: makeMemoryFs().fs,
      resetServer: async () => response,
    });
    expect(result.server.message).toBe(response.message);
  });

  test('resume worker even when server reset throws', async () => {
    await setup();
    pauseUploadWorker();
    resumeUploadWorker();

    await expect(
      resetAllLocalAndServerReports(getDatabase(), {
        resetServer: async () => {
          throw new ResetAllReportsError('server', 'boom');
        },
      }),
    ).rejects.toBeInstanceOf(ResetAllReportsError);

    expect(isUploadWorkerPaused()).toBe(false);
    expect(isResetAllReportsInFlight()).toBe(false);
  });
});
