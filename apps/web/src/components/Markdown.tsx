import { useMemo } from 'preact/hooks';
import { renderMarkdown } from '../lib/markdown';

/** Sanitised Markdown (model text is untrusted). `anchors`: an id prefix, so every block can be linked to. */
export function Markdown({ text, class: cls, anchors }: { text: string; class?: string; anchors?: string }) {
  const html = useMemo(() => renderMarkdown(text, anchors), [text, anchors]);
  return <div class={cls ? `md ${cls}` : 'md'} dangerouslySetInnerHTML={{ __html: html }} />;
}
