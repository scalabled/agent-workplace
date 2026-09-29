// The conference stage, bound to the app (OFFICE-PHASE2 §4.4.2): entering a glass room opens a meeting (a room
// session), mounts the dock and sends push-to-talk to the room; the session's events drive the stage's captions, floor
// line and speaker highlight; leaving closes the meeting, which leaves one quiet line in Talk if the owner spoke.
// Presence (the next responder thinking) comes from the store through the office's presence effect, and voiced lines
// light their speaker through the audio engine's speaking changes (both wired by the office view).
import type { OfficeMode, OfficeScene } from '@headcount/office';
import { isRoomId, roomKindOf, type RoomId } from '@headcount/protocol/ext/rooms';
import { dockSignals, mentionFor, mountRoomDock, type DockModel, type MountedDock } from './RoomDock';
import { openRoomSession, type RoomEvent, type RoomSession, type RoomSessionOptions } from './session';

/** The caption stays up this long after the room has said everything. */
export const IDLE_CAPTION_MS = 4000;

export interface StageHost {
  scene: Pick<OfficeScene, 'showCaption' | 'setFloorQueue' | 'setSpeaking' | 'dock' | 'getState' | 'el'>;
  nameOf(agentId: string): string;
  /** Opens the invite picker (default: the stage's own Invite button). */
  invite?(): void;
  /** Tests: the session factory and the dock renderer. */
  openSession?(o: RoomSessionOptions): RoomSession;
  mountDock?(el: HTMLElement, model: DockModel): MountedDock;
  schedule?(fn: () => void, ms: number): () => void;
}

export interface StageBinding {
  /** Open a session, mount the dock, set the push-to-talk target. */
  onEnterRoom(roomId: string, participants: string[]): void;
  onInvite(roomId: string, ids: string[], info: { via: 'picker' | 'drag' | 'keyboard' }): void | boolean;
  /** session.close({leave: true}). */
  onLeaveRoom(roomId: string, participants: string[]): void;
  onModeChange(mode: OfficeMode, roomId: string | null): void;
  /** Enter on a participant: the dock field gets "@First " and focus. */
  onOpenInRoom(personId: string): void;
  meeting(): { roomId: string; meetingId: string; participants: readonly string[] } | null;
  destroy(): void;
}

const ROOM_NAMES: Record<string, string> = { skyline: 'Skyline room', garden: 'Garden room' };

/** "Skyline room"; a room the plan does not name is "room". */
export function roomNameOf(roomId: string): string {
  return ROOM_NAMES[roomId] ?? 'room';
}

interface Meeting {
  roomId: RoomId;
  session: RoomSession;
  model: DockModel;
  dock: MountedDock | null;
  dockEl: HTMLElement | null;
}

export function bindStage(host: StageHost): StageBinding {
  const { scene } = host;
  const schedule =
    host.schedule ??
    ((fn: () => void, ms: number) => {
      const t = setTimeout(fn, ms);
      return () => clearTimeout(t);
    });
  let meeting: Meeting | null = null;
  let destroyed = false;
  /** The line whose caption is up (its messageId and text), and whether it is voiced. */
  let captioned: { messageId: string; voiced: boolean; text: string } | null = null;
  /** A line shown as text: its speaker is lit until it ends. */
  let textSpeaker: string | null = null;
  let cancelClear: (() => void) | null = null;

  const tableNow = (roomId: string): string[] => {
    try {
      const st = scene.getState();
      return st.mode === 'conference' && st.roomId === roomId ? [...st.participants] : [];
    } catch {
      return [];
    }
  };

  const invite = () => {
    if (host.invite) return host.invite();
    const btn = scene.el.querySelector<HTMLButtonElement>('.hc-o-stage__actions .hc-o-btn:not(.hc-o-btn--leave)');
    btn?.click();
  };

  const unlight = () => {
    if (textSpeaker) scene.setSpeaking(textSpeaker, false);
    textSpeaker = null;
  };

  const clearStage = () => {
    cancelClear?.();
    cancelClear = null;
    unlight();
    captioned = null;
    scene.showCaption(null, '');
    scene.setFloorQueue([]);
  };

  const onEvent = (m: Meeting, e: RoomEvent) => {
    if (meeting !== m) return;
    m.model.lines.value = m.session.lines();
    switch (e.type) {
      case 'owner':
        cancelClear?.();
        cancelClear = null;
        unlight();
        captioned = null;
        m.model.error.value = null;
        scene.showCaption(null, e.text, { final: true, voiced: true });
        return;
      case 'order':
        scene.setFloorQueue(e.order);
        return;
      case 'queue':
        scene.setFloorQueue(e.queue);
        return;
      case 'start':
        cancelClear?.();
        cancelClear = null;
        unlight();
        captioned = { messageId: e.messageId, voiced: !e.notVoicedTag, text: e.text };
        scene.showCaption(e.agentId, e.text, { voiced: !e.notVoicedTag, final: true });
        if (!e.voiced) {
          textSpeaker = e.agentId;
          scene.setSpeaking(e.agentId, true);
        }
        return;
      case 'line':
        if (captioned?.messageId !== e.messageId || captioned.text === e.text) return;
        captioned.text = e.text;
        scene.showCaption(e.agentId, e.text, { voiced: captioned.voiced, final: true });
        return;
      case 'end':
        if (textSpeaker === e.agentId) unlight();
        return;
      case 'idle':
        cancelClear?.();
        cancelClear = schedule(() => {
          cancelClear = null;
          if (meeting !== m) return;
          captioned = null;
          scene.showCaption(null, '');
        }, IDLE_CAPTION_MS);
        return;
      case 'error':
        m.model.error.value = e.message;
        return;
    }
  };

  const end = (m: Meeting, participants?: readonly string[]) => {
    if (meeting === m) meeting = null;
    clearStage();
    m.dock?.unmount();
    m.dock = null;
    void m.session.close({ leave: true, ...(participants?.length ? { participants } : {}) });
  };

  const open = (roomId: RoomId, participants: string[]) => {
    const model: DockModel = {
      ...dockSignals(),
      roomId,
      roomName: roomNameOf(roomId),
      nameOf: host.nameOf,
      send: (text) => void m.session.say(text, 'text'),
      invite,
    };
    model.participants.value = participants;
    const make = host.openSession ?? openRoomSession;
    const m: Meeting = { roomId, model, dock: null, dockEl: null, session: null as unknown as RoomSession };
    meeting = m;
    m.session = make({
      roomId,
      participants: () => {
        const now = tableNow(roomId);
        return now.length ? now : m.model.participants.peek();
      },
      onEvent: (e) => {
        m.model.participants.value = tableNow(roomId);
        onEvent(m, e);
      },
      ptt: { label: `the ${roomNameOf(roomId)}` },
    });
    try {
      m.dockEl = scene.dock();
      m.dock = (host.mountDock ?? mountRoomDock)(m.dockEl, model);
    } catch (err) {
      console.error('room dock failed', err);
    }
  };

  const binding: StageBinding = {
    onEnterRoom(roomId, participants) {
      if (destroyed) return;
      if (meeting && meeting.roomId === roomId) {
        meeting.model.participants.value = participants.length ? [...participants] : tableNow(roomId);
        return;
      }
      if (meeting) end(meeting);
      if (!isRoomId(roomId) || roomKindOf(roomId) === 'huddle') return;
      open(roomId, [...participants]);
    },
    onInvite(roomId) {
      if (destroyed) return false;
      // The scene seats them after this returns: read the table again once it has.
      const m = meeting;
      if (m && m.roomId === roomId) queueMicrotask(() => meeting === m && (m.model.participants.value = tableNow(roomId)));
      return true;
    },
    onLeaveRoom(roomId, participants) {
      if (meeting && meeting.roomId === roomId) end(meeting, participants);
    },
    onModeChange(mode, roomId) {
      const m = meeting;
      if (!m) return;
      if (mode === 'desks' || (roomId && roomId !== m.roomId)) return; // onLeaveRoom closes the meeting
      m.model.participants.value = tableNow(m.roomId);
    },
    onOpenInRoom(personId) {
      const m = meeting;
      if (!m) return;
      const text = mentionFor(host.nameOf(personId));
      if (!text) return;
      m.model.mention.value = { text, n: (m.model.mention.peek()?.n ?? 0) + 1 };
    },
    meeting() {
      const m = meeting;
      if (!m) return null;
      const now = tableNow(m.roomId);
      return { roomId: m.roomId, meetingId: m.session.meetingId, participants: now.length ? now : m.model.participants.peek() };
    },
    destroy() {
      if (destroyed) return;
      destroyed = true;
      if (meeting) end(meeting);
      cancelClear?.();
      cancelClear = null;
    },
  };
  return binding;
}
