/**
 * Server JSON shapes matching backend/src/types.ts and route handlers.
 * Do not invent fields — keep in sync with the Express API.
 */

export type ServerReportImage = {
  id: string;
  reportId: string;
  filename: string;
  originalName: string;
  mimeType: string;
  sizeBytes: number;
  sortOrder: number;
  url: string;
};

export type ServerReport = {
  id: string;
  idempotencyKey: string;
  description: string;
  createdAt: string;
  images: ServerReportImage[];
};

export type ServerReportSummary = {
  id: string;
  description: string;
  createdAt: string;
  imageCount: number;
};

/** POST /reports success body (201 create or 200 replay). */
export type CreateReportResponse = {
  replayed: boolean;
  report: ServerReport;
};

export type ListReportsResponse = {
  reports: ServerReportSummary[];
};

export type HealthResponse = {
  status: string;
  service: string;
};

export type ApiErrorBody = {
  error: string;
  details?: unknown;
  code?: string;
};

/** DELETE /admin/reset success body. */
export type AdminResetResponse = {
  message: string;
  deletedReports: number;
  deletedTrackedImageFiles: number;
  deletedUploadFiles: number;
  deletedTempFiles: number;
};
