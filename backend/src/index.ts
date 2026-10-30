import { createApp } from './app';
import { PORT } from './config';
import { initDb } from './db';
import { ensureStorageDirs, purgeTmpDir } from './files';

ensureStorageDirs();
initDb();
purgeTmpDir();

const app = createApp();

app.listen(PORT, () => {
  console.log(`Field Reports backend listening on http://localhost:${PORT}`);
  console.log(`SQLite database: data/fieldreports.sqlite`);
  console.log(`Uploads directory: uploads/`);
});
