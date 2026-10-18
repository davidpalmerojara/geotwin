import { defineConfig, devices } from '@playwright/test';
const database =
  process.env.TEST_DATABASE_URL ??
  'postgresql://geotwin:geotwin_local@localhost:55432/geotwin_test';
const apiPort = process.env.API_PORT ?? '3001';
const webPort = process.env.WEB_PORT ?? '5173';
// The API and the worker share this folder as object storage, as they share a bucket in Docker.
const storage = { STORAGE_DRIVER: 'local', STORAGE_LOCAL_DIR: 'data/e2e-storage' };
export default defineConfig({
  testDir: 'tests/e2e',
  fullyParallel: false,
  workers: 1,
  timeout: 90000,
  // Under SwiftShader a frame of the scene can hold the page's main thread for seconds, so a
  // screen update that follows a click or a server event may take longer than the default 5 s.
  expect: { timeout: 10000 },
  // On CI each failure also becomes an annotation of the run, readable without the artifacts.
  reporter: process.env.CI ? [['list'], ['github']] : 'list',
  use: {
    ...devices['Desktop Chrome'],
    baseURL: process.env.E2E_BASE_URL ?? `http://127.0.0.1:${webPort}`,
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
    launchOptions: {
      args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'],
      // Optional: a preinstalled Chromium when it differs from the pinned Playwright build.
      executablePath: process.env.PLAYWRIGHT_CHROMIUM_PATH || undefined,
    },
  },
  webServer: process.env.E2E_BASE_URL
    ? undefined
    : [
        {
          command:
            'npm run build -w @geotwin/shared -w @geotwin/storage && npm run db:test && npm run db:seed && npm run dev -w @geotwin/api',
          url: `http://127.0.0.1:${apiPort}/api/health`,
          env: {
            PORT: apiPort,
            CORS_ORIGIN: `http://127.0.0.1:${webPort},http://localhost:${webPort}`,
            DATABASE_URL: database,
            TEST_DATABASE_URL: database,
            DEMO_MODE: 'true',
            SIMULATOR_ENABLED: 'false',
            ...storage,
          },
          reuseExistingServer: false,
          timeout: 120000,
        },
        {
          // The LiDAR worker (pg-boss consumer + py3dtiles). It starts once the API has created
          // and migrated the test database. LIDAR_PYTHON must import py3dtiles, laspy and lazrs.
          name: 'worker',
          command: `until curl -sf http://127.0.0.1:${apiPort}/api/health > /dev/null; do sleep 1; done; npx tsx apps/worker/src/main.ts`,
          wait: { stdout: /Worker started/ },
          env: { DATABASE_URL: database, ...storage },
          stdout: 'pipe',
          reuseExistingServer: false,
          timeout: 180000,
        },
        {
          command: 'npm run dev -w @geotwin/web',
          url: `http://127.0.0.1:${webPort}`,
          // A placeholder ion token offers the «Fotorrealista (Google)» option; its test answers
          // Cesium ion locally, and no other test uses ion.
          env: {
            WEB_PORT: webPort,
            API_PORT: apiPort,
            VITE_CESIUM_ION_TOKEN: process.env.VITE_CESIUM_ION_TOKEN ?? 'e2e-placeholder-token',
          },
          reuseExistingServer: false,
          timeout: 60000,
        },
      ],
});
