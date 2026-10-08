import { fileURLToPath } from 'node:url';
import preact from '@preact/preset-vite';
import { defineConfig } from 'vite';
import { landingData } from './landing-data.ts';
import { BRAND } from '../../packages/protocol/src/brand.ts';

/**
 * On-device speech recognition (voice/whisper.worker.ts) runs onnxruntime-web, whose WebAssembly (about 26 MB) is
 * fetched from jsDelivr at run time: Transformers.js points the runtime there before it loads. The copy Vite would
 * bundle is never used and is over the 25 MiB per-file limit of Workers Static Assets, so it is left out.
 */
const dropOnnxWasm = () => ({
  name: 'drop-onnx-wasm',
  apply: 'build' as const,
  generateBundle(_: unknown, bundle: Record<string, unknown>) {
    for (const file of Object.keys(bundle)) if (/(^|\/)ort-wasm[^/]*\.wasm$/.test(file)) delete bundle[file];
  },
});

// Ports come from scripts/dev.mjs (HEADCOUNT_WEB_PORT / HEADCOUNT_WORKER_PORT); defaults 5173 / 8787.
const webPort = Number(process.env.HEADCOUNT_WEB_PORT ?? 5173);
const workerPort = Number(process.env.HEADCOUNT_WORKER_PORT ?? 8787);

export default defineConfig({
  plugins: [
    preact(),
    // The product's name in the page head (packages/protocol/src/brand.ts).
    { name: 'brand', transformIndexHtml: (html: string) => html.replaceAll('%BRAND_NAME%', BRAND.name).replaceAll('%BRAND_TAGLINE%', BRAND.tagline).replaceAll('%BRAND_DESCRIPTION%', BRAND.description) },
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
  // Speech recognition on the device runs in a module worker (voice/whisper.worker.ts), which loads its runtime lazily.
  worker: { format: 'es', plugins: () => [dropOnnxWasm()] },
});
