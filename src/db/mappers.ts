import type {
  LocalReport,
  LocalReportPhoto,
  PhotoUploadStatus,
  ReportStatus,
  SqlPrimitive,
  UploadJob,
  UploadJobState,
} from './types';

function asString(value: SqlPrimitive | undefined, field: string): string {
  if (typeof value === 'string') {
    return value;
  }
  throw new Error(`Expected string for ${field}, got ${typeof value}`);
}

function asNullableString(
  value: SqlPrimitive | undefined,
): string | null {
  if (value === null || value === undefined) {
    return null;
  }
  if (typeof value === 'string') {
    return value;
  }
  throw new Error(`Expected string|null, got ${typeof value}`);
}

function asNumber(value: SqlPrimitive | undefined, field: string): number {
  if (typeof value === 'number' && Number.isFinite(value)) {
    return value;
  }
  if (typeof value === 'string' && value.length > 0) {
    const parsed = Number(value);
    if (Number.isFinite(parsed)) {
      return parsed;
    }
  }
  throw new Error(`Expected number for ${field}, got ${String(value)}`);
}

export function mapReport(row: Record<string, SqlPrimitive>): LocalReport {
  return {
    id: asNumber(row.id, 'reports.id'),
    idempotencyKey: asString(row.idempotency_key, 'reports.idempotency_key'),
    description: asString(row.description, 'reports.description'),
    status: asString(row.status, 'reports.status') as ReportStatus,
    serverReportId: asNullableString(row.server_report_id),
    attemptCount: asNumber(row.attempt_count, 'reports.attempt_count'),
    lastError: asNullableString(row.last_error),
    createdAt: asString(row.created_at, 'reports.created_at'),
    updatedAt: asString(row.updated_at, 'reports.updated_at'),
    uploadedAt: asNullableString(row.uploaded_at),
  };
}

export function mapPhoto(row: Record<string, SqlPrimitive>): LocalReportPhoto {
  return {
    id: asNumber(row.id, 'report_photos.id'),
    reportId: asNumber(row.report_id, 'report_photos.report_id'),
    localUri: asString(row.local_uri, 'report_photos.local_uri'),
    sortOrder: asNumber(row.sort_order, 'report_photos.sort_order'),
    byteSize: asNumber(row.byte_size, 'report_photos.byte_size'),
    mimeType: asString(row.mime_type, 'report_photos.mime_type'),
    uploadStatus: asString(
      row.upload_status,
      'report_photos.upload_status',
    ) as PhotoUploadStatus,
    serverPhotoId: asNullableString(row.server_photo_id),
  };
}

export function mapUploadJob(row: Record<string, SqlPrimitive>): UploadJob {
  return {
    id: asNumber(row.id, 'upload_jobs.id'),
    reportId: asNumber(row.report_id, 'upload_jobs.report_id'),
    state: asString(row.state, 'upload_jobs.state') as UploadJobState,
    nextAttemptAt: asNullableString(row.next_attempt_at),
    lockedAt: asNullableString(row.locked_at),
    createdAt: asString(row.created_at, 'upload_jobs.created_at'),
    updatedAt: asString(row.updated_at, 'upload_jobs.updated_at'),
  };
}
