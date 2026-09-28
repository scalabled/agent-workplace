import preact from '@preact/preset-vite';
import { defineConfig } from 'vite';

// Ports come from scripts/dev.mjs (HEADCOUNT_WEB_PORT / HEADCOUNT_WORKER_PORT); defaults 5173 / 8787.
const webPort = Number(process.env.HEADCOUNT_WEB_PORT ?? 5173);
const workerPort = Number(process.env.HEADCOUNT_WORKER_PORT ?? 8787);

export default defineConfig({
  plugins: [preact()],
  // One dependency cache per port, so concurrent servers (pnpm dev, e2e, e2e voice) never race on it.
  cacheDir: webPort === 5173 ? 'node_modules/.vite' : `node_modules/.vite-${webPort}`,
  server: {
    port: webPort,
    strictPort: true,
    // /api (HTTP and the /api/ws WebSocket) goes to wrangler dev; the browser never talks to providers.
    proxy: { '/api': { target: `http://127.0.0.1:${workerPort}`, ws: true } },
  },
  preview: { port: webPort, strictPort: true, proxy: { '/api': { target: `http://127.0.0.1:${workerPort}`, ws: true } } },
  // The slim catalog is its own lazy chunk (~210 kB gzip); everything else stays small.
  build: { target: 'es2022', sourcemap: true, chunkSizeWarningLimit: 1000 },
});
