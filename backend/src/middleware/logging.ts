import type { NextFunction, Request, Response } from 'express';

/**
 * Request logging that never dumps multipart bodies or image bytes.
 */
export function requestLogger(
  req: Request,
  res: Response,
  next: NextFunction,
): void {
  const started = Date.now();
  const idempotencyKey = req.header('Idempotency-Key');

  res.on('finish', () => {
    const durationMs = Date.now() - started;
    const parts = [
      req.method,
      req.originalUrl,
      res.statusCode,
      `${durationMs}ms`,
    ];

    if (idempotencyKey) {
      // Log presence / short prefix only — not used as a secret, but keep logs short.
      parts.push(`idempotency=${idempotencyKey.slice(0, 8)}…`);
    }

    if (req.files && Array.isArray(req.files)) {
      parts.push(`files=${req.files.length}`);
    }

    console.log(parts.join(' '));
  });

  next();
}
