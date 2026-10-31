export type ApiErrorKind =
  | 'network'
  | 'timeout'
  | 'http'
  | 'invalid_response'
  | 'aborted';

export class ApiError extends Error {
  readonly kind: ApiErrorKind;
  readonly status: number | null;
  readonly retryable: boolean;
  readonly body: unknown;

  constructor(
    message: string,
    options: {
      kind: ApiErrorKind;
      status?: number | null;
      retryable: boolean;
      body?: unknown;
      cause?: unknown;
    },
  ) {
    super(message);
    this.name = 'ApiError';
    this.kind = options.kind;
    this.status = options.status ?? null;
    this.retryable = options.retryable;
    this.body = options.body;
    if (options.cause !== undefined) {
      (this as Error & {cause?: unknown}).cause = options.cause;
    }
  }
}

export function isRetryableHttpStatus(status: number): boolean {
  return status === 408 || status === 429 || status >= 500;
}

export function isPermanentHttpStatus(status: number): boolean {
  return status >= 400 && status < 500 && !isRetryableHttpStatus(status);
}
