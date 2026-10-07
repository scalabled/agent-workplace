// Download a Markdown document as Word, PowerPoint (a slide per section) or Excel (its tables), or as Markdown itself.
// The conversion happens on the server (POST /api/export); the Markdown comes from the caller, loaded when asked.
import type { ExportFormat } from '@headcount/protocol/ext/files';
import { useState } from 'preact/hooks';
import { api, ApiError } from '../api/client';
import { Icon } from './Icon';

const FORMATS: { format: ExportFormat; label: string; hint: string }[] = [
  { format: 'docx', label: 'Word', hint: '.docx' },
  { format: 'pptx', label: 'PowerPoint', hint: 'a slide per section' },
  { format: 'xlsx', label: 'Excel', hint: 'its tables' },
  { format: 'md', label: 'Markdown', hint: '.md' },
];

export function saveBlob(name: string, blob: Blob): void {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

const fileName = (title: string, ext: string) => `${title.replace(/[^\p{L}\p{N} _-]+/gu, ' ').replace(/\s+/g, ' ').trim().slice(0, 80) || 'Document'}.${ext}`;

export function ExportMenu({ title, markdown, label = 'Download', class: cls = '' }: { title: string; markdown: () => string | Promise<string>; label?: string; class?: string }) {
  const [busy, setBusy] = useState<ExportFormat | null>(null);
  const [error, setError] = useState<string | null>(null);
  const run = async (format: ExportFormat, menu: HTMLDetailsElement | null) => {
    setBusy(format);
    setError(null);
    try {
      const md = await markdown();
      saveBlob(fileName(title, format), format === 'md' ? new Blob([md], { type: 'text/markdown' }) : await api.exportDocument({ title, markdown: md, format }));
      if (menu) menu.open = false;
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'That did not download. Try again.');
    } finally {
      setBusy(null);
    }
  };
  return (
    <details class={`export-menu ${cls}`.trim()}>
      <summary class="button-quiet">
        <Icon name="download" size={16} /> {label}
      </summary>
      <div class="export-menu-list" role="menu" aria-label={`${label} as`}>
        {FORMATS.map((f) => (
          <button
            key={f.format}
            type="button"
            role="menuitem"
            class="export-menu-item"
            disabled={busy !== null}
            onClick={(e) => void run(f.format, (e.currentTarget as HTMLElement).closest('details'))}
          >
            <span>{busy === f.format ? 'Preparing…' : f.label}</span>
            <span class="page-fine">{f.hint}</span>
          </button>
        ))}
        {error && (
          <p class="form-error" role="alert">
            {error}
          </p>
        )}
      </div>
    </details>
  );
}
