// @headcount/catalog — typed access to /catalog (read-only). Integrator-owned.
// Data lives in the generated bundles: import `@headcount/catalog/full` (worker) or
// `@headcount/catalog/slim` (web; load it lazily with `import('@headcount/catalog/slim')`).
export type * from './types';
export * from './helpers';
