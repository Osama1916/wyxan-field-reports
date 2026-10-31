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

/**
 * User-facing database error text.
 * Production: short, non-sensitive message only.
 * Development: original message, cause chain, and stacks for diagnosis.
 */
export function formatDatabaseErrorForDisplay(error: unknown): string {
  if (!__DEV__) {
    return 'Local database failed to initialize.';
  }

  const parts: string[] = [];
  let current: unknown = error;
  let depth = 0;

  while (current != null && depth < 5) {
    if (current instanceof Error) {
      const header =
        depth === 0
          ? current.message
          : `Caused by: ${current.name}: ${current.message}`;
      parts.push(header);
      if (typeof current.stack === 'string' && current.stack.length > 0) {
        parts.push(current.stack);
      }
      current =
        'cause' in current ? (current as {cause?: unknown}).cause : undefined;
    } else {
      parts.push(String(current));
      break;
    }
    depth += 1;
  }

  if (parts.length === 0) {
    return 'Local database failed to initialize.';
  }
  return parts.join('\n\n');
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
