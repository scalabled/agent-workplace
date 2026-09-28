import { defineProject } from 'vitest/config';

export default defineProject({ test: { name: 'avatar', environment: 'happy-dom', include: ['src/**/*.test.ts'] } });
