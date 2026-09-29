import type { ExpressionCatalogInput } from '../src/types';
declare const bundle: {
  kind: 'expression_bundle';
  version: string;
  input: ExpressionCatalogInput;
  /** Office small-talk packs (catalog/expressions/huddles). */
  huddles?: { version: string; packs: import('../src/huddle').HuddlePackInput[] };
};
export default bundle;
