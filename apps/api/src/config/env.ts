import { config } from 'dotenv';
import { fileURLToPath } from 'node:url';
import { z } from 'zod';
config({ path: fileURLToPath(new URL('../../../../.env', import.meta.url)), quiet: true });
const boolean = z.enum(['true', 'false']).transform((v) => v === 'true');
export const env = z
  .object({
    DATABASE_URL: z.string().default('postgresql://geotwin:geotwin_local@localhost:55432/geotwin'),
    HOST: z.string().default('127.0.0.1'),
    PORT: z.coerce.number().int().positive().default(3001),
    CORS_ORIGIN: z.string().default('http://localhost:5173,http://127.0.0.1:5173'),
    DEMO_MODE: boolean.default(false),
    SIMULATOR_ENABLED: boolean.default(true),
    SIMULATOR_INTERVAL_MS: z.coerce.number().int().min(1000).default(5000),
  })
  .parse(process.env);
export const ORGANIZATION_ID = '00000000-0000-4000-8000-000000000001';
