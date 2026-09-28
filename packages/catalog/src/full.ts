// Worker bundle: every record in full. Rebuilt by `pnpm catalog:build` (and by `pnpm dev` on change).
import data from '../generated/full.js';
import { indexCatalog } from './helpers';
import type { CatalogFull } from './types';

export const catalogFull: CatalogFull = data;
export const fullIndex = indexCatalog(catalogFull);
export default catalogFull;
