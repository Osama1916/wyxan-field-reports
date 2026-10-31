import {ApiError} from '../api/errors';

export type ClassifiedUploadFailure = {
  retryable: boolean;
  message: string;
};

/**
 * Decide whether a thrown upload error should be retried.
 * Permanent 4xx validation failures are not retried.
 * Timeouts are retryable so idempotent POST can reconcile server-side creates.
 */
export function classifyUploadError(error: unknown): ClassifiedUploadFailure {
  if (error instanceof ApiError) {
    return {
      retryable: error.retryable,
      message: error.message,
    };
  }
  if (error instanceof Error) {
    const message = error.message || 'Upload failed';
    const lower = message.toLowerCase();
    const looksNetwork =
      lower.includes('network') ||
      lower.includes('failed to fetch') ||
      lower.includes('connection') ||
      lower.includes('timed out') ||
      lower.includes('timeout') ||
      error.name === 'AbortError';
    return {
      retryable: looksNetwork,
      message,
    };
  }
  return {
    retryable: true,
    message: 'Upload failed',
  };
}
