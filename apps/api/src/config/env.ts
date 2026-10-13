import { config } from 'dotenv';
import { fileURLToPath } from 'node:url';
import { z } from 'zod';
import { storageEnvSchema } from '@geotwin/storage';
config({ path: fileURLToPath(new URL('../../../../.env', import.meta.url)), quiet: true });
const boolean = z.enum(['true', 'false']).transform((v) => v === 'true');
export const env = storageEnvSchema
  .extend({
    DATABASE_URL: z.string().default('postgresql://geotwin:geotwin_local@localhost:55432/geotwin'),
    HOST: z.string().default('127.0.0.1'),
    PORT: z.coerce.number().int().positive().default(3001),
    CORS_ORIGIN: z.string().default('http://localhost:5173,http://127.0.0.1:5173'),
    DEMO_MODE: boolean.default(false),
    SIMULATOR_ENABLED: boolean.default(true),
    SIMULATOR_INTERVAL_MS: z.coerce.number().int().min(1000).default(5000),
    // Hours of readings to keep. 0 (the default) keeps everything; the demo sets 24.
    READINGS_RETENTION_HOURS: z.coerce.number().int().min(0).max(8760).default(0),
    // A PNOA-LiDAR 1 x 1 km LAZ is 40-70 MB; 150 MiB leaves room for denser or 2 x 2 km tiles.
    LAYER_UPLOAD_MAX_BYTES: z.coerce
      .number()
      .int()
      .min(1024)
      .max(4 * 1024 ** 3)
      .default(150 * 1024 ** 2),
    // Whole-request timeout. Uploads of tens of MB need minutes on slow links.
    REQUEST_TIMEOUT_MS: z.coerce.number().int().min(1000).default(600000),
  })
  .parse(process.env);
export const repoRoot = fileURLToPath(new URL('../../../../', import.meta.url));
export const ORGANIZATION_ID = '00000000-0000-4000-8000-000000000001';
