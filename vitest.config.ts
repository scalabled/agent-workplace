import { defineConfig } from 'vitest/config';

// One `vitest run` across the workspace; each package/app declares its own project config.
export default defineConfig({
  test: {
    projects: ['packages/*/vitest.config.ts', 'apps/*/vitest.config.ts'],
  },
});
