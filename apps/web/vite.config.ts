import { fileURLToPath } from 'node:url';
import preact from '@preact/preset-vite';
import { defineConfig } from 'vite';
import { landingData } from './landing-data.ts';

// Ports come from scripts/dev.mjs (HEADCOUNT_WEB_PORT / HEADCOUNT_WORKER_PORT); defaults 5173 / 8787.
const webPort = Number(process.env.HEADCOUNT_WEB_PORT ?? 5173);
const workerPort = Number(process.env.HEADCOUNT_WORKER_PORT ?? 8787);

export default defineConfig({
  plugins: [
    preact(),
    // The landing page's cast (from the catalog bundle, never hard-coded) and marketing images.
    landingData({
      catalog: fileURLToPath(new URL('../../packages/catalog/generated/slim.js', import.meta.url)),
      manifest: fileURLToPath(new URL('./public/marketing/manifest.json', import.meta.url)),
      voices: fileURLToPath(new URL('./public/marketing/voices/manifest.json', import.meta.url)),
    }),
  ],
  // One dependency cache per port, so concurrent servers (pnpm dev, e2e, e2e voice) never race on it.
  cacheDir: webPort === 5173 ? 'node_modules/.vite' : `node_modules/.vite-${webPort}`,
  server: {
    port: webPort,
    strictPort: true,
    // /api (HTTP and the /api/ws WebSocket) goes to wrangler dev; the browser never talks to providers.
    proxy: { '/api': { target: `http://127.0.0.1:${workerPort}`, ws: true } },
  },
  preview: { port: webPort, strictPort: true, proxy: { '/api': { target: `http://127.0.0.1:${workerPort}`, ws: true } } },
  // Chunks: a tiny entry (router + theme), then the landing or the app, each lazy. The slim catalog is its own
  // lazy chunk (~230 kB gzip) that only the app loads; the landing carries its own ~15 kB cast.
  build: { target: 'es2022', sourcemap: true, chunkSizeWarningLimit: 1000 },
});
