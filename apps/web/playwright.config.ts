import { defineConfig, devices } from '@playwright/test';

/**
 * Two builds are tested:
 * - "production": the normal build (what Render serves). Test mode is compiled out.
 * - "test-mode": a build made with CLARITY_TEST_MODE=1 (the separate test site), served on another port.
 */
export default defineConfig({
  testDir: './e2e',
  timeout: 60_000,
  fullyParallel: false,
  workers: 1,
  reporter: [['list']],
  use: {
    trace: 'off',
    ...devices['Desktop Chrome'],
    viewport: { width: 1440, height: 900 },
  },
  projects: [
    { name: 'production', testIgnore: /test-mode\.spec\.ts/, use: { baseURL: 'http://localhost:4173' } },
    { name: 'test-mode', testMatch: /test-mode\.spec\.ts/, use: { baseURL: 'http://localhost:4174' } },
  ],
  webServer: [
    {
      command: 'npx vite build && npx vite preview --port 4173 --strictPort',
      url: 'http://localhost:4173',
      reuseExistingServer: true,
      timeout: 120_000,
    },
    {
      command: 'CLARITY_TEST_MODE=1 npx vite build --outDir dist-test && npx vite preview --outDir dist-test --port 4174 --strictPort',
      url: 'http://localhost:4174',
      reuseExistingServer: true,
      timeout: 120_000,
    },
  ],
});
