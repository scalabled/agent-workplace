// Web bundle: leads in full, personas slim, departments, skills index, match quiz.
import data from '../generated/slim.js';
import { indexCatalog } from './helpers';
import type { CatalogSlim } from './types';

export const catalogSlim: CatalogSlim = data;
export const slimIndex = indexCatalog(catalogSlim);
export default catalogSlim;
