// The app shell's Office Phase 2 hooks: room frames stay out of Talk, side-threads and
// unread; a room line or a note is never voiced by the Chief's Talk voice; the note renders as one quiet line; global
// Esc and Space defer to the page; the palette registry and "Set your name"; the onboarding name field is optional.
import { slimIndex } from '@headcount/catalog/slim';
import { CHIEF_ID, type Frame, type FrameType } from '@headcount/protocol';
import { render } from 'preact';
import { act } from 'preact/test-utils';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { handledByPage, isEmptyPttField } from '../app';
import { catalog } from '../catalog';
import { closePalette, openPalette, Palette, registerPaletteItems } from '../components/Palette';
import { navigate, path, paths } from '../router';
import { Onboarding } from '../routes/Onboarding';
import { Talk } from '../routes/Talk';
import { applyFrame, capabilities, isRoomFrame, lastSeq, replayThrough, settings, sideThreads, thread } from '../store';
import { ownerNameProblem, setOwnerName } from '../talk/actions';
import { createFakeAudio, type FakeAudio } from '../test/fake-audio';
import { startUnread, unread } from '../ui/unread';
import { chiefSpeaker, startChiefVoice } from '../voice/chief-voice';
import { setAudioEngine } from '../voice/engine';
import { resetVoiceOwner } from '../voice/owner';

type Call = { url: string; method: string; body: unknown };
let calls: Call[] = [];
let respond: (c: Call) => Response = () => json({});
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

let seq = 0;
const frame = (type: FrameType, data: unknown, extra: Partial<Frame> = {}): Frame =>
  ({ v: 1, streamId: 'ws:local', ts: new Date().toISOString(), type, data, ...(type.startsWith('talk.') && type !== 'talk.delta' ? { seq: ++seq } : { after: seq }), ...extra }) as unknown as Frame;
const ROOM = { surface: 'room', roomId: 'skyline', meetingId: 'mtg_01j00000000000000000000000' };

let host: HTMLElement;
let engine: FakeAudio;
const mount = async (vnode: preact.ComponentChild) => {
  await act(() => render(vnode, host));
};
const flush = () => act(async () => void (await new Promise((r) => setTimeout(r, 0))));

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
  resetVoiceOwner();
  engine = createFakeAudio({ speechSynthesis: true });
  setAudioEngine(engine);
  host = document.createElement('div');
  document.body.appendChild(host);
  catalog.value = slimIndex;
  capabilities.value = null;
  settings.value = { workspaceId: 'local', leadId: slimIndex.catalog.leads[0]!.id, chiefName: null, voiceOn: true, updatedAt: 'x' };
  thread.value = [];
  sideThreads.value = {};
  seq = 0;
  lastSeq.value = 0;
  replayThrough.value = 0;
});

afterEach(() => {
  render(null, host);
  host.remove();
  closePalette();
  chiefSpeaker.stop();
  setAudioEngine(null);
  vi.unstubAllGlobals();
});

describe('store: office rooms stay out of Talk', () => {
  it('room frames never reach the thread or the side-threads, nor do errors of room turns', () => {
    applyFrame(frame('talk.owner', { turnId: 'turn_r', messageId: 'msg_o', text: 'What do you all think?', via: 'text', ...ROOM }, { opId: 'op_room' }));
    applyFrame(frame('talk.delta', { turnId: 'turn_r', messageId: 'msg_1', agentId: 'cw_juno', delta: 'One idea.', ...ROOM }));
    applyFrame(frame('talk.message', { turnId: 'turn_r', messageId: 'msg_1', agentId: 'cw_juno', text: 'One idea.', kind: 'reply', ...ROOM }));
    applyFrame(frame('talk.done', { turnId: 'turn_r', messageId: 'msg_1', agentId: 'cw_juno', finish: 'stop', route: 'room', ...ROOM }));
    applyFrame(frame('talk.message', { turnId: 'turn_r', messageId: 'msg_2', agentId: CHIEF_ID, text: 'So, a pilot.', kind: 'reply', ...ROOM }));
    applyFrame(frame('talk.done', { turnId: 'turn_r', messageId: 'msg_2', agentId: CHIEF_ID, finish: 'stop', route: 'room', ...ROOM }));
    applyFrame(frame('error', { code: 'rate_limited', message: 'That is a lot of room talk right now. Wait a minute and ask again.', turnId: 'turn_r' }));
    applyFrame(frame('error', { code: 'rate_limited', message: 'Same, by op.', opId: 'op_room' }));
    expect(thread.value).toEqual([]);
    expect(sideThreads.value).toEqual({});
    // A Talk error is still Talk's.
    applyFrame(frame('error', { code: 'internal', message: 'Something broke.', turnId: 'turn_talk' }));
    expect(thread.value.map((m) => m.kind)).toEqual(['error']);
    expect(isRoomFrame(frame('talk.delta', { turnId: 't', messageId: 'm', agentId: 'cw_x', delta: 'x', surface: 'floor' }))).toBe(false);
  });

  it('a meeting note lands in the thread as a note; neither it nor room lines count as unread', () => {
    navigate(paths.floor);
    const stop = startUnread();
    try {
      unread.value = 0;
      applyFrame(frame('talk.message', { turnId: 'turn_r', messageId: 'msg_1', agentId: CHIEF_ID, text: 'In the room.', kind: 'reply', ...ROOM }));
      applyFrame(frame('talk.message', { turnId: null, messageId: 'msg_n', agentId: CHIEF_ID, text: 'Skyline room with Juno and Walt · 4 min', kind: 'note', roomId: 'skyline', meetingId: ROOM.meetingId }));
      expect(unread.value).toBe(0);
      expect(thread.value).toMatchObject([{ messageId: 'msg_n', kind: 'note', roomId: 'skyline', from: CHIEF_ID }]);
      applyFrame(frame('talk.message', { turnId: null, messageId: 'msg_a', agentId: CHIEF_ID, text: 'The suppliers job is done.', kind: 'announcement' }));
      expect(unread.value).toBe(1);
    } finally {
      stop();
    }
  });
});

describe('the Chief’s Talk voice', () => {
  it('never voices the Chief’s room lines or a note; Talk replies still speak', async () => {
    const stop = startChiefVoice();
    try {
      applyFrame(frame('talk.delta', { turnId: 'turn_r', messageId: 'msg_r', agentId: CHIEF_ID, delta: 'In the room we agree. ', ...ROOM }));
      applyFrame(frame('talk.message', { turnId: 'turn_r', messageId: 'msg_r', agentId: CHIEF_ID, text: 'In the room we agree.', kind: 'reply', ...ROOM }));
      applyFrame(frame('talk.done', { turnId: 'turn_r', messageId: 'msg_r', agentId: CHIEF_ID, finish: 'stop', route: 'room', ...ROOM }));
      applyFrame(frame('talk.message', { turnId: null, messageId: 'msg_n', agentId: CHIEF_ID, text: 'Skyline room with Juno · 1 min', kind: 'note', roomId: 'skyline', meetingId: ROOM.meetingId }));
      await engine.drain();
      expect(engine.spoken).toEqual([]);
      applyFrame(frame('talk.message', { turnId: 'turn_t', messageId: 'msg_t', agentId: CHIEF_ID, text: 'Happy to.', kind: 'reply' }));
      await engine.drain();
      expect(engine.spoken).toHaveLength(1);
    } finally {
      stop();
    }
  });
});

describe('Talk: the meeting note', () => {
  it('renders one quiet line with a room glyph, no face and no actions', async () => {
    navigate(paths.talk);
    thread.value = [
      { messageId: 'msg_n', turnId: null, from: CHIEF_ID, text: 'Water cooler with Kate and Pax · 2 min', streaming: false, kind: 'note', roomId: 'huddle:abcd', ts: new Date().toISOString() },
      { messageId: 'msg_a', turnId: 'turn_t', from: CHIEF_ID, text: 'Back to it.', streaming: false, kind: 'reply', ts: new Date().toISOString() },
    ];
    await mount(<Talk />);
    const note = host.querySelector('li.msg[data-kind="note"]');
    expect(note).not.toBeNull();
    expect(note!.textContent).toContain('Water cooler with Kate and Pax · 2 min');
    expect(note!.querySelector('svg.msg-note-glyph')).not.toBeNull();
    expect(note!.querySelector('button, .face, .msg-from')).toBeNull();
    // The next Chief message is not folded into the note: it names its speaker.
    const next = note!.nextElementSibling!;
    expect(next.querySelector('.msg-from')).not.toBeNull();
  });
});

describe('global keys defer to the page', () => {
  it('an Esc or a Space the page already handled is left alone', () => {
    const esc = new KeyboardEvent('keydown', { key: 'Escape', cancelable: true });
    expect(handledByPage(esc)).toBe(false);
    esc.preventDefault();
    expect(handledByPage(esc)).toBe(true);
    const space = new KeyboardEvent('keydown', { key: ' ', cancelable: true });
    space.preventDefault();
    expect(handledByPage(space)).toBe(true);
    const k = new KeyboardEvent('keydown', { key: 'k', cancelable: true });
    k.preventDefault();
    expect(handledByPage(k)).toBe(false);
  });

  it('the room dock’s empty field holds Space to talk like the Talk composer', () => {
    const field = document.createElement('input');
    field.setAttribute('data-ptt-hold', '');
    expect(isEmptyPttField(field)).toBe(true);
    field.value = 'typing';
    expect(isEmptyPttField(field)).toBe(false);
    expect(isEmptyPttField(document.createElement('input'))).toBe(false);
  });
});

describe('palette', () => {
  it('registered items appear while registered and go when unregistered', async () => {
    const run = vi.fn();
    const off = registerPaletteItems(() => [{ id: 'office:pause', label: 'Pause office life', group: 'Office', icon: 'stop', run }]);
    openPalette();
    await mount(<Palette />);
    const item = () => [...document.querySelectorAll('.palette-item')].find((li) => li.textContent?.includes('Pause office life'));
    expect(item()).toBeDefined();
    await act(() => (item() as HTMLElement).click());
    expect(run).toHaveBeenCalledTimes(1);
    off();
    openPalette();
    await flush();
    expect(item()).toBeUndefined();
  });

  it('Set your name asks for one line, saves it, and blank clears it', async () => {
    respond = (c) => json({ ...settings.value, ...(c.body as object), updatedAt: 'y' });
    openPalette();
    await mount(<Palette />);
    const input = () => document.querySelector<HTMLInputElement>('.palette input')!;
    await act(() => {
      input().value = 'set your';
      input().dispatchEvent(new Event('input', { bubbles: true }));
    });
    const item = [...document.querySelectorAll('.palette-item')].find((li) => li.textContent?.includes('Set your name')) as HTMLElement;
    expect(item.textContent).toContain('Used in greetings');
    await act(() => item.click());
    expect(input().getAttribute('aria-label')).toBe('Your first name');
    expect(input().getAttribute('autocomplete')).toBe('given-name');
    await act(() => {
      input().value = 'Greg';
      input().dispatchEvent(new Event('input', { bubbles: true }));
    });
    await act(() => void input().dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true })));
    await flush();
    expect(calls.find((c) => c.method === 'PUT')?.body).toEqual({ ownerName: 'Greg' });
    expect(settings.value?.ownerName).toBe('Greg');
    expect(document.querySelector('.palette')).toBeNull();
    expect(await setOwnerName('  ')).toBeNull();
    expect(calls.filter((c) => c.method === 'PUT').at(-1)?.body).toEqual({ ownerName: null });
  });

  it('a name the worker would refuse gets one sentence, and nothing is sent', async () => {
    expect(ownerNameProblem('<b>')).toBe('Use letters for your name.');
    expect(ownerNameProblem('x'.repeat(41))).toMatch(/40 characters/);
    expect(ownerNameProblem("Anne-Marie O'Neil")).toBeNull();
    expect(await setOwnerName('me@home')).toBe('Use letters for your name.');
    expect(calls).toEqual([]);
  });
});

describe('onboarding: the owner’s name', () => {
  // Choose opens the Start dialog; its first field is what the office calls the owner.
  const open = async () => {
    const btn = [...host.querySelectorAll('button')].find((b) => b.textContent?.startsWith('Choose '))!;
    await act(() => void btn.click());
  };
  const choose = async () => {
    await act(() => void document.querySelector('.dialog form')!.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true })));
    await flush();
  };
  const ownerField = () => document.querySelector<HTMLInputElement>('.dialog input')!;

  beforeEach(() => {
    settings.value = { workspaceId: 'local', leadId: null, chiefName: null, voiceOn: true, updatedAt: '' };
    navigate(paths.onboarding);
    respond = (c) => json({ ...settings.value, ...(c.body as object), updatedAt: 'now' });
  });

  it('is optional: skipping sends no name', async () => {
    await mount(<Onboarding />);
    await open();
    expect(ownerField().getAttribute('autocomplete')).toBe('given-name');
    expect(ownerField().maxLength).toBe(40);
    expect(ownerField().closest('.field')?.textContent).toContain('Optional. Used in greetings.');
    await choose();
    expect(calls.find((c) => c.method === 'PUT')?.body).not.toHaveProperty('ownerName');
    expect(path.value).toBe(paths.talk);
  });

  it('a name typed there rides on the same save', async () => {
    await mount(<Onboarding />);
    await open();
    await act(() => {
      ownerField().value = 'Greg';
      ownerField().dispatchEvent(new Event('input', { bubbles: true }));
    });
    await choose();
    expect(calls.find((c) => c.method === 'PUT')?.body).toMatchObject({ leadId: slimIndex.catalog.leads[0]!.id, ownerName: 'Greg' });
  });

  it('a name the worker would refuse is caught before the save', async () => {
    await mount(<Onboarding />);
    await open();
    await act(() => {
      ownerField().value = '{Greg}';
      ownerField().dispatchEvent(new Event('input', { bubbles: true }));
    });
    await choose();
    expect(calls.filter((c) => c.method === 'PUT')).toEqual([]);
    expect(ownerField().closest('.field')?.querySelector('[role="alert"]')?.textContent).toBe('Use letters for your name.');
  });
});
