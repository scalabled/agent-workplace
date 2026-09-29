// Automations (biz-bot parity: Automations tab): work that starts by itself, on a schedule or when a public page
// changes, as a background job or a team project. The owner sets one up (or allows one the Chief proposes), pauses it,
// runs it now, and sees each run and whether they were told.
import {
  MIN_AUTOMATION_MINUTES,
  PAGE_CONDITIONS,
  type AutomationAction,
  type AutomationGate,
  type AutomationSpec,
  type AutomationView,
  type PageCondition,
} from '@headcount/protocol/ext/automations';
import { useEffect, useState } from 'preact/hooks';
import { api, ApiError } from '../api/client';
import { chiefName } from '../chief';
import { Link } from '../components/Link';
import { paths } from '../router';
import { PageTitle } from '../links/CopyLink';
import { CopyLink } from '../links/CopyLink';
import './pages.css';

const GATE_WORDS: Record<AutomationGate, string> = { on: 'After every run', quiet: 'Only when it matters', off: 'Never (just keep the history)' };
const CONDITION_WORDS: Record<PageCondition, string> = { changed: 'changes', contains: 'contains…', not_contains: 'no longer contains…', below: 'has a number below…', above: 'has a number above…' };
const EVERY = [
  { minutes: 15, label: '15 minutes' },
  { minutes: 60, label: 'hour' },
  { minutes: 360, label: '6 hours' },
  { minutes: 1440, label: 'day' },
  { minutes: 10080, label: 'week' },
];

const errorOf = (err: unknown, fallback: string) => (err instanceof ApiError ? err.message : fallback);
const when = (at?: string) => (at ? new Date(at).toLocaleString(undefined, { weekday: 'short', hour: '2-digit', minute: '2-digit', month: 'short', day: 'numeric' }) : '');

export function Automations() {
  const [list, setList] = useState<AutomationView[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);
  useEffect(() => {
    api
      .listAutomations()
      .then((r) => setList(r.automations))
      .catch((err) => setError(errorOf(err, 'Could not load the automations.')));
  }, []);
  const put = (a: AutomationView) => setList((l) => (l ? (l.some((x) => x.automationId === a.automationId) ? l.map((x) => (x.automationId === a.automationId ? a : x)) : [...l, a]) : [a]));
  const drop = (id: string) => setList((l) => (l ?? []).filter((x) => x.automationId !== id));
  return (
    <section class="page automations-page" aria-labelledby="automations-title">
      <header class="page-head">
        <PageTitle id="automations-title">Automations</PageTitle>
        <p class="page-lede">
          Work that starts by itself: on a schedule, or when a public page changes. Each run is a background job or a team project, and {chiefName.value} tells you as you choose. You can also just ask {chiefName.value}: “every Monday
          morning, check…”.
        </p>
      </header>
      {error && (
        <p class="form-error" role="alert">
          {error}
        </p>
      )}
      {!list && !error && <p class="page-fine">Loading…</p>}
      {list && list.length === 0 && !adding && <p class="panel empty-text automation-empty">No automations yet.</p>}
      <div class="automation-list">
        {(list ?? []).map((a) => (
          <AutomationCard key={a.automationId} automation={a} onChange={put} onRemoved={drop} />
        ))}
      </div>
      {list &&
        (adding ? (
          <AutomationForm
            onDone={(a) => {
              if (a) put(a);
              setAdding(false);
            }}
          />
        ) : (
          <button type="button" class="button-primary automation-add needs-owner" onClick={() => setAdding(true)}>
            Add an automation
          </button>
        ))}
    </section>
  );
}

function AutomationCard({ automation: a, onChange, onRemoved }: { automation: AutomationView; onChange: (a: AutomationView) => void; onRemoved: (id: string) => void }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [editing, setEditing] = useState(false);
  const [confirm, setConfirm] = useState(false);
  const run = async (fn: () => Promise<{ automation: AutomationView }>) => {
    setBusy(true);
    setError(null);
    try {
      onChange((await fn()).automation);
    } catch (err) {
      setError(errorOf(err, 'That did not go through. Try again.'));
    } finally {
      setBusy(false);
    }
  };
  if (editing)
    return (
      <AutomationForm
        initial={a}
        onDone={(next) => {
          if (next) onChange(next);
          setEditing(false);
        }}
      />
    );
  return (
    <article class="panel automation-card" data-enabled={a.enabled || undefined} aria-labelledby={`aut-${a.automationId}`}>
      <header class="connector-card-head">
        <div>
          <h2 id={`aut-${a.automationId}`} class="connector-name">
            <CopyLink page={paths.automations} at={`aut-${a.automationId}`} label={`Copy link to ${a.name}`} what="Link to this automation" />
            {a.name}
            {a.createdBy === 'chief' && <span class="connector-tag">Set up by {chiefName.value}</span>}
          </h2>
          <p class="connector-desc">{a.describe}</p>
        </div>
        <label class="grant-label automation-switch needs-owner">
          <input type="checkbox" checked={a.enabled} disabled={busy} aria-label={`${a.name}: ${a.enabled ? 'on' : 'paused'}`} onChange={(e) => void run(() => api.putAutomation(a.automationId, { enabled: (e.target as HTMLInputElement).checked }))} />
          <span class="grant-name">{a.enabled ? 'On' : 'Paused'}</span>
        </label>
      </header>
      <p class="automation-goal">{a.action.goal}</p>
      <p class="connector-meta">
        Tell me: {GATE_WORDS[a.gate].toLowerCase()}
        {a.enabled && a.nextAt ? ` · next ${a.kind === 'page' ? 'look' : 'run'} ${when(a.nextAt)}` : ''}
        {a.kind === 'page' && a.lastValue ? ` · last seen: ${a.lastValue.startsWith('sha256:') ? 'page fingerprint' : a.lastValue}` : ''}
      </p>
      {a.lastError && <p class="connector-error">{a.lastError}</p>}
      {a.history.length > 0 && (
        <details class="connector-tools">
          <summary>
            Runs ({a.runs}){a.lastResult ? ` · last: ${a.lastResult}` : ''}
          </summary>
          <ul class="automation-runs">
            {a.history.map((h) => (
              <li key={h.runId} data-status={h.status}>
                <span class="tabular">{when(h.firedAt)}</span> · {h.context} · <strong>{h.status}</strong>
                {h.notified !== undefined && <span class="connector-meta"> · {h.notified ? 'you were told' : 'kept quiet'}{h.why ? ` (${h.why})` : ''}</span>}
                {h.runKind === 'project' && h.status !== 'refused' && (
                  <>
                    {' '}
                    <Link href={paths.project(h.runId)}>Open the project</Link>
                  </>
                )}
              </li>
            ))}
          </ul>
        </details>
      )}
      {error && (
        <p class="form-error" role="alert">
          {error}
        </p>
      )}
      <div class="settings-actions connector-actions needs-owner">
        <button type="button" class="button-quiet button-small" disabled={busy} onClick={() => void run(() => api.runAutomation(a.automationId))}>
          Run now
        </button>
        <button type="button" class="button-quiet button-small" disabled={busy} onClick={() => setEditing(true)}>
          Edit
        </button>
        {confirm ? (
          <>
            <button
              type="button"
              class="button-danger button-small"
              disabled={busy}
              onClick={() =>
                void api
                  .removeAutomation(a.automationId)
                  .then(() => onRemoved(a.automationId))
                  .catch((err) => setError(errorOf(err, 'That did not go through.')))
              }
            >
              Delete {a.name}
            </button>
            <button type="button" class="button-quiet button-small" onClick={() => setConfirm(false)}>
              Keep it
            </button>
          </>
        ) : (
          <button type="button" class="button-quiet button-small" onClick={() => setConfirm(true)}>
            Delete
          </button>
        )}
      </div>
    </article>
  );
}

function AutomationForm({ initial, onDone }: { initial?: AutomationView; onDone: (a: AutomationView | null) => void }) {
  const [name, setName] = useState(initial?.name ?? '');
  const [kind, setKind] = useState<AutomationSpec['kind']>(initial?.kind ?? 'schedule');
  const [daily, setDaily] = useState(!!initial?.schedule?.dailyAt);
  const [every, setEvery] = useState(initial?.schedule?.everyMinutes ?? 1440);
  const [dailyAt, setDailyAt] = useState(initial?.schedule?.dailyAt ?? '09:00');
  const [url, setUrl] = useState(initial?.page?.url ?? '');
  const [condition, setCondition] = useState<PageCondition>(initial?.page?.condition ?? 'changed');
  const [value, setValue] = useState(initial?.page?.value ?? '');
  const [extract, setExtract] = useState(initial?.page?.extract ?? '');
  const [pageEvery, setPageEvery] = useState(initial?.page?.everyMinutes ?? 60);
  const [type, setType] = useState<AutomationAction>(initial?.action.type ?? 'job');
  const [autoStart, setAutoStart] = useState(initial?.action.autoStart !== false);
  const [goal, setGoal] = useState(initial?.action.goal ?? '');
  const [gate, setGate] = useState<AutomationGate>(initial?.gate ?? 'quiet');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const save = async (e: Event) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    const spec: Partial<AutomationSpec> = {
      name: name.trim(),
      kind,
      ...(kind === 'schedule' ? { schedule: daily ? { dailyAt } : { everyMinutes: every } } : { page: { url: url.trim(), condition, ...(value.trim() ? { value: value.trim() } : {}), ...(extract.trim() ? { extract: extract.trim() } : {}), everyMinutes: pageEvery } }),
      action: { type, goal: goal.trim(), ...(type === 'project' ? { autoStart } : {}) },
      gate,
    };
    try {
      const r = initial ? await api.putAutomation(initial.automationId, spec) : await api.addAutomation(spec);
      onDone(r.automation);
    } catch (err) {
      setError(errorOf(err, 'That did not save. Try again.'));
    } finally {
      setBusy(false);
    }
  };
  return (
    <form class="panel automation-form" onSubmit={save} aria-label={initial ? `Edit ${initial.name}` : 'New automation'}>
      <h2 class="panel-title">{initial ? `Edit “${initial.name}”` : 'A new automation'}</h2>
      <label class="field">
        <span class="field-label">Name</span>
        <input class="field-input" maxLength={120} value={name} placeholder="Monday competitor prices" onInput={(e) => setName((e.target as HTMLInputElement).value)} />
      </label>
      <label class="field field-inline">
        <span class="field-label">Start</span>
        <select class="field-input" value={kind} onChange={(e) => setKind((e.target as HTMLSelectElement).value as AutomationSpec['kind'])}>
          <option value="schedule">On a schedule</option>
          <option value="page">When a web page changes</option>
        </select>
      </label>
      {kind === 'schedule' ? (
        <div class="automation-when">
          <label class="field field-inline">
            <span class="field-label">Every</span>
            <select class="field-input" value={daily ? 'daily' : String(every)} onChange={(e) => {
              const v = (e.target as HTMLSelectElement).value;
              if (v === 'daily') setDaily(true);
              else {
                setDaily(false);
                setEvery(Number(v));
              }
            }}>
              {EVERY.map((o) => (
                <option key={o.minutes} value={String(o.minutes)}>
                  {o.label}
                </option>
              ))}
              <option value="daily">day, at a set time</option>
            </select>
          </label>
          {daily && (
            <label class="field field-inline">
              <span class="field-label">At (UTC)</span>
              <input class="field-input" type="time" value={dailyAt} onInput={(e) => setDailyAt((e.target as HTMLInputElement).value)} />
            </label>
          )}
        </div>
      ) : (
        <div class="automation-when">
          <label class="field">
            <span class="field-label">Page (https)</span>
            <input class="field-input" type="url" value={url} placeholder="https://example.com/product" onInput={(e) => setUrl((e.target as HTMLInputElement).value)} />
          </label>
          <label class="field field-inline">
            <span class="field-label">When it</span>
            <select class="field-input" value={condition} onChange={(e) => setCondition((e.target as HTMLSelectElement).value as PageCondition)}>
              {PAGE_CONDITIONS.map((c) => (
                <option key={c} value={c}>
                  {CONDITION_WORDS[c]}
                </option>
              ))}
            </select>
          </label>
          {condition !== 'changed' && (
            <label class="field">
              <span class="field-label">{condition === 'below' || condition === 'above' ? 'Number' : 'Text'}</span>
              <input class="field-input" value={value} onInput={(e) => setValue((e.target as HTMLInputElement).value)} />
            </label>
          )}
          <label class="field">
            <span class="field-label">Watch only this part (optional regular expression; its first group)</span>
            <input class="field-input" value={extract} placeholder="Price:\s*\$([\d.]+)" onInput={(e) => setExtract((e.target as HTMLInputElement).value)} />
          </label>
          <label class="field field-inline">
            <span class="field-label">Look every</span>
            <select class="field-input" value={String(pageEvery)} onChange={(e) => setPageEvery(Number((e.target as HTMLSelectElement).value))}>
              {EVERY.filter((o) => o.minutes >= MIN_AUTOMATION_MINUTES).map((o) => (
                <option key={o.minutes} value={String(o.minutes)}>
                  {o.label}
                </option>
              ))}
            </select>
          </label>
        </div>
      )}
      <label class="field field-inline">
        <span class="field-label">Then</span>
        <select class="field-input" value={type} onChange={(e) => setType((e.target as HTMLSelectElement).value as AutomationAction)}>
          <option value="job">A background job</option>
          <option value="project">A team project</option>
        </select>
      </label>
      {type === 'project' && (
        <label class="grant-label">
          <input type="checkbox" checked={autoStart} onChange={(e) => setAutoStart((e.target as HTMLInputElement).checked)} />
          <span>
            <span class="grant-name">Start the plan without asking me</span>
            <span class="grant-desc">Otherwise each plan waits in your Inbox.</span>
          </span>
        </label>
      )}
      <label class="field">
        <span class="field-label">What each run should do</span>
        <textarea class="note-input" rows={3} maxLength={4000} value={goal} placeholder="Check the three competitors’ coffee prices and say what changed." onInput={(e) => setGoal((e.target as HTMLTextAreaElement).value)} />
      </label>
      <label class="field field-inline">
        <span class="field-label">Tell me</span>
        <select class="field-input" value={gate} onChange={(e) => setGate((e.target as HTMLSelectElement).value as AutomationGate)}>
          {(Object.keys(GATE_WORDS) as AutomationGate[]).map((g) => (
            <option key={g} value={g}>
              {GATE_WORDS[g]}
            </option>
          ))}
        </select>
      </label>
      {error && (
        <p class="form-error" role="alert">
          {error}
        </p>
      )}
      <div class="settings-actions">
        <button type="submit" class="button-primary" disabled={busy || !name.trim() || goal.trim().length < 8}>
          {initial ? 'Save' : 'Add it'}
        </button>
        <button type="button" class="button-quiet" onClick={() => onDone(null)}>
          Cancel
        </button>
      </div>
    </form>
  );
}
