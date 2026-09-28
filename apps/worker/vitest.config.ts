import { fileURLToPath } from 'node:url';
import { defineProject } from 'vitest/config';

export default defineProject({
  resolve: {
    alias: { 'cloudflare:workers': fileURLToPath(new URL('./test/shims/cloudflare-workers.ts', import.meta.url)) },
  },
  test: {
    name: 'worker',
    environment: 'node',
    include: ['src/**/*.test.ts', 'test/**/*.test.ts'],
    // node:sqlite (used by test/fake-cloud.ts) is flagged experimental on Node 22.
    execArgv: ['--disable-warning=ExperimentalWarning'],
  },
});
