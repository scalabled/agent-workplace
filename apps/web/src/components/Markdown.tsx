import { useMemo } from 'preact/hooks';
import { renderMarkdown } from '../lib/markdown';

/** Sanitised Markdown (model text is untrusted). */
export function Markdown({ text, class: cls }: { text: string; class?: string }) {
  const html = useMemo(() => renderMarkdown(text), [text]);
  return <div class={cls ? `md ${cls}` : 'md'} dangerouslySetInnerHTML={{ __html: html }} />;
}
