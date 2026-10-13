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
    // Noise and PNOA overlap points are left out and a 2 m ground model is built by default.
    expect(env.LIDAR_EXCLUDE_CLASSES).toEqual([7, 12, 18]);
    expect(env.DTM_CELL_M).toBe(2);
  });
  it('keeps every class when the exclusion list is empty and can turn the DTM off', () => {
    const env = workerEnvSchema.parse({ LIDAR_EXCLUDE_CLASSES: '', DTM_CELL_M: '0' });
    expect(env.LIDAR_EXCLUDE_CLASSES).toEqual([]);
    expect(env.DTM_CELL_M).toBe(0);
    expect(
      workerEnvSchema.parse({ LIDAR_EXCLUDE_CLASSES: ' 7, 12 ,7' }).LIDAR_EXCLUDE_CLASSES,
    ).toEqual([7, 12]);
  });
  it('rejects nonsense instead of starting with it', () => {
    expect(() => workerEnvSchema.parse({ GEOID_OFFSET_M: '500' })).toThrow();
    expect(() => workerEnvSchema.parse({ TILER_JOBS: '0' })).toThrow();
    expect(() => workerEnvSchema.parse({ LIDAR_EXCLUDE_CLASSES: '7;12' })).toThrow();
    expect(() => workerEnvSchema.parse({ DTM_CELL_M: '-1' })).toThrow();
    expect(workerEnvSchema.parse({ GEOID_OFFSET_M: '53.1' }).GEOID_OFFSET_M).toBe(53.1);
  });
});
