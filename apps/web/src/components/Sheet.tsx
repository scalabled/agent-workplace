// A modal side sheet (the run inspector, long views): focus moves in on open and back on close, Esc and the scrim
// close it, and the page behind does not scroll.
import type { ComponentChildren } from 'preact';
import { useEffect, useRef } from 'preact/hooks';
import { Icon } from './Icon';

export function Sheet({ title, onClose, children, label }: { title: string; onClose: () => void; children: ComponentChildren; label?: string }) {
  const panel = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const before = document.activeElement as HTMLElement | null;
    panel.current?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.stopPropagation();
        onClose();
      }
    };
    document.addEventListener('keydown', onKey);
    const overflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.removeEventListener('keydown', onKey);
      document.body.style.overflow = overflow;
      before?.focus?.();
    };
  }, []);
  return (
    <div class="sheet-layer">
      <div class="sheet-scrim" onClick={onClose} />
      <div class="sheet" role="dialog" aria-modal="true" aria-label={label ?? title} tabIndex={-1} ref={panel}>
        <header class="sheet-head">
          <h2 class="sheet-title">{title}</h2>
          <button type="button" class="icon-button" aria-label="Close" onClick={onClose}>
            <Icon name="close" size={20} />
          </button>
        </header>
        <div class="sheet-body">{children}</div>
      </div>
    </div>
  );
}
