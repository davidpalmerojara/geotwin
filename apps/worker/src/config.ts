import { config } from 'dotenv';
import { cpus } from 'node:os';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { z } from 'zod';
import { storageEnvSchema } from '@geotwin/storage';
const root = fileURLToPath(new URL('../../../', import.meta.url));
config({ path: `${root}.env`, quiet: true });
// Empty values in .env mean "not set".
const unset = (v: unknown) => (v === '' ? undefined : v);
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
  TILER_JOBS: z.preprocess(
    unset,
    z.coerce
      .number()
      .int()
      .min(1)
      .max(64)
      .default(Math.max(1, cpus().length - 1)),
  ),
  // py3dtiles point cache per process (MB). Empty: py3dtiles' default, a tenth of the RAM.
  TILER_CACHE_MB: z.preprocess(
    (v) => (v === '' || v === undefined ? undefined : v),
    z.coerce.number().int().min(64).max(65536).optional(),
  ),
  // Folder with es_ign_egm08-rednap.tif (official EGM08-REDNAP geoid). Optional.
  GEOID_GRID_DIR: z.preprocess(unset, z.string().optional()),
  // Forces one geoid undulation (m) for every layer without its own override. Optional.
  GEOID_OFFSET_M: optionalNumber,
  // ASPRS classes left out of the tiles: low noise (7), PNOA strip-overlap points (12), high noise
  // (18). Empty: keep every point.
  LIDAR_EXCLUDE_CLASSES: z.preprocess(
    (v) => (v === undefined ? '7,12,18' : v),
    z
      .string()
      .regex(/^(\s*\d{1,3}\s*(,\s*\d{1,3}\s*)*)?$/, 'Lista de códigos ASPRS separados por comas')
      .transform((v) => [
        ...new Set(
          v
            .split(',')
            .filter((c) => c.trim())
            .map(Number),
        ),
      ]),
  ),
  // Cell of the ground model (DTM) built from class 2 and served as terrain; 0 disables it.
  DTM_CELL_M: z.preprocess(
    (v) => (v === '' || v === undefined ? undefined : v),
    z.coerce.number().min(0).max(50).default(2),
  ),
  LAYER_JOB_TIMEOUT_SECONDS: z.coerce.number().int().min(60).max(86400).default(1800),
  LAYER_JOB_RETRY_LIMIT: z.coerce.number().int().min(0).max(10).default(2),
});
export type WorkerEnv = z.infer<typeof workerEnvSchema>;
export const repoRoot = root;
