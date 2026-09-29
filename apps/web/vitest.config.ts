import { fileURLToPath } from 'node:url';
import preact from '@preact/preset-vite';
import { defineProject } from 'vitest/config';
import { landingData } from './landing-data.ts';

export default defineProject({
  plugins: [
    preact(),
    landingData({
      catalog: fileURLToPath(new URL('../../packages/catalog/generated/slim.js', import.meta.url)),
      manifest: fileURLToPath(new URL('./public/marketing/manifest.json', import.meta.url)),
      voices: fileURLToPath(new URL('./public/marketing/voices/manifest.json', import.meta.url)),
    }),
  ],
  test: { name: 'web', environment: 'happy-dom', include: ['src/**/*.test.{ts,tsx}'] },
});
