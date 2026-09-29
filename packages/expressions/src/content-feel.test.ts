// The live catalog/expressions content, held to the Inc 0.5 feel review: fillers that fit the owner's tone and the
// kind of turn, listener sounds that stay low, goodbyes without pressure, idle desks that do not chorus for work,
// and a Chief of Staff whose "let me think" does not collapse into two alternating lines.
import { describe, expect, it } from 'vitest';
import { loadExpressionSources } from '../scripts/load-expressions.mjs';
import { sniffOwnerText } from './affect';
import { buildAgentIndex, compileCatalogLenient } from './catalog';
import { planPrevoice } from './prevoice';
import { createRecencyMemory } from './recency';
import { recordUtterance, selectLine } from './select';
import { makeState, T0 } from './testing';
import type { AgentExpressionProfile, AffectCues, ClipAvailability, CompiledCatalog, LineDef } from './types';
import type { IntentId } from './vocab';

const { input } = loadExpressionSources();
const catalog: CompiledCatalog = compileCatalogLenient(input).catalog;

/** Every raw line of an intent, with where it lives (archetype packs, signature packs and their catchphrases). */
function rawLines(intent: IntentId): { where: string; line: LineDef }[] {
  const out: { where: string; line: LineDef }[] = [];
  for (const p of input.packs) for (const l of p.intents[intent] ?? []) out.push({ where: p.id, line: l });
  for (const f of input.signatures) {
    for (const p of f.packs) {
      for (const l of p.lines[intent] ?? []) out.push({ where: p.persona_id, line: l });
      for (const c of p.catchphrases ?? []) if (c.intents.includes(intent)) out.push({ where: p.persona_id, line: c });
    }
  }
  return out;
}

/** Enthusiastic or evaluative filler wording: fine for a question, wrong for a complaint or a joke. */
const UPBEAT = /!|\b(ooh+|fun|puzzle|love|favou?rite|juicy|delicious|exciting|excited|brilliant|interesting|good one|good question|great question|i like (this|that|it))\b/i;

function leadProfile(leadId: string): AgentExpressionProfile {
  return {
    agentId: 'cw_chief', personaId: leadId, firstName: 'Frankie', teamRole: 'chief',
    personality: { sliders: { warmth: 70, directness: 55, formality: 35, humor: 75, risk_appetite: 55, detail: 50, pace: 65 }, traits: [], leadId },
    voice: { xai: 'eve', openai: 'alloy', speed: 1 },
  };
}

const leadIds = input.signatures.flatMap((f) => f.packs.map((p) => p.persona_id)).filter((id) => id.startsWith('lead-'));
const cuesOf = (text: string): AffectCues => sniffOwnerText(text, catalog.lexicon);

describe('fillers fit the owner and the turn (feel review)', () => {
  it('every upbeat or evaluative filler forbids a negative owner tone and the distress lock', () => {
    const bad: string[] = [];
    for (const intent of ['thinking_filler', 'holding_filler'] as const) {
      for (const { line } of rawLines(intent)) {
        if (!UPBEAT.test(line.text)) continue;
        const ctx = line.context ?? [];
        if (!ctx.includes('!owner_tone:negative') || !ctx.includes('!after_distress')) bad.push(`${line.id}: ${line.text}`);
      }
    }
    expect(bad).toEqual([]);
  });

  it('upbeat thinking fillers need a question or a request (a joke or a complaint never gets "Ooh, a puzzle")', () => {
    const bad = rawLines('thinking_filler')
      .filter(({ line }) => !('intents' in line) && UPBEAT.test(line.text))
      .filter(({ line }) => !(line.context ?? []).some((c) => c === 'owner_asks' || c === 'owner_question'))
      .map(({ line }) => line.id);
    expect(bad).toEqual([]);
  });

  it('no lead ever answers bad news, frustration or the distress lock with an upbeat filler', () => {
    const complaint = cuesOf('Ugh. The website is down again and I think I lost three orders');
    const question = cuesOf('Can you look at why the website keeps going down?');
    const picks: string[] = [];
    for (const leadId of leadIds) {
      const index = buildAgentIndex(catalog, leadProfile(leadId));
      const recency = createRecencyMemory();
      for (let i = 0; i < 30; i++) {
        const distressed = i % 2 === 1;
        const cues = distressed ? question : complaint;
        const state = makeState(index.agentId, 'Frankie', {
          exchange: { mode: 'voice', cues },
          history: { distressThisSession: distressed },
        });
        const r = selectLine(index, { intent: 'thinking_filler', state, mood: { valence: 0.3, energy: 0.2 }, ambience: 'lively', provider: 'xai', seed: `${leadId}|${i}`, now: T0 + i * 60_000, channel: 'voice' }, recency);
        if (r.ok) {
          recordUtterance(recency, index, r.utterance, T0 + i * 60_000, '2026-09-29');
          if (UPBEAT.test(r.utterance.caption)) picks.push(`${leadId}: ${r.utterance.caption}`);
        }
      }
    }
    expect(picks).toEqual([]);
  });

  it('listener sounds stay low: no "!" and no upbeat words in any backchannel (they play mid-complaint too)', () => {
    const bad = rawLines('backchannel')
      .filter(({ line }) => /!|\b(ooh+|nice|ha|haha|love|lovely|great|wow|cool|fun|yay|brilliant|amazing|awesome|excellent)\b/i.test(line.text) || (line.mood?.energy ?? 0) > 0.4)
      .map(({ line }) => `${line.id}: ${line.text}`);
    expect(bad).toEqual([]);
  });

  it('goodbyes put no pressure on the owner (H7)', () => {
    const bad = rawLines('sign_off')
      .filter(({ line }) => /\b(miss me|come back soon|don't forget (me|about me)|without me|lonely|don't leave)\b/i.test(line.text))
      .map(({ line }) => line.id);
    expect(bad).toEqual([]);
  });
});

describe('idle desks do not chorus for work (H7, E25)', () => {
  const AVAILABLE = /\b(free|available|ready when|ready to (jump|build|go|help)|pick me|happy to (help|take|look|dig)|glad to help|here if you need|here when you need|whenever you('re| are)? (ready|like|need)|send (me|something)|throw me|hand me|put me in|anything (i can|for me)|can i help|need (anything|me)|at your service|just say the word|take something|ask me anything|raring to go|what do you need)\b/i;

  it('every idle or unstaffed line that offers the owner availability is flagged solicits', () => {
    const bad = rawLines('passing_by')
      .filter(({ line }) => (line.context ?? []).some((c) => c === 'idle' || c === 'unstaffed'))
      .filter(({ line }) => AVAILABLE.test(line.text) && !line.solicits)
      .map(({ line }) => `${line.id}: ${line.text}`);
    expect(bad).toEqual([]);
  });

  it('unstaffed lines are mostly beats about the craft: no asking, few self-introductions, no "… yet" template', () => {
    const lines = rawLines('passing_by').filter(({ line }) => (line.context ?? []).includes('unstaffed'));
    expect(lines.length).toBeGreaterThanOrEqual(300);
    const soliciting = lines.filter(({ line }) => line.solicits || /\?\s*$/.test(line.text) && AVAILABLE.test(line.text));
    expect(soliciting.map(({ line }) => line.id)).toEqual([]);
    const intros = lines.filter(({ line }) => /\{self_name\}/.test(line.text));
    // A self-introduction is said once a week per coworker, then the beats take over.
    for (const { line } of intros) expect(line.max_per_week, line.id).toBe(1);
    expect(intros.length / lines.length).toBeLessThan(0.4);
    const yet = lines.filter(({ line }) => /\byet[.!]?$/i.test(line.text.trim()));
    expect(yet.length / lines.length).toBeLessThan(0.05);
    // Every coworker with a signature has at least two beats of its own besides the hello.
    const byPersona = new Map<string, number>();
    for (const { where, line } of lines) if (!/\{self_name\}/.test(line.text) && !input.packs.some((p) => p.id === where)) byPersona.set(where, (byPersona.get(where) ?? 0) + 1);
    for (const f of input.signatures) {
      for (const p of f.packs) {
        if (p.persona_id.startsWith('lead-')) continue;
        if (!(p.lines.passing_by ?? []).some((l) => (l.context ?? []).includes('unstaffed'))) continue;
        expect(byPersona.get(p.persona_id) ?? 0, p.persona_id).toBeGreaterThanOrEqual(2);
      }
    }
  });
});

describe("the Chief's thinking fillers rotate (feel review bar)", () => {
  it('pre-voicing P0 with every thinking filler: no filler more than twice in 30 minutes of client and server picks', async () => {
    for (const leadId of leadIds) {
      const index = buildAgentIndex(catalog, leadProfile(leadId));
      const items = await planPrevoice(index, catalog, 'mock', { self_name: 'Frankie' }, { tiers: ['p0'], allLinesFor: ['thinking_filler'] });
      const decoded = new Map(items.map((i) => [`${i.lineId}|${i.fillKey}`, i.clipKey]));
      const keys = new Set(decoded.values());
      const clips: ClipAvailability = { has: (k) => keys.has(k), durationMs: () => 1600, pronunciationChecked: () => false };
      // One memory: the client records the server's frames and the server merges the client's picks (expr.recent).
      const recency = createRecencyMemory();
      const counts = new Map<string, number>();
      const turns = ['What do you think about a candle subscription box?', 'How should I price the gift sets?', 'Is the Friday market worth it?', 'What would you cut first?', 'Could we sell to hotels?', 'Which supplier looks better to you?', 'How long does a website redesign usually take?', 'What is a good first hire?', 'Why are the jar costs up?', 'Should I run a sale in October?', 'Where do my orders come from?'];
      turns.forEach((text, i) => {
        const now = T0 + i * 165_000; // eleven fillers in about 30 minutes
        const state = makeState(index.agentId, 'Frankie', { exchange: { mode: 'voice', cues: cuesOf(text) } });
        const r = selectLine(index, {
          intent: 'thinking_filler', state, mood: { valence: 0.3, energy: 0.2 }, ambience: 'lively', provider: 'mock', seed: `cw_chief|thinking_filler|turn_${i}`, now, channel: 'voice',
          instantOnly: true, clips, clipKeyOf: (lineId, fk) => decoded.get(`${lineId}|${fk}`), maxDurationMs: 2600,
        }, recency);
        expect(r.ok, `${leadId} turn ${i}`).toBe(true);
        if (!r.ok) return;
        recordUtterance(recency, index, r.utterance, now, '2026-09-29');
        counts.set(r.utterance.caption, (counts.get(r.utterance.caption) ?? 0) + 1);
      });
      const worst = Math.max(...counts.values());
      expect(worst, `${leadId}: ${JSON.stringify([...counts])}`).toBeLessThanOrEqual(2);
      expect(counts.size, leadId).toBeGreaterThanOrEqual(6);
    }
  });

  it('a line just said as an acknowledgement is never the next filler (cross-intent text exclusion)', () => {
    const index = buildAgentIndex(catalog, leadProfile('lead-playful-creative'));
    const recency = createRecencyMemory();
    const cues = cuesOf('Can you sketch me three ideas for the candle launch?');
    const state = makeState(index.agentId, 'Frankie', { exchange: { mode: 'voice', cues } });
    for (let i = 0; i < 40; i++) {
      const recent = createRecencyMemory();
      const ack = selectLine(index, { intent: 'acknowledge', state, mood: { valence: 0.4, energy: 0.3 }, ambience: 'lively', provider: 'xai', seed: `ack${i}`, now: T0, channel: 'voice' }, recent);
      if (!ack.ok) continue;
      recordUtterance(recent, index, ack.utterance, T0, '2026-09-29');
      const filler = selectLine(index, { intent: 'thinking_filler', state, mood: { valence: 0.4, energy: 0.3 }, ambience: 'lively', provider: 'xai', seed: `fill${i}`, now: T0 + 1300, channel: 'voice' }, recent);
      expect(filler.ok).toBe(true);
      if (filler.ok) expect(filler.utterance.caption).not.toBe(ack.utterance.caption);
    }
    expect(recency.recent(index.agentId)).toEqual([]);
  });
});
