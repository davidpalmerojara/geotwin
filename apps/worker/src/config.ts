import { config } from 'dotenv';
import { cpus } from 'node:os';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { z } from 'zod';
import { storageEnvSchema } from '@geotwin/storage';
const root = fileURLToPath(new URL('../../../', import.meta.url));
config({ path: `${root}.env`, quiet: true });
const optionalNumber = z.preprocess(
  (v) => (v === '' || v === undefined ? undefined : v),
  z.coerce.number().min(-150).max(150).optional(),
);
export const workerEnvSchema = storageEnvSchema.extend({
  DATABASE_URL: z.string().default('postgresql://geotwin:geotwin_local@localhost:55432/geotwin'),
  // Python with laspy[lazrs] and py3dtiles (apps/worker/python/requirements.txt).
  LIDAR_PYTHON: z.string().default('python3'),
  LIDAR_SCRIPT: z.string().default(`${root}apps/worker/python/geotwin_lidar.py`),
  WORKER_TMP_DIR: z.string().default(tmpdir()),
  WORKER_CONCURRENCY: z.coerce.number().int().min(1).max(8).default(1),
  TILER_JOBS: z.coerce
    .number()
    .int()
    .min(1)
    .max(64)
    .default(Math.max(1, cpus().length - 1)),
  // py3dtiles point cache per process (MB). Empty: py3dtiles' default, a tenth of the RAM.
  TILER_CACHE_MB: z.preprocess(
    (v) => (v === '' || v === undefined ? undefined : v),
    z.coerce.number().int().min(64).max(65536).optional(),
  ),
  // Folder with es_ign_egm08-rednap.tif (official EGM08-REDNAP geoid). Optional.
  GEOID_GRID_DIR: z.string().optional(),
  // Forces one geoid undulation (m) for every layer without its own override. Optional.
  GEOID_OFFSET_M: optionalNumber,
  LAYER_JOB_TIMEOUT_SECONDS: z.coerce.number().int().min(60).max(86400).default(1800),
  LAYER_JOB_RETRY_LIMIT: z.coerce.number().int().min(0).max(10).default(2),
});
export type WorkerEnv = z.infer<typeof workerEnvSchema>;
export const repoRoot = root;
