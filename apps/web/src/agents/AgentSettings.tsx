// How a coworker works, as the owner sets it (biz-bot parity: the agent form — instructions, skills, tools, model):
// their instructions (edit, reset to the catalog, earlier versions), which tools they may use, which model answers
// for them, and their skills (on or off, with each skill's full method).
import type { AgentView, ModelsResponse, ReasoningChoice, ToolGrantId } from '@headcount/protocol/ext/agents';
import { INSTRUCTIONS_MAX } from '@headcount/protocol/ext/agents';
import { useEffect, useState } from 'preact/hooks';
import { api, ApiError } from '../api/client';
import { Link } from '../components/Link';
import { Markdown } from '../components/Markdown';
import { paths } from '../router';

export function AgentSettings({ view, onChange }: { view: AgentView; onChange: (v: AgentView) => void }) {
  const [text, setText] = useState(view.instructions);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState<string | null>(null);
  const [models, setModels] = useState<ModelsResponse | null>(null);
  useEffect(() => setText(view.instructions), [view.instructions]);
  useEffect(() => {
    api
      .listModels()
      .then(setModels)
      .catch(() => setModels({ providers: [] }));
  }, []);
  const first = view.name.split(' ')[0];
  const run = async (what: string, call: () => Promise<AgentView>) => {
    setBusy(true);
    setError(null);
    setSaved(null);
    try {
      onChange(await call());
      setSaved(what);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'That did not save. Try again.');
    } finally {
      setBusy(false);
    }
  };
  const patch = (what: string, p: Parameters<typeof api.putAgent>[1]) => run(what, () => api.putAgent(view.personaId, p));
  const choice = view.config.model ?? {};
  const provider = models?.providers.find((p) => p.id === choice.provider);
  return (
    <div class="agent-settings">
      <section class="profile-block" aria-labelledby="instr-title">
        <h2 id="instr-title">
          How {first} works {view.edited && <span class="prompt-origin">Your words</span>}
        </h2>
        <p class="profile-note">These instructions go into every piece of project work and every review {first} does. The prompt tab shows exactly where.</p>
        <label class="visually-hidden" for="instr">
          Instructions
        </label>
        <textarea id="instr" class="field-input instructions-input" rows={10} maxLength={INSTRUCTIONS_MAX} value={text} onInput={(e) => setText((e.target as HTMLTextAreaElement).value)} />
        <div class="settings-actions">
          <button type="button" class="button-primary" disabled={busy || text.trim() === view.instructions.trim() || !text.trim()} onClick={() => void patch('Instructions saved.', { instructions: text })}>
            Save instructions
          </button>
          {view.edited && (
            <button type="button" class="button-quiet" disabled={busy} onClick={() => void patch('Back to the catalog instructions.', { instructions: null, note: 'Reset to the catalog' })}>
              Use the catalog’s
            </button>
          )}
          {view.history.length > 0 && (
            <select
              class="field-input field-compact"
              aria-label="Earlier instructions"
              value=""
              onChange={(e) => {
                const i = Number((e.target as HTMLSelectElement).value);
                const h = view.history[i];
                if (h) setText(h.instructions ?? view.catalogInstructions);
              }}
            >
              <option value="">Earlier versions…</option>
              {view.history.map((h, i) => (
                <option key={i} value={i}>
                  {new Date(h.at).toLocaleString()} · {h.instructions ? 'your words' : 'the catalog’s'}
                  {h.note ? ` · ${h.note}` : ''}
                </option>
              ))}
            </select>
          )}
        </div>
      </section>

      <section class="profile-block" aria-labelledby="tools-title">
        <h2 id="tools-title">Tools</h2>
        <ul class="grant-list">
          {view.grants.map((g) => (
            <li key={g.id} class="grant">
              <label class="grant-label">
                <input type="checkbox" checked={g.granted} disabled={busy || !g.available} onChange={(e) => void patch(`${g.label}: ${(e.target as HTMLInputElement).checked ? 'on' : 'off'}.`, { tools: { [g.id as ToolGrantId]: (e.target as HTMLInputElement).checked } })} />
                <span>
                  <span class="grant-name">{g.label}</span>
                  <span class="grant-desc">{g.note ?? g.description}</span>
                </span>
              </label>
            </li>
          ))}
        </ul>
      </section>

      <section class="profile-block" aria-labelledby="connectors-title">
        <h2 id="connectors-title">Connectors</h2>
        {!view.connectors?.length ? (
          <p class="profile-note">
            No services are connected yet. <Link href={paths.connectors}>Connect one</Link> (GitHub, Notion, docs servers…) and {first} can use it in project work.
          </p>
        ) : (
          <>
            <p class="profile-note">
              Services {first} may use in project work. Calls that change things wait for your OK. <Link href={paths.connectors}>All connectors</Link>
            </p>
            <ul class="grant-list">
              {view.connectors.map((c) => (
                <li key={c.connectorId} class="grant">
                  <label class="grant-label">
                    <input
                      type="checkbox"
                      checked={c.granted}
                      disabled={busy || c.everyone}
                      onChange={(e) => {
                        const on = (e.target as HTMLInputElement).checked;
                        const next = new Set(view.config.connectors ?? []);
                        if (on) next.add(c.connectorId);
                        else next.delete(c.connectorId);
                        void patch(`${c.name}: ${on ? 'on' : 'off'}.`, { connectors: [...next] });
                      }}
                    />
                    <span>
                      <span class="grant-name">{c.name}</span>
                      <span class="grant-desc">
                        {c.tools} {c.tools === 1 ? 'tool' : 'tools'}
                        {c.everyone ? ' · every coworker may use it' : ''}
                        {c.status !== 'ready' ? ' · not ready' : ''}
                      </span>
                    </span>
                  </label>
                </li>
              ))}
            </ul>
          </>
        )}
      </section>

      <section class="profile-block" aria-labelledby="model-title">
        <h2 id="model-title">Model</h2>
        <p class="profile-note">
          {view.model.resolved ? (
            <>
              Answering now: <strong>{view.model.resolved.provider}</strong> · {view.model.resolved.model}.
            </>
          ) : (
            'No model can answer yet: add a provider key.'
          )}{' '}
          The catalog prefers {view.model.policy.providerPreference.join(', ') || 'any provider'} on the {view.model.policy.tier} tier
          {view.model.policy.reasoning ? `, ${view.model.policy.reasoning} reasoning` : ''}.
        </p>
        <div class="model-picks">
          <label class="field field-inline">
            <span class="field-label">Provider</span>
            <select class="field-input" value={choice.provider ?? ''} disabled={busy} onChange={(e) => void patch('Model saved.', { model: (e.target as HTMLSelectElement).value ? { provider: (e.target as HTMLSelectElement).value, ...(choice.reasoning ? { reasoning: choice.reasoning } : {}) } : choice.reasoning ? { reasoning: choice.reasoning } : null })}>
              <option value="">The catalog’s preference</option>
              {(models?.providers ?? []).map((p) => (
                <option key={p.id} value={p.id} disabled={!p.configured}>
                  {p.label}
                  {p.configured ? '' : ' (no key)'}
                </option>
              ))}
            </select>
          </label>
          {provider && provider.models.length > 0 && (
            <label class="field field-inline">
              <span class="field-label">Model</span>
              <select class="field-input" value={choice.model ?? ''} disabled={busy} onChange={(e) => void patch('Model saved.', { model: { provider: provider.id, ...((e.target as HTMLSelectElement).value ? { model: (e.target as HTMLSelectElement).value } : {}), ...(choice.reasoning ? { reasoning: choice.reasoning } : {}) } })}>
                <option value="">Its default</option>
                {provider.models.map((m) => (
                  <option key={m.id} value={m.id}>
                    {m.id} ({m.latencyClass})
                  </option>
                ))}
              </select>
            </label>
          )}
          <label class="field field-inline">
            <span class="field-label">Reasoning</span>
            <select class="field-input" value={choice.reasoning ?? 'default'} disabled={busy} onChange={(e) => void patch('Reasoning saved.', { model: { ...choice, reasoning: (e.target as HTMLSelectElement).value as ReasoningChoice } })}>
              <option value="default">Default</option>
              <option value="low">Low</option>
              <option value="medium">Medium</option>
              <option value="high">High</option>
            </select>
          </label>
        </div>
      </section>

      <section class="profile-block" aria-labelledby="skills-title">
        <h2 id="skills-title">Skills</h2>
        <p class="profile-note">
          {first}’s prompt lists each skill that is on; the full method loads when a piece of work calls for it. <Link href={paths.skills}>All skills</Link>
        </p>
        <ul class="skill-list">
          {view.skills.map((s) => (
            <li key={s.id} class="skill-item" data-on={s.enabled || undefined}>
              <details>
                <summary>
                  <label class="grant-label" onClick={(e) => e.stopPropagation()}>
                    <input
                      type="checkbox"
                      checked={s.enabled}
                      disabled={busy}
                      aria-label={`${s.name}: ${s.enabled ? 'on' : 'off'}`}
                      onChange={(e) => {
                        const on = (e.target as HTMLInputElement).checked;
                        const off = new Set(view.config.skillsOff ?? []);
                        if (on) off.delete(s.id);
                        else off.add(s.id);
                        void patch(`${s.name}: ${on ? 'on' : 'off'}.`, { skillsOff: [...off] });
                      }}
                    />
                  </label>
                  <span class="skill-name">
                    {s.icon} {s.name}
                  </span>
                  <span class="skill-meta">
                    {s.level === 'primary' ? 'Signature' : 'Also'} · v{s.version}
                    {s.edited ? ' · edited' : ''}
                  </span>
                </summary>
                <div class="skill-body">
                  <p class="skill-when">Use when {s.when}</p>
                  <Markdown text={s.instructions} />
                  {s.quality_checks.length > 0 && (
                    <>
                      <p class="skill-sub">Quality checks</p>
                      <ul class="skill-checks">
                        {s.quality_checks.map((q, i) => (
                          <li key={i}>{q}</li>
                        ))}
                      </ul>
                    </>
                  )}
                  <Link href={paths.skill(s.id)}>Open the skill</Link>
                </div>
              </details>
            </li>
          ))}
        </ul>
      </section>
      {(error || saved) && (
        <p class={error ? 'form-error' : 'page-fine'} role={error ? 'alert' : 'status'}>
          {error ?? saved}
        </p>
      )}
    </div>
  );
}
