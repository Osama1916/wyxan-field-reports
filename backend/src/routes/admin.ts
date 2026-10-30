import { Router } from 'express';
import {
  getChaosConfig,
  listAllImageFilenames,
  resetAllReports,
  updateChaosConfig,
} from '../db';
import { HttpError } from '../errors';
import { purgeAllUploads, purgeTmpDir } from '../files';
import type { ChaosConfig } from '../types';

export const adminRouter = Router();

adminRouter.get('/admin/chaos', (_req, res) => {
  res.json(getChaosConfig());
});

adminRouter.patch('/admin/chaos', (req, res, next) => {
  try {
    const body = (req.body ?? {}) as Record<string, unknown>;
    const patch: Partial<ChaosConfig> = {};

    if (body.latencyMs !== undefined) {
      patch.latencyMs = Number(body.latencyMs);
    }
    if (body.failNextN !== undefined) {
      patch.failNextN = Number(body.failNextN);
    }
    if (body.failRate !== undefined) {
      patch.failRate = Number(body.failRate);
    }
    if (body.hang !== undefined) {
      if (typeof body.hang === 'boolean') {
        patch.hang = body.hang;
      } else if (body.hang === 0 || body.hang === 1) {
        patch.hang = body.hang === 1;
      } else if (body.hang === 'true' || body.hang === 'false') {
        patch.hang = body.hang === 'true';
      } else {
        throw new HttpError(400, 'hang must be a boolean');
      }
    }

    const updated = updateChaosConfig(patch);
    res.json(updated);
  } catch (err) {
    if (err instanceof Error && !(err instanceof HttpError)) {
      next(new HttpError(400, err.message));
      return;
    }
    next(err);
  }
});

/**
 * Deletes:
 * - All report and image metadata rows in SQLite
 * - All files under backend/uploads/ (except .gitkeep)
 * - Leftover files under backend/tmp/
 *
 * Does not reset chaos configuration.
 */
adminRouter.delete('/admin/reset', (_req, res) => {
  const beforeFiles = listAllImageFilenames();
  const { deletedReports } = resetAllReports();
  const deletedUploadFiles = purgeAllUploads();
  const deletedTempFiles = purgeTmpDir();

  res.json({
    message:
      'Deleted all report metadata from SQLite and all files in uploads/ and tmp/. Chaos settings were left unchanged.',
    deletedReports,
    deletedTrackedImageFiles: beforeFiles.length,
    deletedUploadFiles,
    deletedTempFiles,
  });
});
