import { defineProject } from 'vitest/config';

export default defineProject({ test: { name: 'office', environment: 'happy-dom', include: ['src/**/*.test.ts'] } });
