import {
  getApiBaseUrl,
  HEALTH_REQUEST_TIMEOUT_MS,
  UPLOAD_REQUEST_TIMEOUT_MS,
} from './config';
import {ApiError, isPermanentHttpStatus, isRetryableHttpStatus} from './errors';
import type {
  AdminResetResponse,
  ApiErrorBody,
  CreateReportResponse,
  HealthResponse,
  ListReportsResponse,
  ServerReport,
} from './types';
import {stripFileScheme} from '../reports/photoStorage';

export type UploadPhotoPart = {
  localUri: string;
  mimeType: string;
  fileName?: string | null;
  sortOrder: number;
};

export type UploadReportRequest = {
  description: string;
  idempotencyKey: string;
  photos: readonly UploadPhotoPart[];
  timeoutMs?: number;
};

function joinUrl(base: string, path: string): string {
  return `${base.replace(/\/$/, '')}${path.startsWith('/') ? path : `/${path}`}`;
}

function basenameFromUri(uri: string, fallback: string): string {
  const path = stripFileScheme(uri);
  const parts = path.split(/[/\\]/).filter(Boolean);
  const last = parts[parts.length - 1];
  return last && last.includes('.') ? last : fallback;
}

function extensionForMime(mimeType: string): string {
  const normalized = mimeType.trim().toLowerCase();
  if (normalized === 'image/png') {
    return '.png';
  }
  if (normalized === 'image/webp') {
    return '.webp';
  }
  if (normalized === 'image/gif') {
    return '.gif';
  }
  if (normalized === 'image/heic' || normalized === 'image/heif') {
    return '.heic';
  }
  return '.jpg';
}

async function parseJsonSafe(response: Response): Promise<unknown> {
  const text = await response.text();
  if (!text) {
    return null;
  }
  try {
    return JSON.parse(text) as unknown;
  } catch (cause) {
    throw new ApiError('Server returned non-JSON response', {
      kind: 'invalid_response',
      status: response.status,
      retryable: isRetryableHttpStatus(response.status),
      body: text,
      cause,
    });
  }
}

function errorMessageFromBody(body: unknown, fallback: string): string {
  if (body && typeof body === 'object' && 'error' in body) {
    const message = (body as ApiErrorBody).error;
    if (typeof message === 'string' && message.trim() !== '') {
      return message;
    }
  }
  return fallback;
}

async function fetchWithTimeout(
  url: string,
  init: RequestInit,
  timeoutMs: number,
): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, {
      ...init,
      signal: controller.signal,
    });
  } catch (error) {
    if (
      error instanceof Error &&
      (error.name === 'AbortError' || /aborted/i.test(error.message))
    ) {
      throw new ApiError('Request timed out', {
        kind: 'timeout',
        retryable: true,
        cause: error,
      });
    }
    throw new ApiError(
      error instanceof Error ? error.message : 'Network request failed',
      {
        kind: 'network',
        retryable: true,
        cause: error,
      },
    );
  } finally {
    clearTimeout(timer);
  }
}

export async function getHealth(
  timeoutMs: number = HEALTH_REQUEST_TIMEOUT_MS,
): Promise<HealthResponse> {
  const response = await fetchWithTimeout(
    joinUrl(getApiBaseUrl(), '/health'),
    {method: 'GET'},
    timeoutMs,
  );
  const body = await parseJsonSafe(response);
  if (!response.ok) {
    throw new ApiError(errorMessageFromBody(body, `Health check failed (${response.status})`), {
      kind: 'http',
      status: response.status,
      retryable: isRetryableHttpStatus(response.status),
      body,
    });
  }
  return body as HealthResponse;
}

/** In-flight GET /reports — concurrent callers share one network request. */
let listServerReportsInFlight: Promise<ListReportsResponse> | null = null;

/** Test helper: clear in-flight dedupe state between cases. */
export function resetListServerReportsForTests(): void {
  listServerReportsInFlight = null;
}

/**
 * GET /reports. Concurrent callers coalesce onto a single in-flight promise.
 * A later call after the in-flight request settles starts a new GET.
 */
export async function listServerReports(): Promise<ListReportsResponse> {
  if (listServerReportsInFlight) {
    return listServerReportsInFlight;
  }

  listServerReportsInFlight = (async () => {
    const response = await fetchWithTimeout(
      joinUrl(getApiBaseUrl(), '/reports'),
      {method: 'GET'},
      HEALTH_REQUEST_TIMEOUT_MS,
    );
    const body = await parseJsonSafe(response);
    if (!response.ok) {
      throw new ApiError(
        errorMessageFromBody(
          body,
          `Failed to list reports (${response.status})`,
        ),
        {
          kind: 'http',
          status: response.status,
          retryable: isRetryableHttpStatus(response.status),
          body,
        },
      );
    }
    return body as ListReportsResponse;
  })().finally(() => {
    listServerReportsInFlight = null;
  });

  return listServerReportsInFlight;
}

/**
 * DELETE /admin/reset — wipes server report metadata + upload/tmp files.
 * Does not change chaos configuration (backend contract).
 */
export async function resetServerReports(
  timeoutMs: number = HEALTH_REQUEST_TIMEOUT_MS,
): Promise<AdminResetResponse> {
  const response = await fetchWithTimeout(
    joinUrl(getApiBaseUrl(), '/admin/reset'),
    {
      method: 'DELETE',
      headers: {Accept: 'application/json'},
    },
    timeoutMs,
  );
  const body = await parseJsonSafe(response);
  if (!response.ok) {
    throw new ApiError(
      errorMessageFromBody(
        body,
        `Server reset failed (${response.status})`,
      ),
      {
        kind: 'http',
        status: response.status,
        retryable: isRetryableHttpStatus(response.status),
        body,
      },
    );
  }
  return body as AdminResetResponse;
}

export async function getServerReport(id: string): Promise<ServerReport> {
  const response = await fetchWithTimeout(
    joinUrl(getApiBaseUrl(), `/reports/${encodeURIComponent(id)}`),
    {method: 'GET'},
    HEALTH_REQUEST_TIMEOUT_MS,
  );
  const body = await parseJsonSafe(response);
  if (!response.ok) {
    throw new ApiError(
      errorMessageFromBody(body, `Failed to fetch report (${response.status})`),
      {
        kind: 'http',
        status: response.status,
        retryable: isRetryableHttpStatus(response.status),
        body,
      },
    );
  }
  return body as ServerReport;
}

/**
 * POST /reports multipart:
 * - Header Idempotency-Key
 * - Field description
 * - Field images (1–5 files), same field name repeated
 */
export async function uploadReportMultipart(
  request: UploadReportRequest,
): Promise<CreateReportResponse> {
  const form = new FormData();
  form.append('description', request.description);

  const ordered = [...request.photos].sort(
    (a, b) => a.sortOrder - b.sortOrder,
  );
  ordered.forEach((photo, index) => {
    const ext = extensionForMime(photo.mimeType);
    const name =
      photo.fileName?.trim() ||
      basenameFromUri(photo.localUri, `photo-${index}${ext}`);
    // React Native FormData file part shape (uri/type/name).
    form.append('images', {
      uri: photo.localUri,
      type: photo.mimeType,
      name,
    } as unknown as Blob);
  });

  const response = await fetchWithTimeout(
    joinUrl(getApiBaseUrl(), '/reports'),
    {
      method: 'POST',
      headers: {
        'Idempotency-Key': request.idempotencyKey,
        Accept: 'application/json',
      },
      body: form,
    },
    request.timeoutMs ?? UPLOAD_REQUEST_TIMEOUT_MS,
  );

  const body = await parseJsonSafe(response);

  if (!response.ok) {
    const message = errorMessageFromBody(
      body,
      `Upload failed (${response.status})`,
    );
    throw new ApiError(message, {
      kind: 'http',
      status: response.status,
      retryable: !isPermanentHttpStatus(response.status),
      body,
    });
  }

  if (
    !body ||
    typeof body !== 'object' ||
    !('report' in body) ||
    typeof (body as CreateReportResponse).report !== 'object' ||
    !(body as CreateReportResponse).report?.id
  ) {
    throw new ApiError('Malformed upload response: missing report.id', {
      kind: 'invalid_response',
      status: response.status,
      retryable: true,
      body,
    });
  }

  return body as CreateReportResponse;
}
