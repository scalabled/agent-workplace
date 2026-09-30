// Email for coworkers (Inc 6): a test mailbox inside Headcount ("sink": nothing leaves, for trying it safely) and real
// email through Resend. Every send carries the effect key as its idempotency key, so a retry after a crash never sends
// twice: the sink looks the key up; Resend keeps idempotency keys for 24 hours, so a retry within that window is safe
// and after it the outcome is unknown (the owner decides). ARCHITECTURE §6.6: reconcile, never blindly replay.
import type { EmailStatus, MailProvider } from '@headcount/protocol/ext/trust';
import type { Env } from '../env';

export interface OutgoingMail {
  from: string;
  to: string[];
  cc?: string[];
  replyTo?: string;
  subject: string;
  text: string;
}

/** After a crash: it went out (with the provider's id), it is safe to send again with the same key, or nobody can tell. */
export type Reconciled = { status: 'sent'; providerId: string } | { status: 'safe_retry' } | { status: 'unknown' };

export interface MailSender {
  provider: Exclude<MailProvider, 'none'>;
  /** Sends once per key: a repeat with the same key returns the first send's id. */
  send(key: string, mail: OutgoingMail): Promise<{ providerId: string }>;
  reconcile(key: string, firstAttemptAt: number, now: number): Promise<Reconciled>;
}

/** The provider said no (a bad address, an unverified sender): nothing went out, and retrying will not help. */
export class MailRefused extends Error {}
/** The provider could not be reached or failed: it may be retried with the same key. */
export class MailUnavailable extends Error {}

const ADDRESS_RE = /^[^\s@<>(),;:"]+@[^\s@<>(),;:"]+\.[^\s@<>(),;:"]+$/;
export const isEmailAddress = (s: string): boolean => ADDRESS_RE.test(s) && s.length <= 254;
/** The address inside "Name <address>", or the whole string. */
export const addressOf = (from: string): string => /<([^>]+)>\s*$/.exec(from)?.[1]?.trim() ?? from.trim();

const SINK_FROM = 'Headcount test mailbox <test-mailbox@headcount.invalid>';

export function mailStatus(env: Env): EmailStatus {
  const p = (env.MAIL_PROVIDER ?? '').trim().toLowerCase();
  if (p === 'sink') return { provider: 'sink', from: env.MAIL_FROM?.trim() || SINK_FROM, ready: true };
  if (p === 'resend') {
    const from = env.MAIL_FROM?.trim() || null;
    if (!env.RESEND_API_KEY?.trim()) return { provider: 'resend', from, ready: false, why: 'Add a Resend key on Admin → Email.' };
    if (!from || !isEmailAddress(addressOf(from))) return { provider: 'resend', from, ready: false, why: 'Set who emails come from on Admin → Email (a domain verified with Resend).' };
    return { provider: 'resend', from, ready: true };
  }
  return { provider: 'none', from: null, ready: false, why: 'Email is off. An owner can turn it on in Admin → Email (a test mailbox, or real email).' };
}

// ── the test mailbox ──────────────────────────────────────────────────────────────

export const SINK_SCHEMA = [`CREATE TABLE IF NOT EXISTS mail_sink (key TEXT PRIMARY KEY, provider_id TEXT NOT NULL, message TEXT NOT NULL, at TEXT NOT NULL)`];

export function sinkSender(sql: SqlStorage, now: () => number): MailSender {
  for (const s of SINK_SCHEMA) sql.exec(s);
  return {
    provider: 'sink',
    async send(key, mail) {
      const had = sql.exec<{ provider_id: string }>('SELECT provider_id FROM mail_sink WHERE key = ?', key).toArray()[0];
      if (had) return { providerId: had.provider_id };
      const providerId = `sink_${key.slice(-16)}`;
      sql.exec('INSERT INTO mail_sink (key, provider_id, message, at) VALUES (?, ?, ?, ?)', key, providerId, JSON.stringify(mail), new Date(now()).toISOString());
      return { providerId };
    },
    async reconcile(key) {
      const had = sql.exec<{ provider_id: string }>('SELECT provider_id FROM mail_sink WHERE key = ?', key).toArray()[0];
      // The mailbox is local and transactional: not there means it never went in.
      return had ? { status: 'sent', providerId: had.provider_id } : { status: 'safe_retry' };
    },
  };
}

export function sinkMessages(sql: SqlStorage, limit = 50): { key: string; at: string; mail: OutgoingMail }[] {
  for (const s of SINK_SCHEMA) sql.exec(s);
  return sql
    .exec<{ key: string; message: string; at: string }>('SELECT key, message, at FROM mail_sink ORDER BY at DESC LIMIT ?', limit)
    .toArray()
    .map((r) => ({ key: r.key, at: r.at, mail: JSON.parse(r.message) as OutgoingMail }));
}

// ── Resend ────────────────────────────────────────────────────────────────────────

const RESEND_URL = 'https://api.resend.com/emails';
/** Resend keeps idempotency keys for 24 hours; stay well inside it. */
export const RESEND_IDEMPOTENCY_MS = 23 * 3600_000;

export function resendSender(env: Env, fetchFn: typeof fetch = fetch): MailSender {
  return {
    provider: 'resend',
    async send(key, mail) {
      let res: Response;
      try {
        res = await fetchFn(RESEND_URL, {
          method: 'POST',
          headers: { authorization: `Bearer ${env.RESEND_API_KEY ?? ''}`, 'content-type': 'application/json', 'idempotency-key': key },
          body: JSON.stringify({
            from: mail.from,
            to: mail.to,
            ...(mail.cc?.length ? { cc: mail.cc } : {}),
            ...(mail.replyTo ? { reply_to: mail.replyTo } : {}),
            subject: mail.subject,
            text: mail.text,
            tags: [{ name: 'headcount_effect', value: key.replace(/[^A-Za-z0-9_-]/g, '_').slice(0, 256) }],
          }),
          signal: AbortSignal.timeout(20_000),
        });
      } catch {
        throw new MailUnavailable('Resend could not be reached.');
      }
      const body = (await res.json().catch(() => ({}))) as { id?: string; message?: string; name?: string };
      if (res.ok && body.id) return { providerId: body.id };
      // 409: the same key is already being processed, or was used with a different body; 429 and 5xx: try again later.
      if (res.status === 409 || res.status === 429 || res.status >= 500) throw new MailUnavailable(`Resend said: ${body.message ?? res.statusText}`);
      throw new MailRefused(`Resend refused it: ${body.message ?? res.statusText}`);
    },
    async reconcile(_key, firstAttemptAt, now) {
      // Within the idempotency window a send with the same key returns the first one's id instead of sending again.
      return now - firstAttemptAt < RESEND_IDEMPOTENCY_MS ? { status: 'safe_retry' } : { status: 'unknown' };
    },
  };
}

/** The sender email goes through now, or null when email is off or not set up. */
export function mailSender(env: Env, sql: SqlStorage, now: () => number, fetchFn?: typeof fetch): MailSender | null {
  const s = mailStatus(env);
  if (!s.ready) return null;
  return s.provider === 'sink' ? sinkSender(sql, now) : s.provider === 'resend' ? resendSender(env, fetchFn) : null;
}

/** Every email says who wrote it (PRODUCT §9.8: coworker email carries a disclosure line). */
export function withDisclosure(text: string, who: { agentName: string; ownerName?: string | null }): string {
  const line = `Sent by ${who.agentName}, an AI coworker${who.ownerName ? ` working with ${who.ownerName}` : ''}.`;
  return `${text.trim()}\n\n--\n${line}`;
}
