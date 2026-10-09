// Admin: everything an owner can set, in one place, each section at its own link (/app/admin/<section>).
// - General: the office (Chief of Staff, your name, voice, ambience, theme), "view as", and the other places where the
//   team is configured (coworkers, skills, connectors, automations, the Handbook, memory).
// - People: who can sign in, as an owner, a contributor or a reader.
// - Usage: what the models did and cost — by day, surface, coworker and model; the latest calls; today's limits; prices.
// - Autonomy (Inc 6): what the team may do on its own per kind of action, permissions in force, Everyone stop.
// - Audit log (Inc 6): everything that happened, with receipts and Undo.
// - Settings: every option the worker reads (limits, how work runs, email, voice, models, provider keys, the deployment).
import { AMBIENCES, ambienceOf, type Ambience } from '@headcount/protocol/ext/expressions';
import {
  CONFIG_GROUPS,
  CONFIG_OPTIONS,
  ROLE_WORDS,
  ROLES,
  type ConfigGroup,
  type ConfigOption,
  type ConfigResponse,
  type ConfigValue,
  type Member,
  type MembersResponse,
  type ModelPrice,
  type Role,
  type UsageResponse,
  type UsageRow,
} from '@headcount/protocol/ext/admin';
import { useEffect, useMemo, useState } from 'preact/hooks';
import { api, ApiError } from '../api/client';
import { actualRole, auth, isOwner, role, viewAs, isPlatform } from '../auth/session';
import { chiefName, currentLead } from '../chief';
import { TextDialog } from '../components/Dialog';
import { Face, leadSubject } from '../components/Face';
import { Icon, type IconName } from '../components/Icon';
import { Link } from '../components/Link';
import { setTheme, theme, type ThemeChoice } from '../lib/theme';
import { navigate, paths } from '../router';
import { settings } from '../store';
import { setAmbience, setOwnerName, setVoiceOn, updateSettings } from '../talk/actions';
import { CopyLink, PageTitle } from '../links/CopyLink';
import { AuditSection, AutonomySection, EmailExtras } from '../admin/Trust';
import { OrgCard, PlatformSection } from '../admin/Orgs';
import './pages.css';
import './admin.css';
import { BRAND, CHIEF_ID } from '@headcount/protocol';

type Section = 'general' | 'people' | 'autonomy' | 'audit' | 'usage' | 'platform' | ConfigGroup;
const SECTIONS: readonly { id: Section; title: string; icon: IconName }[] = [
  { id: 'general', title: 'General', icon: 'sun' },
  { id: 'people', title: 'People and roles', icon: 'user' },
  { id: 'autonomy', title: 'Autonomy', icon: 'check' },
  { id: 'audit', title: 'Audit log', icon: 'book' },
  { id: 'usage', title: 'Usage and costs', icon: 'expand' },
  ...CONFIG_GROUPS.map((g) => ({ id: g.id as Section, title: g.title, icon: (g.id === 'keys' ? 'code' : g.id === 'voice' ? 'voiceOn' : g.id === 'deployment' ? 'book' : g.id === 'email' ? 'send' : 'edit') as IconName })),
  { id: 'platform', title: 'Every organization', icon: 'projects' },
];
const isSection = (s: string | undefined): s is Section => !!s && SECTIONS.some((x) => x.id === s);

const errorOf = (err: unknown, fallback: string) => (err instanceof ApiError ? err.message : fallback);
const n = (v: number) => v.toLocaleString();
const tokens = (v: number) => (v >= 1_000_000 ? `${(v / 1_000_000).toFixed(v >= 10_000_000 ? 0 : 1)}M` : v >= 1000 ? `${(v / 1000).toFixed(v >= 10_000 ? 0 : 1)}k` : String(v));
const usd = (v: number | null) => (v === null ? '—' : v === 0 ? '$0' : v < 0.01 ? '<$0.01' : `$${v.toFixed(2)}`);
const ms = (v: number) => (v >= 1000 ? `${(v / 1000).toFixed(1)} s` : `${v} ms`);
const when = (at?: string) => (at ? new Date(at).toLocaleString(undefined, { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' }) : '');

export function Admin({ section }: { section?: string }) {
  const current: Section = isSection(section) ? section : 'general';
  if (!isOwner.value)
    return (
      <section class="page admin-page" aria-labelledby="admin-title">
        <header class="page-head">
          <PageTitle id="admin-title">Admin</PageTitle>
          <p class="page-lede">Only owners can change the office’s settings. Ask an owner if something needs changing.</p>
        </header>
        {actualRole.value === 'owner' && <ViewAsBar />}
        <OrgCard />
      </section>
    );
  const title = SECTIONS.find((s) => s.id === current)!.title;
  // The platform page is for the deployment's owners only.
  const sections = SECTIONS.filter((s) => s.id !== 'platform' || (isPlatform.value && auth.value.status === 'signed-in'));
  return (
    <section class="page admin-page" aria-labelledby="admin-title">
      <header class="page-head">
        <PageTitle id="admin-title">Admin</PageTitle>
        <p class="page-lede">Everything you can set for your office. Every section has its own link, so you can send someone straight to it.</p>
      </header>
      <div class="admin-layout">
        <nav class="admin-nav" aria-label="Admin sections">
          {sections.map((s) => (
            <Link key={s.id} href={s.id === 'general' ? paths.admin() : paths.admin(s.id)} class="admin-nav-item" data-on={s.id === current || undefined}>
              <Icon name={s.icon} size={16} /> {s.title}
            </Link>
          ))}
        </nav>
        <div class="admin-main" aria-label={title}>
          {current === 'general' && <General />}
          {current === 'people' && <People />}
          {current === 'usage' && <Usage />}
          {current === 'autonomy' && <AutonomySection />}
          {current === 'audit' && <AuditSection />}
          {current === 'platform' && <PlatformSection />}
          {current !== 'general' && current !== 'people' && current !== 'usage' && current !== 'autonomy' && current !== 'audit' && current !== 'platform' && <ConfigSection group={current} />}
          {current === 'email' && <EmailExtras />}
        </div>
      </div>
    </section>
  );
}

// ── general ──────────────────────────────────────────────────────────────────────────

function ViewAsBar() {
  return (
    <p class="panel admin-viewas" role="status">
      You are previewing the office as a {role.value}.{' '}
      <button type="button" class="link-button" onClick={() => void viewAs(null)}>
        Back to owner
      </button>
    </p>
  );
}

function General() {
  const s = settings.value;
  const [editing, setEditing] = useState<'chief' | 'owner' | null>(null);
  const lead = currentLead.value;
  const leadFirst = lead ? lead.name.split(' ')[0]! : '';
  const signedIn = auth.value.status === 'signed-in';
  return (
    <div class="admin-stack">
      <OrgCard />
      <section class="panel admin-card" aria-labelledby="adm-office">
        <h2 id="adm-office" class="admin-card-title">
          Your office
        </h2>
        <ul class="setting-rows">
          <li class="setting-row">
            {lead && <Face subject={leadSubject(lead, chiefName.value)} tier="token" agentId={CHIEF_ID} decorative />}
            <div class="setting-text">
              <span class="setting-label">Your Chief of Staff</span>
              <span class="setting-value">
                {chiefName.value}
                {lead && chiefName.value !== leadFirst ? <span class="setting-hint"> ({lead.name})</span> : null}
              </span>
            </div>
            <div class="setting-actions">
              <button type="button" class="button-quiet" onClick={() => setEditing('chief')}>
                Rename
              </button>
              <button type="button" class="button-quiet" onClick={() => navigate(paths.onboarding)}>
                Choose someone else
              </button>
            </div>
          </li>
          <li class="setting-row">
            <div class="setting-text">
              <span class="setting-label">What the team calls you</span>
              <span class="setting-value">{s?.ownerName || <span class="setting-unset">Not set</span>}</span>
              <span class="setting-hint">Used in greetings, now and then.</span>
            </div>
            <button type="button" class="button-quiet" onClick={() => setEditing('owner')}>
              Change
            </button>
          </li>
        </ul>
      </section>
      {editing === 'chief' && (
        <TextDialog
          title="Rename your Chief of Staff"
          lede={lead ? `${lead.name} keeps their face, voice and way of working; only the name they go by changes.` : undefined}
          label="Their name"
          hint={leadFirst ? `Leave it blank to call them ${leadFirst}.` : undefined}
          value={s?.chiefName ?? ''}
          placeholder={leadFirst}
          maxLength={40}
          min={0}
          action="Save"
          save={async (v) => {
            const next = v && v !== leadFirst ? v : null;
            if (next === (s?.chiefName ?? null)) return null;
            return (await updateSettings({ chiefName: next })) ? null : 'Not saved. Try again.';
          }}
          onClose={() => setEditing(null)}
        />
      )}
      {editing === 'owner' && (
        <TextDialog
          title="What should the team call you?"
          lede="Your first name, or whatever you like to be called. Leave it blank and they won’t use a name."
          label="Your name"
          value={s?.ownerName ?? ''}
          placeholder="Your first name"
          maxLength={40}
          min={0}
          action="Save"
          autoComplete="given-name"
          save={(v) => setOwnerName(v)}
          onClose={() => setEditing(null)}
        />
      )}
      <section class="panel admin-card" aria-labelledby="adm-feel">
        <h2 id="adm-feel" class="admin-card-title">
          Sound and look
        </h2>
        <label class="grant-label">
          <input type="checkbox" checked={s?.voiceOn ?? false} onChange={(e) => void setVoiceOn(e.currentTarget.checked)} />
          <span class="grant-name">Spoken replies</span>
        </label>
        <div class="field">
          <span class="field-label">How lively the office is</span>
          <div class="segmented admin-segmented" role="radiogroup" aria-label="Ambience">
            {AMBIENCES.map((a: Ambience) => (
              <button key={a} type="button" role="radio" aria-checked={s ? ambienceOf(s) === a : false} class="segmented-item" onClick={() => void setAmbience(a)}>
                {a[0]!.toUpperCase() + a.slice(1)}
              </button>
            ))}
          </div>
        </div>
        <div class="field">
          <span class="field-label">Theme (this browser)</span>
          <div class="segmented admin-segmented" role="radiogroup" aria-label="Theme">
            {(['dark', 'light', 'system'] as ThemeChoice[]).map((t) => (
              <button key={t} type="button" role="radio" aria-checked={theme.value === t} class="segmented-item" onClick={() => setTheme(t)}>
                {t === 'system' ? 'Match system' : t[0]!.toUpperCase() + t.slice(1)}
              </button>
            ))}
          </div>
        </div>
      </section>
      <section class="panel admin-card" aria-labelledby="adm-viewas">
        <h2 id="adm-viewas" class="admin-card-title">
          See it as someone else
        </h2>
        <p class="page-fine">Preview what a contributor or a reader sees{signedIn ? '' : ' (useful before you invite people)'}. You stay an owner; come back here or use the bar at the top to return.</p>
        <div class="admin-row">
          <button type="button" class="button-quiet" onClick={() => void viewAs('contributor')}>
            View as a contributor
          </button>
          <button type="button" class="button-quiet" onClick={() => void viewAs('reader')}>
            View as a reader
          </button>
        </div>
      </section>
      <section class="panel admin-card" aria-labelledby="adm-more">
        <h2 id="adm-more" class="admin-card-title">
          The team’s own settings
        </h2>
        <ul class="admin-links">
          <li>
            <Link href={paths.floor}>Coworkers</Link> — open anyone’s profile, then “How they work”: instructions, tools, model and skills.
          </li>
          <li>
            <Link href={paths.chief}>How {chiefName.value} works</Link> — the exact prompt and tools.
          </li>
          <li>
            <Link href={paths.skills}>Skills</Link> — the methods coworkers follow, editable.
          </li>
          <li>
            <Link href={paths.connectors}>Connectors</Link> — services the team may use, and what needs your OK.
          </li>
          <li>
            <Link href={paths.automations}>Automations</Link> — work that starts by itself.
          </li>
          <li>
            <Link href={paths.handbook}>Handbook</Link> and <Link href={paths.memory}>Memory</Link> — what the team knows about the business.
          </li>
        </ul>
      </section>
    </div>
  );
}

// ── people ───────────────────────────────────────────────────────────────────────────

function People() {
  const [data, setData] = useState<MembersResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [email, setEmail] = useState('');
  const [newRole, setNewRole] = useState<Role>('contributor');
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    api
      .listMembers()
      .then(setData)
      .catch((err) => setError(errorOf(err, 'Could not load the people.')));
  }, []);
  const run = async (fn: () => Promise<MembersResponse>) => {
    setBusy(true);
    setError(null);
    try {
      setData(await fn());
      return true;
    } catch (err) {
      setError(errorOf(err, 'That did not go through. Try again.'));
      return false;
    } finally {
      setBusy(false);
    }
  };
  const me = auth.value.status === 'signed-in' ? auth.value.email : '';
  return (
    <div class="admin-stack">
      <section class="panel admin-card" aria-labelledby="adm-roles">
        <h2 id="adm-roles" class="admin-card-title">
          Roles
        </h2>
        <dl class="admin-roles">
          {ROLES.map((r) => (
            <div key={r}>
              <dt>{ROLE_WORDS[r].label}</dt>
              <dd>{ROLE_WORDS[r].can}</dd>
            </div>
          ))}
        </dl>
        {data && !data.signIn && <p class="page-fine">Sign-in is off on this computer, so whoever opens it here is an owner. The people below can sign in once the office is deployed with Google sign-in.</p>}
      </section>
      {error && (
        <p class="form-error" role="alert">
          {error}
        </p>
      )}
      <section class="panel admin-card" aria-labelledby="adm-people">
        <h2 id="adm-people" class="admin-card-title">
          People
        </h2>
        {!data && !error && <p class="page-fine">Loading…</p>}
        {data && data.members.length === 0 && <p class="page-fine">Nobody yet. Invite someone below.</p>}
        {data && data.members.length > 0 && (
          <ul class="admin-people">
            {data.members.map((m) => (
              <PersonRow key={m.email} member={m} self={m.email === me} busy={busy} onRole={(r) => void run(() => api.putMember(m.email, { role: r }))} onRemove={() => void run(() => api.removeMember(m.email))} />
            ))}
          </ul>
        )}
        <form
          class="admin-invite"
          onSubmit={async (e) => {
            e.preventDefault();
            if (await run(() => api.putMember(email.trim(), { role: newRole }))) setEmail('');
          }}
        >
          <label class="field">
            <span class="field-label">Invite by Google email</span>
            <input class="field-input" type="email" required value={email} placeholder="sam@example.com" onInput={(e) => setEmail(e.currentTarget.value)} />
          </label>
          <label class="field">
            <span class="field-label">As</span>
            <select class="field-input" value={newRole} onChange={(e) => setNewRole(e.currentTarget.value as Role)}>
              {ROLES.map((r) => (
                <option key={r} value={r}>
                  {ROLE_WORDS[r].label}
                </option>
              ))}
            </select>
          </label>
          <button type="submit" class="button-primary" disabled={busy || !email.includes('@')}>
            Invite
          </button>
        </form>
        <p class="page-fine">They sign in with that Google account. Nothing is emailed: tell them the office’s address.</p>
      </section>
    </div>
  );
}

function PersonRow({ member: m, self, busy, onRole, onRemove }: { member: Member; self: boolean; busy: boolean; onRole: (r: Role) => void; onRemove: () => void }) {
  const [confirm, setConfirm] = useState(false);
  const fixed = m.source === 'deployment' || self;
  return (
    <li class="admin-person">
      <span class="admin-person-main">
        <span class="admin-person-name">{m.name || m.email}</span>
        <span class="connector-meta">
          {m.name ? `${m.email} · ` : ''}
          {m.source === 'deployment' ? 'Owner named in the deployment' : m.lastSeenAt ? `Last here ${when(m.lastSeenAt)}` : 'Not signed in yet'}
          {self ? ' · you' : ''}
        </span>
      </span>
      {fixed ? (
        <span class="connector-tag">{ROLE_WORDS[m.role].label}</span>
      ) : (
        <>
          <label class="visually-hidden" for={`role-${m.email}`}>
            Role for {m.email}
          </label>
          <select id={`role-${m.email}`} class="field-input field-compact" value={m.role} disabled={busy} onChange={(e) => onRole(e.currentTarget.value as Role)}>
            {ROLES.map((r) => (
              <option key={r} value={r}>
                {ROLE_WORDS[r].label}
              </option>
            ))}
          </select>
          {confirm ? (
            <span class="card-row-confirm">
              <button type="button" class="button-quiet button-danger" disabled={busy} onClick={onRemove}>
                Remove
              </button>
              <button type="button" class="link-button" onClick={() => setConfirm(false)}>
                Keep
              </button>
            </span>
          ) : (
            <button type="button" class="icon-button icon-button-sm" aria-label={`Remove ${m.email}`} title="Remove (signs them out)" onClick={() => setConfirm(true)}>
              <Icon name="trash" size={16} />
            </button>
          )}
        </>
      )}
    </li>
  );
}

// ── usage ────────────────────────────────────────────────────────────────────────────

function Usage() {
  const [days, setDays] = useState(7);
  const [u, setU] = useState<UsageResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    let live = true;
    api
      .adminUsage(days)
      .then((r) => live && (setU(r), setError(null)))
      .catch((err) => live && setError(errorOf(err, 'Could not load the usage.')));
    return () => void (live = false);
  }, [days]);
  const peak = useMemo(() => Math.max(1, ...(u?.byDay ?? []).map((d) => d.input + d.output)), [u]);
  return (
    <div class="admin-stack">
      <div class="admin-row">
        <div class="segmented admin-segmented" role="radiogroup" aria-label="Period">
          {[1, 7, 30].map((d) => (
            <button key={d} type="button" role="radio" aria-checked={days === d} class="segmented-item" onClick={() => setDays(d)}>
              {d === 1 ? 'Today' : `${d} days`}
            </button>
          ))}
        </div>
      </div>
      {error && (
        <p class="form-error" role="alert">
          {error}
        </p>
      )}
      {!u && !error && <p class="page-fine">Loading…</p>}
      {u && (
        <>
          <div class="admin-stats" aria-label="Totals">
            <Stat label="Model calls" value={n(u.total.calls)} note={u.total.errors ? `${n(u.total.errors)} failed` : 'none failed'} />
            <Stat label="Tokens in" value={tokens(u.total.input)} note={u.total.cached ? `${tokens(u.total.cached)} from cache` : ''} />
            <Stat label="Tokens out" value={tokens(u.total.output)} />
            <Stat label="Cost" value={usd(u.total.usd)} note={u.total.usd === null ? 'set prices below' : u.total.priced < 1 ? `${Math.round(u.total.priced * 100)}% of calls priced` : ''} />
            <Stat label="Average call" value={ms(u.total.avgMs)} note={u.total.avgFirstMs ? `first words in ${ms(u.total.avgFirstMs)}` : ''} />
          </div>
          {days > 1 && (
            <section class="panel admin-card" aria-labelledby="adm-days">
              <h2 id="adm-days" class="admin-card-title">
                By day
              </h2>
              <ol class="admin-bars">
                {u.byDay.map((d) => (
                  <li key={d.day} title={`${d.day}: ${n(d.calls)} calls, ${tokens(d.input)} in, ${tokens(d.output)} out, ${usd(d.usd)}`}>
                    <span class="admin-bar" style={{ height: `${Math.max(2, Math.round(((d.input + d.output) / peak) * 100))}%` }} />
                    <span class="admin-bar-day">{d.day.slice(8)}</span>
                  </li>
                ))}
              </ol>
            </section>
          )}
          <UsageTable id="adm-surface" title="Where it went" rows={u.bySurface} first="Surface" />
          <UsageTable id="adm-agent" title="Who used it" rows={u.byAgent} first="Coworker" />
          <UsageTable id="adm-model" title="Which models" rows={u.byModel} first="Model" />
          <section class="panel admin-card" aria-labelledby="adm-limits">
            <h2 id="adm-limits" class="admin-card-title">
              Today’s limits
            </h2>
            <ul class="admin-limits">
              {u.limits.map((l) => (
                <li key={l.key}>
                  <span class="admin-limit-label">{l.label}</span>
                  <span class="admin-limit-bar" aria-hidden="true">
                    <span style={{ width: `${l.limit ? Math.min(100, Math.round((l.used / l.limit) * 100)) : 0}%` }} data-full={l.used >= l.limit || undefined} />
                  </span>
                  <span class="tabular admin-limit-num">
                    {n(l.used)} / {n(l.limit)}
                  </span>
                </li>
              ))}
            </ul>
            <p class="page-fine">
              <Link href={paths.admin('limits')}>Change the limits</Link>
            </p>
          </section>
          <RecentCalls u={u} />
          <Prices initial={u.prices} models={u.byModel} />
        </>
      )}
    </div>
  );
}

function Stat({ label, value, note }: { label: string; value: string; note?: string }) {
  return (
    <div class="panel admin-stat">
      <span class="admin-stat-label">{label}</span>
      <span class="admin-stat-value tabular">{value}</span>
      {note && <span class="admin-stat-note">{note}</span>}
    </div>
  );
}

function UsageTable({ id, title, rows, first }: { id: string; title: string; rows: UsageRow[]; first: string }) {
  if (!rows.length) return null;
  return (
    <section class="panel admin-card" aria-labelledby={id}>
      <h2 id={id} class="admin-card-title">
        {title}
      </h2>
      <div class="admin-table-wrap">
        <table class="admin-table">
          <thead>
            <tr>
              <th scope="col">{first}</th>
              <th scope="col">Calls</th>
              <th scope="col">In</th>
              <th scope="col">Out</th>
              <th scope="col">Cost</th>
              <th scope="col">Avg</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.key}>
                <th scope="row">{r.label}</th>
                <td class="tabular">
                  {n(r.calls)}
                  {r.errors ? <span class="admin-err"> ({n(r.errors)} failed)</span> : null}
                </td>
                <td class="tabular">{tokens(r.input)}</td>
                <td class="tabular">{tokens(r.output)}</td>
                <td class="tabular">{usd(r.usd)}</td>
                <td class="tabular">{ms(r.avgMs)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}

function RecentCalls({ u }: { u: UsageResponse }) {
  if (!u.recent.length) return null;
  return (
    <section class="panel admin-card" aria-labelledby="adm-recent">
      <details>
        <summary>
          <h2 id="adm-recent" class="admin-card-title admin-inline">
            The latest calls
          </h2>
        </summary>
        <div class="admin-table-wrap">
          <table class="admin-table">
            <thead>
              <tr>
                <th scope="col">When</th>
                <th scope="col">What</th>
                <th scope="col">Model</th>
                <th scope="col">In / out</th>
                <th scope="col">Time</th>
              </tr>
            </thead>
            <tbody>
              {u.recent.map((c, i) => (
                <tr key={`${c.at}-${i}`} data-ok={c.ok || undefined}>
                  <td class="tabular">{when(c.at)}</td>
                  <td>
                    {c.surface}
                    {c.agentName ? ` · ${c.agentName}` : ''}
                    {c.projectId ? (
                      <>
                        {' · '}
                        <Link href={paths.project(c.projectId)}>project</Link>
                      </>
                    ) : null}
                    {!c.ok && <span class="admin-err"> · failed{c.error ? `: ${c.error}` : ''}</span>}
                  </td>
                  <td>{c.model || c.provider}</td>
                  <td class="tabular">
                    {tokens(c.input)} / {tokens(c.output)}
                  </td>
                  <td class="tabular">{ms(c.ms)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </details>
    </section>
  );
}

function Prices({ initial, models }: { initial: ModelPrice[]; models: UsageRow[] }) {
  const [rows, setRows] = useState<ModelPrice[]>(initial);
  const [note, setNote] = useState<string | null>(null);
  // Offer every model seen in the period that has no price yet.
  const seen = models
    .map((m) => m.key.split('\u0000'))
    .filter(([provider, model, cap]) => cap === 'chat' && provider !== 'mock' && !rows.some((r) => r.provider === provider && (r.model === model || r.model === '*')))
    .map(([provider, model]) => ({ provider: provider!, model: model! }));
  const edit = (i: number, patch: Partial<ModelPrice>) => setRows((r) => r.map((x, j) => (j === i ? { ...x, ...patch } : x)));
  const save = async () => {
    setNote(null);
    try {
      setRows((await api.putPrices(rows)).prices);
      setNote('Saved. Costs above are worked out at these prices.');
    } catch (err) {
      setNote(errorOf(err, 'The prices were not saved.'));
    }
  };
  return (
    <section class="panel admin-card" aria-labelledby="adm-prices">
      <h2 id="adm-prices" class="admin-card-title">
        Prices
      </h2>
      <p class="page-fine">Most providers do not report what a call cost. Enter their price per million tokens (from their pricing page) and the costs above are worked out from it. Use * as the model to price every model of a provider.</p>
      {rows.length > 0 && (
        <div class="admin-table-wrap">
          <table class="admin-table admin-prices">
            <thead>
              <tr>
                <th scope="col">Provider</th>
                <th scope="col">Model</th>
                <th scope="col">$ in</th>
                <th scope="col">$ cached</th>
                <th scope="col">$ out</th>
                <th scope="col">
                  <span class="visually-hidden">Remove</span>
                </th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r, i) => (
                <tr key={i}>
                  <td>
                    <input class="field-input field-compact" aria-label="Provider" value={r.provider} onInput={(e) => edit(i, { provider: e.currentTarget.value })} />
                  </td>
                  <td>
                    <input class="field-input field-compact" aria-label="Model" value={r.model} onInput={(e) => edit(i, { model: e.currentTarget.value })} />
                  </td>
                  <td>
                    <input class="field-input field-compact" aria-label="Dollars per million tokens in" type="number" min="0" step="0.01" value={r.input} onInput={(e) => edit(i, { input: Number(e.currentTarget.value) })} />
                  </td>
                  <td>
                    <input
                      class="field-input field-compact"
                      aria-label="Dollars per million cached tokens"
                      type="number"
                      min="0"
                      step="0.01"
                      value={r.cached ?? ''}
                      onInput={(e) => {
                        const v = e.currentTarget.value;
                        edit(i, v === '' ? { cached: undefined } : { cached: Number(v) });
                      }}
                    />
                  </td>
                  <td>
                    <input class="field-input field-compact" aria-label="Dollars per million tokens out" type="number" min="0" step="0.01" value={r.output} onInput={(e) => edit(i, { output: Number(e.currentTarget.value) })} />
                  </td>
                  <td>
                    <button type="button" class="icon-button icon-button-sm" aria-label={`Remove the price for ${r.model}`} onClick={() => setRows((x) => x.filter((_, j) => j !== i))}>
                      <Icon name="trash" size={16} />
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <div class="admin-row">
        {seen.map((s) => (
          <button key={`${s.provider}/${s.model}`} type="button" class="button-quiet button-small" onClick={() => setRows((r) => [...r, { provider: s.provider, model: s.model, input: 0, output: 0 }])}>
            <Icon name="plus" size={14} /> Price {s.model}
          </button>
        ))}
        <button type="button" class="button-quiet button-small" onClick={() => setRows((r) => [...r, { provider: '', model: '*', input: 0, output: 0 }])}>
          <Icon name="plus" size={14} /> Add a price
        </button>
        <button type="button" class="button-primary" onClick={() => void save()}>
          Save prices
        </button>
        {note && (
          <span class="page-fine" role="status">
            {note}
          </span>
        )}
      </div>
    </section>
  );
}

// ── settings ─────────────────────────────────────────────────────────────────────────

function ConfigSection({ group }: { group: ConfigGroup }) {
  const [data, setData] = useState<ConfigResponse | null>(null);
  const [draft, setDraft] = useState<Record<string, string | null>>({});
  const [error, setError] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    setDraft({});
    setNote(null);
    api
      .adminConfig()
      .then(setData)
      .catch((err) => setError(errorOf(err, 'Could not load the settings.')));
  }, [group]);
  const g = CONFIG_GROUPS.find((x) => x.id === group)!;
  const options = CONFIG_OPTIONS.filter((o) => o.group === group);
  const values = new Map((data?.values ?? []).map((v) => [v.key, v]));
  const dirty = Object.keys(draft).length > 0;
  const save = async (changes: Record<string, string | null>) => {
    setBusy(true);
    setError(null);
    setNote(null);
    try {
      setData(await api.putAdminConfig(changes));
      setDraft({});
      setNote('Saved. It applies everywhere within a few seconds.');
    } catch (err) {
      setError(errorOf(err, 'Not saved. Try again.'));
    } finally {
      setBusy(false);
    }
  };
  return (
    <section class="panel admin-card" aria-labelledby={`adm-${group}`}>
      <h2 id={`adm-${group}`} class="admin-card-title">
        {g.title}
      </h2>
      <p class="page-fine">{g.about}</p>
      {group === 'keys' && data && !data.canStoreKeys && <p class="form-error">Keys can be saved here once the deployment has an encryption secret (CONNECTOR_SECRET). Until then, set them in the deployment.</p>}
      {!data && !error && <p class="page-fine">Loading…</p>}
      {data && (
        <form
          class="admin-options"
          onSubmit={(e) => {
            e.preventDefault();
            if (dirty) void save(draft);
          }}
        >
          {options.map((o) => (
            <OptionRow key={o.key} option={o} value={values.get(o.key)} draft={draft[o.key]} disabled={busy || !!o.fixed || !!values.get(o.key)?.locked || (o.kind === 'secret' && !data.canStoreKeys)} onDraft={(v) => setDraft((d) => ({ ...d, [o.key]: v }))} onReset={() => void save({ [o.key]: null })} />
          ))}
          {group !== 'deployment' && (
            <div class="admin-row">
              <button type="submit" class="button-primary" disabled={!dirty || busy}>
                Save changes
              </button>
              {dirty && (
                <button type="button" class="link-button" onClick={() => setDraft({})}>
                  Undo
                </button>
              )}
              {note && (
                <span class="page-fine" role="status">
                  {note}
                </span>
              )}
            </div>
          )}
        </form>
      )}
      {error && (
        <p class="form-error" role="alert">
          {error}
        </p>
      )}
    </section>
  );
}

const SOURCE_WORDS = { admin: 'Changed here', deployment: 'From the deployment', default: 'Default' } as const;

function OptionRow({ option: o, value, draft, disabled, onDraft, onReset }: { option: ConfigOption; value?: ConfigValue; draft?: string | null; disabled: boolean; onDraft: (v: string) => void; onReset: () => void }) {
  const id = `opt-${o.key}`;
  const current = draft ?? value?.value ?? o.fallback;
  const input = (() => {
    switch (o.kind) {
      case 'switch':
        return (
          <label class="grant-label">
            <input id={id} type="checkbox" disabled={disabled} checked={current === (o.on ?? 'true')} onChange={(e) => onDraft(e.currentTarget.checked ? (o.on ?? 'true') : (o.off ?? ''))} />
            <span class="grant-name">{current === (o.on ?? 'true') ? 'On' : 'Off'}</span>
          </label>
        );
      case 'choice':
        return (
          <select id={id} class="field-input" disabled={disabled} value={current} onChange={(e) => onDraft(e.currentTarget.value)}>
            {o.choices!.map((c) => (
              <option key={c.value} value={c.value}>
                {c.label}
              </option>
            ))}
          </select>
        );
      case 'number':
        return <input id={id} class="field-input admin-number" type="number" min={o.min} max={o.max} disabled={disabled} value={current} onInput={(e) => onDraft(e.currentTarget.value)} />;
      case 'secret':
        return <input id={id} class="field-input" type="password" autoComplete="off" disabled={disabled} value={draft ?? ''} placeholder={value?.set ? 'Saved (hidden). Type to replace.' : 'Not set'} onInput={(e) => onDraft(e.currentTarget.value)} />;
      default:
        return <input id={id} class="field-input" type={o.kind === 'url' ? 'url' : 'text'} disabled={disabled} value={current} placeholder={o.fallback || 'Not set'} onInput={(e) => onDraft(e.currentTarget.value)} />;
    }
  })();
  return (
    <div class="admin-option" id={`setting-${o.key}`} data-changed={draft !== undefined || undefined}>
      <div class="admin-option-text">
        <span class="page-title-row">
          <label class="admin-option-label" for={id}>
            {o.label}
          </label>
          <CopyLink page={paths.admin(o.group)} at={`setting-${o.key}`} label={`Copy link to “${o.label}”`} what="Link to this setting" />
        </span>
        <span class="admin-option-help">{o.help}</span>
        <span class="admin-option-source">
          {value ? SOURCE_WORDS[value.source] : ''}
          {value?.source === 'admin' && value.updatedBy && value.updatedBy !== 'owner' ? ` by ${value.updatedBy}` : ''}
          {o.kind === 'secret' && value ? (value.set ? ' · set' : ' · not set') : ''}
          {o.fallback && o.kind !== 'secret' && value?.source !== 'default' ? ` · default ${o.choices?.find((c) => c.value === o.fallback)?.label ?? o.fallback}` : ''}
          {value?.locked ? ` · set by ${BRAND.name} for every organization` : ''}
        </span>
      </div>
      <div class="admin-option-input">
        {input}
        {value?.source === 'admin' && !o.fixed && (
          <button type="button" class="link-button" disabled={disabled} onClick={onReset}>
            Reset
          </button>
        )}
      </div>
    </div>
  );
}
