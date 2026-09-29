// Link-first: links to items (`?at=`) on the same page, the item revealed (opened, highlighted), "Copy link", and a
// document's passage asked about from a selection, in a side chat pinned to it.
import type { DocThread } from '@headcount/protocol/ext/threads';
import { render } from 'preact';
import { act } from 'preact/test-utils';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Markdown } from '../components/Markdown';
import { DocAsk, DocThreads } from '../docs/DocAsk';
import { asking, docThreads, openThread } from '../docs/threads';
import { linkTarget, linkTo, navigate, path, search } from '../router';
import { CopyLink } from './CopyLink';
import { revealLinked, toast } from './links';

type Call = { url: string; method: string; body: unknown };
let calls: Call[] = [];
let respond: (c: Call) => Response = () => json({});
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
let host: HTMLElement;
const flush = (ms = 0) => act(async () => void (await new Promise((r) => setTimeout(r, ms))));

beforeEach(() => {
  calls = [];
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string, init: RequestInit = {}) => {
      const call = { url, method: init.method ?? 'GET', body: typeof init.body === 'string' ? JSON.parse(init.body) : init.body };
      calls.push(call);
      return respond(call);
    }),
  );
  host = document.createElement('div');
  document.body.appendChild(host);
  docThreads.value = {};
  asking.value = null;
  openThread.value = null;
});
afterEach(() => {
  render(null, host);
  host.remove();
  vi.unstubAllGlobals();
});

describe('links', () => {
  it('builds item links, and moves to another item on the same page without a new page', () => {
    expect(linkTo('/app/memory', 'mem_0123456789abcdef')).toBe('/app/memory?at=mem_0123456789abcdef');
    expect(linkTo('/app/handbook', 'hb-rules-b-1', { thread: 'thr_x' })).toBe('/app/handbook?thread=thr_x&at=hb-rules-b-1');
    navigate('/app/memory');
    const scrollTo = vi.spyOn(window, 'scrollTo').mockImplementation(() => {});
    navigate('/app/memory?at=mem_0123456789abcdef');
    expect(path.value).toBe('/app/memory');
    expect(search.value).toBe('?at=mem_0123456789abcdef');
    expect(linkTarget.value).toBe('mem_0123456789abcdef');
    expect(scrollTo).not.toHaveBeenCalled();
    scrollTo.mockRestore();
  });

  it('reveals the linked item: opens what folds it away and highlights it', async () => {
    host.innerHTML = '<details><summary>More</summary><p id="mem_aaaaaaaaaaaaaaaa">Oat milk is 40p extra.</p></details>';
    const el = host.querySelector('p')!;
    el.scrollIntoView = vi.fn();
    navigate('/app/memory?at=mem_aaaaaaaaaaaaaaaa');
    revealLinked();
    await flush(30);
    expect(host.querySelector('details')!.open).toBe(true);
    expect(el.hasAttribute('data-linked')).toBe(true);
    expect(el.scrollIntoView).toHaveBeenCalled();
  });

  it('Copy link puts the full address on the clipboard and says so', async () => {
    const writeText = vi.fn(async () => undefined);
    vi.stubGlobal('navigator', { ...navigator, clipboard: { writeText } });
    await act(() => render(<CopyLink page="/app/talk" at="msg_01abc" label="Copy link to this message" what="Link to this message" />, host));
    const a = host.querySelector<HTMLAnchorElement>('a.copy-link')!;
    expect(a.getAttribute('href')).toBe('/app/talk?at=msg_01abc');
    await act(async () => void a.click());
    await flush();
    expect(writeText).toHaveBeenCalledWith(`${location.origin}/app/talk?at=msg_01abc`);
    expect(toast.value?.text).toBe('Link to this message copied');
  });
});

describe('asking about a passage', () => {
  const thread = (over: Partial<DocThread> = {}): DocThread => ({
    threadId: 'thr_0123456789abcdef',
    doc: 'deliverable:prj_0123456789',
    anchor: 'dl-b-1',
    quote: 'Launch on March 3rd',
    agentId: 'cw_sam',
    agentName: 'Sam',
    status: 'open',
    createdAt: '2026-09-29T10:00:00Z',
    updatedAt: '2026-09-29T10:00:00Z',
    messages: [
      { from: 'owner', name: 'You', text: 'Why March 3rd?', at: '2026-09-29T10:00:00Z' },
      { from: 'cw_sam', name: 'Sam', text: 'It is the first **Monday** after the menu print run.', at: '2026-09-29T10:00:01Z' },
    ],
    ...over,
  });

  it('a selection becomes a question pinned to its block, answered in the document’s side chat', async () => {
    respond = (c) => (c.method === 'POST' ? json({ thread: thread() }, 201) : json({ threads: [] }));
    await act(() =>
      render(
        <>
          <DocAsk doc="deliverable:prj_0123456789" page="/app/projects/prj_0123456789" agent="Sam">
            <Markdown text={'# Plan\n\nLaunch on March 3rd with a tasting.'} anchors="dl-" />
          </DocAsk>
          <DocThreads doc="deliverable:prj_0123456789" page="/app/projects/prj_0123456789" agent="Sam" />
        </>,
        host,
      ),
    );
    await flush();
    // Every block has an anchor (the words below sit in one).
    const p = [...host.querySelectorAll('.md [id]')].find((el) => el.textContent?.startsWith('Launch'))!;
    expect(p.id).toMatch(/^dl-b-\d+$/);
    expect(host.textContent).toContain('Select any passage above to ask Sam about it');
    // Select the words and let go of the mouse.
    const range = document.createRange();
    range.selectNodeContents(p.firstChild!);
    getSelection()!.removeAllRanges();
    getSelection()!.addRange(range);
    await act(async () => void document.dispatchEvent(new MouseEvent('mouseup', { bubbles: true })));
    await flush(20);
    const ask = [...host.querySelectorAll<HTMLButtonElement>('.doc-select-bar button')].find((b) => b.textContent?.includes('Ask Sam'))!;
    expect(ask).toBeTruthy();
    await act(async () => void ask.click());
    expect(asking.value).toEqual({ doc: 'deliverable:prj_0123456789', anchor: p.id, quote: 'Launch on March 3rd with a tasting.' });
    const box = host.querySelector<HTMLTextAreaElement>('.doc-thread-new textarea')!;
    box.value = 'Why March 3rd?';
    await act(() => void box.dispatchEvent(new Event('input', { bubbles: true })));
    await act(() => void host.querySelector<HTMLFormElement>('.doc-thread-new')!.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true })));
    await flush();
    expect(calls.find((c) => c.method === 'POST')).toMatchObject({ url: '/api/threads', body: { doc: 'deliverable:prj_0123456789', anchor: p.id, quote: 'Launch on March 3rd with a tasting.', text: 'Why March 3rd?' } });
    const messages = [...host.querySelectorAll('.doc-thread-messages li')].map((li) => li.textContent);
    expect(messages[0]).toBe('YouWhy March 3rd?');
    expect(messages[1]).toMatch(/^SamIt is the first \W*Monday\W* after the menu print run\.$/);
    expect(host.querySelector('.doc-thread-tools a.copy-link')?.getAttribute('href')).toBe('/app/projects/prj_0123456789?thread=thr_0123456789abcdef&at=dl-b-1');
  });

  it('a change made from the side chat links to the new version', async () => {
    docThreads.value = { 'canvas:cnv_0000000000000001': [thread({ doc: 'canvas:cnv_0000000000000001', agentName: 'Eddie', messages: [{ from: 'cw_chief', name: 'Eddie', text: 'Started a new version.', at: '', action: { kind: 'revised', canvasId: 'cnv_0000000000000002' } }] })] };
    openThread.value = 'thr_0123456789abcdef';
    respond = () => json({ threads: docThreads.value['canvas:cnv_0000000000000001'] });
    await act(() => render(<DocThreads doc="canvas:cnv_0000000000000001" page="/app/canvas/cnv_0000000000000001" agent="Eddie" />, host));
    await flush();
    expect(host.querySelector<HTMLAnchorElement>('.doc-thread-messages a')?.getAttribute('href')).toBe('/app/canvas/cnv_0000000000000002');
  });
});
