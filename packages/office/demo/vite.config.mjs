// Standalone demo for @headcount/office (OFFICE-PLAN §5.5). Run from the repo root:
//   node apps/web/node_modules/vite/bin/vite.js --config packages/office/demo/vite.config.mjs
// or from packages/office/demo: npx vite. Serves apps/web/public (the skyline art under /office/) and proxies only
// read-only GET /api/portraits* to the owner's worker (any other method gets a 404), so the demo can never write.
import { fileURLToPath } from 'node:url';

const here = fileURLToPath(new URL('.', import.meta.url));
const repo = fileURLToPath(new URL('../../../', import.meta.url));
const worker = process.env.OFFICE_WORKER ?? 'http://127.0.0.1:8787';
const port = Number(process.env.OFFICE_DEMO_PORT ?? 5870);

const getOnly = (req) => (req.method === 'GET' || req.method === 'HEAD' ? undefined : false);

export default {
  root: here,
  publicDir: `${repo}apps/web/public`,
  cacheDir: `${here}../node_modules/.vite-demo`,
  clearScreen: false,
  server: {
    port,
    strictPort: true,
    host: '127.0.0.1',
    fs: { allow: [repo] },
    proxy: {
      '/api/portraits': { target: worker, changeOrigin: true, bypass: getOnly },
    },
  },
};
