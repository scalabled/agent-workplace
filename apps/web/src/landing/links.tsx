// Links from the landing page into the app: real hrefs (they work without JS and in new tabs), client-side
// navigation on a plain click, and the app chunk warmed on hover, focus or touch.
import type { ComponentChildren } from 'preact';
import { prefetchApp } from '../lazy';
import { navigate, paths } from '../router';

export function AppLink({ href, class: cls, children, hero = false }: { href: string; class?: string; children: ComponentChildren; hero?: boolean }) {
  return (
    <a
      class={cls}
      href={href}
      data-hero-cta={hero || undefined}
      onPointerEnter={prefetchApp}
      onFocus={prefetchApp}
      onTouchStart={prefetchApp}
      onClick={(e) => {
        if (e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
        e.preventDefault();
        navigate(href);
      }}
    >
      {children}
    </a>
  );
}

/** "Enter the office": the app decides where you land (first run → pick your Chief of Staff; else Talk). */
export function EnterLink({ class: cls, children, hero = false }: { class?: string; children: ComponentChildren; /** The hero's own CTA (the nav hides its copy while this one is on screen). */ hero?: boolean }) {
  return (
    <AppLink href={paths.app} class={cls} hero={hero}>
      {children}
    </AppLink>
  );
}
