// Lazy access to the slim catalog bundle (its own chunk, loaded on first use).
import { signal } from '@preact/signals';
import type { CatalogIndex, CatalogSlim } from '@headcount/catalog';

export const catalog = signal<CatalogIndex<CatalogSlim> | null>(null);
let loading: Promise<CatalogIndex<CatalogSlim>> | null = null;

export function loadCatalog(): Promise<CatalogIndex<CatalogSlim>> {
  loading ??= import('@headcount/catalog/slim').then((m) => (catalog.value = m.slimIndex));
  return loading;
}
