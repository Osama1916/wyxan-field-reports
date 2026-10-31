import {uploadReportMultipart, type UploadReportRequest} from '../api/client';
import type {CreateReportResponse} from '../api/types';
import {
  getReportById,
  getReportWithDetails,
  getUploadJobById,
  listPhotosForReport,
  listUploadJobs,
  updatePhoto,
  updateReport,
  updateUploadJob,
  type LocalReport,
  type LocalReportPhoto,
  type SqlDatabase,
  type UploadJob,
} from '../db';
import {nowIso} from '../db/time';
import {
  addMsToIso,
  computeBackoffDelayMs,
  MAX_UPLOAD_ATTEMPTS,
} from './backoff';
import {classifyUploadError} from './classifyError';

export type UploadTransport = {
  uploadReport(request: UploadReportRequest): Promise<CreateReportResponse>;
};

export type ClaimedJob = {
  job: UploadJob;
  report: LocalReport;
  photos: LocalReportPhoto[];
};

export type ProcessJobResult =
  | {outcome: 'uploaded'; reportId: number; serverReportId: string; replayed: boolean}
  | {outcome: 'retry_scheduled'; reportId: number; nextAttemptAt: string; attemptCount: number; error: string}
  | {outcome: 'failed'; reportId: number; attemptCount: number; error: string}
  | {outcome: 'skipped'};

const defaultTransport: UploadTransport = {
  uploadReport: uploadReportMultipart,
};

let activeTransport: UploadTransport = defaultTransport;

/** Test helper: inject a fake multipart transport. Pass null to restore. */
export function setUploadTransportForTests(
  transport: UploadTransport | null,
): void {
  activeTransport = transport ?? defaultTransport;
}

export function getUploadTransport(): UploadTransport {
  return activeTransport;
}

/**
 * Claim the oldest due pending job and mark report/job/photos as uploading.
 * Returns null when nothing is due.
 */
export async function claimNextDueJob(
  db: SqlDatabase,
): Promise<ClaimedJob | null> {
  return db.transaction(async tx => {
    const pending = await listUploadJobs(tx, {state: 'pending'});
    const now = nowIso();
    const due = pending.filter(
      job => job.nextAttemptAt == null || job.nextAttemptAt <= now,
    );
    if (due.length === 0) {
      return null;
    }

    // listUploadJobs already orders by created_at ASC.
    const job = due[0];
    const report = await getReportById(tx, job.reportId);
    if (!report) {
      await updateUploadJob(tx, job.id, {
        state: 'failed',
        lockedAt: null,
        nextAttemptAt: null,
      });
      return null;
    }

    if (report.status === 'uploaded' && report.serverReportId) {
      await updateUploadJob(tx, job.id, {
        state: 'succeeded',
        lockedAt: null,
        nextAttemptAt: null,
      });
      return null;
    }

    const photos = await listPhotosForReport(tx, report.id);
    const attemptCount = report.attemptCount + 1;
    const lockedAt = now;

    await updateReport(tx, report.id, {
      status: 'uploading',
      attemptCount,
      lastError: null,
    });
    await updateUploadJob(tx, job.id, {
      state: 'in_progress',
      lockedAt,
    });
    for (const photo of photos) {
      await updatePhoto(tx, photo.id, {uploadStatus: 'uploading'});
    }

    const refreshedJob = await getUploadJobById(tx, job.id);
    const refreshedReport = await getReportById(tx, report.id);
    if (!refreshedJob || !refreshedReport) {
      return null;
    }

    return {
      job: refreshedJob,
      report: refreshedReport,
      photos,
    };
  });
}

async function markSuccess(
  db: SqlDatabase,
  claimed: ClaimedJob,
  response: CreateReportResponse,
): Promise<ProcessJobResult> {
  const uploadedAt = nowIso();
  const serverReport = response.report;

  await db.transaction(async tx => {
    await updateReport(tx, claimed.report.id, {
      status: 'uploaded',
      serverReportId: serverReport.id,
      lastError: null,
      uploadedAt,
    });
    await updateUploadJob(tx, claimed.job.id, {
      state: 'succeeded',
      lockedAt: null,
      nextAttemptAt: null,
    });

    const imagesByOrder = new Map(
      serverReport.images.map(image => [image.sortOrder, image]),
    );
    for (const photo of claimed.photos) {
      const serverImage = imagesByOrder.get(photo.sortOrder);
      await updatePhoto(tx, photo.id, {
        uploadStatus: 'uploaded',
        serverPhotoId: serverImage?.id ?? null,
      });
    }
  });

  return {
    outcome: 'uploaded',
    reportId: claimed.report.id,
    serverReportId: serverReport.id,
    replayed: response.replayed === true,
  };
}

async function markRetryableFailure(
  db: SqlDatabase,
  claimed: ClaimedJob,
  message: string,
): Promise<ProcessJobResult> {
  const attemptCount = claimed.report.attemptCount;
  if (attemptCount >= MAX_UPLOAD_ATTEMPTS) {
    return markPermanentFailure(db, claimed, message);
  }

  const delayMs = computeBackoffDelayMs(attemptCount);
  const nextAttemptAt = addMsToIso(nowIso(), delayMs);

  await db.transaction(async tx => {
    await updateReport(tx, claimed.report.id, {
      status: 'pending',
      lastError: message,
    });
    await updateUploadJob(tx, claimed.job.id, {
      state: 'pending',
      lockedAt: null,
      nextAttemptAt,
    });
    for (const photo of claimed.photos) {
      await updatePhoto(tx, photo.id, {uploadStatus: 'pending'});
    }
  });

  return {
    outcome: 'retry_scheduled',
    reportId: claimed.report.id,
    nextAttemptAt,
    attemptCount,
    error: message,
  };
}

async function markPermanentFailure(
  db: SqlDatabase,
  claimed: ClaimedJob,
  message: string,
): Promise<ProcessJobResult> {
  await db.transaction(async tx => {
    await updateReport(tx, claimed.report.id, {
      status: 'failed',
      lastError: message,
    });
    await updateUploadJob(tx, claimed.job.id, {
      state: 'failed',
      lockedAt: null,
      nextAttemptAt: null,
    });
    for (const photo of claimed.photos) {
      await updatePhoto(tx, photo.id, {uploadStatus: 'failed'});
    }
  });

  return {
    outcome: 'failed',
    reportId: claimed.report.id,
    attemptCount: claimed.report.attemptCount,
    error: message,
  };
}

/**
 * Run network upload for an already-claimed job and persist the outcome.
 * Never deletes local photo files.
 */
export async function executeClaimedJob(
  db: SqlDatabase,
  claimed: ClaimedJob,
  transport: UploadTransport = getUploadTransport(),
): Promise<ProcessJobResult> {
  try {
    const response = await transport.uploadReport({
      description: claimed.report.description,
      idempotencyKey: claimed.report.idempotencyKey,
      photos: claimed.photos.map(photo => ({
        localUri: photo.localUri,
        mimeType: photo.mimeType,
        sortOrder: photo.sortOrder,
      })),
    });
    return markSuccess(db, claimed, response);
  } catch (error) {
    const classified = classifyUploadError(error);
    if (classified.retryable) {
      return markRetryableFailure(db, claimed, classified.message);
    }
    return markPermanentFailure(db, claimed, classified.message);
  }
}

export async function processNextDueJob(
  db: SqlDatabase,
  transport: UploadTransport = getUploadTransport(),
): Promise<ProcessJobResult> {
  const claimed = await claimNextDueJob(db);
  if (!claimed) {
    return {outcome: 'skipped'};
  }
  return executeClaimedJob(db, claimed, transport);
}

/**
 * Re-queue a failed report for another attempt using the same idempotency key.
 */
export async function retryFailedReport(
  db: SqlDatabase,
  reportId: number,
): Promise<boolean> {
  const detailed = await getReportWithDetails(db, reportId);
  if (!detailed || !detailed.uploadJob) {
    return false;
  }
  if (detailed.status === 'uploaded') {
    return false;
  }

  const now = nowIso();
  await db.transaction(async tx => {
    await updateReport(tx, reportId, {
      status: 'pending',
      lastError: null,
    });
    await updateUploadJob(tx, detailed.uploadJob!.id, {
      state: 'pending',
      nextAttemptAt: now,
      lockedAt: null,
    });
    for (const photo of detailed.photos) {
      await updatePhoto(tx, photo.id, {uploadStatus: 'pending'});
    }
  });
  return true;
}

/**
 * Earliest future next_attempt_at among pending jobs, or null if none / all due.
 */
export async function getEarliestPendingAttemptAt(
  db: SqlDatabase,
): Promise<string | null> {
  const pending = await listUploadJobs(db, {state: 'pending'});
  const now = nowIso();
  let earliest: string | null = null;
  for (const job of pending) {
    if (job.nextAttemptAt == null || job.nextAttemptAt <= now) {
      continue;
    }
    if (earliest == null || job.nextAttemptAt < earliest) {
      earliest = job.nextAttemptAt;
    }
  }
  return earliest;
}
