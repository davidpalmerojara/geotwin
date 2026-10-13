import { defineConfig } from 'vitest/config';
export default defineConfig({
  test: {
    include: ['apps/*/tests/*.integration.test.ts', 'packages/*/tests/*.integration.test.ts'],
    fileParallelism: false,
    testTimeout: 15000,
    hookTimeout: 30000,
  },
});
