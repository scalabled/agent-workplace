import { useMemo } from 'preact/hooks';
import { renderMarkdown } from '../lib/markdown';
import { navigate } from '../router';

/**
 * Sanitised Markdown (model text is untrusted). `anchors`: an id prefix, so every block can be linked to. Links into
 * the app (an agent linking the project or coworker it mentions) open in place; others open in a new tab.
 */
export function Markdown({ text, class: cls, anchors }: { text: string; class?: string; anchors?: string }) {
  const html = useMemo(() => renderMarkdown(text, anchors), [text, anchors]);
  return (
    <div
      class={cls ? `md ${cls}` : 'md'}
      dangerouslySetInnerHTML={{ __html: html }}
      onClick={(e) => {
        const a = (e.target as Element | null)?.closest?.('a');
        const href = a?.getAttribute('href') ?? '';
        if (!a || !href.startsWith('/app') || e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
        e.preventDefault();
        navigate(href);
      }}
    />
  );
}
