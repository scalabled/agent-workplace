import { render } from 'preact';
import { act } from 'preact/test-utils';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { TextDialog } from './Dialog';

let host: HTMLElement;
const tab = (shiftKey = false) => act(() => void document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Tab', shiftKey, bubbles: true, cancelable: true })));

beforeEach(() => {
  host = document.createElement('div');
  document.body.appendChild(host);
});
afterEach(() => {
  render(null, host);
  host.remove();
});

describe('Dialog', () => {
  it('keeps Tab inside: past the last control it wraps to the first, and Shift+Tab wraps back', async () => {
    const onClose = vi.fn();
    await act(() => render(<TextDialog title="Rename the office" label="Office name" value="Old" maxLength={40} action="Rename" save={async () => null} onClose={onClose} />, host));
    const dialog = document.querySelector<HTMLElement>('[role="dialog"]')!;
    const controls = [...dialog.querySelectorAll<HTMLElement>('button, input')].filter((el) => !el.hasAttribute('disabled'));
    const first = controls[0]!;
    const last = controls[controls.length - 1]!;
    expect(document.activeElement).toBe(dialog.querySelector('input'));
    last.focus();
    await tab();
    expect(document.activeElement).toBe(first);
    await tab(true);
    expect(document.activeElement).toBe(last);
  });
});
