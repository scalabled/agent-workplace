// When the office chunk cannot load, the Floor shows the Directory with one notice and keeps the owner's choice
//.
import { slimIndex } from '@headcount/catalog/slim';
import { render } from 'preact';
import { act } from 'preact/test-utils';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { catalog } from '../catalog';
import { Floor } from '../routes/Floor';
import { settings } from '../store';
import { floorView } from './view';

vi.mock('../lazy', () => ({ prefetchOffice: () => Promise.reject(new Error('chunk failed')), loadOffice: () => Promise.reject(new Error('chunk failed')) }));

let host: HTMLElement;
const flush = () => act(async () => void (await new Promise((r) => setTimeout(r, 0))));

beforeAll(() => {
  catalog.value = slimIndex;
});
beforeEach(() => {
  host = document.createElement('div');
  document.body.appendChild(host);
  vi.stubGlobal('fetch', vi.fn(async () => new Response('{}', { status: 404 })));
  settings.value = { workspaceId: 'local', leadId: slimIndex.catalog.leads[0]!.id, chiefName: null, voiceOn: true, updatedAt: 'a', ambience: 'lively' };
});
afterEach(() => {
  render(null, host);
  host.remove();
  vi.unstubAllGlobals();
});

describe('the Office fallback', () => {
  it('shows the Directory with one notice when the office cannot load, and keeps the choice', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    floorView.value = 'office';
    await act(() => render(<Floor />, host));
    await flush();
    await flush();
    expect(host.querySelector('.floor-notice')?.textContent).toBe('The office view could not load. Showing the Directory.');
    expect(host.querySelectorAll('.cw-grid .cw-card').length).toBeGreaterThan(100);
    expect(floorView.value).toBe('office');
    warn.mockRestore();
  });
});
