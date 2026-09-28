import { defineProject } from 'vitest/config';

export default defineProject({ test: { name: 'agent-loop', environment: 'node', include: ['src/**/*.test.ts'] } });
