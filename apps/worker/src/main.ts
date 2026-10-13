import pg from 'pg';
import { PgBoss } from 'pg-boss';
import { createStorage } from '@geotwin/storage';
import { workerEnvSchema, repoRoot } from './config.js';
import { LayerRepository } from './layers.js';
import { startLayerWorker } from './worker.js';

/**
 * Background worker: consumes `layer-process` jobs from pg-boss (PostgreSQL, no Redis) and turns
 * uploaded LAS/LAZ files into 3D Tiles. It runs as its own process (and container), so heavy
 * conversions never block the API; progress reaches browsers through Postgres NOTIFY.
 */
const env = workerEnvSchema.parse(process.env);
const log = {
  info: (obj: object, msg: string) => console.log(JSON.stringify({ level: 'info', msg, ...obj })),
  warn: (obj: object, msg: string) => console.warn(JSON.stringify({ level: 'warn', msg, ...obj })),
  error: (obj: object, msg: string) =>
    console.error(JSON.stringify({ level: 'error', msg, ...serialize(obj) })),
};
function serialize(obj: object) {
  return Object.fromEntries(
    Object.entries(obj).map(([k, v]) => [
      k,
      v instanceof Error ? { message: v.message, stack: v.stack } : v,
    ]),
  );
}
const db = new pg.Pool({ connectionString: env.DATABASE_URL, max: 4 });
db.on('error', (error) => log.error({ err: error }, 'Idle database connection error'));
const storage = createStorage(env, repoRoot);
await storage.ensureReady();
const boss = new PgBoss({ connectionString: env.DATABASE_URL, max: 4, instanceName: 'worker' });
boss.on('error', (error) => log.error({ err: error }, 'pg-boss error'));
await boss.start({ attempts: 10 });
await startLayerWorker(
  boss,
  { repo: new LayerRepository(db), storage, env, log },
  {
    timeoutSeconds: env.LAYER_JOB_TIMEOUT_SECONDS,
    retryLimit: env.LAYER_JOB_RETRY_LIMIT,
    concurrency: env.WORKER_CONCURRENCY,
  },
);
log.info({ storage: storage.driver, concurrency: env.WORKER_CONCURRENCY }, 'Worker started');
let stopping = false;
async function shutdown() {
  if (stopping) return;
  stopping = true;
  log.info({}, 'Worker stopping');
  // Graceful: running jobs get up to 30 s to finish, then pg-boss hands them to a retry.
  await boss.stop({ graceful: true, timeout: 30000 });
  await db.end();
}
process.once('SIGINT', () => void shutdown());
process.once('SIGTERM', () => void shutdown());
