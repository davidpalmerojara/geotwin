import pg from 'pg';
import { PgBoss } from 'pg-boss';
import { createStorage, waitForStorage } from '@geotwin/storage';
import { workerEnvSchema, repoRoot } from './config.js';
import { LayerRepository } from './layers.js';
import { startLayerWorker } from './worker.js';
import { removeStaleAttempts } from './temp.js';

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
// Temp folders of attempts killed before they could clean up: removed on start and then every
// 10 minutes, once they are older than the job timeout (plus a margin) and so certainly dead.
const staleAfterMs = (env.LAYER_JOB_TIMEOUT_SECONDS + 300) * 1000;
const sweep = async () => {
  const removed = await removeStaleAttempts(env.WORKER_TMP_DIR, staleAfterMs);
  if (removed.length) log.info({ removed }, 'Removed stale temp folders');
};
await sweep();
const sweeper = setInterval(() => void sweep().catch(() => undefined), 10 * 60 * 1000);
sweeper.unref();
const db = new pg.Pool({ connectionString: env.DATABASE_URL, max: 4 });
db.on('error', (error) => log.error({ err: error }, 'Idle database connection error'));
const storage = createStorage(env, repoRoot);
await waitForStorage(storage);
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
  clearInterval(sweeper);
  log.info({}, 'Worker stopping');
  // Graceful: running jobs get up to 30 s to finish, then pg-boss hands them to a retry.
  await boss.stop({ graceful: true, timeout: 30000 });
  await db.end();
}
process.once('SIGINT', () => void shutdown());
process.once('SIGTERM', () => void shutdown());
