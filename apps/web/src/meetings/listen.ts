// Listen in (Inc 2): a project meeting voiced on demand. Meeting lines stay text until the owner listens; then each
// line plays in its speaker's team voice (the voices set at staffing, unique within the team; the Chief of Staff in
// theirs), one after another through the room player (TTS look-ahead, a gap between speakers, captions, lip sync on
// every face of that speaker). Voiced lines are kept on the server, so a replay is free. A live meeting keeps adding
// its lines as they are said. One meeting plays at a time, app-wide: the now-playing bar shows and controls it while
// the owner moves around the app.
import { personaVoiceRef } from '@headcount/catalog';
import { speechChunkFromResponse } from '@headcount/audio';
import { CHIEF_ID, type VoiceRef } from '@headcount/protocol';
import type { ChannelEntry, MeetingKind, MeetingResponse, TeamMember } from '@headcount/protocol/ext/projects';
import { signal } from '@preact/signals';
import { api } from '../api/client';
import { catalog } from '../catalog';
import { browserVoiceHint, chiefName, chiefVoiceHint, chiefVoiceRef } from '../chief';
import { clearCaption, showCaption } from '../living/captions';
import { RoomPlayer, readingMs, type PlayerLine, type RoomSpeaker, type VoiceVerdict } from '../room/player';
import { can, onFrame } from '../store';
import { speakerDeps } from '../voice/chief-voice';
import { claimUnsettled, mayVoice } from '../voice/owner';
import { AgentSpeaker, type SpeakerDeps, type VoiceSpec } from '../voice/speaker';

export interface NowPlayingLine {
  agentId: string;
  name: string;
  text: string;
  voiced: boolean;
}

export interface NowPlaying {
  projectId: string;
  meetingId: string;
  /** The project's title. */
  title: string;
  kind: MeetingKind;
  question: string;
  /** Still being held (new lines keep coming). */
  live: boolean;
  /** Everything has played and the meeting is over. */
  finished: boolean;
  paused: boolean;
  line: NowPlayingLine | null;
  /** 1-based position of the line playing, and how many there are so far. */
  position: number;
  total: number;
  /** Lines play as text: no provider voice here, or the voice is on another tab. */
  textOnly: boolean;
}

export const nowPlaying = signal<NowPlaying | null>(null);

type Line = { agentId: string; messageId: string; text: string; seq: number; phase?: string };

/** A meeting line as the player takes it (owner lines show as text; whispers and notes are not played). */
function lineOf(e: ChannelEntry): Line | null {
  if (e.kind === 'whisper' || e.kind === 'system' || !e.text.trim()) return null;
  if (e.kind !== 'discussion' && e.kind !== 'owner') return null;
  const agentId = e.fromId === 'chief' ? CHIEF_ID : e.fromId === 'owner' ? 'owner' : `cw_${e.fromId}`;
  return { agentId, messageId: `mtg:${e.seq}`, text: e.text, seq: e.seq, ...(e.phase ? { phase: e.phase } : {}) };
}

/** Meeting speech is kept on the server for replay (TtsRequest.cache). */
const meetingDeps: SpeakerDeps = {
  ...speakerDeps,
  async synthesize(text, voiceRef, speakerId, sig) {
    const res = await api.tts({ text, voiceRef, speakerId, response: 'json', cache: true }, sig);
    return speechChunkFromResponse(res, text);
  },
};

/** A member's team voice (their catalog speed and style, the staffing-time voice ids and provider). */
export function teamVoiceRef(m: TeamMember): VoiceRef | null {
  const p = catalog.value?.persona(m.personaId);
  const base = p ? personaVoiceRef(p) : {};
  if (!m.voice) return p ? base : null;
  return { ...base, openai: m.voice.openai, xai: m.voice.xai, ...(m.voice.prefer ? { provider: m.voice.prefer } : {}) };
}

/** Plays through the provider voice when this tab may speak; the verdict is taken again as each line starts. */
function listenVoice(): VoiceVerdict {
  const tts = can('tts');
  return { voiced: tts && mayVoice() && !claimUnsettled(), notVoicedTag: !tts };
}

class Session {
  readonly lines: Line[] = [];
  private readonly seen = new Set<number>();
  private readonly speakers = new Map<string, AgentSpeaker>();
  private player: RoomPlayer | null = null;
  /** Index of the line playing (or next to play). */
  private pos = 0;
  private closedLines = false;
  private stopFrames: (() => void) | null = null;
  /** Stopping the player ends its line: that is not the line having played (pause and skip keep their place). */
  private halting = false;

  constructor(
    readonly m: MeetingResponse,
    private readonly title: string,
    private readonly deps: { now(): number; schedule(fn: () => void, ms: number): () => void },
  ) {
    for (const e of m.entries) this.take(e);
    this.closedLines = m.meeting.status !== 'live';
    // A live meeting: its new lines play as they are said.
    this.stopFrames = onFrame((frame) => {
      if (frame.type === 'project.channel' && frame.data.entry.meetingId === m.meeting.meetingId) {
        const line = this.take(frame.data.entry);
        if (line && this.player && !nowPlaying.peek()?.paused) this.player.finish(line.agentId, line.messageId, line.text);
        // The Chief's closing words end it.
        if (frame.data.entry.fromId === 'chief' && frame.data.entry.phase === 'moderator' && this.lines.filter((l) => l.phase === 'moderator').length >= 2) this.close();
        this.publish();
      } else if (frame.type === 'project.updated' && frame.data.project.projectId === m.meeting.projectId && !this.closedLines) {
        const d = frame.data.project.discussion;
        if (!d || d.meetingId !== m.meeting.meetingId) {
          if (!['running', 'paused', 'proposed', 'needs_review'].includes(frame.data.project.status)) this.close();
        }
      }
    });
  }

  private take(e: ChannelEntry): Line | null {
    if (this.seen.has(e.seq)) return null;
    const line = lineOf(e);
    if (!line) return null;
    this.seen.add(e.seq);
    this.lines.push(line);
    this.lines.sort((a, b) => a.seq - b.seq);
    return line;
  }

  private close(): void {
    if (this.closedLines) return;
    this.closedLines = true;
    this.player?.turnOver();
    this.publish();
  }

  private member(agentId: string): TeamMember | undefined {
    return this.m.team.find((t) => `cw_${t.personaId}` === agentId);
  }

  nameOf(agentId: string): string {
    if (agentId === CHIEF_ID) return chiefName.value;
    if (agentId === 'owner') return 'You';
    return this.member(agentId)?.name.split(' ')[0] ?? 'Someone';
  }

  private speakerOf = (agentId: string): RoomSpeaker | null => {
    if (agentId === 'owner') return null;
    const have = this.speakers.get(agentId);
    if (have) return have;
    const voice = (): VoiceSpec => {
      if (agentId === CHIEF_ID) return { voiceRef: chiefVoiceRef.value, hint: chiefVoiceHint.value };
      const m = this.member(agentId);
      const p = m ? catalog.value?.persona(m.personaId) : undefined;
      return { voiceRef: m ? teamVoiceRef(m) : null, ...(p ? { hint: browserVoiceHint(p.pronouns, p.voice.speed) } : {}) };
    };
    const s = new AgentSpeaker(agentId, meetingDeps, voice);
    this.speakers.set(agentId, s);
    return s;
  };

  /** Play from line `from` (0-based). */
  play(from: number): void {
    this.halt();
    this.pos = Math.max(0, Math.min(from, this.lines.length));
    const player = new RoomPlayer(
      { speakerOf: this.speakerOf, voice: listenVoice, clipVoice: listenVoice, now: this.deps.now, schedule: this.deps.schedule },
      {
        onStart: (l: PlayerLine, voiced: boolean) => {
          const idx = this.lines.findIndex((x) => x.messageId === l.messageId);
          if (idx >= 0) this.pos = idx;
          if (l.agentId !== 'owner') showCaption({ agentId: l.agentId, text: l.text, kind: 'line', ttlMs: voiced ? 30_000 : readingMs(l.text) + 500, replyable: false });
          this.publish({ agentId: l.agentId, name: this.nameOf(l.agentId), text: l.text, voiced });
        },
        onText: () => undefined,
        onEnd: (l: PlayerLine) => {
          if (l.agentId !== 'owner') clearCaption(l.agentId, 'line');
          if (this.halting) return;
          const idx = this.lines.findIndex((x) => x.messageId === l.messageId);
          if (idx >= 0) this.pos = idx + 1;
        },
        onIdle: () => this.publish(null, true),
        onChange: () => undefined,
      },
    );
    this.player = player;
    this.publish(null);
    player.beginTurn();
    for (const l of this.lines.slice(this.pos)) player.finish(l.agentId, l.messageId, l.text);
    if (this.closedLines) player.turnOver();
  }

  pause(): void {
    this.halt();
    const now = nowPlaying.peek();
    if (now) nowPlaying.value = { ...now, paused: true };
  }

  resume(): void {
    this.play(this.pos);
  }

  skip(): void {
    this.play(this.pos + 1);
  }

  private halt(): void {
    this.halting = true;
    try {
      this.player?.destroy();
    } finally {
      this.halting = false;
    }
    this.player = null;
    for (const l of this.lines) if (l.agentId !== 'owner') clearCaption(l.agentId, 'line');
  }

  destroy(): void {
    this.halt();
    this.stopFrames?.();
    this.stopFrames = null;
    for (const s of this.speakers.values()) s.stop();
  }

  private publish(line?: NowPlayingLine | null, idle = false): void {
    const prev = nowPlaying.peek();
    const m = this.m.meeting;
    const finished = idle && this.closedLines && this.pos >= this.lines.length;
    nowPlaying.value = {
      projectId: m.projectId,
      meetingId: m.meetingId,
      title: this.title,
      kind: m.kind,
      question: m.question,
      live: !this.closedLines,
      finished,
      paused: false,
      line: line === undefined ? (prev?.meetingId === m.meetingId ? prev.line : null) : line,
      position: Math.min(this.pos + 1, Math.max(1, this.lines.length)),
      total: this.lines.length,
      textOnly: !listenVoice().voiced,
    };
  }
}

let session: Session | null = null;

const defaultDeps = { now: () => Date.now(), schedule: (fn: () => void, ms: number) => {
  const t = setTimeout(fn, ms);
  return () => clearTimeout(t);
} };

/**
 * Listen to a meeting (`from`: 'start' replays it all; 'live' starts at the line being said now, or the last one).
 * Replaces whatever was playing. Resolves once playback has begun (or rejects when the meeting cannot be read).
 */
export async function listen(projectId: string, meetingId: string, opts: { from?: 'start' | 'live'; title?: string } = {}, deps = defaultDeps): Promise<void> {
  const m = await api.getMeeting(projectId, meetingId);
  stopListening();
  const s = new Session(m, opts.title ?? '', deps);
  session = s;
  const from = opts.from === 'live' && m.meeting.status === 'live' ? Math.max(0, s.lines.length - 1) : 0;
  s.play(from);
}

export function pauseListening(): void {
  session?.pause();
}

export function resumeListening(): void {
  session?.resume();
}

export function skipLine(): void {
  session?.skip();
}

export function stopListening(): void {
  session?.destroy();
  session = null;
  nowPlaying.value = null;
}
