import type { Request } from 'express';
import { consumeFailNext, getChaosConfig } from '../db';
import { cleanupTempFiles } from '../files';
import { HttpError } from '../errors';

function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

export type ChaosOutcome = 'continue' | 'hang';

/**
 * Applies failure simulation AFTER multipart parsing and validation,
 * but BEFORE any durable report/file creation.
 *
 * - continue: proceed to create the report
 * - hang: temps cleaned; caller must not send a response
 * - throws HttpError: temps cleaned; caller should return the error
 */
export async function runChaos(req: Request): Promise<ChaosOutcome> {
  const chaos = getChaosConfig();
  const files = Array.isArray(req.files) ? req.files : undefined;

  if (chaos.latencyMs > 0) {
    await sleep(chaos.latencyMs);
  }

  if (chaos.hang) {
    cleanupTempFiles(files);
    console.log('Chaos: hanging request (no response will be sent)');
    return 'hang';
  }

  if (consumeFailNext()) {
    cleanupTempFiles(files);
    throw new HttpError(500, 'Simulated upload failure (failNextN)');
  }

  if (chaos.failRate > 0 && Math.random() < chaos.failRate) {
    cleanupTempFiles(files);
    throw new HttpError(500, 'Simulated upload failure (failRate)');
  }

  return 'continue';
}
