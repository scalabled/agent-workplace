import type { ComponentChildren, JSX } from 'preact';
import { navigate, path } from '../router';

type Props = Omit<JSX.HTMLAttributes<HTMLAnchorElement>, 'href'> & { href: string; children: ComponentChildren; matchPrefix?: boolean };

/** In-app link: client-side navigation, aria-current on the active place. */
export function Link({ href, children, matchPrefix, ...rest }: Props) {
  const active = matchPrefix ? path.value.startsWith(href) : path.value === href;
  return (
    <a
      {...rest}
      href={href}
      aria-current={active ? 'page' : undefined}
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
