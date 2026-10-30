import { randomUUID } from 'node:crypto';
import path from 'node:path';
import { Router, type NextFunction, type Request, type Response } from 'express';
import {
  createReport,
  findReportById,
  findReportByIdempotencyKey,
  listReports,
} from '../db';
import { MAX_IMAGES, MIN_IMAGES } from '../config';
import { HttpError } from '../errors';
import {
  cleanupTempFiles,
  moveTempToUploads,
  removeFileQuietly,
} from '../files';
import { runChaos } from '../middleware/chaos';
import { assertImageSizeLimits, uploadImages } from '../middleware/upload';

export const reportsRouter = Router();

function runMulter(req: Request, res: Response): Promise<void> {
  return new Promise((resolve, reject) => {
    uploadImages(req, res, (err: unknown) => {
      if (err) {
        reject(err);
        return;
      }
      resolve();
    });
  });
}

function getIdempotencyKey(req: Request): string {
  const key = req.header('Idempotency-Key')?.trim();
  if (!key) {
    throw new HttpError(400, 'Idempotency-Key header is required');
  }
  return key;
}

function getDescription(req: Request): string {
  const raw = req.body?.description;
  const description = typeof raw === 'string' ? raw.trim() : '';
  if (!description) {
    throw new HttpError(400, 'description is required and must be non-empty');
  }
  return description;
}

function getImages(req: Request): Express.Multer.File[] {
  const files = req.files;
  if (!Array.isArray(files) || files.length < MIN_IMAGES) {
    throw new HttpError(
      400,
      `Between ${MIN_IMAGES} and ${MAX_IMAGES} images are required (field name: images)`,
    );
  }
  if (files.length > MAX_IMAGES) {
    throw new HttpError(400, `At most ${MAX_IMAGES} images are allowed`);
  }
  return files;
}

function isUniqueConstraintError(err: unknown): boolean {
  if (!(err instanceof Error)) {
    return false;
  }
  const code =
    'code' in err && err.code != null ? String(err.code) : '';
  const message = err.message.toLowerCase();
  return (
    code === 'SQLITE_CONSTRAINT_UNIQUE' ||
    code === 'SQLITE_CONSTRAINT' ||
    code === 'ERR_SQLITE_ERROR' ||
    message.includes('unique constraint failed')
  );
}

reportsRouter.get('/reports', (_req, res) => {
  res.json({ reports: listReports() });
});

reportsRouter.get('/reports/:id', (req, res, next) => {
  try {
    const report = findReportById(req.params.id);
    if (!report) {
      throw new HttpError(404, 'Report not found');
    }
    res.json(report);
  } catch (err) {
    next(err);
  }
});

reportsRouter.post(
  '/reports',
  async (req: Request, res: Response, next: NextFunction) => {
    let files: Express.Multer.File[] | undefined;

    try {
      await runMulter(req, res);
      files = Array.isArray(req.files) ? req.files : undefined;

      const idempotencyKey = getIdempotencyKey(req);
      const description = getDescription(req);
      const images = getImages(req);

      try {
        assertImageSizeLimits(images);
      } catch (sizeErr) {
        cleanupTempFiles(images);
        const message =
          sizeErr instanceof Error ? sizeErr.message : 'Invalid image size';
        throw new HttpError(413, message);
      }

      // Idempotent replay: return existing report, discard newly uploaded temps.
      const existing = findReportByIdempotencyKey(idempotencyKey);
      if (existing) {
        cleanupTempFiles(images);
        res.status(200).json({
          replayed: true,
          report: existing,
        });
        return;
      }

      // Chaos: after validation, before any durable writes.
      const chaosOutcome = await runChaos(req);
      if (chaosOutcome === 'hang') {
        return;
      }

      const reportId = randomUUID();
      const createdAt = new Date().toISOString();
      const movedPaths: string[] = [];
      const imageInputs: Array<{
        id: string;
        filename: string;
        originalName: string;
        mimeType: string;
        sizeBytes: number;
        sortOrder: number;
      }> = [];

      try {
        for (let i = 0; i < images.length; i += 1) {
          const file = images[i];
          const ext = path.extname(file.originalname).toLowerCase() || '.jpg';
          const filename = `${reportId}-${i}${ext}`;
          const dest = moveTempToUploads(file.path, filename);
          movedPaths.push(dest);

          imageInputs.push({
            id: randomUUID(),
            filename,
            originalName: file.originalname,
            mimeType: file.mimetype,
            sizeBytes: file.size,
            sortOrder: i,
          });
        }

        const report = createReport({
          id: reportId,
          idempotencyKey,
          description,
          createdAt,
          images: imageInputs,
        });

        res.status(201).json({
          replayed: false,
          report,
        });
      } catch (writeErr) {
        for (const moved of movedPaths) {
          removeFileQuietly(moved);
        }
        cleanupTempFiles(images);

        if (isUniqueConstraintError(writeErr)) {
          const raced = findReportByIdempotencyKey(idempotencyKey);
          if (raced) {
            res.status(200).json({
              replayed: true,
              report: raced,
            });
            return;
          }
        }

        throw writeErr;
      }
    } catch (err) {
      if (files) {
        cleanupTempFiles(files);
      }
      next(err);
    }
  },
);
