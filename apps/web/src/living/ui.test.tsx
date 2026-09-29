// The living workforce in the UI: passing by a desk (pointer, keyboard, touch), the bubble's quick reply to a
// coworker, the three-exchange hand-off, Ambience in ⌘K and on the Floor, the Talk caption line, and unread.
import { slimIndex } from '@headcount/catalog/slim';
import { CHIEF_ID, coworkerAgentId, makeFrame, type Frame, type FrameInput, type FrameType } from '@headcount/protocol';
import { render } from 'preact';
import { act } from 'preact/test-utils';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { catalog } from '../catalog';
import { closePalette, openPalette, Palette } from '../components/Palette';
import { navigate, path, paths } from '../router';
import { Floor } from '../routes/Floor';
import { Talk } from '../routes/Talk';
import { applyFrame, capabilities, settings, sideThreads, thread } from '../store';
import { createFakeAudio } from '../test/fake-audio';
import { startUnread, unread } from '../ui/unread';
import { setAudioEngine } from '../voice/engine';
import { bubbles, resetCaptions, showCaption } from './captions';
import { living } from './index';
import { livelyAnyway, quietHoursNow, setLivelyAnyway } from './quiet';
import type { HoverPhase, HoverVia, LivingRuntime } from './types';

type Call = { url: string; method: string; body: unknown };
let calls: Call[] = [];
let respond: (c: Call) => Response = () => json({});
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

let host: HTMLElement;
const mount = async (vnode: preact.ComponentChild) => {
  await act(() => render(vnode, host));
};
const flush = () => act(async () => void (await new Promise((r) => setTimeout(r, 0))));
const click = (el: Element | null | undefined) => act(() => void (el as HTMLElement).click());
const typeInto = (el: Element | null | undefined, value: string) =>
  act(() => {
    const input = el as HTMLInputElement;
    input.value = value;
    input.dispatchEvent(new Event('input', { bubbles: true }));
  });
const submit = (el: Element | null | undefined) => act(() => void (el as HTMLElement).closest('form')!.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true })));
const pointer = (el: Element, type: string, pointerType = 'mouse', x = 10, y = 10) =>
  act(() => void el.dispatchEvent(new PointerEvent(type, { bubbles: type !== 'pointerenter' && type !== 'pointerleave', pointerType, clientX: x, clientY: y })));

const f = <T extends FrameType>(input: FrameInput<T>, seq?: number) => makeFrame('ws:local', input, seq === undefined ? { after: 0 } : { seq }) as unknown as Frame;
let seq = 1000;

const LEAD = slimIndex.catalog.leads[0]!;
const persona = slimIndex.catalog.personas.find((p) => p.department === slimIndex.catalog.departments[0]!.id)!;
const agentId = coworkerAgentId(persona.id);
const first = persona.name.split(' ')[0]!;

/** A stand-in runtime that records what the Floor asks of it. */
function stubRuntime() {
  const hovers: [string, HoverPhase, HoverVia][] = [];
  const turns: { agentId: string; turnId: string; mode: string }[] = [];
  const rt = {
    hover: (a: string, p: HoverPhase, v: HoverVia) => void hovers.push([a, p, v]),
    ownerTurn: (e: { agentId: string; turnId: string; mode: string }) => void turns.push(e),
    sendSettled: () => undefined,
    ensureAgent: async () => true,
    sendDecision: () => 'none',
    bargeIn: () => undefined,
    setAmbience: () => undefined,
    dispose: () => undefined,
  } as unknown as LivingRuntime;
  return { rt, hovers, turns };
}

beforeAll(() => {
  setAudioEngine(createFakeAudio());
});

beforeEach(() => {
  calls = [];
  respond = () => json({});
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
  catalog.value = slimIndex;
  capabilities.value = null;
  settings.value = { workspaceId: 'local', leadId: LEAD.id, chiefName: null, voiceOn: true, updatedAt: 'a', ambience: 'lively' };
  thread.value = [];
  sideThreads.value = {};
  resetCaptions();
});

afterEach(() => {
  render(null, host);
  host.remove();
  living.value = null;
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe('passing by a desk (§8.1)', () => {
  it('a pointer resting 600 ms on a card is a dwell; leaving ends it; the face wakes while you are there', async () => {
    const { rt, hovers } = stubRuntime();
    living.value = rt;
    vi.useFakeTimers();
    await mount(<Floor />);
    const slot = host.querySelector(`.cw-slot[data-agent-id="${agentId}"]`)!;
    await pointer(slot, 'pointerenter');
    expect(slot.hasAttribute('data-active')).toBe(true);
    await act(() => void vi.advanceTimersByTime(599));
    expect(hovers).toEqual([[agentId, 'enter', 'pointer']]);
    await act(() => void vi.advanceTimersByTime(1));
    expect(hovers.at(-1)).toEqual([agentId, 'dwell', 'pointer']);
    await pointer(slot, 'pointerleave');
    expect(hovers.at(-1)).toEqual([agentId, 'leave', 'pointer']);
  });

  it('keyboard focus for 900 ms is a dwell by keyboard (a bubble, never a voice)', async () => {
    const { rt, hovers } = stubRuntime();
    living.value = rt;
    vi.useFakeTimers();
    await mount(<Floor />);
    const card = host.querySelector<HTMLAnchorElement>(`.cw-slot[data-agent-id="${agentId}"] .cw-card`)!;
    await act(() => card.focus());
    await act(() => void vi.advanceTimersByTime(899));
    expect(hovers).toEqual([]);
    await act(() => void vi.advanceTimersByTime(1));
    expect(hovers).toEqual([[agentId, 'dwell', 'keyboard']]);
  });

  it('a tap on a face on touch says hello instead of opening the profile', async () => {
    const { rt, hovers } = stubRuntime();
    living.value = rt;
    navigate(paths.floor);
    await mount(<Floor />);
    const slot = host.querySelector(`.cw-slot[data-agent-id="${agentId}"]`)!;
    const face = slot.querySelector('.face')!;
    await pointer(face, 'pointerdown', 'touch');
    await click(face);
    expect(path.value).toBe(paths.floor);
    expect(hovers).toEqual([
      [agentId, 'enter', 'touch'],
      [agentId, 'dwell', 'touch'],
    ]);
  });

  it('shows the bubble next to the card and gives screen readers what was said, without announcing it', async () => {
    await mount(<Floor />);
    await act(() => showCaption({ agentId, text: `Hi — ${first}. Nothing on my desk yet.`, kind: 'bubble', ttlMs: 4000, replyable: true, intent: 'passing_by' }));
    const bubble = host.querySelector(`[data-testid="floor-bubble"][data-agent-id="${agentId}"]`);
    expect(bubble?.textContent).toContain('Nothing on my desk yet.');
    expect(bubble?.closest('[aria-live]')).toBeNull();
    expect(host.querySelector(`.cw-slot[data-agent-id="${agentId}"] .cw-card`)?.textContent).toContain('said: “Hi —');
  });
});

describe('the quick side-thread (§8.2)', () => {
  const accept = () =>
    (respond = (c) =>
      c.url.startsWith('/api/desk/')
        ? json({ accepted: true, opId: (c.body as { opId: string }).opId, agentId, turnId: `turn_${(c.body as { opId: string }).opId}`, messageId: `msg_${(c.body as { opId: string }).opId}` }, 202)
        : json({}));

  it('Reply sends to the coworker’s desk, and their answer streams into the bubble', async () => {
    const { rt, turns } = stubRuntime();
    living.value = rt;
    accept();
    await mount(<Floor />);
    await act(() => showCaption({ agentId, text: `Hi — ${first}.`, kind: 'bubble', ttlMs: 4000, replyable: true }));
    await click(host.querySelector('[data-testid="bubble-reply"]'));
    const input = host.querySelector('[data-testid="bubble-input"]');
    expect(input).not.toBeNull();
    await typeInto(input, 'what do you do?');
    await submit(input);
    await flush();
    const post = calls.find((c) => c.method === 'POST')!;
    expect(post.url).toBe(`/api/desk/${encodeURIComponent(persona.id)}/say`);
    expect(post.body).toMatchObject({ text: 'what do you do?', via: 'text' });
    const opId = (post.body as { opId: string }).opId;
    // The living layer gets the owner turn in text mode, so a slow reply can be covered by a filler bubble.
    expect(turns).toEqual([expect.objectContaining({ agentId, turnId: `turn_${opId}`, mode: 'text' })]);
    await act(() => {
      applyFrame(f({ type: 'talk.delta', data: { turnId: `turn_${opId}`, messageId: 'msg_ans', agentId, delta: 'I design systems', surface: 'floor' } }));
    });
    expect(host.querySelector('[data-testid="bubble-answer"]')?.textContent).toBe('I design systems');
    await act(() => {
      applyFrame(f({ type: 'talk.message', data: { turnId: `turn_${opId}`, messageId: 'msg_ans', agentId, text: 'I design systems that last. I am not on a project yet.', kind: 'reply', surface: 'floor' } }, ++seq));
    });
    expect(host.querySelector('[data-testid="bubble-answer"]')?.textContent).toBe('I design systems that last. I am not on a project yet.');
    expect(thread.value).toEqual([]); // nothing new in the Talk transcript
  });

  it('after three exchanges the bubble offers the profile; Esc closes it', async () => {
    accept();
    await mount(<Floor />);
    await act(() => showCaption({ agentId, text: `Hi — ${first}.`, kind: 'bubble', ttlMs: 4000, replyable: true }));
    await click(host.querySelector('[data-testid="bubble-reply"]'));
    for (const text of ['hello', 'what do you do?', 'nice']) {
      await typeInto(host.querySelector('[data-testid="bubble-input"]'), text);
      await submit(host.querySelector('[data-testid="bubble-input"]'));
      await flush();
    }
    const more = [...host.querySelectorAll('.side-more')].find((b) => b.textContent === `Keep talking on ${first}'s profile`);
    expect(more).toBeDefined();
    await click(more);
    expect(path.value).toBe(paths.coworker(persona.id));
    navigate(paths.floor);
    await act(() => showCaption({ agentId, text: 'Hello again.', kind: 'bubble', ttlMs: 4000, replyable: true }));
    const bubble = host.querySelector('[data-testid="floor-bubble"]')!;
    await act(() => void bubble.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })));
    expect(bubbles.value[agentId]).toBeUndefined();
  });
});

describe('Ambience (§9.1)', () => {
  const putBack = () => (respond = (c) => (c.method === 'PUT' ? json({ ...settings.value, ...(c.body as object), updatedAt: 'b' }) : json({})));

  it('⌘K offers the three, marks the current one, and sets it', async () => {
    putBack();
    await mount(<Palette />);
    await act(() => openPalette());
    const field = host.querySelector('input[role="combobox"]');
    await typeInto(field, 'ambience');
    const labels = [...host.querySelectorAll('.palette-item')].map((li) => [li.querySelector('.palette-label')?.textContent, li.querySelector('.palette-hint')?.textContent]);
    expect(labels.map(([l]) => l).sort()).toEqual(['Ambience: Buzzing', 'Ambience: Lively', 'Ambience: Quiet']);
    expect(labels.find(([l]) => l === 'Ambience: Lively')?.[1]).toMatch(/^Current/);
    await click([...host.querySelectorAll('.palette-item')].find((li) => li.textContent?.includes('Ambience: Quiet')));
    await flush();
    expect(calls.find((c) => c.method === 'PUT')?.body).toEqual({ ambience: 'quiet' });
    expect(settings.value?.ambience).toBe('quiet');
    closePalette();
  });

  it('the Floor control shows the current value and sets a new one from its popover', async () => {
    putBack();
    quietHoursNow.value = false; // daytime
    await mount(<Floor />);
    const control = host.querySelector('[data-testid="ambience-control"]')!;
    expect(control.textContent).toContain('Lively');
    await click(control);
    const buzzing = host.querySelector<HTMLInputElement>('input[name="ambience"][value="buzzing"]')!;
    await pointer(buzzing.closest('label')!, 'pointerdown');
    await click(buzzing);
    await flush();
    expect(calls.find((c) => c.method === 'PUT')?.body).toEqual({ ambience: 'buzzing' });
    expect(host.querySelector('.ambience-pop')).toBeNull();
    expect(host.querySelector('[data-testid="ambience-control"]')?.textContent).toContain('Buzzing');
  });
});

describe('quiet hours on the Floor (§9.2)', () => {
  it('the chip says "Quiet hours" at night, and "Lively anyway" lifts them until morning', async () => {
    quietHoursNow.value = true;
    setLivelyAnyway(false);
    await mount(<Floor />);
    const control = host.querySelector('[data-testid="ambience-control"]')!;
    expect(control.textContent).toContain('Quiet hours');
    expect(control.getAttribute('aria-label')).toMatch(/Lively, quiet hours until/);
    await click(control);
    const note = host.querySelector('[data-testid="ambience-quiet-hours"]')!;
    expect(note.textContent).toContain('bubble, not a voice');
    await click([...note.querySelectorAll('button')].find((b) => b.textContent === 'Lively anyway'));
    expect(livelyAnyway.value).toBe(true);
    expect(host.querySelector('[data-testid="ambience-control"]')?.textContent).toContain('Lively');
    setLivelyAnyway(false);
    quietHoursNow.value = false;
  });
});

describe('Talk captions (L6)', () => {
  it('shows reflexes on the live caption line in the reaction style, never live-announced', async () => {
    navigate(paths.talk);
    await mount(<Talk />);
    await act(() => showCaption({ agentId: CHIEF_ID, text: 'mm-hm', kind: 'reaction', ttlMs: 1500, replyable: false }));
    const cap = host.querySelector('[data-testid="live-caption"]');
    expect(cap?.getAttribute('data-kind')).toBe('reaction');
    expect(cap?.textContent).toBe(`${LEAD.name.split(' ')[0]}: mm-hm`);
    expect(cap?.closest('[aria-live]')).toBeNull();
  });

  it('a text-mode filler shows under the face; a reflex reply already in the transcript does not show twice', async () => {
    navigate(paths.talk);
    await mount(<Talk />);
    await act(() => showCaption({ agentId: CHIEF_ID, text: 'One sec.', kind: 'bubble', ttlMs: 4000, replyable: false }));
    expect(host.querySelector('[data-testid="face-bubble"]')?.textContent).toBe('One sec.');
    await act(() => {
      applyFrame(f({ type: 'talk.message', data: { turnId: 'turn_t', messageId: 'msg_t', agentId: CHIEF_ID, text: 'Anytime.', kind: 'reflex', intent: 'gratitude_reply', lineId: 'warm.gratitude_reply.01' } }, ++seq));
      showCaption({ agentId: CHIEF_ID, text: 'Anytime.', kind: 'bubble', ttlMs: 4000, replyable: false });
    });
    expect(host.querySelector('[data-testid="face-bubble"]')).toBeNull();
    expect(host.querySelector('li.msg[data-kind="reflex"]')?.textContent).toContain('Anytime.');
  });
});

describe('unread', () => {
  it('a Floor quick-chat reply is not news for the Talk badge', () => {
    navigate(paths.floor);
    unread.value = 0;
    const stop = startUnread();
    applyFrame(f({ type: 'talk.message', data: { turnId: 'turn_s', messageId: 'msg_s', agentId, text: 'Hello.', kind: 'reply', surface: 'floor' } }, ++seq));
    expect(unread.value).toBe(0);
    applyFrame(f({ type: 'talk.message', data: { turnId: null, messageId: 'msg_a', agentId: CHIEF_ID, text: 'Done.', kind: 'announcement' } }, ++seq));
    expect(unread.value).toBe(1);
    stop();
  });
});
