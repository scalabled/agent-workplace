// The stage binding and the dock (OFFICE-PHASE2 §4.4.2–4.4.3): session events drive the scene's captions, floor line
// and speaker; the dock sends, mentions, shows errors and the transcript; leaving closes the meeting.
import { act } from 'preact/test-utils';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { RoomEvent, RoomSession, RoomSessionOptions, RoomTranscriptLine } from './session';
import { bindStage, IDLE_CAPTION_MS, roomNameOf, type StageBinding } from './stage';

interface SceneCall {
  fn: string;
  args: unknown[];
}

function fakeScene() {
  const calls: SceneCall[] = [];
  const el = document.createElement('div');
  const actions = document.createElement('div');
  actions.className = 'hc-o-stage__actions';
  const inviteBtn = document.createElement('button');
  inviteBtn.className = 'hc-o-btn';
  const leaveBtn = document.createElement('button');
  leaveBtn.className = 'hc-o-btn hc-o-btn--leave';
  actions.append(inviteBtn, leaveBtn);
  const dockEl = document.createElement('div');
  el.append(actions, dockEl);
  document.body.append(el);
  const state = { mode: 'conference' as 'desks' | 'conference', roomId: 'skyline' as string | null, participants: ['cw_juno', 'cw_walt'] };
  const rec =
    (fn: string) =>
    (...args: unknown[]) =>
      void calls.push({ fn, args });
  return {
    calls,
    state,
    el,
    dockEl,
    inviteBtn,
    scene: {
      el,
      showCaption: rec('showCaption'),
      setFloorQueue: rec('setFloorQueue'),
      setSpeaking: rec('setSpeaking'),
      dock: () => dockEl,
      getState: () => ({ ...state }) as never,
    },
  };
}

function fakeSession() {
  let opts: RoomSessionOptions | null = null;
  const said: [string, string][] = [];
  const closes: unknown[] = [];
  let transcript: RoomTranscriptLine[] = [];
  const session: RoomSession = {
    roomId: 'skyline',
    meetingId: 'mtg_01j00000000000000000000000',
    say: async (t, via) => void said.push([t, via]),
    hush: () => undefined,
    close: async (o) => void closes.push(o),
    lines: () => transcript,
    participants: () => [],
  };
  return {
    open: (o: RoomSessionOptions) => {
      opts = o;
      return session;
    },
    opts: () => opts!,
    emit: (e: RoomEvent) => act(() => opts!.onEvent(e)),
    said,
    closes,
    setLines: (l: RoomTranscriptLine[]) => (transcript = l),
  };
}

const names: Record<string, string> = { cw_juno: 'Juno Park', cw_walt: 'Walt Brenner', cw_chief: 'Eddie Ramos' };
let s: ReturnType<typeof fakeScene>;
let fs: ReturnType<typeof fakeSession>;
let binding: StageBinding;

beforeEach(() => {
  vi.useFakeTimers();
  s = fakeScene();
  fs = fakeSession();
  binding = bindStage({ scene: s.scene, nameOf: (id) => names[id] ?? id, openSession: fs.open });
});
afterEach(() => {
  binding.destroy();
  s.el.remove();
  vi.useRealTimers();
});

const enter = () => act(() => binding.onEnterRoom('skyline', ['cw_juno', 'cw_walt']));
const input = () => s.dockEl.querySelector<HTMLInputElement>('input.hc-o-input');
const lastCall = (fn: string) => s.calls.filter((c) => c.fn === fn).at(-1)?.args;

describe('stage binding', () => {
  it('entering a room opens a meeting with push-to-talk to it and mounts the dock', async () => {
    await enter();
    expect(fs.opts().roomId).toBe('skyline');
    expect(fs.opts().ptt).toEqual({ label: 'the Skyline room' });
    expect(fs.opts().participants()).toEqual(['cw_juno', 'cw_walt']);
    expect(s.dockEl.querySelector('form.hc-o-compose')).not.toBeNull();
    expect(input()!.hasAttribute('data-ptt-hold')).toBe(true);
    expect(input()!.getAttribute('aria-label')).toBe('Message the Skyline room');
    expect(binding.meeting()).toMatchObject({ roomId: 'skyline', participants: ['cw_juno', 'cw_walt'] });
    expect(roomNameOf('garden')).toBe('Garden room');
  });

  it('an empty table shows Invite in the dock, which opens the stage’s picker', async () => {
    s.state.participants = [];
    await act(() => binding.onEnterRoom('skyline', []));
    const btn = s.dockEl.querySelector<HTMLButtonElement>('.room-dock__invite');
    expect(btn?.textContent).toMatch(/Invite people/);
    const clicked = vi.fn();
    s.inviteBtn.addEventListener('click', clicked);
    await act(() => btn!.click());
    expect(clicked).toHaveBeenCalledTimes(1);
    s.state.participants = ['cw_juno'];
    await act(async () => {
      binding.onInvite('skyline', ['cw_juno'], { via: 'picker' });
      await Promise.resolve();
    });
    expect(input()).not.toBeNull();
  });

  it('maps session events to captions, the floor line and the speaker', async () => {
    await enter();
    await fs.emit({ type: 'owner', text: 'What do you all think?', via: 'text' });
    expect(lastCall('showCaption')).toEqual([null, 'What do you all think?', { final: true, voiced: true }]);
    await fs.emit({ type: 'order', order: ['cw_juno', 'cw_walt'], mode: 'group' });
    expect(lastCall('setFloorQueue')).toEqual([['cw_juno', 'cw_walt']]);
    await fs.emit({ type: 'queue', queue: ['cw_walt'] });
    expect(lastCall('setFloorQueue')).toEqual([['cw_walt']]);
    // A voiced line: the caption with no tag; the audio engine lights the speaker, not the binding.
    await fs.emit({ type: 'start', agentId: 'cw_juno', messageId: 'm1', text: 'One idea.', voiced: true, notVoicedTag: false });
    expect(lastCall('showCaption')).toEqual(['cw_juno', 'One idea.', { voiced: true, final: true }]);
    expect(s.calls.filter((c) => c.fn === 'setSpeaking')).toEqual([]);
    await fs.emit({ type: 'line', agentId: 'cw_juno', messageId: 'm1', text: 'One idea. Two.', final: true });
    expect(lastCall('showCaption')).toEqual(['cw_juno', 'One idea. Two.', { voiced: true, final: true }]);
    // A line of someone else not playing never replaces the caption.
    await fs.emit({ type: 'line', agentId: 'cw_walt', messageId: 'm2', text: 'Later.', final: false });
    expect(lastCall('showCaption')).toEqual(['cw_juno', 'One idea. Two.', { voiced: true, final: true }]);
    // A text-only line (keyless): NOT VOICED, and the speaker is lit until it ends.
    await fs.emit({ type: 'start', agentId: 'cw_walt', messageId: 'm2', text: 'Later.', voiced: false, notVoicedTag: true });
    expect(lastCall('showCaption')).toEqual(['cw_walt', 'Later.', { voiced: false, final: true }]);
    expect(lastCall('setSpeaking')).toEqual(['cw_walt', true]);
    await fs.emit({ type: 'end', agentId: 'cw_walt', messageId: 'm2' });
    expect(lastCall('setSpeaking')).toEqual(['cw_walt', false]);
    await fs.emit({ type: 'idle' });
    vi.advanceTimersByTime(IDLE_CAPTION_MS - 1);
    expect(lastCall('showCaption')).toEqual(['cw_walt', 'Later.', { voiced: false, final: true }]);
    vi.advanceTimersByTime(1);
    expect(lastCall('showCaption')).toEqual([null, '']);
  });

  it('a line voiced in another tab carries no tag (captions only here)', async () => {
    await enter();
    await fs.emit({ type: 'start', agentId: 'cw_juno', messageId: 'm1', text: 'Hm.', voiced: false, notVoicedTag: false });
    expect(lastCall('showCaption')).toEqual(['cw_juno', 'Hm.', { voiced: true, final: true }]);
  });

  it('the dock sends typed messages; errors show as one line until the next send', async () => {
    await enter();
    const i = input()!;
    i.value = 'What about bundling?';
    await act(() => void s.dockEl.querySelector('form')!.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true })));
    expect(fs.said).toEqual([['What about bundling?', 'text']]);
    expect(i.value).toBe('');
    await fs.emit({ type: 'error', message: 'That is a lot of room talk right now. Wait a minute and ask again.' });
    expect(s.dockEl.querySelector('[role="alert"]')?.textContent).toBe('That is a lot of room talk right now. Wait a minute and ask again.');
    i.value = 'ok';
    await act(() => void s.dockEl.querySelector('form')!.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true })));
    expect(s.dockEl.querySelector('[role="alert"]')).toBeNull();
  });

  it('Enter on a participant puts "@First " in the field and focuses it', async () => {
    await enter();
    await act(() => binding.onOpenInRoom('cw_juno'));
    expect(input()!.value).toBe('@Juno ');
    expect(document.activeElement).toBe(input());
    await act(() => binding.onOpenInRoom('cw_walt'));
    expect(input()!.value).toBe('@Walt ');
  });

  it('the transcript lists every line, the unheard ones marked', async () => {
    await enter();
    fs.setLines([
      { agentId: 'owner', text: 'Thoughts?', at: 1, heard: true },
      { agentId: 'cw_juno', text: 'One idea.', at: 2, heard: true },
      { agentId: 'cw_walt', text: 'Cut off.', at: 3, heard: false },
    ]);
    await fs.emit({ type: 'idle' });
    const details = s.dockEl.querySelector('details.room-dock__transcript');
    expect(details).not.toBeNull();
    expect(details!.hasAttribute('open')).toBe(false);
    expect([...details!.querySelectorAll('li')].map((li) => li.textContent)).toEqual(['You: Thoughts?', 'Juno: One idea.', 'Walt: Cut off. (not heard)']);
    expect(details!.querySelector('[aria-live]')).toBeNull();
  });

  it('leaving closes the meeting with who was there, unmounts the dock and clears the stage', async () => {
    await enter();
    await fs.emit({ type: 'start', agentId: 'cw_juno', messageId: 'm1', text: 'x', voiced: false, notVoicedTag: true });
    await act(() => binding.onLeaveRoom('skyline', ['cw_juno', 'cw_walt']));
    expect(fs.closes).toEqual([{ leave: true, participants: ['cw_juno', 'cw_walt'] }]);
    expect(s.dockEl.innerHTML).toBe('');
    expect(lastCall('setSpeaking')).toEqual(['cw_juno', false]);
    expect(lastCall('showCaption')).toEqual([null, '']);
    expect(lastCall('setFloorQueue')).toEqual([[]]);
    expect(binding.meeting()).toBeNull();
    // Events after leaving change nothing.
    const n = s.calls.length;
    await fs.emit({ type: 'queue', queue: ['cw_walt'] });
    expect(s.calls.length).toBe(n);
  });

  it('destroy leaves an open meeting; huddle room ids never open the stage', async () => {
    await act(() => binding.onEnterRoom('huddle:abcd', ['cw_juno']));
    expect(binding.meeting()).toBeNull();
    await enter();
    binding.destroy();
    expect(fs.closes).toEqual([{ leave: true }]);
  });
});
