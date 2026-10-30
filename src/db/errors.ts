/**
 * Safe, typed wrappers around SQLite failures.
 * Callers should catch DatabaseError rather than raw driver errors.
 */

export class DatabaseError extends Error {
  readonly cause?: unknown;
  readonly code?: string;

  constructor(message: string, options?: {cause?: unknown; code?: string}) {
    super(message);
    this.name = 'DatabaseError';
    this.cause = options?.cause;
    this.code = options?.code;
  }
}

export class UniqueConstraintError extends DatabaseError {
  constructor(message: string, options?: {cause?: unknown}) {
    super(message, {cause: options?.cause, code: 'UNIQUE_CONSTRAINT'});
    this.name = 'UniqueConstraintError';
  }
}

export function wrapDatabaseError(
  error: unknown,
  context: string,
): DatabaseError {
  if (error instanceof DatabaseError) {
    return error;
  }

  const message =
    error instanceof Error ? error.message : String(error ?? 'Unknown error');
  const lower = message.toLowerCase();

  if (lower.includes('unique')) {
    return new UniqueConstraintError(`${context}: ${message}`, {cause: error});
  }

  return new DatabaseError(`${context}: ${message}`, {cause: error});
}

export function isUniqueConstraintError(error: unknown): boolean {
  if (error instanceof UniqueConstraintError) {
    return true;
  }
  if (!(error instanceof Error)) {
    return false;
  }
  const lower = error.message.toLowerCase();
  return lower.includes('unique');
}
