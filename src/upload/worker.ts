import {requestServerReviewRefresh} from '../api/serverReviewRefresh';
import {getDatabase, type SqlDatabase} from '../db';
import {
  getEarliestPendingAttemptAt,
  getUploadTransport,
  processNextDueJob,
  type ProcessJobResult,
  type UploadTransport,
} from './processJob';

export type UploadWorkerEvent =
  | {type: 'pass_started'}
  | {type: 'job_result'; result: ProcessJobResult}
  | {type: 'pass_finished'; processed: number}
  | {type: 'error'; message: string};

type Listener = (event: UploadWorkerEvent) => void;

let runningPromise: Promise<void> | null = null;
let rerunRequested = false;
let scheduledTimer: ReturnType<typeof setTimeout> | null = null;
let uploadsPaused = false;
const listeners = new Set<Listener>();

/** Test/reset helper. */
export function resetUploadWorkerForTests(): void {
  if (scheduledTimer) {
    clearTimeout(scheduledTimer);
    scheduledTimer = null;
  }
  runningPromise = null;
  rerunRequested = false;
  uploadsPaused = false;
  listeners.clear();
}

/**
 * Blocks new upload passes (and cancels a scheduled retry timer).
 * Does not forcibly abort an in-flight pass — callers should refuse reset
 * while isUploadWorkerRunning() is true.
 */
export function pauseUploadWorker(): void {
  uploadsPaused = true;
  rerunRequested = false;
  if (scheduledTimer) {
    clearTimeout(scheduledTimer);
    scheduledTimer = null;
  }
}

export function resumeUploadWorker(): void {
  uploadsPaused = false;
}

export function isUploadWorkerPaused(): boolean {
  return uploadsPaused;
}

export function subscribeUploadWorker(listener: Listener): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

function emit(event: UploadWorkerEvent): void {
  for (const listener of listeners) {
    try {
      listener(event);
    } catch {
      // Listener failures must not break the worker.
    }
  }
}

function schedulePassAt(iso: string): void {
  const delayMs = Math.max(0, new Date(iso).getTime() - Date.now());
  if (scheduledTimer) {
    clearTimeout(scheduledTimer);
  }
  scheduledTimer = setTimeout(() => {
    scheduledTimer = null;
    void kickUploadWorker();
  }, delayMs + 25);
}

async function runPass(
  db: SqlDatabase,
  transport: UploadTransport,
): Promise<number> {
  emit({type: 'pass_started'});
  let processed = 0;

  // Process due jobs sequentially — never concurrently for the same queue.
  while (true) {
    if (uploadsPaused) {
      break;
    }
    const result = await processNextDueJob(db, transport);
    if (result.outcome === 'skipped') {
      break;
    }
    processed += 1;
    emit({type: 'job_result', result});
    // Successful create or idempotent replay — refresh server-backed review.
    // Failures / scheduled retries must not hit GET /reports.
    if (result.outcome === 'uploaded') {
      requestServerReviewRefresh();
    }
  }

  if (!uploadsPaused) {
    const nextAt = await getEarliestPendingAttemptAt(db);
    if (nextAt) {
      schedulePassAt(nextAt);
    }
  }

  emit({type: 'pass_finished', processed});
  return processed;
}

/**
 * Single-flight upload worker.
 * Concurrent kicks coalesce into one running pass (+ optional follow-up).
 * Durability lives in SQLite, not React state.
 */
export function kickUploadWorker(options?: {
  database?: SqlDatabase;
  transport?: UploadTransport;
}): Promise<void> {
  if (uploadsPaused) {
    return Promise.resolve();
  }

  if (runningPromise) {
    rerunRequested = true;
    return runningPromise;
  }

  const database = options?.database;
  const transport = options?.transport ?? getUploadTransport();

  runningPromise = (async () => {
    do {
      rerunRequested = false;
      if (uploadsPaused) {
        break;
      }
      try {
        const db = database ?? getDatabase();
        await runPass(db, transport);
      } catch (error) {
        emit({
          type: 'error',
          message:
            error instanceof Error
              ? error.message
              : 'Upload worker failed unexpectedly',
        });
      }
    } while (rerunRequested && !uploadsPaused);
  })().finally(() => {
    runningPromise = null;
  });

  return runningPromise;
}

export function isUploadWorkerRunning(): boolean {
  return runningPromise != null;
}
