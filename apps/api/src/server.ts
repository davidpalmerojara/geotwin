import { createPool } from './db/pool.js';
import { buildApp } from './app.js';
import { env } from './config/env.js';
const db = createPool();
db.on('error', (error) => console.error('Idle database connection error', error));
const app = await buildApp(db);
async function shutdown() {
  await app.close();
  await db.end();
}
process.once('SIGINT', () => void shutdown());
process.once('SIGTERM', () => void shutdown());
try {
  await app.listen({ port: env.PORT, host: env.HOST });
} catch (error) {
  app.log.error(error);
  await shutdown();
  process.exitCode = 1;
}
