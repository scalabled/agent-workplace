// Showing files and pictures with a message in Talk: each is read as it is added (so it is on the Memory page too),
// can be removed, and goes with the message once read; the owner's message keeps them.
import type { ContextCard } from '@headcount/protocol/ext/memory';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { applyFrame, thread } from '../store';
import { attachFiles, draftFiles, removeDraftFile, takeAttachments } from './attachments';
import { sendOwnerMessage } from './actions';

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
const card = (id: string, name: string, kind: ContextCard['kind']): ContextCard => ({ cardId: id, name, kind, bytes: 10, chars: 0, scope: 'workspace', chunks: 0, summary: '', createdAt: '' }) as ContextCard;
let posts: { url: string; body: unknown }[] = [];
let n = 0;

beforeEach(() => {
  posts = [];
  draftFiles.value = [];
  thread.value = [];
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string, init: RequestInit = {}) => {
      if (url.startsWith('/api/cards')) {
        const name = decodeURIComponent(new Headers(init.headers).get('x-file-name') ?? '');
        if (name === 'broken.png') return json({ error: { code: 'bad_request', message: 'That image could not be opened (use PNG, JPEG, WebP or GIF).' } }, 400);
        return json({ card: card(`card_${String(++n).padStart(16, '0')}`, name, name.endsWith('.png') ? 'image' : 'text') }, 201);
      }
      posts.push({ url, body: JSON.parse(String(init.body)) });
      return json({ opId: (JSON.parse(String(init.body)) as { opId: string }).opId, turnId: 'turn_1', messageId: 'msg_1' }, 202);
    }),
  );
});
afterEach(() => vi.unstubAllGlobals());

describe('attachments', () => {
  it('reads each file as it is added; one that cannot be read is dropped with a sentence', async () => {
    const pending = attachFiles([new File(['x'], 'shelf.png', { type: 'image/png' }), new File(['notes'], 'notes.txt', { type: 'text/plain' }), new File(['x'], 'broken.png', { type: 'image/png' })]);
    expect(draftFiles.value.map((f) => [f.name, !!f.card])).toEqual([
      ['shelf.png', false],
      ['notes.txt', false],
      ['broken.png', false],
    ]);
    expect(takeAttachments()).toBeNull(); // still reading
    await pending;
    expect(draftFiles.value.map((f) => f.name)).toEqual(['shelf.png', 'notes.txt']);
    removeDraftFile(draftFiles.value[1]!.key);
    const shown = takeAttachments()!;
    expect(shown).toEqual([{ cardId: expect.stringMatching(/^card_/), name: 'shelf.png', kind: 'image' }]);
    expect(draftFiles.value).toEqual([]);
  });

  it('at most four go with one message', async () => {
    await attachFiles(Array.from({ length: 6 }, (_, i) => new File(['x'], `f${i}.txt`, { type: 'text/plain' })));
    expect(draftFiles.value).toHaveLength(4);
  });

  it('the message carries them to the server and in the thread; the echo keeps them', async () => {
    const attachments = [{ cardId: 'card_00000000000000aa', name: 'shelf.png', kind: 'image' as const }];
    await sendOwnerMessage('What do you make of this?', 'text', { attachments });
    expect(posts[0]!.body).toMatchObject({ text: 'What do you make of this?', attachments: ['card_00000000000000aa'] });
    expect(thread.value.at(-1)).toMatchObject({ from: 'owner', attachments });
    applyFrame({ v: 1, streamId: 'ws:local', seq: 1, ts: '', type: 'talk.owner', opId: (posts[0]!.body as { opId: string }).opId, data: { turnId: 'turn_1', messageId: 'msg_1', text: 'What do you make of this?', via: 'text', attachments } } as never);
    expect(thread.value.filter((m) => m.from === 'owner')).toEqual([expect.objectContaining({ messageId: 'msg_1', attachments })]);
  });
});
