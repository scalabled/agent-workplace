// "Copy link": to this page, or to one item on it (`at`). Everything in the office can be shared this way.
import type { ComponentChildren } from 'preact';
import { Icon } from '../components/Icon';
import { linkTo } from '../router';
import { copyLink, pageHref } from './links';

export function CopyLink({ page, at, label = 'Copy link', what, class: cls = '' }: { page?: string; at?: string; label?: string; what?: string; class?: string }) {
  const href = page ? linkTo(page, at) : at ? linkTo(pageHref().split('?')[0]!, at) : pageHref();
  return (
    <a
      class={`icon-button icon-button-sm copy-link ${cls}`}
      href={href}
      aria-label={label}
      title={`${label} (to share it with someone or give it to an agent)`}
      onClick={(e) => {
        if (e.metaKey || e.ctrlKey || e.shiftKey || e.altKey || e.button !== 0) return;
        e.preventDefault();
        void copyLink(href, what ?? (at ? 'Link to it' : 'Link to this page'));
      }}
    >
      <Icon name="link" size={16} />
    </a>
  );
}

/** A page title with its link beside it. */
export function PageTitle({ id, children }: { id: string; children: ComponentChildren }) {
  return (
    <div class="page-title-row">
      <h1 id={id}>{children}</h1>
      <CopyLink label="Copy link to this page" />
    </div>
  );
}
