import { fullIndex } from '@headcount/catalog/full';
import type { ChatProvider, ChatRequest, ModelEvent } from '@headcount/models';
import { describe, expect, it } from 'vitest';
import { acceptVoiced, composeAnnouncement, templateAnnouncement, type AnnouncementFacts } from './announce';

const done: AnnouncementFacts = { kind: 'done', title: 'Office chairs under $500', summary: 'Buy the Steelcase Series 1 at about $415; the Branch Ergonomic is the budget pick.' };
const failed: AnnouncementFacts = { kind: 'failed', title: 'Office chairs', reason: 'The model kept failing, so I stopped retrying. Try again in a minute, or check the provider key.' };

/** A cloud chat provider that answers with `text` after `delayMs` (or with `events`). */
function fast(opts: { text?: string; delayMs?: number; events?: ModelEvent[]; kind?: ChatProvider['kind'] } = {}): ChatProvider & { requests: ChatRequest[] } {
  const requests: ChatRequest[] = [];
  return {
    id: 'anthropic',
    kind: opts.kind ?? 'cloud',
    family: 'claude',
    requests,
    defaultModel: () => 'claude-sonnet-5',
    async *chat(req) {
      requests.push(req);
      if (opts.delayMs) {
        await new Promise<void>((resolve) => {
          const t = setTimeout(resolve, opts.delayMs);
          req.signal?.addEventListener('abort', () => (clearTimeout(t), resolve()));
        });
        if (req.signal?.aborted) {
          yield { type: 'done', finish: 'cancelled' };
          return;
        }
      }
      for (const e of opts.events ?? [{ type: 'text', delta: opts.text ?? '' }, { type: 'done', finish: 'stop' }]) yield e as ModelEvent;
    },
  };
}

const compose = (provider: ChatProvider, facts: AnnouncementFacts, timeoutMs = 200) =>
  composeAnnouncement({ provider, model: 'claude-sonnet-5', lead: fullIndex.lead('lead-steady-operator'), chiefName: 'Rosa', facts, timeoutMs });

describe('announcement templates', () => {
  it('names the job once, including a failure whose reason already does', () => {
    expect(templateAnnouncement(done)).toBe('“Office chairs under $500” is done. Buy the Steelcase Series 1 at about $415; the Branch Ergonomic is the budget pick. The full write-up is in Projects.');
    const text = templateAnnouncement(failed);
    expect(text).toBe('I could not finish “Office chairs”. The model kept failing, so I stopped retrying. Try again in a minute, or check the provider key.');
    expect(text.match(/I could not finish/g)).toHaveLength(1);
    // A reason written before this fix (it repeats the opener) is not doubled either.
    const old = templateAnnouncement({ ...failed, reason: 'I could not finish “Office chairs” because the model kept failing. Try again in a minute.' });
    expect(old.match(/I could not finish/g)).toHaveLength(1);
    expect(templateAnnouncement({ kind: 'stopped', title: 'Office chairs' })).toContain('Stopped “Office chairs”.');
  });
});

describe('voiced announcements', () => {
  it("phrases the result in the lead's voice from the fast model, grounded only in the job result", async () => {
    const p = fast({ text: 'Copy that, Rosa here: office chairs are sorted. Steelcase Series 1 at about $415, Branch as the budget pick. The full write-up is in Projects.' });
    const r = await compose(p, done);
    expect(r).toMatchObject({ source: 'model', text: 'Copy that, Rosa here: office chairs are sorted. Steelcase Series 1 at about $415, Branch as the budget pick. The full write-up is in Projects.' });
    const req = p.requests[0]!;
    expect(req.system).toContain('You are Rosa');
    expect(req.system).toContain('Use only the facts inside <job_result>');
    expect(req.messages).toEqual([{ role: 'user', content: expect.stringContaining('Answer (summary of the write-up): Buy the Steelcase Series 1') }]);
    // Fast and short: thinking off where the model allows it.
    expect(req.reasoningEffort).toBe('none');
  });

  it('falls back to the template when the model is slow, fails, or is not a cloud model', async () => {
    const slow = await compose(fast({ text: 'Too late.', delayMs: 1000 }), done, 50);
    expect(slow).toMatchObject({ source: 'template', fallback: 'timeout', text: templateAnnouncement(done) });
    expect(slow.ms).toBeLessThan(900);
    const broken = await compose(fast({ events: [{ type: 'error', message: 'Anthropic: overloaded', retryable: true }] }), failed);
    expect(broken).toMatchObject({ source: 'template', fallback: 'error', text: templateAnnouncement(failed) });
    const cut = await compose(fast({ events: [{ type: 'text', delta: 'Office chairs are' }, { type: 'done', finish: 'length' }] }), done);
    expect(cut.fallback).toBe('error');
    const local = fast({ text: 'Hi', kind: 'local' });
    expect(await compose(local, done)).toMatchObject({ source: 'template', fallback: 'not_cloud' });
    expect(local.requests).toHaveLength(0);
  });

  it('rejects ungrounded or unspeakable lines', () => {
    // A number that is not in the result (an invented price) → template.
    expect(acceptVoiced('Office chairs are done: the Steelcase at $389 wins. The write-up is in Projects.', done)).toBeNull();
    // Numbers from the result are fine, with or without thousands separators.
    expect(acceptVoiced('Done: Steelcase Series 1 for about $415. It is in Projects.', done)).toBe('Done: Steelcase Series 1 for about $415. It is in Projects.');
    expect(acceptVoiced('**Done.** See Projects.', done)).toBeNull();
    expect(acceptVoiced('Done, see https://example.com', done)).toBeNull();
    expect(acceptVoiced('x'.repeat(500), done)).toBeNull();
    expect(acceptVoiced('   ', done)).toBeNull();
    // A finished job always points to the write-up.
    expect(acceptVoiced('“Office chairs, done: go with the Steelcase Series 1.”', done)).toBe('Office chairs, done: go with the Steelcase Series 1. The full write-up is in Projects.');
    expect(acceptVoiced('Office chairs hit a wall: the model kept failing. Give it a minute and try again, or check the key.', failed)).toBe('Office chairs hit a wall: the model kept failing. Give it a minute and try again, or check the key.');
  });
});
