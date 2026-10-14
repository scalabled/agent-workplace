// Inc 6 on the Admin page:
// - Autonomy: how much each kind of action needs you (only the levels it allows), permissions you gave that are still
//   in force (take one back), emails waiting or held, and Everyone stop (resume it here).
// - Audit log: everything that happened, newest first, each at its own link; Undo where it can be undone.
// - Email (under the Email settings): the test mailbox, and a test email to yourself.
import { BRAND, CHIEF_ID } from '@headcount/protocol';
import { AUTONOMY_WORDS, type AuditEntry, type AuditKind, type Autonomy, type EffectView, type Grant, type TestMailbox, type TrustResponse } from '@headcount/protocol/ext/trust';
import { useEffect, useState } from 'preact/hooks';
import { api, ApiError } from '../api/client';
import { auth } from '../auth/session';
import { catalog } from '../catalog';
import { chiefName } from '../chief';
import { Link } from '../components/Link';
import { CopyLink } from '../links/CopyLink';
import { linkTo, paths, queryParam, setQuery } from '../router';
import { trustStop } from '../store';

const errorOf = (err: unknown, fallback: string) => (err instanceof ApiError ? err.message : fallback);
const myEmail = () => (auth.value.status === 'signed-in' ? auth.value.email : '');
const when = (at?: string) => (at ? new Date(at).toLocaleString(undefined, { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' }) : '');

/** An agent id, "owner:<email>" or "system", in words. */
export function actorName(actor: string): string {
  if (actor === CHIEF_ID || actor === 'chief') return chiefName.value;
  if (actor === 'system') return BRAND.name;
  if (actor === 'owner' || actor === 'owner:owner') return 'You';
  if (actor.startsWith('owner:')) {
    const who = actor.slice(6);
    return who === myEmail() ? 'You' : who;
  }
  const id = actor.startsWith('cw_') ? actor.slice(3) : actor;
  return catalog.value?.persona(id)?.name ?? id;
}

function grantLine(g: Grant): string {
  const who = g.subject === '*' ? 'Anyone' : actorName(g.subject).split(' ')[0];
  const what = g.tool === 'email.send' ? 'send email' : g.tool;
  const reach = g.kind === 'day' ? `until ${when(g.expiresAt)}` : g.kind === 'project' ? 'for the rest of a project' : 'for the rest of a task';
  return `${who} may ${what} ${reach}`;
}

export function AutonomySection() {
  const [data, setData] = useState<TrustResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [confirmResume, setConfirmResume] = useState(false);
  const load = () =>
    api
      .getTrust()
      .then((t) => {
        setData(t);
        trustStop.value = t.stopped;
      })
      .catch((err) => setError(errorOf(err, 'Could not load the autonomy settings. Reload the page to try again.')));
  useEffect(() => void load(), []);
  // Everyone stop can change from another page or tab.
  useEffect(() => {
    if (data && (trustStop.value?.at ?? null) !== (data.stopped?.at ?? null)) void load();
  }, [trustStop.value?.at]);

  const setLevel = async (actionClass: string, level: Autonomy) => {
    setBusy(actionClass);
    setError(null);
    try {
      const r = await api.putAutonomy({ actionClass: actionClass as TrustResponse['classes'][number]['id'], level });
      setData((d) => (d ? { ...d, policy: r.policy } : d));
    } catch (err) {
      setError(errorOf(err, 'Not changed. Try again.'));
    } finally {
      setBusy(null);
    }
  };
  const revoke = async (id: string) => {
    setBusy(id);
    try {
      await api.revokeGrant(id);
      await load();
    } catch (err) {
      setError(errorOf(err, 'It could not be taken back. Try again.'));
    } finally {
      setBusy(null);
    }
  };
  const resume = async () => {
    setBusy('resume');
    try {
      await api.resumeAll();
      setConfirmResume(false);
      await load();
    } catch (err) {
      setError(errorOf(err, 'Could not resume. Try again.'));
    } finally {
      setBusy(null);
    }
  };
  if (!data)
    return (
      <section class="panel admin-card">
        {error ? (
          <p class="form-error" role="alert">
            {error}
          </p>
        ) : (
          <p class="page-fine">Loading…</p>
        )}
      </section>
    );
  const waiting = data.effects;
  return (
    <>
      {data.stopped && (
        <section class="panel admin-card trust-stopped" id="everyone-stop" aria-labelledby="adm-stop" role="status">
          <h2 id="adm-stop" class="admin-card-title">
            Everyone stop is on
          </h2>
          <p class="page-fine">
            Since {when(data.stopped.at)}. All work halted, and emails are held: nothing goes out until you resume. Emails you already approved go out when you do; the rest ask you again.
          </p>
          {confirmResume ? (
            <div class="admin-row">
              <button type="button" class="button-primary" disabled={busy === 'resume'} onClick={() => void resume()}>
                Yes, resume
              </button>
              <button type="button" class="link-button" onClick={() => setConfirmResume(false)}>
                Keep everything stopped
              </button>
            </div>
          ) : (
            <button type="button" class="button-primary" onClick={() => setConfirmResume(true)}>
              Resume
            </button>
          )}
        </section>
      )}
      <section class="panel admin-card" aria-labelledby="adm-autonomy">
        <div class="page-title-row">
          <h2 id="adm-autonomy" class="admin-card-title">
            What your team may do on its own
          </h2>
          <CopyLink page={paths.admin('autonomy')} label="Copy link to autonomy" what="Link to these settings" />
        </div>
        <p class="page-fine">Pick a mode for each kind of action: ask first, prepare for your OK, or act and tell you. The audit log lists everything they do.</p>
        <ul class="trust-classes">
          {data.classes.map((c) => {
            const level = data.policy[c.id];
            return (
              <li key={c.id} class="trust-class" id={`autonomy-${c.id}`}>
                <div class="trust-class-head">
                  <p class="trust-class-name">{c.label}</p>
                  <CopyLink page={paths.admin('autonomy')} at={`autonomy-${c.id}`} label={`Copy link to ${c.label}`} what="Link to this setting" />
                </div>
                <p class="page-fine">{c.hint}</p>
                {c.allowed.length > 0 ? (
                  <>
                    <div class="segmented admin-segmented" role="radiogroup" aria-label={c.label}>
                      {c.allowed.map((l) => (
                        <button key={l} type="button" role="radio" aria-checked={level === l} class="segmented-item" disabled={busy === c.id} onClick={() => level !== l && void setLevel(c.id, l)}>
                          {AUTONOMY_WORDS[l].label}
                        </button>
                      ))}
                    </div>
                    <p class="trust-class-line">{AUTONOMY_WORDS[level].line}</p>
                    {c.id === 'external_send' && (
                      <p class="page-fine">
                        {data.email.ready ? (data.email.provider === 'sink' ? 'Email is in test mode: it goes to a test mailbox and nothing leaves. ' : `Email goes out from ${data.email.from}. `) : `${data.email.why ?? 'Email is off.'} `}
                        <Link href={paths.admin('email')}>Email settings</Link>. Sending never happens on its own: approving can allow more for a task, a project or a day.
                      </p>
                    )}
                    {c.id === 'app_write' && (
                      <p class="page-fine">
                        A connector’s own setting can ask more often, never less. <Link href={paths.connectors}>Connectors</Link>
                      </p>
                    )}
                  </>
                ) : (
                  <p class="trust-class-line" data-muted>
                    {c.fixed ?? c.unavailable}
                  </p>
                )}
              </li>
            );
          })}
        </ul>
        {error && (
          <p class="form-error" role="alert">
            {error}
          </p>
        )}
      </section>
      <section class="panel admin-card" aria-labelledby="adm-grants" id="grants">
        <h2 id="adm-grants" class="admin-card-title">
          Permissions in force
        </h2>
        {data.grants.length ? (
          <ul class="trust-grants">
            {data.grants.map((g) => (
              <li key={g.grantId} id={g.grantId} class="trust-grant">
                <span>
                  {grantLine(g)}
                  {g.note ? <span class="page-fine"> · {g.note}</span> : null}
                  <span class="page-fine"> · used {g.uses} time{g.uses === 1 ? '' : 's'}</span>
                </span>
                <CopyLink page={paths.admin('autonomy')} at={g.grantId} label="Copy link to this permission" what="Link to it" />
                <button type="button" class="button-quiet" disabled={busy === g.grantId} onClick={() => void revoke(g.grantId)}>
                  Take back
                </button>
              </li>
            ))}
          </ul>
        ) : (
          <p class="page-fine">None. When you approve an email, you can allow more for a task, a project or a day. That permission shows here until it ends or you take it back.</p>
        )}
      </section>
      {waiting.length > 0 && (
        <section class="panel admin-card" aria-labelledby="adm-waiting">
          <h2 id="adm-waiting" class="admin-card-title">
            Emails waiting
          </h2>
          <ul class="trust-grants">
            {waiting.map((e) => (
              <EffectRow key={e.key} e={e} />
            ))}
          </ul>
        </section>
      )}
    </>
  );
}

const STATUS_WORDS: Record<EffectView['status'], string> = {
  awaiting: 'Waiting for your OK',
  pending: 'Going out now',
  held: 'Held: Everyone stop is on',
  unknown: 'Not certain it went out',
  failed: 'Not sent',
  done: 'Sent',
  declined: 'Not sent (you said no)',
};

function EffectRow({ e }: { e: EffectView }) {
  return (
    <li class="trust-grant" id={e.key}>
      <span>
        <strong>{STATUS_WORDS[e.status]}</strong>: “{e.email.subject}” to {e.email.to.join(', ')} <span class="page-fine">· from {actorName(e.agentId)}</span>
        {e.note ? <span class="page-fine"> · {e.note}</span> : null}
      </span>
      {e.decisionId && (e.status === 'awaiting' || e.status === 'unknown') && <Link href={linkTo(paths.inbox, e.decisionId)}>Decide</Link>}
    </li>
  );
}

// ── the audit log ────────────────────────────────────────────────────────────────────

const FILTERS: readonly { kind: AuditKind | null; label: string }[] = [
  { kind: null, label: 'Everything' },
  { kind: 'email', label: 'Emails' },
  { kind: 'change', label: 'Changes' },
  { kind: 'grant', label: 'Permissions' },
  { kind: 'app', label: 'Connected apps' },
  { kind: 'autonomy', label: 'Settings' },
  { kind: 'stop', label: 'Everyone stop' },
];

export function AuditSection() {
  const kindParam = queryParam('kind') as AuditKind | null;
  const kind = FILTERS.some((f) => f.kind === kindParam) ? kindParam : null;
  const [entries, setEntries] = useState<AuditEntry[] | null>(null);
  const [next, setNext] = useState<string | undefined>();
  const [error, setError] = useState<string | null>(null);
  const [confirm, setConfirm] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const load = async (before?: string) => {
    try {
      const r = await api.listAudit({ ...(kind ? { kind } : {}), ...(before ? { before } : {}) });
      setEntries((cur) => (before ? [...(cur ?? []), ...r.entries] : r.entries));
      setNext(r.next);
    } catch (err) {
      setError(errorOf(err, 'Could not load the audit log. Reload the page to try again.'));
    }
  };
  useEffect(() => {
    setEntries(null);
    void load();
  }, [kind]);
  const undo = async (e: AuditEntry) => {
    setBusy(e.auditId);
    setError(null);
    try {
      await api.undoAudit(e.auditId);
      setConfirm(null);
      await load();
    } catch (err) {
      setError(errorOf(err, 'It could not be undone.'));
    } finally {
      setBusy(null);
    }
  };
  return (
    <section class="panel admin-card" aria-labelledby="adm-audit">
      <div class="page-title-row">
        <h2 id="adm-audit" class="admin-card-title">
          Audit log
        </h2>
        <CopyLink page={linkTo(paths.admin('audit'), null, kind ? { kind } : {})} label="Copy link to the audit log" what="Link to this view" />
      </div>
      <p class="page-fine">Everything your team did that matters: emails asked, approved and sent (with receipts), changes they made, permissions, and your settings. Newest first. Undo where it can be undone.</p>
      <div class="segmented admin-segmented audit-filters" role="radiogroup" aria-label="Show">
        {FILTERS.map((f) => (
          <button key={f.label} type="button" role="radio" aria-checked={kind === f.kind} class="segmented-item" onClick={() => setQuery({ kind: f.kind })}>
            {f.label}
          </button>
        ))}
      </div>
      {error && (
        <p class="form-error" role="alert">
          {error}
        </p>
      )}
      {!entries ? (
        <p class="page-fine">Loading…</p>
      ) : entries.length === 0 ? (
        <p class="page-fine">Nothing yet.</p>
      ) : (
        <ol class="audit-list">
          {entries.map((e) => {
            const anchor = e.receipt?.receiptId ?? e.auditId;
            return (
              <li key={e.auditId} class="audit-entry" id={anchor} data-kind={e.kind}>
                <p class="audit-meta">
                  <time dateTime={e.at}>{when(e.at)}</time> · {actorName(e.actor)}
                </p>
                <p class="audit-summary">{e.summary}</p>
                {e.receipt && (
                  <details class="audit-receipt">
                    <summary>Receipt {e.receipt.receiptId}</summary>
                    <dl>
                      <dt>To</dt>
                      <dd>{e.receipt.target}</dd>
                      <dt>Approved by</dt>
                      <dd>{e.receipt.approvedBy.startsWith('grant:') ? `A permission you gave (${e.receipt.approvedBy.slice(6)})` : e.receipt.approvedBy.startsWith('owner:') ? actorName(e.receipt.approvedBy) : e.receipt.approvedBy}</dd>
                      <dt>Sent</dt>
                      <dd>
                        {when(e.receipt.at)} via {e.receipt.provider === 'sink' ? 'the test mailbox' : e.receipt.provider} ({e.receipt.providerId})
                      </dd>
                      <dt>Content hash</dt>
                      <dd class="audit-hash">{e.receipt.payloadHash.slice(0, 16)}…</dd>
                    </dl>
                  </details>
                )}
                <div class="audit-actions">
                  {e.link && <Link href={e.link}>Open</Link>}
                  <CopyLink page={paths.admin('audit')} at={anchor} label="Copy link to this entry" what="Link to this entry" />
                  {e.undo &&
                    (e.undo.undoneAt ? (
                      <span class="page-fine">
                        Undone {when(e.undo.undoneAt)}
                        {e.undo.undoneBy ? ` by ${actorName(`owner:${e.undo.undoneBy}`)}` : ''}
                      </span>
                    ) : e.undo.can ? (
                      confirm === e.auditId ? (
                        <span class="audit-confirm">
                          <button type="button" class="button-quiet" disabled={busy === e.auditId} onClick={() => void undo(e)}>
                            {e.undo.label}
                          </button>
                          <button type="button" class="link-button" onClick={() => setConfirm(null)}>
                            Keep it
                          </button>
                        </span>
                      ) : (
                        <button type="button" class="button-quiet" onClick={() => setConfirm(e.auditId)}>
                          Undo
                        </button>
                      )
                    ) : (
                      <span class="page-fine">{e.undo.label}</span>
                    ))}
                </div>
              </li>
            );
          })}
        </ol>
      )}
      {next && (
        <button type="button" class="button-quiet" onClick={() => void load(next)}>
          Show older
        </button>
      )}
    </section>
  );
}

// ── email: the test mailbox and a test send ────────────────────────────────────────

export function EmailExtras() {
  const [trust, setTrust] = useState<TrustResponse | null>(null);
  const [box, setBox] = useState<TestMailbox | null>(null);
  const [to, setTo] = useState(myEmail());
  const [note, setNote] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const load = () => {
    void api.getTrust().then(setTrust).catch(() => undefined);
    void api.testMailbox().then(setBox).catch(() => undefined);
  };
  useEffect(load, []);
  const send = async (e: Event) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    setNote(null);
    try {
      const r = await api.testEmail(to.trim() || undefined);
      setNote(r.result.receipt ? `Sent. Receipt ${r.result.receipt.receiptId}.` : 'Sent.');
      load();
    } catch (err) {
      setError(errorOf(err, 'The test email did not go out.'));
    } finally {
      setBusy(false);
    }
  };
  const status = trust?.email;
  return (
    <section class="panel admin-card" aria-labelledby="adm-email-check">
      <h2 id="adm-email-check" class="admin-card-title">
        Check it works
      </h2>
      <p class="page-fine">{status ? (status.ready ? (status.provider === 'sink' ? `Test mode: emails go to the test mailbox below and nothing leaves ${BRAND.name}.` : `Ready: emails go out from ${status.from}.`) : (status.why ?? 'Email is off.')) : 'Loading…'}</p>
      {status?.ready && (
        <form class="admin-row" onSubmit={send}>
          <label class="visually-hidden" for="test-email-to">
            Send a test email to
          </label>
          <input id="test-email-to" class="field-input" type="email" placeholder="you@example.com" value={to} onInput={(e) => setTo((e.target as HTMLInputElement).value)} />
          <button type="submit" class="button-primary" disabled={busy || !to.trim()}>
            Send a test email
          </button>
          {note && (
            <span class="page-fine" role="status">
              {note}
            </span>
          )}
        </form>
      )}
      {error && (
        <p class="form-error" role="alert">
          {error}
        </p>
      )}
      {status?.provider === 'sink' && (
        <>
          <h3 class="trust-class-name">Test mailbox</h3>
          {box?.messages.length ? (
            <ol class="audit-list" aria-label="Test mailbox">
              {box.messages.map((m) => (
                <li key={m.key} class="audit-entry" id={m.key}>
                  <p class="audit-meta">
                    {when(m.at)} · to {m.to.join(', ')}
                  </p>
                  <details>
                    <summary class="audit-summary">{m.subject}</summary>
                    <pre class="decision-email-text">{m.text}</pre>
                  </details>
                </li>
              ))}
            </ol>
          ) : (
            <p class="page-fine">Empty. Emails your team sends in test mode land here.</p>
          )}
        </>
      )}
    </section>
  );
}
