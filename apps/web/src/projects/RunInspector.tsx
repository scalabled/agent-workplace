// The run inspector (biz-bot has none): every model call a project made — who, which model, the exact system prompt
// and prompt, each tool call with its arguments and result, the output, sources, tokens and time.
import type { RunTrace } from '@headcount/protocol/ext/agents';
import { useEffect, useState } from 'preact/hooks';
import { api, ApiError } from '../api/client';
import { catalog } from '../catalog';
import { Sheet } from '../components/Sheet';
import { Sources } from '../components/Sources';

const PHASE: Record<RunTrace['phase'], string> = {
  plan: 'Planning',
  work: 'Work',
  review: 'Review',
  revise: 'Revision',
  deliverable: 'Deliverable',
  qa: 'Deliverable check',
  ask: 'Consultation',
  discussion: 'Discussion',
};

const nf = new Intl.NumberFormat('en-US');

export function RunInspector({ projectId, stepId, title, onClose }: { projectId: string; stepId?: string | null; title: string; onClose: () => void }) {
  const [runs, setRuns] = useState<RunTrace[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    let live = true;
    api
      .projectRuns(projectId, stepId ?? undefined)
      .then((r) => live && setRuns(r.runs))
      .catch((err) => live && setError(err instanceof ApiError ? err.message : 'Could not load the calls.'));
    return () => void (live = false);
  }, [projectId, stepId]);
  const total = (runs ?? []).reduce((n, r) => n + r.usage.input + r.usage.output, 0);
  return (
    <Sheet title={title} onClose={onClose} label={`Model calls: ${title}`}>
      {error && (
        <p class="form-error" role="alert">
          {error}
        </p>
      )}
      {!runs && !error && <p class="page-fine">Loading the calls…</p>}
      {runs && !runs.length && <p class="page-fine">No model calls yet.</p>}
      {runs && runs.length > 0 && (
        <p class="page-fine tabular">
          {runs.length} call{runs.length === 1 ? '' : 's'} · {nf.format(total)} tokens
        </p>
      )}
      <ol class="run-list">
        {(runs ?? []).map((r) => (
          <RunCard key={r.runId} run={r} />
        ))}
      </ol>
    </Sheet>
  );
}

function RunCard({ run: r }: { run: RunTrace }) {
  const who = catalog.value?.persona(r.personaId)?.name ?? r.personaId;
  return (
    <li class="run" data-phase={r.phase}>
      <header class="run-head">
        <span class="run-phase">{PHASE[r.phase]}</span>
        <span class="run-who">{who}</span>
        <span class="run-meta tabular">
          {r.provider} · {r.model} · {nf.format(r.usage.input)} in / {nf.format(r.usage.output)} out
          {r.usage.usd !== null && r.usage.usd > 0 ? ` · $${r.usage.usd.toFixed(4)}` : ''} · {(r.ms / 1000).toFixed(1)} s{r.finish !== 'stop' ? ` · ${r.finish}` : ''}
        </span>
      </header>
      <details class="run-part">
        <summary>System prompt</summary>
        <pre class="run-pre">{r.system}</pre>
      </details>
      <details class="run-part">
        <summary>Prompt</summary>
        <pre class="run-pre">{r.prompt}</pre>
      </details>
      {r.calls.length > 0 && (
        <details class="run-part" open>
          <summary>
            Tool calls ({r.calls.length}): {r.calls.map((c) => c.name).join(', ')}
          </summary>
          <ol class="run-calls">
            {r.calls.map((c, i) => (
              <li key={i} class="run-call" data-ok={c.ok || undefined}>
                <p class="run-call-name">
                  {c.name}
                  {!c.ok && <span class="run-call-err"> · failed</span>}
                </p>
                <pre class="run-pre run-pre-sm">{prettyJson(c.args)}</pre>
                {c.result && <pre class="run-pre run-pre-sm">{prettyJson(c.result)}</pre>}
              </li>
            ))}
          </ol>
        </details>
      )}
      {r.text && (
        <details class="run-part">
          <summary>Text the model wrote</summary>
          <pre class="run-pre">{r.text}</pre>
        </details>
      )}
      <Sources sources={r.sources} max={5} />
    </li>
  );
}

function prettyJson(s: string): string {
  try {
    return JSON.stringify(JSON.parse(s), null, 2);
  } catch {
    return s;
  }
}
