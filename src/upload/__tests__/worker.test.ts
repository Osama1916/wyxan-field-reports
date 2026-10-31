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

import {ApiError} from '../../api/errors';
import {
  getServerReviewRefreshGeneration,
  resetServerReviewRefreshForTests,
  subscribeServerReviewRefresh,
} from '../../api/serverReviewRefresh';
import type {CreateReportResponse} from '../../api/types';
import {
  closeDatabase,
  createLocalReport,
  getDatabase,
  getReportById,
  getReportWithDetails,
  initializeDatabase,
  listPhotosForReport,
  listUploadJobs,
  recoverStaleUploadJobs,
  updatePhoto,
  updateReport,
  updateUploadJob,
} from '../../db';
import {openNodeSqliteDatabase} from '../../db/testing/nodeSqliteAdapter';
import {exists as fsExists} from '@dr.pogodin/react-native-fs';
import {MAX_UPLOAD_ATTEMPTS} from '../backoff';
import {
  claimNextDueJob,
  processNextDueJob,
  retryFailedReport,
  setUploadTransportForTests,
} from '../processJob';
import {
  isUploadWorkerRunning,
  kickUploadWorker,
  resetUploadWorkerForTests,
  subscribeUploadWorker,
} from '../worker';

jest.mock('@dr.pogodin/react-native-fs', () => ({
  exists: jest.fn(async () => true),
}));

function serverResponse(
  localIdempotencyKey: string,
  replayed = false,
): CreateReportResponse {
  return {
    replayed,
    report: {
      id: `server-${localIdempotencyKey}`,
      idempotencyKey: localIdempotencyKey,
      description: 'desc',
      createdAt: new Date().toISOString(),
      images: [
        {
          id: 'img-1',
          reportId: `server-${localIdempotencyKey}`,
          filename: 'a.jpg',
          originalName: 'a.jpg',
          mimeType: 'image/jpeg',
          sizeBytes: 100,
          sortOrder: 0,
          url: '/uploads/a.jpg',
        },
      ],
    },
  };
}

async function seedReport(
  description: string,
  idempotencyKey: string,
  photoCount = 1,
) {
  return createLocalReport(getDatabase(), {
    description,
    idempotencyKey,
    photos: Array.from({length: photoCount}, (_, index) => ({
      localUri: `file:///tmp/photo-${idempotencyKey}-${index}.jpg`,
      sortOrder: index,
      byteSize: 1200,
      mimeType: 'image/jpeg',
    })),
  });
}

describe('Phase 4 upload worker', () => {
  beforeEach(async () => {
    resetUploadWorkerForTests();
    resetServerReviewRefreshForTests();
    setUploadTransportForTests(null);
    const database = openNodeSqliteDatabase(':memory:');
    await initializeDatabase({database, recoverStaleJobs: false});
  });

  afterEach(async () => {
    resetUploadWorkerForTests();
    resetServerReviewRefreshForTests();
    setUploadTransportForTests(null);
    await closeDatabase();
  });

  test('uploads successfully and stores server confirmation without deleting photos', async () => {
    const created = await seedReport('Broken fence', 'key-success');
    const calls: string[] = [];
    setUploadTransportForTests({
      uploadReport: async request => {
        calls.push(request.idempotencyKey);
        expect(request.idempotencyKey).toBe('key-success');
        expect(request.photos).toHaveLength(1);
        return serverResponse(request.idempotencyKey, false);
      },
    });

    const db = getDatabase();
    const result = await processNextDueJob(db);
    expect(result.outcome).toBe('uploaded');
    expect(calls).toEqual(['key-success']);

    const report = await getReportById(db, created.id);
    expect(report?.status).toBe('uploaded');
    expect(report?.serverReportId).toBe('server-key-success');
    expect(report?.uploadedAt).toBeTruthy();

    const jobs = await listUploadJobs(db);
    expect(jobs[0]?.state).toBe('succeeded');

    const photos = await listPhotosForReport(db, created.id);
    expect(photos).toHaveLength(1);
    expect(photos[0].uploadStatus).toBe('uploaded');
    expect(photos[0].localUri).toContain('photo-key-success');
    expect(await fsExists(photos[0].localUri)).toBe(true);
  });

  test('successful upload via worker requests a server-review refresh', async () => {
    await seedReport('Needs refresh', 'key-refresh');
    const refreshListener = jest.fn();
    const unsubscribe = subscribeServerReviewRefresh(refreshListener);
    setUploadTransportForTests({
      uploadReport: async request => serverResponse(request.idempotencyKey),
    });

    const before = getServerReviewRefreshGeneration();
    await kickUploadWorker({database: getDatabase()});
    await new Promise<void>(resolve => setTimeout(resolve, 0));

    expect(refreshListener).toHaveBeenCalledTimes(1);
    expect(getServerReviewRefreshGeneration()).toBe(before + 1);
    unsubscribe();
  });

  test('failed upload via worker does not request a server-review refresh', async () => {
    await seedReport('Will fail', 'key-no-refresh');
    const refreshListener = jest.fn();
    const unsubscribe = subscribeServerReviewRefresh(refreshListener);
    setUploadTransportForTests({
      uploadReport: async () => {
        throw new ApiError('Simulated failure', {
          kind: 'http',
          status: 500,
          retryable: true,
        });
      },
    });

    const before = getServerReviewRefreshGeneration();
    await kickUploadWorker({database: getDatabase()});
    await new Promise<void>(resolve => setTimeout(resolve, 0));

    expect(refreshListener).not.toHaveBeenCalled();
    expect(getServerReviewRefreshGeneration()).toBe(before);
    unsubscribe();
  });

  test('successful retry via worker requests a server-review refresh', async () => {
    const created = await seedReport('Retry refresh', 'key-retry-refresh');
    setUploadTransportForTests({
      uploadReport: async () => {
        throw new ApiError('temporary', {
          kind: 'http',
          status: 500,
          retryable: true,
        });
      },
    });
    await kickUploadWorker({database: getDatabase()});
    await new Promise<void>(resolve => setTimeout(resolve, 0));
    resetUploadWorkerForTests();
    resetServerReviewRefreshForTests();

    const jobs = await listUploadJobs(getDatabase());
    await updateUploadJob(getDatabase(), jobs[0].id, {
      nextAttemptAt: new Date(0).toISOString(),
    });
    await updateReport(getDatabase(), created.id, {status: 'pending'});

    const refreshListener = jest.fn();
    const unsubscribe = subscribeServerReviewRefresh(refreshListener);
    setUploadTransportForTests({
      uploadReport: async request => serverResponse(request.idempotencyKey),
    });

    await kickUploadWorker({database: getDatabase()});
    await new Promise<void>(resolve => setTimeout(resolve, 0));

    expect(refreshListener).toHaveBeenCalledTimes(1);
    expect(getServerReviewRefreshGeneration()).toBe(1);
    unsubscribe();
  });

  test('reuses the same idempotency key on retry and reconciles timeout via replay', async () => {
    const created = await seedReport('Timeout case', 'key-timeout');
    let attempt = 0;
    setUploadTransportForTests({
      uploadReport: async request => {
        attempt += 1;
        expect(request.idempotencyKey).toBe('key-timeout');
        if (attempt === 1) {
          throw new ApiError('Request timed out', {
            kind: 'timeout',
            retryable: true,
          });
        }
        return serverResponse(request.idempotencyKey, true);
      },
    });

    const db = getDatabase();
    const first = await processNextDueJob(db);
    expect(first.outcome).toBe('retry_scheduled');

    const mid = await getReportById(db, created.id);
    expect(mid?.status).toBe('pending');
    expect(mid?.idempotencyKey).toBe('key-timeout');
    expect(mid?.attemptCount).toBe(1);

    // Make the job due immediately for the second attempt.
    const job = (await listUploadJobs(db))[0];
    await updateUploadJob(db, job.id, {
      nextAttemptAt: new Date(0).toISOString(),
    });

    const second = await processNextDueJob(db);
    expect(second.outcome).toBe('uploaded');
    if (second.outcome === 'uploaded') {
      expect(second.replayed).toBe(true);
    }
    expect(attempt).toBe(2);

    const final = await getReportById(db, created.id);
    expect(final?.status).toBe('uploaded');
    expect(final?.idempotencyKey).toBe('key-timeout');
    expect(final?.serverReportId).toBe('server-key-timeout');
  });

  test('does not endlessly retry permanent validation failures', async () => {
    const created = await seedReport('Bad payload', 'key-permanent');
    setUploadTransportForTests({
      uploadReport: async () => {
        throw new ApiError('description is required and must be non-empty', {
          kind: 'http',
          status: 400,
          retryable: false,
        });
      },
    });

    const db = getDatabase();
    const result = await processNextDueJob(db);
    expect(result.outcome).toBe('failed');

    const report = await getReportById(db, created.id);
    expect(report?.status).toBe('failed');
    expect(report?.lastError).toMatch(/description/i);

    const skipped = await processNextDueJob(db);
    expect(skipped.outcome).toBe('skipped');
  });

  test('processes multiple reports in created order with single-flight kicks', async () => {
    await seedReport('First', 'key-a');
    await seedReport('Second', 'key-b');
    await seedReport('Third', 'key-c');

    const order: string[] = [];
    setUploadTransportForTests({
      uploadReport: async request => {
        order.push(request.idempotencyKey);
        return serverResponse(request.idempotencyKey);
      },
    });

    const db = getDatabase();
    const p1 = kickUploadWorker({database: db});
    const p2 = kickUploadWorker({database: db});
    expect(p1).toBe(p2);
    expect(isUploadWorkerRunning()).toBe(true);
    await Promise.all([p1, p2]);

    expect(order).toEqual(['key-a', 'key-b', 'key-c']);
    const reports = await Promise.all(
      (await listUploadJobs(db)).map(job => getReportById(db, job.reportId)),
    );
    expect(reports.every(r => r?.status === 'uploaded')).toBe(true);
  });

  test('claims only one job at a time (never concurrent for same queue)', async () => {
    await seedReport('Only one', 'key-lock');
    const db = getDatabase();
    const first = await claimNextDueJob(db);
    expect(first).not.toBeNull();
    const second = await claimNextDueJob(db);
    expect(second).toBeNull();
  });

  test('recovers stale in_progress jobs and retries with same key', async () => {
    const created = await seedReport('Stale', 'key-stale');
    const db = getDatabase();
    const job = (await listUploadJobs(db))[0];
    await updateReport(db, created.id, {status: 'uploading', attemptCount: 1});
    await updateUploadJob(db, job.id, {
      state: 'in_progress',
      lockedAt: new Date().toISOString(),
    });
    const photosBefore = await listPhotosForReport(db, created.id);
    for (const photo of photosBefore) {
      await updatePhoto(db, photo.id, {uploadStatus: 'uploading'});
    }

    const recovery = await recoverStaleUploadJobs(db);
    expect(recovery.recoveredCount).toBe(1);

    const afterRecovery = await getReportWithDetails(db, created.id);
    expect(afterRecovery?.status).toBe('pending');
    expect(afterRecovery?.idempotencyKey).toBe('key-stale');
    expect(afterRecovery?.uploadJob?.state).toBe('pending');
    expect(afterRecovery?.uploadJob?.lockedAt).toBeNull();
    expect(
      afterRecovery?.photos.every(photo => photo.uploadStatus === 'pending'),
    ).toBe(true);

    setUploadTransportForTests({
      uploadReport: async request => {
        expect(request.idempotencyKey).toBe('key-stale');
        return serverResponse(request.idempotencyKey);
      },
    });

    const result = await processNextDueJob(db);
    expect(result.outcome).toBe('uploaded');
    const final = await getReportById(db, created.id);
    expect(final?.idempotencyKey).toBe('key-stale');
    expect(final?.status).toBe('uploaded');
  });

  test('exhausts retry policy then marks failed; manual retry requeues same key', async () => {
    const created = await seedReport('Flaky', 'key-retry');
    const db = getDatabase();
    await updateReport(db, created.id, {
      attemptCount: MAX_UPLOAD_ATTEMPTS - 1,
    });

    setUploadTransportForTests({
      uploadReport: async () => {
        throw new ApiError('server unavailable', {
          kind: 'http',
          status: 503,
          retryable: true,
        });
      },
    });

    const result = await processNextDueJob(db);
    expect(result.outcome).toBe('failed');
    const failed = await getReportById(db, created.id);
    expect(failed?.status).toBe('failed');
    expect(failed?.idempotencyKey).toBe('key-retry');

    const queued = await retryFailedReport(db, created.id);
    expect(queued).toBe(true);
    const after = await getReportWithDetails(db, created.id);
    expect(after?.status).toBe('pending');
    expect(after?.uploadJob?.state).toBe('pending');
    expect(after?.idempotencyKey).toBe('key-retry');
  });

  test('worker emits events and coalesce concurrent kicks', async () => {
    await seedReport('Evented', 'key-events');
    const events: string[] = [];
    const unsubscribe = subscribeUploadWorker(event => {
      events.push(event.type);
    });

    setUploadTransportForTests({
      uploadReport: async request => serverResponse(request.idempotencyKey),
    });

    const db = getDatabase();
    await Promise.all([
      kickUploadWorker({database: db}),
      kickUploadWorker({database: db}),
      kickUploadWorker({database: db}),
    ]);

    unsubscribe();
    expect(events).toContain('pass_started');
    expect(events).toContain('job_result');
    expect(events).toContain('pass_finished');
  });

  test('schedules retry for network failures without losing photos', async () => {
    const created = await seedReport('Offline', 'key-offline', 2);
    setUploadTransportForTests({
      uploadReport: async () => {
        throw new ApiError('Network request failed', {
          kind: 'network',
          retryable: true,
        });
      },
    });

    const db = getDatabase();
    const result = await processNextDueJob(db);
    expect(result.outcome).toBe('retry_scheduled');

    const detailed = await getReportWithDetails(db, created.id);
    expect(detailed?.status).toBe('pending');
    expect(detailed?.photos).toHaveLength(2);
    expect(detailed?.photos.every(p => p.localUri.includes('key-offline'))).toBe(
      true,
    );
    expect(detailed?.uploadJob?.nextAttemptAt).toBeTruthy();
  });
});
