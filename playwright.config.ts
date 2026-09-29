import { writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { defineConfig, devices } from '@playwright/test';

// Keyless e2e: the Mock provider on separate ports and a fresh local state, so it never touches `pnpm dev`.
// Fake media: Chromium's synthetic mic and camera, mic permission granted, audio allowed without a gesture.
const WEB_PORT = 5183;
const WORKER_PORT = 8797;
const VOICE_WEB_PORT = 5184;
const VOICE_WORKER_PORT = 8798;

/**
 * The owner's microphone for the living-voice project: speech-like sound in 2.8 s stretches with 0.7 s pauses, so a
 * hold-to-talk sees real pauses (owner VAD → a backchannel in the pause, never over the owner's voice). Chromium
 * loops the file.
 */
function ownerSpeechWav(): string {
  const file = join(tmpdir(), 'headcount-e2e-owner-pauses.wav');
  const rate = 16_000;
  const segments: [boolean, number][] = [];
  for (let i = 0; i < 4; i++) segments.push([true, 2800], [false, 700]);
  const samples = segments.reduce((n, [, ms]) => n + (ms * rate) / 1000, 0);
  const wav = Buffer.alloc(44 + samples * 2);
  wav.write('RIFF', 0);
  wav.writeUInt32LE(36 + samples * 2, 4);
  wav.write('WAVEfmt ', 8);
  wav.writeUInt32LE(16, 16);
  wav.writeUInt16LE(1, 20);
  wav.writeUInt16LE(1, 22);
  wav.writeUInt32LE(rate, 24);
  wav.writeUInt32LE(rate * 2, 28);
  wav.writeUInt16LE(2, 32);
  wav.writeUInt16LE(16, 34);
  wav.write('data', 36);
  wav.writeUInt32LE(samples * 2, 40);
  let n = 0;
  for (const [voiced, ms] of segments) {
    for (let i = 0; i < (ms * rate) / 1000; i++, n++) {
      const t = n / rate;
      const v = voiced ? 0.25 * (0.6 + 0.4 * Math.sin(2 * Math.PI * 3 * t)) * (Math.sin(2 * Math.PI * 180 * t) + 0.5 * Math.sin(2 * Math.PI * 360 * t)) : 0;
      wav.writeInt16LE(Math.round(v * 32767), 44 + n * 2);
    }
  }
  writeFileSync(file, wav);
  return file;
}

const FAKE_MEDIA = ['--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream', '--autoplay-policy=no-user-gesture-required'];

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
    launchOptions: { args: FAKE_MEDIA },
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
    { name: 'chromium', testIgnore: /voice\.spec\.ts|office-screens\.spec\.ts/, use: { ...devices['Desktop Chrome'], viewport: { width: 1280, height: 800 } } },
    { name: 'voice', testMatch: /(^|\/)voice\.spec\.ts/, use: { ...devices['Desktop Chrome'], viewport: { width: 1280, height: 800 }, baseURL: `http://localhost:${VOICE_WEB_PORT}` } },
    {
      // The living workforce with voice (Mock TTS clips with timing) and a microphone that pauses like a person.
      name: 'living-voice',
      // one-voice.spec.ts: one voice per workspace (several tabs on the voice stack). office-voice.spec.ts: the Office's
      // room voices, barge-in and listen-in (Office Phase 2); office-screens.spec.ts: its screens (opt-in).
      testMatch: /(living-voice|one-voice|office-voice|office-screens|meeting-voice)\.spec\.ts/,
      use: {
        ...devices['Desktop Chrome'],
        viewport: { width: 1280, height: 800 },
        baseURL: `http://localhost:${VOICE_WEB_PORT}`,
        launchOptions: { args: [...FAKE_MEDIA, `--use-file-for-fake-audio-capture=${ownerSpeechWav()}`] },
      },
    },
  ],
});
