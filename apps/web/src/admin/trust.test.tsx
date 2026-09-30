// Inc 6 in the browser: an email waiting on a card (only the approvals it allows), a coworker's change for your OK,
// Admin → Autonomy (the dial, permissions, Everyone stop), the audit log with Undo, and an email's note in Talk.
import { ACTION_CLASSES, defaultPolicy, type AuditResponse, type TrustResponse } from '@headcount/protocol/ext/trust';
import type { Decision } from '@headcount/protocol/ext/projects';
import { render } from 'preact';
import { act } from 'preact/test-utils';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { slimIndex } from '@headcount/catalog/slim';
import { role } from '../auth/session';
import { catalog } from '../catalog';
import { DecisionCard } from '../components/DecisionCard';
import { Admin } from '../routes/Admin';
import { applyFrame, settings, sideThreads, thread, trustStop } from '../store';

type Call = { url: string; method: string; body: unknown };
let calls: Call[] = [];
let respond: (c: Call) => Response = () => json({});
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
let host: HTMLElement;
const flush = () => act(async () => void (await new Promise((r) => setTimeout(r, 0))));
const button = (text: string) => [...host.querySelectorAll('button')].find((b) => b.textContent?.trim().startsWith(text));

beforeEach(() => {
  calls = [];
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
  settings.value = { workspaceId: 'local', leadId: slimIndex.catalog.leads[0]!.id, chiefName: 'Eddie', voiceOn: false, updatedAt: '' };
  role.value = 'owner';
  trustStop.value = null;
});
afterEach(() => {
  render(null, host);
  host.remove();
  vi.unstubAllGlobals();
});

const emailDecision = (over: Partial<Decision> = {}): Decision => ({
  decisionId: 'dec_email0001',
  kind: 'effect',
  projectId: '',
  fromId: 'bookkeeper',
  title: 'Dana wants to send 2 emails',
  body: '',
  status: 'open',
  effect: {
    keys: ['eff_a', 'eff_b'],
    emails: [
      { key: 'eff_a', to: ['a@example.com'], subject: 'Your invoice', text: 'Hello A' },
      { key: 'eff_b', to: ['b@example.com'], subject: 'Your invoice', text: 'Hello B' },
    ],
    allowedGrants: ['once', 'day'],
  },
  createdAt: '2026-09-29T10:00:00Z',
  ...over,
});

const trust = (over: Partial<TrustResponse> = {}): TrustResponse => ({
  policy: defaultPolicy(),
  classes: ACTION_CLASSES,
  grants: [{ grantId: 'grt_1', actionClass: 'external_send', tool: 'email.send', kind: 'day', subject: 'cw_bookkeeper', expiresAt: '2026-09-30T10:00:00Z', createdAt: '2026-09-29T10:00:00Z', createdBy: 'owner', uses: 3, note: 'Dana wants to send 2 emails' }],
  email: { provider: 'sink', from: 'Test <t@headcount.invalid>', ready: true },
  stopped: null,
  effects: [],
  ...over,
});

describe('an email waiting for your OK', () => {
  it('shows every email; offers only the approvals it allows; sends with the one chosen', async () => {
    respond = () => json({ accepted: true, decision: { ...emailDecision(), status: 'approved' } }, 202);
    await act(() => render(<DecisionCard decision={emailDecision()} />, host));
    expect(host.querySelector('.decision-kind')?.textContent).toContain('Send email?');
    expect([...host.querySelectorAll('.decision-emails li')].map((li) => li.textContent)).toEqual([expect.stringContaining('To a@example.com'), expect.stringContaining('To b@example.com')]);
    const select = host.querySelector<HTMLSelectElement>('.decision-grant select')!;
    expect([...select.options].map((o) => o.value)).toEqual(['once', 'day']);
    await act(() => {
      select.value = 'day';
      select.dispatchEvent(new Event('change'));
    });
    await act(() => button('Send all 2')!.click());
    await flush();
    expect(calls.find((c) => c.method === 'POST')).toMatchObject({ url: '/api/decisions/dec_email0001', body: { action: 'approve', grant: 'day' } });
  });

  it('one email and no wider approvals: just Send it, no choice to make', async () => {
    const d = emailDecision({ effect: { keys: ['eff_a'], emails: [{ key: 'eff_a', to: ['a@example.com'], subject: 'Hi', text: 'Hello' }], allowedGrants: ['once'], unknown: true } });
    await act(() => render(<DecisionCard decision={d} />, host));
    expect(host.querySelector('.decision-grant')).toBeNull();
    expect(host.textContent).toContain('It is not certain whether this went out');
    expect(button('Send again')).toBeTruthy();
  });

  it('a change for your OK shows what is added', async () => {
    const d: Decision = { decisionId: 'dec_change001', kind: 'change', projectId: '', fromId: 'bookkeeper', title: 'Dana wants to change how they work', body: '', status: 'open', change: { change: 'instructions', target: 'bookkeeper', targetLabel: 'Dana Reyes', before: 'Be brief.', after: 'Be brief.\n\nAlways include VAT.', why: 'The owner asked for it.' }, createdAt: '' };
    await act(() => render(<DecisionCard decision={d} />, host));
    expect(host.querySelector('.decision-args')?.textContent).toBe('Always include VAT.');
    expect(button('Approve the change')).toBeTruthy();
  });
});

describe('Admin → Autonomy', () => {
  it('each kind of action with only its allowed levels; a change saved; a permission taken back', async () => {
    respond = (c) => (c.method === 'PUT' ? json({ policy: { ...defaultPolicy(), external_send: 'propose' } }) : c.method === 'DELETE' ? json({ revoked: true }) : json(trust()));
    await act(() => render(<Admin section="autonomy" />, host));
    await flush();
    const send = host.querySelector('#autonomy-external_send')!;
    expect([...send.querySelectorAll('[role=radio]')].map((b) => b.textContent)).toEqual(['Ask first', 'Propose']);
    expect(send.textContent).toContain('test mode');
    expect(host.querySelector('#autonomy-spend')?.textContent).toContain('No coworker can spend money.');
    expect(host.querySelector('#autonomy-spend [role=radio]')).toBeNull();
    await act(() => (send.querySelectorAll<HTMLButtonElement>('[role=radio]')[1]!).click());
    await flush();
    expect(calls.find((c) => c.method === 'PUT')).toMatchObject({ url: '/api/trust/autonomy', body: { actionClass: 'external_send', level: 'propose' } });
    expect(send.querySelector('[aria-checked=true]')?.textContent).toBe('Propose');
    expect(host.querySelector('#grt_1')?.textContent).toContain('may send email until');
    await act(() => button('Take back')!.click());
    await flush();
    expect(calls.find((c) => c.method === 'DELETE')?.url).toBe('/api/trust/grants/grt_1');
  });

  it('Everyone stop on: resume asks first', async () => {
    respond = (c) => (c.url === '/api/resume-all' ? json({ resumed: true }) : json(trust({ stopped: { at: '2026-09-29T10:00:00Z', by: 'owner' } })));
    await act(() => render(<Admin section="autonomy" />, host));
    await flush();
    expect(host.querySelector('#everyone-stop')?.textContent).toContain('emails are held');
    await act(() => button('Resume')!.click());
    await act(() => button('Yes, resume')!.click());
    await flush();
    expect(calls.some((c) => c.url === '/api/resume-all' && c.method === 'POST')).toBe(true);
  });
});

describe('Admin → Audit log', () => {
  it('entries at their own links, receipts, Undo once confirmed, and what cannot be undone says why', async () => {
    const page: AuditResponse = {
      entries: [
        { auditId: 'aud_0000000000000000000a', at: '2026-09-29T10:05:00Z', actor: 'cw_chief', kind: 'email', action: 'email.sent', summary: 'Eddie sent “Hi” to jo@example.com', receipt: { receiptId: 'rcp_1', key: 'eff_a', action: 'email.send', target: 'jo@example.com', payloadHash: 'abcdef0123456789abcdef', approvedBy: 'owner:owner', at: '2026-09-29T10:05:00Z', provider: 'sink', providerId: 'sink_1', undo: 'No undo: an email cannot be recalled.' }, undo: { can: false, label: 'No undo: an email cannot be recalled.' } },
        { auditId: 'aud_0000000000000000000b', at: '2026-09-29T10:00:00Z', actor: 'cw_chief', kind: 'change', action: 'handbook.updated', summary: 'Updated “Customers” in the Handbook', link: '/app/handbook?at=hb-customers', undo: { can: true, label: 'Restore the previous text' } },
      ],
    };
    respond = (c) => (c.method === 'POST' ? json({ undone: true }) : json(page));
    await act(() => render(<Admin section="audit" />, host));
    await flush();
    expect(host.querySelector('#rcp_1 .audit-receipt')?.textContent).toContain('the test mailbox');
    expect(host.querySelector('#rcp_1')?.textContent).toContain('No undo: an email cannot be recalled.');
    const entry = host.querySelector('#aud_0000000000000000000b')!;
    await act(() => [...entry.querySelectorAll('button')].find((b) => b.textContent === 'Undo')!.click());
    await act(() => [...entry.querySelectorAll('button')].find((b) => b.textContent === 'Restore the previous text')!.click());
    await flush();
    expect(calls.find((c) => c.method === 'POST')?.url).toBe('/api/audit/aud_0000000000000000000b/undo');
  });
});

describe('the feed', () => {
  it('an email that went out is a quiet line where it was asked for; Everyone stop is shown', () => {
    thread.value = [];
    const base = { v: 1, streamId: 'ws:local', ts: '2026-09-29T10:00:00Z' } as const;
    const effect = (agentId: string, seq: number) =>
      ({ ...base, seq, type: 'effect.updated', data: { effect: { key: `eff_${seq}`, tool: 'email.send', actionClass: 'external_send', status: 'done', agentId, email: { to: ['jo@example.com'], subject: 'Hi' , text: 'x' }, receipt: { receiptId: `rcp_${seq}`, provider: 'sink' }, createdAt: '', updatedAt: '' } } }) as never;
    applyFrame(effect('cw_chief', 1));
    expect(thread.value.at(-1)).toMatchObject({ kind: 'note', receiptId: 'rcp_1', text: expect.stringContaining('Sent “Hi” to jo@example.com (test mailbox') });
    applyFrame(effect('cw_bookkeeper', 2));
    expect(sideThreads.value['cw_bookkeeper']?.at(-1)).toMatchObject({ kind: 'note', receiptId: 'rcp_2' });
    applyFrame({ ...base, seq: 3, type: 'trust.updated', data: { stopped: { at: '2026-09-29T10:00:00Z', by: 'owner' } } } as never);
    expect(trustStop.value).toMatchObject({ by: 'owner' });
  });
});
