import { defineConfig, devices } from '@playwright/test';

// Keyless e2e: the Mock provider on separate ports and a fresh local state, so it never touches `pnpm dev`.
// Fake media: Chromium's synthetic mic and camera, mic permission granted, audio allowed without a gesture.
const WEB_PORT = 5183;
const WORKER_PORT = 8797;
const VOICE_WEB_PORT = 5184;
const VOICE_WORKER_PORT = 8798;

export default defineConfig({
  testDir: 'e2e',
  // A Mock background job takes about 15 s end to end (checkpoints are paced 2.5 s apart so steering can land).
  timeout: 90_000,
  expect: { timeout: 10_000 },
  fullyParallel: false,
  workers: 1,
  reporter: process.env.CI ? 'line' : 'list',
  use: {
    baseURL: `http://localhost:${WEB_PORT}`,
    trace: 'retain-on-failure',
    permissions: ['microphone'],
    launchOptions: {
      args: ['--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream', '--autoplay-policy=no-user-gesture-required'],
    },
  },
  webServer: [
    {
      command: `node scripts/dev.mjs --mock --fresh --no-watch --web-port ${WEB_PORT} --worker-port ${WORKER_PORT} --persist-to .wrangler/e2e-state`,
      url: `http://localhost:${WEB_PORT}/api/health`,
      // Never reuse: a stale server may predate --mock and carry provider keys.
      reuseExistingServer: false,
      timeout: 120_000,
      gracefulShutdown: { signal: 'SIGTERM', timeout: 6_000 },
      stdout: 'ignore',
      stderr: 'pipe',
    },
    {
      // Voice path without keys: Mock TTS (silent audio with character timing) and Mock STT count as available.
      command: `node scripts/dev.mjs --mock --mock-media --fresh --no-watch --web-port ${VOICE_WEB_PORT} --worker-port ${VOICE_WORKER_PORT} --persist-to .wrangler/e2e-voice-state`,
      url: `http://localhost:${VOICE_WEB_PORT}/api/health`,
      reuseExistingServer: false,
      timeout: 120_000,
      gracefulShutdown: { signal: 'SIGTERM', timeout: 6_000 },
      stdout: 'ignore',
      stderr: 'pipe',
    },
  ],
  projects: [
    { name: 'chromium', testIgnore: /voice\.spec\.ts/, use: { ...devices['Desktop Chrome'], viewport: { width: 1280, height: 800 } } },
    { name: 'voice', testMatch: /voice\.spec\.ts/, use: { ...devices['Desktop Chrome'], viewport: { width: 1280, height: 800 }, baseURL: `http://localhost:${VOICE_WEB_PORT}` } },
  ],
});
