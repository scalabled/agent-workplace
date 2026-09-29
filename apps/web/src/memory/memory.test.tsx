// Inc 4 on the web: the Memory page (search, add, pin, forget), the Handbook (sections, editing, the interview), shared
// files (dropped where they belong, checked before they are sent, removed), and recall chips arriving on a reply.
import { CHIEF_ID, makeFrame, type Frame, type FrameInput, type FrameType } from '@headcount/protocol';
import { HANDBOOK_SECTIONS, type ContextCard, type HandbookResponse, type MemoryItem } from '@headcount/protocol/ext/memory';
import { render } from 'preact';
import { act } from 'preact/test-utils';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { slimIndex } from '@headcount/catalog/slim';
import { catalog } from '../catalog';
import { Handbook } from '../routes/Handbook';
import { Memory } from '../routes/Memory';
import { navigate, route } from '../router';
import { applyFrame, lastSeq, replayThrough, settings, thread } from '../store';
import { ContextFiles } from './ContextFiles';

type Call = { url: string; method: string; body: unknown; headers: Record<string, string> };
let calls: Call[] = [];
let respond: (c: Call) => Response = () => json({});
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
let host: HTMLElement;
const flush = (ms = 0) => act(async () => void (await new Promise((r) => setTimeout(r, ms))));
const button = (text: string) => [...host.querySelectorAll('button')].find((b) => b.textContent?.trim().startsWith(text) || b.getAttribute('aria-label') === text);
const type = async (el: HTMLInputElement | HTMLTextAreaElement, value: string) => {
  el.value = value;
  await act(() => void el.dispatchEvent(new Event('input', { bubbles: true })));
};
const click = (b: Element | undefined) => act(() => void (b as HTMLElement).click());

const mem = (over: Partial<MemoryItem> = {}): MemoryItem => ({
  memoryId: 'mem_0000000000000001',
  text: 'We close early on Sundays, at 2pm.',
  kind: 'rule',
  scope: 'workspace',
  source: 'owner',
  sourceLabel: 'Told to remember',
  pinned: false,
  uses: 2,
  createdAt: '2026-09-29T10:00:00Z',
  updatedAt: '2026-09-29T10:00:00Z',
  ...over,
});
const card = (over: Partial<ContextCard> = {}): ContextCard => ({ cardId: 'card_0000000000000001', name: 'prices.csv', kind: 'csv', bytes: 2048, chars: 300, scope: 'workspace', summary: 'A price list: coffee, milk and bread.', chunks: 1, createdAt: '2026-09-29T10:00:00Z', ...over });

beforeEach(() => {
  calls = [];
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string, init: RequestInit = {}) => {
      const call = { url, method: init.method ?? 'GET', body: typeof init.body === 'string' ? JSON.parse(init.body) : init.body, headers: (init.headers ?? {}) as Record<string, string> };
      calls.push(call);
      return respond(call);
    }),
  );
  host = document.createElement('div');
  document.body.appendChild(host);
  catalog.value = slimIndex;
  settings.value = { workspaceId: 'local', leadId: slimIndex.catalog.leads[0]!.id, chiefName: 'Eddie', voiceOn: false, updatedAt: '' };
});
afterEach(() => {
  render(null, host);
  host.remove();
  vi.unstubAllGlobals();
});

describe('the Memory page', () => {
  it('lists, searches (debounced), adds, pins and forgets', async () => {
    let list = [mem(), mem({ memoryId: 'mem_0000000000000002', text: 'Oat milk is 40p extra.', kind: 'fact', source: 'talk', sourceLabel: 'Talk, 2026-09-28', uses: 0 })];
    respond = (c) => {
      if (c.url.startsWith('/api/memory?q=')) return json({ memories: [list[1]] });
      if (c.url === '/api/memory' && c.method === 'GET') return json({ memories: list });
      if (c.url === '/api/memory' && c.method === 'POST') return json({ memory: mem({ memoryId: 'mem_0000000000000003', text: (c.body as { text: string }).text, kind: 'decision', sourceLabel: 'Added by you', uses: 0 }) }, 201);
      if (c.method === 'PUT') return json({ memory: { ...list[0]!, ...(c.body as object) } });
      if (c.method === 'DELETE') return json({ removed: true });
      if (c.url.startsWith('/api/cards')) return json({ cards: [] });
      return json({});
    };
    await act(() => render(<Memory />, host));
    await flush();
    const rows = () => [...host.querySelectorAll('.memory-row')];
    expect(rows().map((r) => r.querySelector('.memory-text')?.textContent)).toEqual(['We close early on Sundays, at 2pm.', 'Oat milk is 40p extra.']);
    expect(rows()[0]!.querySelector('.connector-meta')?.textContent).toBe('Rule · Told to remember · Sep 29 · recalled 2 times');

    await type(host.querySelector<HTMLInputElement>('#memory-search')!, 'milk');
    expect(calls.some((c) => c.url.includes('q=milk'))).toBe(false); // not yet: debounced
    await flush(300);
    expect(calls.at(-1)!.url).toBe('/api/memory?q=milk');
    expect(rows()).toHaveLength(1);
    await type(host.querySelector<HTMLInputElement>('#memory-search')!, '');
    await flush();

    await click(button('Add'));
    await type(host.querySelector<HTMLTextAreaElement>('.memory-add textarea')!, 'The spring launch budget is £500.');
    const kind = host.querySelector<HTMLSelectElement>('.memory-add select')!;
    kind.value = 'decision';
    await act(() => void kind.dispatchEvent(new Event('change', { bubbles: true })));
    await act(() => void host.querySelector<HTMLFormElement>('.memory-add')!.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true })));
    await flush();
    expect(calls.find((c) => c.method === 'POST')!.body).toEqual({ text: 'The spring launch budget is £500.', kind: 'decision' });
    expect(rows()[0]!.textContent).toContain('The spring launch budget is £500.');

    const sunday = () => rows().find((r) => r.textContent?.includes('Sundays'))!;
    await click(sunday().querySelector('[aria-label^="Pin"]')!);
    await flush();
    expect(calls.find((c) => c.method === 'PUT')).toMatchObject({ url: '/api/memory/mem_0000000000000001', body: { pinned: true } });
    expect(sunday().getAttribute('data-pinned')).toBe('true');

    await click(sunday().querySelector('[aria-label="Forget"]')!);
    list = list.slice(1);
    await click([...sunday().querySelectorAll('button')].find((b) => b.textContent === 'Forget'));
    await flush();
    expect(calls.find((c) => c.method === 'DELETE')!.url).toBe('/api/memory/mem_0000000000000001');
    expect(rows().some((r) => r.textContent?.includes('Sundays'))).toBe(false);
  });
});

describe('the Handbook', () => {
  const view = (over: Partial<HandbookResponse> = {}): HandbookResponse => ({
    sections: HANDBOOK_SECTIONS.map((s) => ({ id: s.id, title: s.title, content: s.id === 'business' ? 'A small café in Leeds.' : '', ...(s.id === 'business' ? { updatedAt: '2026-09-29T10:00:00Z', updatedBy: 'chief' as const } : {}) })),
    interviewing: false,
    markdown: '# Handbook\n\n## The business\n\nA small café in Leeds.\n',
    ...over,
  });

  it('shows what is written and what is not, edits a section, and starts the interview in Talk', async () => {
    respond = (c) => {
      if (c.method === 'PUT') return json(view({ sections: view().sections.map((s) => (s.id === 'rules' ? { ...s, content: (c.body as { content: string }).content, updatedBy: 'owner' as const, updatedAt: '2026-09-29T11:00:00Z' } : s)) }));
      if (c.method === 'POST') return json(view({ interviewing: true }), 202);
      return json(view());
    };
    await act(() => render(<Handbook />, host));
    await flush();
    expect(host.querySelector('.handbook-status')?.textContent).toBe('1 of 8 sections written.');
    const business = host.querySelector('[aria-labelledby="hb-business"]')!;
    expect(business.querySelector('.handbook-body')?.textContent).toContain('A small café in Leeds.');
    expect(business.querySelector('.connector-meta')?.textContent).toBe('Written by Eddie from your interview · Sep 29');
    const rules = () => host.querySelector('[aria-labelledby="hb-rules"]')!;
    expect(rules().textContent).toContain('Not written yet: how things are always (or never) done');

    await click(rules().querySelector('[aria-label="Edit Standing rules"]')!);
    await type(rules().querySelector('textarea')!, '- Never discount bread after 3pm.');
    await act(() => void rules().querySelector('form')!.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true })));
    await flush();
    expect(calls.find((c) => c.method === 'PUT')).toMatchObject({ url: '/api/handbook/rules', body: { content: '- Never discount bread after 3pm.' } });
    expect(rules().querySelector('.connector-meta')?.textContent).toBe('Written by you · Sep 29');

    navigate('/app/handbook');
    await click(button('Let Eddie ask about the rest'));
    await flush();
    expect(calls.find((c) => c.method === 'POST')!.url).toBe('/api/handbook/interview');
    expect(route.value.name).toBe('talk');
  });

  it('while interviewing: a way back to Talk, and a way to stop', async () => {
    respond = (c) => json(view({ interviewing: c.method !== 'DELETE' }));
    await act(() => render(<Handbook />, host));
    await flush();
    expect(host.querySelector('.handbook-status')?.textContent).toBe('Eddie is interviewing you in Talk. Each answer is written up here.');
    await click(button('Stop the interview'));
    await flush();
    expect(calls.at(-1)).toMatchObject({ url: '/api/handbook/interview', method: 'DELETE' });
    expect(host.querySelector('.handbook-status')?.textContent).toBe('1 of 8 sections written.');
  });
});

describe('shared files', () => {
  it('uploads to the scope it was dropped in, refuses what is too big, and removes', async () => {
    const added = card({ cardId: 'card_0000000000000002', name: 'brief.docx', kind: 'docx', scope: 'project:prj_abc12345', chunks: 3 });
    respond = (c) => (c.method === 'POST' ? json({ card: added }, 201) : c.method === 'DELETE' ? json({ removed: true }) : json({ cards: [] }));
    await act(() => render(<ContextFiles scope="project:prj_abc12345" title="Files for this project" />, host));
    await flush();
    expect(calls[0]!.url).toBe('/api/cards?scope=project%3Aprj_abc12345');
    const input = host.querySelector<HTMLInputElement>('input[type=file]')!;
    const big = new File([new Uint8Array(11 * 1024 * 1024)], 'huge.pdf', { type: 'application/pdf' });
    const doc = new File(['hello'], 'brief.docx', { type: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' });
    Object.defineProperty(input, 'files', { value: [big, doc], configurable: true });
    await act(() => void input.dispatchEvent(new Event('change', { bubbles: true })));
    await flush();
    const post = calls.filter((c) => c.method === 'POST');
    expect(post).toHaveLength(1);
    expect(post[0]!.url).toBe('/api/cards?scope=project%3Aprj_abc12345');
    expect(post[0]!.headers['x-file-name']).toBe('brief.docx');
    expect(host.querySelector('.form-error')?.textContent).toBe('huge.pdf: files must be under 10 MB.');
    expect(host.querySelector('.card-row .connector-meta')?.textContent).toBe('Word · 2 KB · 3 parts');

    await click(host.querySelector('[aria-label="Remove brief.docx"]')!);
    await click(button('Remove'));
    await flush();
    expect(calls.at(-1)).toMatchObject({ url: '/api/cards/card_0000000000000002', method: 'DELETE' });
    expect(host.querySelector('.card-row')).toBeNull();
  });
});

describe('recall chips', () => {
  const f = <T extends FrameType>(input: FrameInput<T>, seq: number) => makeFrame('ws:local', input, { seq }) as unknown as Frame;
  it('a reply carries what was remembered for it', () => {
    lastSeq.value = 0;
    replayThrough.value = 0;
    thread.value = [];
    applyFrame(
      f({ type: 'talk.message', data: { turnId: 'turn_1', messageId: 'msg_1', agentId: CHIEF_ID, text: 'We close at 2pm on Sundays.', kind: 'reply', recalled: [{ memoryId: 'mem_0000000000000001', text: 'We close early on Sundays, at 2pm.', kind: 'rule', sourceLabel: 'Told to remember' }] } }, 1),
    );
    expect(thread.value[0]!.recalled).toEqual([{ memoryId: 'mem_0000000000000001', text: 'We close early on Sundays, at 2pm.', kind: 'rule', sourceLabel: 'Told to remember' }]);
  });
});
