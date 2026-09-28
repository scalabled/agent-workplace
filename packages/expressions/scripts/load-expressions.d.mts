import type { ExpressionCatalogInput, Sliders } from '../src/index';

export declare const REPO_ROOT: string;
export declare function catalogSliderStats(catalogDir?: string): { mean: Sliders; std: Sliders } | null;
export declare function loadExpressionSources(opts?: { exprDir?: string; catalogDir?: string }): {
  input: ExpressionCatalogInput;
  files: { path: string; kind: string }[];
  skipped: { path: string; reason: string }[];
};
