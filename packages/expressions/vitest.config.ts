import { defineProject } from 'vitest/config';

export default defineProject({ test: { name: 'expressions', environment: 'node', include: ['src/**/*.test.ts'] } });
