import type { CatalogFull, CatalogReport, CatalogSlim } from '../src/types';

export function buildCatalog(opts?: { catalogDir?: string }): { full: CatalogFull; slim: CatalogSlim; report: CatalogReport };
export function writeBundles(opts?: { outDir?: string; catalogDir?: string; quiet?: boolean }): { report: CatalogReport; changed: boolean };
