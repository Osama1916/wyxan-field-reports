import type { NextFunction, Request, Response } from 'express';
import { MulterError } from 'multer';
import { HttpError } from '../errors';
import { cleanupTempFiles } from '../files';

export function errorHandler(
  err: unknown,
  req: Request,
  res: Response,
  _next: NextFunction,
): void {
  const files = req.files;
  if (Array.isArray(files)) {
    cleanupTempFiles(files);
  }

  if (err instanceof HttpError) {
    res.status(err.status).json({
      error: err.message,
      ...(err.details !== undefined ? { details: err.details } : {}),
    });
    return;
  }

  if (err instanceof MulterError) {
    const status = err.code === 'LIMIT_FILE_SIZE' ? 413 : 400;
    res.status(status).json({
      error: err.code === 'LIMIT_FILE_SIZE'
        ? 'Each image must be under 5 MB'
        : err.message,
      code: err.code,
    });
    return;
  }

  if (err instanceof Error && err.message.includes('Only image uploads')) {
    res.status(400).json({ error: err.message });
    return;
  }

  console.error('Unhandled error:', err instanceof Error ? err.message : err);
  res.status(500).json({ error: 'Internal server error' });
}
