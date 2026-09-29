// The Floor's Office | Directory toggle (OFFICE-PHASE2 §4.5.1): no toggle before onboarding (always the Directory),
// a radio group with arrow keys, the choice remembered, and the Office mounted lazily in place of the Directory's
// tools (the fallback when the office cannot load is in floor-fallback.test.tsx).
import { slimIndex } from '@headcount/catalog/slim';
import { render } from 'preact';
import { act } from 'preact/test-utils';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { catalog } from '../catalog';
import { Floor } from '../routes/Floor';
import { settings } from '../store';
import { FLOOR_VIEW_KEY, floorView, setFloorView } from './view';

const LEAD = slimIndex.catalog.leads[0]!.id;
let host: HTMLElement;
const mount = async () => {
  await act(() => render(<Floor />, host));
};

beforeAll(() => {
  catalog.value = slimIndex;
});
beforeEach(() => {
  host = document.createElement('div');
  document.body.appendChild(host);
  vi.stubGlobal('fetch', vi.fn(async () => new Response('{}', { status: 404 })));
  settings.value = { workspaceId: 'local', leadId: LEAD, chiefName: null, voiceOn: true, updatedAt: 'a', ambience: 'lively' };
  setFloorView('directory');
});
afterEach(() => {
  render(null, host);
  host.remove();
  vi.unstubAllGlobals();
});

describe('the Floor’s Office | Directory toggle', () => {
  it('is not there before onboarding, and the Floor shows the Directory', async () => {
    settings.value = { workspaceId: 'local', leadId: null, chiefName: null, voiceOn: true, updatedAt: 'a' };
    floorView.value = 'office';
    await mount();
    expect(host.querySelector('[data-testid="floor-view"]')).toBeNull();
    expect(host.querySelectorAll('.cw-grid .cw-card').length).toBeGreaterThan(100);
    expect(host.querySelector('.floor-office')).toBeNull();
  });

  it('is a radio group before the other header controls; choosing the Office swaps the Directory for it', async () => {
    await mount();
    const group = host.querySelector('[data-testid="floor-view"]')!;
    expect(group.getAttribute('role')).toBe('radiogroup');
    expect(group.parentElement?.firstElementChild).toBe(group);
    const [office, directory] = [...group.querySelectorAll<HTMLButtonElement>('[role="radio"]')];
    expect(directory!.getAttribute('aria-checked')).toBe('true');
    expect(directory!.tabIndex).toBe(0);
    expect(office!.tabIndex).toBe(-1);
    expect(host.querySelector('.floor-tools')).not.toBeNull();
    await act(() => office!.click());
    expect(floorView.value).toBe('office');
    expect(localStorage.getItem(FLOOR_VIEW_KEY)).toBe('office');
    expect(host.querySelector('.floor[data-view="office"] .floor-office')).not.toBeNull();
    expect(host.querySelector('.floor-tools')).toBeNull();
    expect(host.querySelector('.cw-grid')).toBeNull();
    expect(host.querySelector('.chief-slot')).toBeNull();
  });

  it('moves with the arrow keys', async () => {
    await mount();
    const group = host.querySelector('[data-testid="floor-view"]')!;
    await act(() => void group.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowLeft', bubbles: true })));
    expect(floorView.value).toBe('office');
    await act(() => void host.querySelector('[data-testid="floor-view"]')!.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true })));
    expect(floorView.value).toBe('directory');
  });
});
