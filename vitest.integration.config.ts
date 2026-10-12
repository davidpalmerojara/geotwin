import { defineConfig } from 'vitest/config';
export default defineConfig({
  test: {
    include: ['apps/api/tests/*.integration.test.ts'],
    fileParallelism: false,
    testTimeout: 15000,
    hookTimeout: 30000,
  },
});
