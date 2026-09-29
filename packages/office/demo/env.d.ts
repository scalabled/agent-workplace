// Vite's import.meta.glob, for the demo only (the office package does not depend on Vite's client types).
interface ImportMeta {
  glob(pattern: string, options?: { import?: string; eager?: false }): Record<string, () => Promise<unknown>>;
}
