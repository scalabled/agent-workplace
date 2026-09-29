// The Admin page: settings (with where each value comes from, saving and resetting), people and roles, usage.
import type { ConfigResponse, MembersResponse, UsageResponse } from '@headcount/protocol/ext/admin';
import { render } from 'preact';
import { act } from 'preact/test-utils';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { slimIndex } from '@headcount/catalog/slim';
import { role } from '../auth/session';
import { catalog } from '../catalog';
import { settings } from '../store';
import { Admin } from './Admin';

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
});
afterEach(() => {
  render(null, host);
  host.remove();
  vi.unstubAllGlobals();
});

const config = (over: Record<string, Partial<ConfigResponse['values'][number]>> = {}): ConfigResponse => ({
  canStoreKeys: true,
  values: [
    { key: 'CHAT_DAILY_LIMIT', value: '1500', source: 'default' },
    { key: 'JOB_DAILY_LIMIT', value: '60', source: 'default' },
    { key: 'OPENAI_API_KEY', value: '', source: 'deployment', set: true },
    { key: 'ANTHROPIC_API_KEY', value: '', source: 'default', set: false },
  ].map((v) => ({ ...v, ...over[v.key] })) as ConfigResponse['values'],
});

describe('Admin', () => {
  it('a settings section: values with their source, a change saved, a reset', async () => {
    respond = (c) => (c.method === 'PUT' ? json(config({ CHAT_DAILY_LIMIT: { value: '200', source: 'admin', updatedBy: 'olive@example.com' } })) : json(config()));
    await act(() => render(<Admin section="limits" />, host));
    await flush();
    const row = host.querySelector('#setting-CHAT_DAILY_LIMIT')!;
    expect(row.querySelector('.admin-option-label')?.textContent).toBe('Replies');
    expect(row.querySelector('.admin-option-source')?.textContent).toBe('Default');
    const input = row.querySelector<HTMLInputElement>('input')!;
    input.value = '200';
    await act(() => void input.dispatchEvent(new Event('input', { bubbles: true })));
    expect(row.getAttribute('data-changed')).toBe('true');
    await act(() => void host.querySelector<HTMLFormElement>('.admin-options')!.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true })));
    await flush();
    expect(calls.find((c) => c.method === 'PUT')).toMatchObject({ url: '/api/admin/config', body: { values: { CHAT_DAILY_LIMIT: '200' } } });
    expect(host.querySelector('#setting-CHAT_DAILY_LIMIT .admin-option-source')?.textContent).toBe('Changed here by olive@example.com · default 1500');
    await act(() => void button('Reset')!.click());
    await flush();
    expect(calls.at(-1)).toMatchObject({ method: 'PUT', body: { values: { CHAT_DAILY_LIMIT: null } } });
  });

  it('keys are write-only', async () => {
    respond = () => json(config());
    await act(() => render(<Admin section="keys" />, host));
    await flush();
    const openai = host.querySelector<HTMLInputElement>('#opt-OPENAI_API_KEY')!;
    expect(openai.type).toBe('password');
    expect(openai.value).toBe('');
    expect(openai.placeholder).toBe('Saved (hidden). Type to replace.');
    expect(host.querySelector<HTMLInputElement>('#opt-ANTHROPIC_API_KEY')!.placeholder).toBe('Not set');
  });

  it('people: invite, change a role, and the deployment’s owners stay fixed', async () => {
    const list = (extra: MembersResponse['members'] = []): MembersResponse => ({ signIn: true, members: [{ email: 'olive@example.com', role: 'owner', source: 'deployment' }, ...extra] });
    respond = (c) => (c.method === 'PUT' ? json(list([{ email: 'sam@example.com', role: 'reader', source: 'invited', addedAt: '2026-09-29T10:00:00Z' }])) : json(list()));
    await act(() => render(<Admin section="people" />, host));
    await flush();
    expect(host.querySelector('.admin-person .connector-tag')?.textContent).toBe('Owner');
    const email = host.querySelector<HTMLInputElement>('.admin-invite input')!;
    email.value = 'sam@example.com';
    await act(() => void email.dispatchEvent(new Event('input', { bubbles: true })));
    const as = host.querySelector<HTMLSelectElement>('.admin-invite select')!;
    as.value = 'reader';
    await act(() => void as.dispatchEvent(new Event('change', { bubbles: true })));
    await act(() => void host.querySelector<HTMLFormElement>('.admin-invite')!.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true })));
    await flush();
    expect(calls.find((c) => c.method === 'PUT')).toMatchObject({ url: '/api/admin/members/sam%40example.com', body: { role: 'reader' } });
    expect(host.querySelectorAll('.admin-person')).toHaveLength(2);
    expect(host.querySelector<HTMLSelectElement>('#role-sam\\@example\\.com')?.value).toBe('reader');
  });

  it('usage: totals, where it went, limits and prices', async () => {
    const row = (key: string, label: string, over: Partial<UsageResponse['total']> = {}) => ({ key, label, calls: 12, errors: 1, input: 48_000, output: 6_200, cached: 0, usd: null, priced: 0, avgMs: 1400, avgFirstMs: 420, ...over });
    const u: UsageResponse = {
      days: 7,
      since: '2026-09-23',
      total: row('total', 'Everything'),
      byDay: Array.from({ length: 7 }, (_, i) => ({ day: `2026-09-${23 + i}`, calls: i, input: i * 1000, output: i * 100, usd: null })),
      bySurface: [row('talk', 'Talk (Chief of Staff)')],
      byAgent: [row('cw_chief', 'Eddie')],
      byModel: [row('openai\u0000gpt-test\u0000chat', 'gpt-test · openai')],
      recent: [{ at: '2026-09-29T10:00:00Z', surface: 'talk', agentId: 'cw_chief', agentName: 'Eddie', provider: 'openai', model: 'gpt-test', capability: 'chat', input: 4000, output: 300, cached: 0, usd: null, ms: 1400, ok: true }],
      limits: [{ key: 'CHAT_DAILY_LIMIT', label: 'Replies', used: 12, limit: 1500 }],
      prices: [],
    };
    respond = (c) => (c.method === 'PUT' ? json({ prices: [{ provider: 'openai', model: 'gpt-test', input: 0, output: 0 }] }) : json(u));
    await act(() => render(<Admin section="usage" />, host));
    await flush();
    expect(calls[0]!.url).toBe('/api/admin/usage?days=7');
    const stats = [...host.querySelectorAll('.admin-stat')].map((s) => s.textContent);
    expect(stats).toEqual(['Model calls121 failed', 'Tokens in48k', 'Tokens out6.2k', 'Cost—set prices below', 'Average call1.4 sfirst words in 420 ms']);
    expect(host.querySelectorAll('.admin-bars li')).toHaveLength(7);
    expect(host.querySelector('#adm-surface')?.closest('section')?.querySelector('tbody th')?.textContent).toBe('Talk (Chief of Staff)');
    expect(host.querySelector('.admin-limits li')?.textContent).toContain('12 / 1,500');
    await act(() => void button('Price gpt-test')!.click());
    await act(() => void button('Save prices')!.click());
    await flush();
    expect(calls.at(-1)).toMatchObject({ url: '/api/admin/prices', method: 'PUT', body: { prices: [{ provider: 'openai', model: 'gpt-test', input: 0, output: 0 }] } });
  });

  it('is for owners only', async () => {
    role.value = 'contributor';
    await act(() => render(<Admin section="usage" />, host));
    expect(host.textContent).toContain('Only owners can change the office’s settings.');
    expect(calls).toHaveLength(0);
  });
});
