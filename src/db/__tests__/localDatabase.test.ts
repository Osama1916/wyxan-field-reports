jest.mock('@op-engineering/op-sqlite', () => ({
  open: jest.fn(() => {
    throw new Error('op-sqlite open should not be called in unit tests');
  }),
}));

import {
  closeDatabase,
  createIdempotencyKey,
  createLocalReport,
  getAppliedMigrationVersions,
  getLatestMigrationVersion,
  getReportById,
  getReportWithDetails,
  initializeDatabase,
  isUniqueConstraintError,
  listPhotosForReport,
  listUploadJobs,
  recoverStaleUploadJobs,
  updatePhoto,
  updateReport,
  updateUploadJob,
} from '../index';
import {openNodeSqliteDatabase} from '../testing/nodeSqliteAdapter';

async function expectUniqueFailure(promise: Promise<unknown>): Promise<void> {
  try {
    await promise;
    throw new Error('Expected unique constraint failure');
  } catch (error) {
    expect(isUniqueConstraintError(error)).toBe(true);
  }
}

describe('Phase 2 local SQLite storage', () => {
  afterEach(async () => {
    await closeDatabase();
  });

  async function setup() {
    const database = openNodeSqliteDatabase(':memory:');
    const init = await initializeDatabase({
      database,
      recoverStaleJobs: false,
    });
    return {database, init};
  }

  test('initializes database and applies versioned migrations once', async () => {
    const {database, init} = await setup();

    expect(init.appliedMigrations).toEqual([1, 2]);
    expect(getLatestMigrationVersion()).toBe(2);
    expect(await getAppliedMigrationVersions(database)).toEqual([1, 2]);

    const tables = await database.execute(
      `SELECT name FROM sqlite_master
       WHERE type = 'table'
       ORDER BY name`,
    );
    const names = tables.rows.map(row => String(row.name));
    expect(names).toEqual(
      expect.arrayContaining([
        'reports',
        'report_photos',
        'upload_jobs',
        'report_drafts',
        'report_draft_photos',
        'schema_migrations',
      ]),
    );

    const second = await initializeDatabase({
      database,
      recoverStaleJobs: false,
    });
    expect(second.appliedMigrations).toEqual([]);
  });

  test('atomically creates report, photos, and upload job', async () => {
    const {database} = await setup();
    const idempotencyKey = createIdempotencyKey();

    const created = await createLocalReport(database, {
      idempotencyKey,
      description: 'Broken fence at north gate',
      photos: [
        {
          localUri: 'file:///photos/a.jpg',
          sortOrder: 0,
          byteSize: 1200,
          mimeType: 'image/jpeg',
        },
        {
          localUri: 'file:///photos/b.jpg',
          sortOrder: 1,
          byteSize: 2200,
          mimeType: 'image/jpeg',
        },
      ],
    });

    expect(created.id).toBeGreaterThan(0);
    expect(created.idempotencyKey).toBe(idempotencyKey);
    expect(created.status).toBe('pending');
    expect(created.attemptCount).toBe(0);
    expect(created.photos).toHaveLength(2);
    expect(created.uploadJob?.state).toBe('pending');
    expect(created.uploadJob?.reportId).toBe(created.id);

    const photos = await listPhotosForReport(database, created.id);
    expect(photos.map(p => p.sortOrder)).toEqual([0, 1]);
  });

  test('rolls back partial work when atomic create fails mid-transaction', async () => {
    const {database} = await setup();
    const key = createIdempotencyKey();
    const triggerName = 'fail_second_photo_insert';

    // Fail only on the second photo (sort_order = 1), and only after the
    // report + first photo rows are visible inside the same transaction.
    await database.execute(`
      CREATE TEMP TRIGGER ${triggerName}
      BEFORE INSERT ON report_photos
      WHEN NEW.sort_order = 1
      BEGIN
        SELECT CASE
          WHEN (SELECT COUNT(*) FROM reports WHERE id = NEW.report_id) = 0
            THEN RAISE(ABORT, 'report missing before second photo')
          WHEN (
            SELECT COUNT(*) FROM report_photos
            WHERE report_id = NEW.report_id AND sort_order = 0
          ) = 0
            THEN RAISE(ABORT, 'first photo missing before second photo')
          ELSE RAISE(ABORT, 'intentional mid-transaction photo failure')
        END;
      END
    `);

    try {
      await expect(
        createLocalReport(database, {
          idempotencyKey: key,
          description: 'Should not persist',
          photos: [
            {
              localUri: 'file:///photos/a.jpg',
              sortOrder: 0,
              byteSize: 100,
              mimeType: 'image/jpeg',
            },
            {
              localUri: 'file:///photos/b.jpg',
              sortOrder: 1,
              byteSize: 100,
              mimeType: 'image/jpeg',
            },
          ],
        }),
      ).rejects.toThrow(/intentional mid-transaction photo failure/);

      const reports = await database.execute(
        'SELECT COUNT(*) AS c FROM reports',
      );
      const photos = await database.execute(
        'SELECT COUNT(*) AS c FROM report_photos',
      );
      const jobs = await database.execute(
        'SELECT COUNT(*) AS c FROM upload_jobs',
      );

      expect(Number(reports.rows[0]?.c)).toBe(0);
      expect(Number(photos.rows[0]?.c)).toBe(0);
      expect(Number(jobs.rows[0]?.c)).toBe(0);
    } finally {
      await database.execute(`DROP TRIGGER IF EXISTS ${triggerName}`);
    }
  });

  test('enforces unique idempotency keys and never regenerates on update', async () => {
    const {database} = await setup();
    const key = createIdempotencyKey();

    const first = await createLocalReport(database, {
      idempotencyKey: key,
      description: 'First',
      photos: [
        {
          localUri: 'file:///a.jpg',
          sortOrder: 0,
          byteSize: 10,
          mimeType: 'image/jpeg',
        },
      ],
    });

    await expectUniqueFailure(
      createLocalReport(database, {
        idempotencyKey: key,
        description: 'Duplicate',
        photos: [
          {
            localUri: 'file:///b.jpg',
            sortOrder: 0,
            byteSize: 10,
            mimeType: 'image/jpeg',
          },
        ],
      }),
    );

    const afterFailedUpload = await updateReport(database, first.id, {
      status: 'failed',
      lastError: 'network timeout',
      attemptCount: first.attemptCount + 1,
    });

    expect(afterFailedUpload?.idempotencyKey).toBe(key);
    expect(afterFailedUpload?.status).toBe('failed');

    const stillThere = await getReportWithDetails(database, first.id);
    expect(stillThere?.photos).toHaveLength(1);
    expect(stillThere?.uploadJob).not.toBeNull();
  });

  test('recovers interrupted upload with consistent pending statuses', async () => {
    const {database} = await setup();
    const idempotencyKey = createIdempotencyKey();

    const created = await createLocalReport(database, {
      idempotencyKey,
      description: 'Interrupted upload',
      photos: [
        {
          localUri: 'file:///x.jpg',
          sortOrder: 0,
          byteSize: 50,
          mimeType: 'image/jpeg',
        },
        {
          localUri: 'file:///y.jpg',
          sortOrder: 1,
          byteSize: 60,
          mimeType: 'image/jpeg',
        },
      ],
    });

    const jobId = created.uploadJob!.id;
    const originalReportId = created.id;

    await updateReport(database, created.id, {
      status: 'uploading',
      attemptCount: 2,
      lastError: 'Process killed mid-upload',
    });
    await updateUploadJob(database, jobId, {
      state: 'in_progress',
      lockedAt: '2020-01-01T00:00:00.000Z',
    });
    for (const photo of created.photos) {
      await updatePhoto(database, photo.id, {uploadStatus: 'uploading'});
    }

    const recovery = await recoverStaleUploadJobs(database);
    expect(recovery.recoveredCount).toBe(1);
    expect(recovery.recovered[0]?.id).toBe(jobId);
    expect(recovery.recovered[0]?.reportId).toBe(originalReportId);
    expect(recovery.recovered[0]?.state).toBe('pending');
    expect(recovery.recovered[0]?.lockedAt).toBeNull();
    expect(recovery.recovered[0]?.nextAttemptAt).toBeTruthy();

    const jobs = await listUploadJobs(database, {state: 'in_progress'});
    expect(jobs).toHaveLength(0);

    const report = await getReportById(database, originalReportId);
    expect(report).not.toBeNull();
    expect(report?.id).toBe(originalReportId);
    expect(report?.status).toBe('pending');
    expect(report?.idempotencyKey).toBe(idempotencyKey);
    expect(report?.attemptCount).toBe(2);

    const photos = await listPhotosForReport(database, originalReportId);
    expect(photos).toHaveLength(2);
    expect(photos.every(photo => photo.uploadStatus === 'pending')).toBe(true);
    expect(photos.map(photo => photo.localUri).sort()).toEqual([
      'file:///x.jpg',
      'file:///y.jpg',
    ]);

    const detailed = await getReportWithDetails(database, originalReportId);
    expect(detailed?.uploadJob?.state).toBe('pending');
    expect(detailed?.idempotencyKey).toBe(idempotencyKey);
  });

  test('repeated recovery is idempotent and preserves keys', async () => {
    const {database} = await setup();
    const idempotencyKey = createIdempotencyKey();

    const created = await createLocalReport(database, {
      idempotencyKey,
      description: 'Recover twice',
      photos: [
        {
          localUri: 'file:///z.jpg',
          sortOrder: 0,
          byteSize: 40,
          mimeType: 'image/jpeg',
        },
      ],
    });

    await updateReport(database, created.id, {status: 'uploading'});
    await updateUploadJob(database, created.uploadJob!.id, {
      state: 'in_progress',
      lockedAt: '2020-01-01T00:00:00.000Z',
    });
    await updatePhoto(database, created.photos[0].id, {
      uploadStatus: 'uploading',
    });

    const first = await recoverStaleUploadJobs(database);
    expect(first.recoveredCount).toBe(1);

    const second = await recoverStaleUploadJobs(database);
    expect(second.recoveredCount).toBe(0);
    expect(second.recovered).toEqual([]);

    const report = await getReportById(database, created.id);
    expect(report?.status).toBe('pending');
    expect(report?.idempotencyKey).toBe(idempotencyKey);
    expect(report?.id).toBe(created.id);

    const photos = await listPhotosForReport(database, created.id);
    expect(photos).toHaveLength(1);
    expect(photos[0].uploadStatus).toBe('pending');
    expect(photos[0].localUri).toBe('file:///z.jpg');
  });

  test('recovery leaves uploaded and permanently failed reports unchanged', async () => {
    const {database} = await setup();

    const stale = await createLocalReport(database, {
      idempotencyKey: createIdempotencyKey(),
      description: 'Stale uploading',
      photos: [
        {
          localUri: 'file:///stale.jpg',
          sortOrder: 0,
          byteSize: 10,
          mimeType: 'image/jpeg',
        },
      ],
    });
    const uploaded = await createLocalReport(database, {
      idempotencyKey: createIdempotencyKey(),
      description: 'Already uploaded',
      photos: [
        {
          localUri: 'file:///done.jpg',
          sortOrder: 0,
          byteSize: 10,
          mimeType: 'image/jpeg',
        },
      ],
    });
    const failed = await createLocalReport(database, {
      idempotencyKey: createIdempotencyKey(),
      description: 'Permanently failed',
      photos: [
        {
          localUri: 'file:///failed.jpg',
          sortOrder: 0,
          byteSize: 10,
          mimeType: 'image/jpeg',
        },
      ],
    });

    await updateReport(database, stale.id, {status: 'uploading'});
    await updateUploadJob(database, stale.uploadJob!.id, {
      state: 'in_progress',
      lockedAt: '2020-01-01T00:00:00.000Z',
    });
    await updatePhoto(database, stale.photos[0].id, {
      uploadStatus: 'uploading',
    });

    await updateReport(database, uploaded.id, {
      status: 'uploaded',
      serverReportId: 'server-keep',
    });
    await updateUploadJob(database, uploaded.uploadJob!.id, {
      state: 'succeeded',
      lockedAt: null,
    });
    await updatePhoto(database, uploaded.photos[0].id, {
      uploadStatus: 'uploaded',
      serverPhotoId: 'img-keep',
    });

    await updateReport(database, failed.id, {
      status: 'failed',
      lastError: 'Validation rejected by server',
      attemptCount: 8,
    });
    await updateUploadJob(database, failed.uploadJob!.id, {
      state: 'failed',
      lockedAt: null,
      nextAttemptAt: null,
    });
    await updatePhoto(database, failed.photos[0].id, {
      uploadStatus: 'failed',
    });

    const recovery = await recoverStaleUploadJobs(database);
    expect(recovery.recoveredCount).toBe(1);
    expect(recovery.recovered[0]?.reportId).toBe(stale.id);

    const recovered = await getReportWithDetails(database, stale.id);
    expect(recovered?.status).toBe('pending');
    expect(recovered?.photos).toHaveLength(1);
    expect(recovered?.photos[0].uploadStatus).toBe('pending');
    expect(recovered?.photos[0].localUri).toBe('file:///stale.jpg');

    const untouchedUploaded = await getReportWithDetails(database, uploaded.id);
    expect(untouchedUploaded?.status).toBe('uploaded');
    expect(untouchedUploaded?.serverReportId).toBe('server-keep');
    expect(untouchedUploaded?.idempotencyKey).toBe(uploaded.idempotencyKey);
    expect(untouchedUploaded?.photos[0].uploadStatus).toBe('uploaded');
    expect(untouchedUploaded?.photos[0].serverPhotoId).toBe('img-keep');
    expect(untouchedUploaded?.uploadJob?.state).toBe('succeeded');

    const untouchedFailed = await getReportWithDetails(database, failed.id);
    expect(untouchedFailed?.status).toBe('failed');
    expect(untouchedFailed?.lastError).toBe('Validation rejected by server');
    expect(untouchedFailed?.attemptCount).toBe(8);
    expect(untouchedFailed?.idempotencyKey).toBe(failed.idempotencyKey);
    expect(untouchedFailed?.photos[0].uploadStatus).toBe('failed');
    expect(untouchedFailed?.photos[0].localUri).toBe('file:///failed.jpg');
    expect(untouchedFailed?.uploadJob?.state).toBe('failed');
  });

  test('initializeDatabase recovers stale jobs by default', async () => {
    const database = openNodeSqliteDatabase(':memory:');
    await initializeDatabase({database, recoverStaleJobs: false});

    const created = await createLocalReport(database, {
      idempotencyKey: createIdempotencyKey(),
      description: 'Startup recovery',
      photos: [
        {
          localUri: 'file:///y.jpg',
          sortOrder: 0,
          byteSize: 50,
          mimeType: 'image/jpeg',
        },
      ],
    });
    await updateReport(database, created.id, {status: 'uploading'});
    await updateUploadJob(database, created.uploadJob!.id, {
      state: 'in_progress',
      lockedAt: '2020-01-01T00:00:00.000Z',
    });
    await updatePhoto(database, created.photos[0].id, {
      uploadStatus: 'uploading',
    });

    const init = await initializeDatabase({database});
    expect(init.staleJobRecovery?.recoveredCount).toBe(1);
    expect(init.staleJobRecovery?.recovered[0]?.state).toBe('pending');

    const report = await getReportById(database, created.id);
    expect(report?.status).toBe('pending');
    expect(report?.idempotencyKey).toBe(created.idempotencyKey);

    const photos = await listPhotosForReport(database, created.id);
    expect(photos[0].uploadStatus).toBe('pending');
  });
});
