import preact from '@preact/preset-vite';
import { defineProject } from 'vitest/config';

export default defineProject({
  plugins: [preact()],
  test: { name: 'web', environment: 'happy-dom', include: ['src/**/*.test.{ts,tsx}'] },
});
