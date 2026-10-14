// The company's second brain, as its steward left it (ext/team.ts): when it was last tidied, duplicates merged, the
// memories that contradict each other or look out of date (each linked, each can be forgotten here), and what the
// Handbook could say (added with one click). "Tidy now" runs it at once; owners turn the weekly tidy on or off.
import { firstName } from '@headcount/catalog';
import type { SecondBrainReport, TeamResponse } from '@headcount/protocol/ext/team';
import { HANDBOOK_SECTIONS } from '@headcount/protocol/ext/memory';
import { useEffect, useState } from 'preact/hooks';
import { api, ApiError } from '../api/client';
import { isOwner, mayContribute } from '../auth/session';
import { catalog } from '../catalog';
import { Link } from '../components/Link';
import { CopyLink } from '../links/CopyLink';
import { showToast } from '../links/links';
import { linkTo, paths } from '../router';

const errorOf = (err: unknown, fallback: string) => (err instanceof ApiError ? err.message : fallback);
const when = (at: string) => new Date(at).toLocaleString(undefined, { weekday: 'short', month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });
const SECTION = Object.fromEntries(HANDBOOK_SECTIONS.map((s) => [s.id, s.title])) as Record<string, string>;

export function SecondBrain({ memoryText, onForget }: { memoryText: (id: string) => string | null; onForget: (id: string) => void }) {
  const [team, setTeam] = useState<TeamResponse | null>(null);
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    api
      .getTeam()
      .then(setTeam)
      .catch(() => undefined);
  }, []);
  if (!team?.secondBrain) return null;
  const sb = team.secondBrain;
  const steward = catalog.value?.persona(sb.steward);
  const first = steward ? firstName(steward.name) : 'The knowledge manager';
  const r: SecondBrainReport | undefined = sb.last;
  const tidy = async () => {
    setBusy(true);
    try {
      const out = await api.startTeamTask(sb.steward);
      showToast(out.say, 5000);
      setTeam(await api.getTeam());
    } catch (err) {
      showToast(errorOf(err, 'The tidy did not run. Try again.'), 5000);
    } finally {
      setBusy(false);
    }
  };
  const forget = async (id: string) => {
    try {
      await api.removeMemory(id);
      onForget(id);
      setTeam((t) => (t && t.secondBrain.last ? { ...t, secondBrain: { ...t.secondBrain, last: { ...t.secondBrain.last, conflicts: t.secondBrain.last.conflicts.filter((c) => c.a !== id && c.b !== id), outdated: t.secondBrain.last.outdated.filter((o) => o.memoryId !== id) } } } : t));
    } catch (err) {
      showToast(errorOf(err, 'That was not forgotten. Try again.'));
    }
  };
  const memo = (id: string) => (
    <Link href={linkTo(paths.memory, id)} class="second-brain-memory">
      «{memoryText(id) ?? 'a memory'}»
    </Link>
  );
  return (
    <section class="panel second-brain" id="second-brain" aria-labelledby="second-brain-title">
      <header class="doc-threads-head">
        <div class="page-title-row">
          <h2 id="second-brain-title" class="admin-card-title">
            The second brain
          </h2>
          <CopyLink page={paths.memory} at="second-brain" label="Copy link to the second brain report" what="Link to the report" />
        </div>
        <span class="team-actions">
          {mayContribute.value && (
            <button type="button" class="button-quiet button-small" disabled={busy} onClick={() => void tidy()}>
              {busy ? 'Tidying…' : 'Tidy now'}
            </button>
          )}
          {isOwner.value && (
            <label class="grant-label team-toggle">
              <input type="checkbox" checked={sb.on} onChange={async (e) => setTeam(await api.putSecondBrain(e.currentTarget.checked))} />
              <span class="grant-name">Weekly</span>
            </label>
          )}
        </span>
      </header>
      <p class="page-fine">
        <Link href={paths.coworker(sb.steward)}>{steward?.name ?? first}</Link> keeps what the business knows in order{sb.on ? ', every week' : ' (the weekly tidy is paused)'}.{' '}
        {r ? `Last tidied ${when(r.at)}: looked over ${r.checked} memories${r.merged ? `, merged ${r.merged} duplicate${r.merged === 1 ? '' : 's'}` : ''}.` : 'Not tidied yet.'}
      </p>
      {r && <p class="second-brain-summary">{r.summary}</p>}
      {r && (r.conflicts.length > 0 || r.outdated.length > 0) && (
        <>
          <h3 class="second-brain-sub">To check</h3>
          <ul class="second-brain-list">
            {r.conflicts.map((c) => (
              <li key={`${c.a}-${c.b}`}>
                <span>
                  {memo(c.a)} and {memo(c.b)} don't agree: {c.note}
                </span>
                {mayContribute.value && (
                  <span class="team-actions">
                    <button type="button" class="link-button" onClick={() => void forget(c.a)}>
                      Forget the first
                    </button>
                    <button type="button" class="link-button" onClick={() => void forget(c.b)}>
                      Forget the second
                    </button>
                  </span>
                )}
              </li>
            ))}
            {r.outdated.map((o) => (
              <li key={o.memoryId}>
                <span>
                  {memo(o.memoryId)} may be out of date: {o.note}
                </span>
                {mayContribute.value && (
                  <button type="button" class="link-button" onClick={() => void forget(o.memoryId)}>
                    Forget it
                  </button>
                )}
              </li>
            ))}
          </ul>
        </>
      )}
      {r && r.handbook.length > 0 && (
        <>
          <h3 class="second-brain-sub">For the Handbook</h3>
          <ul class="second-brain-list">
            {r.handbook.map((h) => (
              <li key={`${h.section}-${h.suggestion.slice(0, 20)}`}>
                <span>
                  <Link href={linkTo(paths.handbook, `hb-${h.section}`)}>{SECTION[h.section]}</Link>: {h.suggestion}
                </span>
                {mayContribute.value && (
                  <button type="button" class="link-button" onClick={async () => setTeam(await api.applyHandbookSuggestion(h.section, h.suggestion))}>
                    Add it
                  </button>
                )}
              </li>
            ))}
          </ul>
        </>
      )}
    </section>
  );
}
