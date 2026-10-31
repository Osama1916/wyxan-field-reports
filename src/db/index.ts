/**
 * Local durable SQLite storage for FieldReports.
 * SQLite is the source of truth for locally created reports.
 */

export {openOpSqliteDatabase, wrapOpSqliteDatabase} from './adapters';
export {
  closeDatabase,
  DEFAULT_DATABASE_NAME,
  getDatabase,
  initializeDatabase,
  setActiveDatabaseForTests,
} from './database';
export type {
  InitializeDatabaseOptions,
  InitializeDatabaseResult,
} from './database';
export {
  verifyNativeDatabaseRuntime,
  type NativeDatabaseVerification,
} from './nativeRuntimeCheck';
export {resetDatabaseStartup, startDatabase} from './startup';
export {createLocalReport} from './createLocalReport';
export {
  clearReportDraft,
  DRAFT_SINGLETON_ID,
  getReportDraft,
  listDraftPhotoLocalUris,
  replaceDraftPhotos,
  upsertDraftDescription,
  type DraftPhotoInput,
  type DraftPhotoRow,
  type ReportDraft,
} from './draftRepository';
export {
  DatabaseError,
  formatDatabaseErrorForDisplay,
  isUniqueConstraintError,
  UniqueConstraintError,
  wrapDatabaseError,
} from './errors';
export {createIdempotencyKey} from './idempotency';
export {
  getAppliedMigrationVersions,
  getLatestMigrationVersion,
  MIGRATIONS,
  runMigrations,
} from './migrations';
export {
  deletePhoto,
  getPhotoById,
  insertPhoto,
  listPhotosForReport,
  updatePhoto,
} from './photosRepository';
export {
  recoverStaleUploadJobs,
  type RecoverStaleJobsResult,
} from './recoverStaleJobs';
export {
  deleteAllReports,
  deleteReport,
  getReportById,
  getReportByIdempotencyKey,
  getReportWithDetails,
  listAllPhotoLocalUris,
  listReports,
  updateReport,
} from './reportsRepository';
export type {
  CreateLocalReportInput,
  CreatePhotoInput,
  LocalReport,
  LocalReportPhoto,
  LocalReportWithPhotos,
  PhotoUploadStatus,
  QueryResult,
  ReportStatus,
  SqlDatabase,
  SqlExecutor,
  SqlParams,
  UpdatePhotoInput,
  UpdateReportInput,
  UpdateUploadJobInput,
  UploadJob,
  UploadJobState,
} from './types';
export {
  deleteUploadJob,
  getUploadJobById,
  getUploadJobByReportId,
  insertUploadJob,
  listUploadJobs,
  updateUploadJob,
} from './uploadJobsRepository';
