// Where micro-talk shows (L6: every voiced micro-utterance is captioned): the live caption line on a stage (Talk,
// a desk) in the lighter "reaction" style, and bubbles next to a face (Floor cards, the Talk header in text mode).
// Nothing here is announced live (EXPERIENCE §9.2): bubbles are reachable in the Directory row instead.
// Light on purpose: signals and timers only, so components render captions without loading the runtime.
import { signal } from '@preact/signals';

export type CaptionKind = 'reaction' | 'line';
export type BubbleKind = 'bubble' | 'sidetalk';

export interface LiveCaption {
  id: number;
  agentId: string;
  text: string;
  kind: CaptionKind;
  gloss?: string;
}

export interface Bubble {
  id: number;
  agentId: string;
  text: string;
  kind: BubbleKind;
  /** A passing-by line can be answered in place (R, or the Reply button). */
  replyable: boolean;
  gloss?: string;
  threadId?: string;
  toAgentId?: string;
  shownAt: number;
  /** A quiet name card (who they are and where), shown when a rest on someone gets no line: never something they said. */
  card?: boolean;
}

export interface CaptionLogEntry {
  at: number;
  agentId: string;
  text: string;
  /** `smalltalk`: office small talk, logged only. */
  kind: CaptionKind | BubbleKind | 'smalltalk';
}

export interface ShowCaption {
  agentId: string;
  text: string;
  kind: CaptionKind | BubbleKind;
  ttlMs: number;
  replyable: boolean;
  gloss?: string;
  threadId?: string;
  toAgentId?: string;
  /** The reflex intent, when a reflex shows it: only Floor-meaningful ones become what the agent "last said". */
  intent?: string;
  /** A name card, not a line (see Bubble.card). */
  card?: boolean;
}

/** A bubble stays this long after the pointer or focus leaves it (LIVING-WORKFORCE §8.2). */
export const BUBBLE_HOLD_AFTER_MS = 3000;
/** A bubble cleared by its answer (a "one sec" when the first word arrives) stays at least this long: never a flicker. */
export const BUBBLE_MIN_VISIBLE_MS = 900;
/**
 * What the Directory row reads out as an agent's last words (§9.4): what they said on the Floor or about their work.
 * Backchannels, acknowledgements and fillers are not something they "said" minutes later.
 */
export const SAID_INTENTS: ReadonlySet<string> = new Set(['passing_by', 'micro_status', 'greeting', 'celebrate', 'quip', 'blocked', 'unblocked', 'oops', 'sign_off', 'gratitude_reply']);
const LOG_MAX = 200;

/** The live caption line per agent (Talk, desk). */
export const liveCaptions = signal<Record<string, LiveCaption>>({});
/** The bubble next to each agent's face. */
export const bubbles = signal<Record<string, Bubble>>({});
/** The last line each agent said in a bubble: the Directory row exposes it to assistive tech. */
export const lastSaid = signal<Record<string, string>>({});
/** Every caption and bubble shown, newest last (dev hook and the L6 checks). */
export const captionLog: CaptionLogEntry[] = [];

let seq = 0;
const captionTimers = new Map<string, ReturnType<typeof setTimeout>>();
const bubbleTimers = new Map<string, ReturnType<typeof setTimeout>>();
const bubbleUntil = new Map<string, number>();
/** Bubbles held open (hovered, focused, or a reply field open): they never expire while held. */
const held = new Set<string>();

function log(e: Omit<CaptionLogEntry, 'at'>): void {
  captionLog.push({ ...e, at: Date.now() });
  if (captionLog.length > LOG_MAX) captionLog.splice(0, captionLog.length - LOG_MAX);
}

function without<T>(rec: Record<string, T>, key: string): Record<string, T> {
  if (!(key in rec)) return rec;
  const next = { ...rec };
  delete next[key];
  return next;
}

function armBubbleExpiry(agentId: string): void {
  clearTimeout(bubbleTimers.get(agentId));
  bubbleTimers.delete(agentId);
  if (held.has(agentId)) return;
  const until = bubbleUntil.get(agentId);
  if (until === undefined) return;
  const id = bubbles.peek()[agentId]?.id;
  bubbleTimers.set(
    agentId,
    setTimeout(() => {
      bubbleTimers.delete(agentId);
      if (bubbles.peek()[agentId]?.id === id) dismissBubble(agentId);
    }, Math.max(0, until - Date.now())),
  );
}

/** The caption port's show(): a caption line or a bubble, for its TTL. */
export function showCaption(c: ShowCaption): void {
  const text = c.text.trim();
  if (!text) return;
  log({ agentId: c.agentId, text, kind: c.kind });
  const id = ++seq;
  if (c.kind === 'reaction' || c.kind === 'line') {
    liveCaptions.value = { ...liveCaptions.peek(), [c.agentId]: { id, agentId: c.agentId, text, kind: c.kind, ...(c.gloss ? { gloss: c.gloss } : {}) } };
    clearTimeout(captionTimers.get(c.agentId));
    captionTimers.set(
      c.agentId,
      setTimeout(() => {
        captionTimers.delete(c.agentId);
        if (liveCaptions.peek()[c.agentId]?.id === id) liveCaptions.value = without(liveCaptions.peek(), c.agentId);
      }, Math.max(0, c.ttlMs)),
    );
    return;
  }
  const bubble: Bubble = {
    id,
    agentId: c.agentId,
    text,
    kind: c.kind,
    replyable: c.replyable,
    shownAt: Date.now(),
    ...(c.gloss ? { gloss: c.gloss } : {}),
    ...(c.threadId ? { threadId: c.threadId } : {}),
    ...(c.toAgentId ? { toAgentId: c.toAgentId } : {}),
    ...(c.card ? { card: true } : {}),
  };
  bubbles.value = { ...bubbles.peek(), [c.agentId]: bubble };
  if (!c.card && (c.kind === 'sidetalk' || (c.intent !== undefined && SAID_INTENTS.has(c.intent)))) lastSaid.value = { ...lastSaid.peek(), [c.agentId]: text };
  bubbleUntil.set(c.agentId, Date.now() + Math.max(0, c.ttlMs));
  armBubbleExpiry(c.agentId);
}

/**
 * Office small talk for the caption log only: never a live caption, a bubble, what someone
 * "last said", or a live region. Small talk is non-factual by design, so nothing lives only here.
 */
export function logCaption(e: { agentId: string; text: string; kind: 'smalltalk' }): void {
  const text = e.text.trim();
  if (text) log({ agentId: e.agentId, text, kind: e.kind });
}

/** The caption port's clear(). */
export function clearCaption(agentId: string, kind?: CaptionKind | BubbleKind): void {
  if (!kind || kind === 'reaction' || kind === 'line') {
    const cur = liveCaptions.peek()[agentId];
    if (cur && (!kind || cur.kind === kind)) liveCaptions.value = without(liveCaptions.peek(), agentId);
  }
  if (!kind || kind === 'bubble' || kind === 'sidetalk') {
    const cur = bubbles.peek()[agentId];
    if (!cur || (kind && cur.kind !== kind) || held.has(agentId)) return;
    // Just shown: it stays out its minimum, then gives way (the answer is already under it).
    const left = cur.shownAt + BUBBLE_MIN_VISIBLE_MS - Date.now();
    if (left <= 0) return dismissBubble(agentId);
    bubbleUntil.set(agentId, Date.now() + left);
    armBubbleExpiry(agentId);
  }
}

/**
 * Keep a bubble open while it is hovered, focused or being replied to; on release it stays
 * BUBBLE_HOLD_AFTER_MS more (or until its own TTL, whichever is later).
 */
export function holdBubble(agentId: string, on: boolean): void {
  if (on) {
    held.add(agentId);
    clearTimeout(bubbleTimers.get(agentId));
    bubbleTimers.delete(agentId);
    return;
  }
  if (!held.delete(agentId)) return;
  if (!bubbles.peek()[agentId]) return;
  bubbleUntil.set(agentId, Math.max(bubbleUntil.get(agentId) ?? 0, Date.now() + BUBBLE_HOLD_AFTER_MS));
  armBubbleExpiry(agentId);
}

/**
 * Open a bubble for a conversation the owner started in place (Reply on a card with no line showing): it holds
 * the side-thread's answer and follows the same hold and expiry rules.
 */
export function openReplyBubble(agentId: string): void {
  if (bubbles.peek()[agentId]) return;
  bubbles.value = { ...bubbles.peek(), [agentId]: { id: ++seq, agentId, text: '', kind: 'bubble', replyable: true, shownAt: Date.now() } };
  bubbleUntil.set(agentId, Date.now() + BUBBLE_HOLD_AFTER_MS);
  armBubbleExpiry(agentId);
}

/** Esc, or the bubble's time is up. */
export function dismissBubble(agentId: string): void {
  clearTimeout(bubbleTimers.get(agentId));
  bubbleTimers.delete(agentId);
  bubbleUntil.delete(agentId);
  held.delete(agentId);
  if (bubbles.peek()[agentId]) bubbles.value = without(bubbles.peek(), agentId);
}

/** Tests: forget everything. */
export function resetCaptions(): void {
  for (const t of [...captionTimers.values(), ...bubbleTimers.values()]) clearTimeout(t);
  captionTimers.clear();
  bubbleTimers.clear();
  bubbleUntil.clear();
  held.clear();
  liveCaptions.value = {};
  bubbles.value = {};
  lastSaid.value = {};
  captionLog.length = 0;
}
