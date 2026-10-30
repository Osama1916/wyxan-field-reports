import express from 'express';
import cors from 'cors';
import path from 'node:path';
import { UPLOADS_DIR } from './config';
import { errorHandler } from './middleware/errorHandler';
import { requestLogger } from './middleware/logging';
import { adminRouter } from './routes/admin';
import { healthRouter } from './routes/health';
import { reportsRouter } from './routes/reports';

export function createApp() {
  const app = express();

  app.use(cors());
  app.use(express.json({ limit: '32kb' }));
  app.use(requestLogger);

  app.use('/uploads', express.static(path.resolve(UPLOADS_DIR)));

  app.use(healthRouter);
  app.use(reportsRouter);
  app.use(adminRouter);

  app.use((_req, res) => {
    res.status(404).json({ error: 'Not found' });
  });

  app.use(errorHandler);

  return app;
}
