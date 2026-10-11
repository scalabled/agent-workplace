// A focused dialog for one change at a time (rename the office, start another, what the team calls you): a title, a
// line on what it does, the field, and its two buttons, so nothing on the page behind competes with it. Focus moves
// in on open (to the first field) and back on close; Esc, the scrim and Cancel close it; the page behind does not
// scroll. On phones it rises from the bottom. It renders at the end of <body> (a portal), so nothing on the page,
// whatever its stacking, is ever drawn over it.
import type { ComponentChildren } from 'preact';
import { createPortal } from 'preact/compat';
import { useEffect, useId, useRef, useState } from 'preact/hooks';
import { Icon } from './Icon';

export function Dialog({ title, lede, onClose, children, label }: { title: string; lede?: ComponentChildren; onClose: () => void; children: ComponentChildren; label?: string }) {
  const panel = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const before = document.activeElement as HTMLElement | null;
    const first = panel.current?.querySelector<HTMLElement>('input:not([type="hidden"]), textarea, select');
    (first ?? panel.current)?.focus();
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
  return createPortal(
    <div class="dialog-layer">
      <div class="dialog-scrim" onClick={onClose} />
      <div class="dialog" role="dialog" aria-modal="true" aria-labelledby="dialog-title" aria-label={label} tabIndex={-1} ref={panel}>
        <header class="dialog-head">
          <h2 id="dialog-title" class="dialog-title">
            {title}
          </h2>
          <button type="button" class="icon-button" aria-label="Close" onClick={onClose}>
            <Icon name="close" size={20} />
          </button>
        </header>
        {lede && <p class="dialog-lede">{lede}</p>}
        {children}
      </div>
    </div>,
    document.body,
  );
}

/**
 * A labelled field with its hint (or the error in its place) read after the field's name, never as part of it.
 */
export function DialogField(p: { label: ComponentChildren; hint?: ComponentChildren; error?: string | null; children: (ids: { id: string; describedBy: string | undefined }) => ComponentChildren }) {
  const id = useId();
  const note = `${id}-note`;
  const shown = p.error || p.hint;
  return (
    <div class="field">
      <label class="field-label" for={id}>
        {p.label}
      </label>
      {p.children({ id, describedBy: shown ? note : undefined })}
      {p.error ? (
        <span id={note} class="form-error" role="alert">
          {p.error}
        </span>
      ) : (
        p.hint && (
          <span id={note} class="field-hint">
            {p.hint}
          </span>
        )
      )}
    </div>
  );
}

/**
 * One text field in a dialog: its label, a hint, Cancel and the action. `save` returns null when done (the dialog
 * closes) or the sentence to show under the field.
 */
export function TextDialog(p: {
  title: string;
  lede?: ComponentChildren;
  label: string;
  hint?: string;
  value: string;
  placeholder?: string;
  maxLength: number;
  /** The action's words ("Rename", "Start the office"). */
  action: string;
  /** Fewest characters the action needs (0: blank is allowed, for clearing). */
  min?: number;
  autoComplete?: string;
  /** A few lines to write in (a change to make) instead of one. */
  multiline?: boolean;
  save(value: string): Promise<string | null>;
  onClose(): void;
}) {
  const [value, setValue] = useState(p.value);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const min = p.min ?? 1;
  // Nothing to do until the value changes (or, for a new one, is long enough).
  const ready = value.trim().length >= min && value.trim() !== p.value.trim() && !busy;
  const submit = async (e: Event) => {
    e.preventDefault();
    if (!ready) return;
    setBusy(true);
    setError(null);
    const problem = await p.save(value.trim()).catch(() => 'That did not work. Try again.');
    setBusy(false);
    if (problem) setError(problem);
    else p.onClose();
  };
  return (
    <Dialog title={p.title} lede={p.lede} onClose={p.onClose}>
      <form class="dialog-form" onSubmit={submit}>
        <DialogField label={p.label} hint={p.hint} error={error}>
          {({ id, describedBy }) => {
            const field = {
              id,
              class: 'field-input',
              value,
              maxLength: p.maxLength,
              placeholder: p.placeholder,
              'aria-describedby': describedBy,
              'aria-invalid': error ? ('true' as const) : undefined,
              onInput: (e: Event) => {
                setValue((e.currentTarget as HTMLInputElement | HTMLTextAreaElement).value);
                if (error) setError(null);
              },
            };
            return p.multiline ? (
              <textarea
                {...field}
                rows={3}
                onKeyDown={(e) => {
                  // Enter sends; Shift+Enter starts a new line.
                  if (e.key === 'Enter' && !e.shiftKey && !e.isComposing) {
                    e.preventDefault();
                    (e.currentTarget as HTMLTextAreaElement).form?.requestSubmit();
                  }
                }}
              />
            ) : (
              <input {...field} autoComplete={p.autoComplete ?? 'off'} />
            );
          }}
        </DialogField>
        <div class="dialog-actions">
          <button type="button" class="button-quiet" onClick={p.onClose}>
            Cancel
          </button>
          <button type="submit" class="button-primary" disabled={!ready}>
            {busy ? 'One moment…' : p.action}
          </button>
        </div>
      </form>
    </Dialog>
  );
}
