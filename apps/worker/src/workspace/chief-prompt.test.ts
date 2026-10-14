import { catalogFull, fullIndex } from '@headcount/catalog/full';
import type { JobSnapshot } from '@headcount/protocol';
import { describe, expect, it } from 'vitest';
import { describeJob, statusSentence, titleFromRequest, workStateBlock } from '../jobs/job-view';
import { buildChiefSystemPrompt, honestyPolicyText } from './chief-prompt';
import { historyFromFrames } from './talk';

const lead = catalogFull.leads.find((l) => l.id === 'lead-warm-mentor') ?? catalogFull.leads[0]!;

function job(over: Partial<JobSnapshot> = {}): JobSnapshot {
  return {
    jobId: 'job_01',
    projectId: 'everyday',
    title: 'Office chairs',
    brief: 'look into office chairs',
    status: 'running',
    label: 'Comparing warranties',
    step: 3,
    of: 5,
    agentId: 'cw_chief',
    startedAt: '2026-09-28T10:00:00Z',
    updatedAt: '2026-09-28T10:01:00Z',
    steers: [],
    ...over,
  };
}

describe('buildChiefSystemPrompt', () => {
  it('layers platform rules, the catalog lead, the role and the live work state', () => {
    const prompt = buildChiefSystemPrompt({
      lead,
      chiefName: 'Rosa',
      voiceOn: true,
      jobs: [job({ partial: 'Steelcase has a 12-year warranty.', steers: [{ steerId: 'steer_1', text: 'also check delivery times', status: 'queued', at: '' }] })],
      honestyPolicy: honestyPolicyText(catalogFull.honestyPolicy),
      now: new Date('2026-09-28T10:00:00Z'),
    });
    expect(prompt.indexOf('Platform rules')).toBeLessThan(prompt.indexOf('You are Rosa'));
    expect(prompt).toContain('The owner chose the name Rosa');
    expect(prompt).toContain(lead.tagline);
    expect(prompt).toContain(lead.personality.temperament);
    expect(prompt).toContain(lead.communication.greeting);
    expect(prompt).toContain(lead.backstory.slice(0, 80));
    expect(prompt).toContain(lead.origin_moments[0]!.title);
    expect(prompt).toContain(lead.relatability_hooks[0]!.owner_kind);
    expect(prompt).toContain(lead.operating_principles[0]!);
    expect(prompt).toContain(lead.guardrails[0]!);
    expect(prompt).toContain(lead.honesty_note);
    expect(prompt).toContain('Write for the ear');
    // The live work state comes last (after the stable persona prefix).
    const state = prompt.indexOf('LIVE WORK STATE (');
    expect(state).toBeGreaterThan(prompt.indexOf(lead.honesty_note));
    expect(prompt.slice(state)).toContain('[job_01] “Office chairs”: running, step 3 of 5, 40% done; now: Comparing warranties');
    expect(prompt.slice(state)).toContain('latest finding: Steelcase has a 12-year warranty.');
    expect(prompt.slice(state)).toContain('pending steering (applies at the next checkpoint): “also check delivery times”');
    if (honestyPolicyText(catalogFull.honestyPolicy)) expect(prompt).toContain('Catalog honesty policy');
  });

  it('uses the lead first name when not renamed, and a neutral persona before onboarding', () => {
    const p = buildChiefSystemPrompt({ lead, chiefName: null, voiceOn: false, jobs: [], now: new Date() });
    expect(p).toContain(`Your full name is ${lead.name}`);
    expect(p).toContain('No background jobs are running.');
    expect(p).not.toContain('Write for the ear');
    const neutral = buildChiefSystemPrompt({ lead: undefined, chiefName: null, voiceOn: false, jobs: null, now: new Date() });
    expect(neutral).toContain('You are Chief of Staff');
    expect(neutral).toContain('LIVE WORK STATE: unavailable');
  });

  it('builds a prompt for every catalog lead', () => {
    for (const l of catalogFull.leads) {
      const p = buildChiefSystemPrompt({ lead: fullIndex.lead(l.id), chiefName: null, voiceOn: true, jobs: [], now: new Date() });
      expect(p).toContain(l.tagline);
      expect(p.length).toBeLessThan(40_000);
    }
  });
});

describe('job views', () => {
  it('describes running, finished and failed jobs from state', () => {
    expect(describeJob(job({ partial: 'Found three models.' }))).toBe('“Office chairs” is running, step 3 of 5 (40%): comparing warranties. Latest: Found three models.');
    expect(describeJob(job({ status: 'done', summary: 'Buy the Aeron. It lasts.' }))).toBe('“Office chairs” is done. Buy the Aeron.');
    expect(describeJob(job({ status: 'failed', error: { code: 'provider_error', message: 'The model kept failing.' } }))).toBe('“Office chairs” failed: The model kept failing.');
    expect(describeJob(job({ step: 1, of: null, label: 'Making a plan' }))).toContain('planning');
    expect(statusSentence([])).toContain('Nothing is running');
    expect(statusSentence([job({ status: 'done', summary: 'All set.' })])).toBe('Nothing is running right now. “Office chairs” is done. All set.');
  });

  it('lists recently finished jobs in the work state block', () => {
    const block = workStateBlock([job({ jobId: 'job_02', status: 'done', summary: 'Buy the Aeron.' })]);
    expect(block).toContain('No background jobs are running.');
    expect(block).toContain('[job_02] “Office chairs”: done: Buy the Aeron.');
  });

  it('derives a short job title from the request', () => {
    expect(titleFromRequest('Can you look into office chairs under $500 for me?')).toBe('Office chairs under $500');
    expect(titleFromRequest('research coffee roasters in Portland')).toBe('Coffee roasters in Portland');
    expect(titleFromRequest('   ')).toBe('Background job');
  });
});

describe('historyFromFrames', () => {
  const owner = (text: string) => ({ v: 1, streamId: 'ws:local', seq: 1, ts: '', type: 'talk.owner', data: { turnId: 'turn_1', messageId: 'msg_1', text, via: 'text' } }) as const;
  const chief = (text: string, kind: 'reply' | 'announcement' = 'reply') => ({ v: 1, streamId: 'ws:local', seq: 2, ts: '', type: 'talk.message', data: { turnId: null, messageId: 'msg_2', agentId: 'cw_chief', text, kind } }) as const;

  it('alternates roles, merges bursts and starts with the owner', () => {
    const h = historyFromFrames([chief('Morning.', 'announcement'), owner('look into chairs'), owner('under $500'), chief('On it.'), owner('thanks')]);
    expect(h).toEqual([
      { role: 'user', content: 'look into chairs\n\nunder $500' },
      { role: 'assistant', content: 'On it.' },
      { role: 'user', content: 'thanks' },
    ]);
  });

  it('places a pre-empted reply after its own owner message, so the newest owner message comes last', () => {
    const o = (turnId: `turn_${string}`, text: string) => ({ v: 1, streamId: 'ws:local', seq: 1, ts: '', type: 'talk.owner', data: { turnId, messageId: 'msg_o', text, via: 'text' } }) as const;
    const r = (turnId: `turn_${string}` | null, text: string) => ({ v: 1, streamId: 'ws:local', seq: 2, ts: '', type: 'talk.message', data: { turnId, messageId: 'msg_r', agentId: 'cw_chief', text, kind: turnId ? 'reply' : 'announcement' } }) as const;
    const h = historyFromFrames([o('turn_a', 'tell me a story'), o('turn_b', 'look into desks'), r('turn_a', 'Once upon'), r(null, 'Chairs are done.'), r('turn_b', 'On it.')]);
    expect(h).toEqual([
      { role: 'user', content: 'tell me a story' },
      { role: 'assistant', content: 'Once upon' },
      { role: 'user', content: 'look into desks' },
      { role: 'assistant', content: 'On it.\n\nChairs are done.' },
    ]);
  });

  it('keeps the newest messages within the budget', () => {
    const h = historyFromFrames([owner('a'.repeat(50)), chief('b'.repeat(50)), owner('c'.repeat(50))], 110);
    expect(h).toEqual([
      { role: 'user', content: 'c'.repeat(50) },
    ]);
  });
});
