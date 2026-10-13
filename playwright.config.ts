import { defineConfig, devices } from '@playwright/test';

/**
 * Browser verification for the local Sehat prototype.
 *
 * The API is started by the suite itself via `webServer`, pointing at a
 * throwaway SQLite file so browser checks never touch the developer's
 * workspace records. NVIDIA is intentionally left unconfigured here: every
 * assertion is about behavior that must work without a provider, and the
 * suite must be runnable offline.
 */
export default defineConfig({
  testDir: './tests/e2e',
  fullyParallel: false,
  forbidOnly: !!process.env.CI,
  retries: 0,
  workers: 1,
  reporter: [['list']],
  timeout: 45_000,
  expect: { timeout: 10_000 },
  use: {
    baseURL: 'http://127.0.0.1:4173',
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
  },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
  webServer: {
    command: 'node tests/e2e/server.mjs',
    url: 'http://127.0.0.1:4173/api/health',
    reuseExistingServer: false,
    timeout: 60_000,
    stdout: 'pipe',
    stderr: 'pipe',
  },
});
