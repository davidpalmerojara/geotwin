import { defineConfig, devices } from '@playwright/test';
const database =
  process.env.TEST_DATABASE_URL ??
  'postgresql://geotwin:geotwin_local@localhost:55432/geotwin_test';
const apiPort = process.env.API_PORT ?? '3001';
const webPort = process.env.WEB_PORT ?? '5173';
export default defineConfig({
  testDir: 'tests/e2e',
  fullyParallel: false,
  workers: 1,
  timeout: 60000,
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
            'npm run build -w @geotwin/shared && npm run db:test && npm run db:seed && npm run dev -w @geotwin/api',
          url: `http://127.0.0.1:${apiPort}/api/health`,
          env: {
            PORT: apiPort,
            CORS_ORIGIN: `http://127.0.0.1:${webPort},http://localhost:${webPort}`,
            DATABASE_URL: database,
            TEST_DATABASE_URL: database,
            DEMO_MODE: 'true',
            SIMULATOR_ENABLED: 'false',
          },
          reuseExistingServer: false,
          timeout: 120000,
        },
        {
          command: 'npm run dev -w @geotwin/web',
          url: `http://127.0.0.1:${webPort}`,
          env: { WEB_PORT: webPort, API_PORT: apiPort },
          reuseExistingServer: false,
          timeout: 60000,
        },
      ],
});
