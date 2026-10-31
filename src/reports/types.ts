/**
 * In-memory photo selection before permanent copy + SQLite save.
 */

export type SelectedPhoto = {
  /** Stable id for list keys / remove. */
  selectionId: string;
  /** Temporary picker/camera URI (may be cache or content://). */
  uri: string;
  mimeType: string;
  byteSize: number;
  fileName: string | null;
  /**
   * Best-effort fingerprint to prevent selecting the same image twice
   * (uri, or originalPath, or fileName+size).
   */
  fingerprint: string;
  /**
   * Absolute path of an app-owned compressed temp (never a gallery original).
   * Deleted after permanent persist or when the selection is discarded.
   */
  ownedTempPath?: string | null;
  /** True when this URI came from the compression pipeline. */
  wasCompressed?: boolean;
  /**
   * True when `uri` points at a durable app-owned draft copy under report-photos/.
   * These files are reused on Save (no second copy) and owned by the draft until then.
   */
  draftPersisted?: boolean;
};

export type ReportValidationIssue = {
  field: 'description' | 'photos' | 'photo';
  message: string;
  /** Optional index into the photos array when field === 'photo'. */
  photoIndex?: number;
};

export type ReportValidationResult =
  | {ok: true}
  | {ok: false; issues: ReportValidationIssue[]};

export type PersistPhotoResult = {
  localUri: string;
  absolutePath: string;
  byteSize: number;
  mimeType: string;
  sortOrder: number;
};
