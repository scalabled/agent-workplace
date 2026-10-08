// The admin page's settings cache (admin/config.ts): a read started by one request (or a Durable Object's event) is
// shared, but never waited on for long. Its I/O belongs to whoever started it and stops when they finish, so it may
// never settle; one such read used to hold every later API request forever.
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { Env } from '../src/env';
import { LOAD_WAIT_MS, configured, loadConfig } from '../src/admin/config';

type Rows = { key: string; value: string; sealed: number; updated_at: string; updated_by: string }[];

/** A D1 stand-in: each read takes the next answer ('hang' never settles). */
function db(answers: ('hang' | Rows)[]) {
  let i = 0;
  return {
    prepare: () => ({
      bind: () => ({
        all: () => {
          const a = answers[Math.min(i++, answers.length - 1)]!;
          return a === 'hang' ? new Promise(() => undefined) : Promise.resolve({ results: a });
        },
      }),
    }),
  };
}

afterEach(() => vi.useRealTimers());

describe('settings cache', () => {
  it('a read that never settles holds nobody for more than a moment, and the next read replaces it', async () => {
    vi.useFakeTimers({ now: 1_000_000 });
    const rows: Rows = [{ key: 'CHAT_DAILY_LIMIT', value: '42', sealed: 0, updated_at: '2026-10-08T00:00:00Z', updated_by: 'test' }];
    const env = { DB: db(['hang', rows]), WORKSPACE_ID: 'local' } as unknown as Env;

    void loadConfig(env); // started by a request that went away: its read never settles
    let waited = false;
    const second = loadConfig(env).then(() => (waited = true));
    await vi.advanceTimersByTimeAsync(LOAD_WAIT_MS - 1);
    expect(waited).toBe(false);
    await vi.advanceTimersByTimeAsync(1);
    await second;
    expect(waited).toBe(true); // released, with the deployment's values

    // Past the bound, a fresh read starts and its values apply.
    await loadConfig(env);
    expect(configured(env).CHAT_DAILY_LIMIT).toBe('42');
  });
});
