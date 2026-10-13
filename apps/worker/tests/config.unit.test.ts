import { describe, it, expect } from 'vitest';
import { workerEnvSchema } from '../src/config.js';
describe('Worker configuration', () => {
  it('treats empty values copied from .env.example as unset', () => {
    const env = workerEnvSchema.parse({
      TILER_JOBS: '',
      TILER_CACHE_MB: '',
      GEOID_GRID_DIR: '',
      GEOID_OFFSET_M: '',
    });
    expect(env.TILER_JOBS).toBeGreaterThanOrEqual(1);
    expect(env.TILER_CACHE_MB).toBeUndefined();
    expect(env.GEOID_GRID_DIR).toBeUndefined();
    expect(env.GEOID_OFFSET_M).toBeUndefined();
    expect(env.STORAGE_DRIVER).toBe('local');
  });
  it('rejects nonsense instead of starting with it', () => {
    expect(() => workerEnvSchema.parse({ GEOID_OFFSET_M: '500' })).toThrow();
    expect(() => workerEnvSchema.parse({ TILER_JOBS: '0' })).toThrow();
    expect(workerEnvSchema.parse({ GEOID_OFFSET_M: '53.1' }).GEOID_OFFSET_M).toBe(53.1);
  });
});
