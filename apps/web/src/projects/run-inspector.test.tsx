import { slimIndex } from '@headcount/catalog/slim';
import type { RunTrace } from '@headcount/protocol/ext/agents';
import { render } from 'preact';
import { act } from 'preact/test-utils';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { catalog } from '../catalog';
import { duration, phaseTotals, RunInspector } from './RunInspector';

const run = (runId: string, phase: string, input: number, output: number, ms: number): RunTrace => ({
  runId,
  projectId: 'prj_abcdefgh',
  stepId: phase === 'plan' ? null : 's1',
  phase: phase as RunTrace['phase'],
  personaId: slimIndex.catalog.personas[0]!.id,
  provider: 'mock',
  model: 'mock-1',
  system: 'You are on the team.',
  prompt: 'Do it.',
  calls: [],
  text: '',
  sources: [],
  usage: { input, output, usd: null },
  steps: 1,
  finish: 'stop',
  startedAt: '2026-10-13T10:00:00Z',
  ms,
});

let host: HTMLElement;
let runs: RunTrace[] = [];
beforeEach(() => {
  catalog.value = slimIndex;
  vi.stubGlobal(
    'fetch',
    vi.fn(async () => new Response(JSON.stringify({ runs }), { status: 200, headers: { 'content-type': 'application/json' } })),
  );
  host = document.createElement('div');
  document.body.appendChild(host);
});
afterEach(() => {
  render(null, host);
  host.remove();
  vi.unstubAllGlobals();
});

const open = async () => {
  await act(() => render(<RunInspector projectId="prj_abcdefgh" title="Every model call" onClose={() => {}} />, host));
  await act(async () => void (await new Promise((r) => setTimeout(r, 0))));
  return document.querySelector('[role="dialog"]')!;
};
const cells = (tr: Element) => [...tr.children].map((c) => c.textContent);

describe('phaseTotals', () => {
  it('adds up calls, tokens and time per phase, in project order, with unknown phases last', () => {
    const t = phaseTotals([run('r1', 'review', 10, 1, 100), run('r2', 'plan', 100, 20, 2000), run('r3', 'meeting', 5, 5, 50), run('r4', 'review', 30, 3, 300), run('r5', 'work', 50, 9, 900)]);
    expect(t).toEqual([
      { phase: 'plan', calls: 1, input: 100, output: 20, ms: 2000 },
      { phase: 'work', calls: 1, input: 50, output: 9, ms: 900 },
      { phase: 'review', calls: 2, input: 40, output: 4, ms: 400 },
      { phase: 'meeting', calls: 1, input: 5, output: 5, ms: 50 },
    ]);
    expect(phaseTotals([])).toEqual([]);
  });

  it('formats time in seconds, then minutes', () => {
    expect([duration(0), duration(4230), duration(59_949), duration(59_950), duration(185_400)]).toEqual(['0.0 s', '4.2 s', '59.9 s', '1 min 0 s', '3 min 5 s']);
  });
});

describe('RunInspector totals', () => {
  it('opens with one row per phase and a total row', async () => {
    runs = [run('r1', 'plan', 1200, 400, 3000), run('r2', 'work', 2000, 600, 4500), run('r3', 'work', 1000, 300, 2500), run('r4', 'review', 800, 100, 1000), run('r5', 'discussion', 500, 200, 64_000)];
    const sheet = await open();
    const table = sheet.querySelector('table.run-totals')!;
    expect(cells(table.querySelector('thead tr')!)).toEqual(['Phase', 'Calls', 'Tokens in', 'Tokens out', 'Time']);
    expect([...table.querySelectorAll('tbody tr')].map(cells)).toEqual([
      ['Planning', '1', '1,200', '400', '3.0 s'],
      ['Work', '2', '3,000', '900', '7.0 s'],
      ['Review', '1', '800', '100', '1.0 s'],
      ['Discussion', '1', '500', '200', '1 min 4 s'],
    ]);
    expect(cells(table.querySelector('tfoot tr')!)).toEqual(['Total', '5', '5,500', '1,600', '1 min 15 s']);
    expect(sheet.querySelectorAll('.run')).toHaveLength(5);
  });

  it('keeps the one-line summary when every call is in one phase', async () => {
    runs = [run('r1', 'work', 1200, 300, 2400)];
    const sheet = await open();
    expect(sheet.querySelector('table.run-totals')).toBeNull();
    expect(sheet.textContent).toContain('1 call · 1,500 tokens');
  });
});
