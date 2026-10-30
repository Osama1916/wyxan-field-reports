/**
 * Domain types for the local FieldReports SQLite store.
 * SQLite is the source of truth for locally created reports.
 */

export type ReportStatus =
  | 'pending'
  | 'uploading'
  | 'uploaded'
  | 'failed';

export type PhotoUploadStatus =
  | 'pending'
  | 'uploading'
  | 'uploaded'
  | 'failed';

export type UploadJobState =
  | 'pending'
  | 'in_progress'
  | 'succeeded'
  | 'failed';

export type SqlPrimitive = string | number | null;
export type SqlParams = ReadonlyArray<SqlPrimitive>;

export type QueryResult = {
  rows: Array<Record<string, SqlPrimitive>>;
  rowsAffected: number;
  insertId?: number;
};

/** Minimal async SQL surface shared by production (op-sqlite) and tests. */
export type SqlExecutor = {
  execute(sql: string, params?: SqlParams): Promise<QueryResult>;
};

export type SqlDatabase = SqlExecutor & {
  transaction<T>(fn: (tx: SqlExecutor) => Promise<T>): Promise<T>;
  close(): void | Promise<void>;
};

export type LocalReport = {
  id: number;
  idempotencyKey: string;
  description: string;
  status: ReportStatus;
  serverReportId: string | null;
  attemptCount: number;
  lastError: string | null;
  createdAt: string;
  updatedAt: string;
  uploadedAt: string | null;
};

export type LocalReportPhoto = {
  id: number;
  reportId: number;
  localUri: string;
  sortOrder: number;
  byteSize: number;
  mimeType: string;
  uploadStatus: PhotoUploadStatus;
  serverPhotoId: string | null;
};

export type UploadJob = {
  id: number;
  reportId: number;
  state: UploadJobState;
  nextAttemptAt: string | null;
  lockedAt: string | null;
  createdAt: string;
  updatedAt: string;
};

export type LocalReportWithPhotos = LocalReport & {
  photos: LocalReportPhoto[];
  uploadJob: UploadJob | null;
};

export type CreatePhotoInput = {
  localUri: string;
  sortOrder: number;
  byteSize: number;
  mimeType: string;
};

export type CreateLocalReportInput = {
  description: string;
  /** Generated once at create time; never regenerated on retries. */
  idempotencyKey: string;
  photos: CreatePhotoInput[];
};

export type UpdateReportInput = {
  description?: string;
  status?: ReportStatus;
  serverReportId?: string | null;
  attemptCount?: number;
  lastError?: string | null;
  uploadedAt?: string | null;
};

export type UpdatePhotoInput = {
  uploadStatus?: PhotoUploadStatus;
  serverPhotoId?: string | null;
  localUri?: string;
  byteSize?: number;
  mimeType?: string;
  sortOrder?: number;
};

export type UpdateUploadJobInput = {
  state?: UploadJobState;
  nextAttemptAt?: string | null;
  lockedAt?: string | null;
};
