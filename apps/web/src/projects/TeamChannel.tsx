// The team channel on the project page (biz-bot parity: the room transcript and its graph): everything the team says
// to each other and to the owner, live — work handed in, reviews, questions between teammates and their answers,
// hand-offs, meetings — and the owner's own posts (@Name to address someone; they answer at once). Meetings themselves
// are called, heard and joined from the Meetings panel.
import type { ChannelEntry, TeamProjectSnapshot } from '@headcount/protocol/ext/projects';
import { useEffect, useMemo, useRef, useState } from 'preact/hooks';
import { linkTarget, paths } from '../router';
import { api, ApiError } from '../api/client';
import { MemberFace } from '../components/ProjectCard';
import { mergeChannel, projectChannels } from '../store';
import { CopyLink } from '../links/CopyLink';
import { Markdown } from '../components/Markdown';

const KIND: Record<ChannelEntry['kind'], string> = {
  owner: 'You',
  work: 'Handed in',
  review: 'Review',
  ask: 'Asks',
  answer: 'Answers',
  handoff: 'Hand-off',
  discussion: 'Discussion',
  decision: 'Decision',
  system: 'Note',
  whisper: 'Whispered',
};

const PHASE: Record<NonNullable<ChannelEntry['phase']>, string> = { framing: 'frames it', opening: 'opens', debate: 'debates', synthesis: 'sums up', reply: 'answers', moderator: 'moderates' };
const SHOWN = 30;

export function TeamChannel({ project }: { project: TeamProjectSnapshot }) {
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [all, setAll] = useState(false);
  const id = project.projectId;
  useEffect(() => {
    api
      .projectChannel(id)
      .then((r) => mergeChannel(id, r.entries))
      .catch(() => undefined);
  }, [id]);
  const entries = projectChannels.value[id] ?? [];
  const shown = all ? entries : entries.slice(-SHOWN);
  // Newest last, like a chat: follow new lines unless the owner has scrolled up to read.
  const list = useRef<HTMLOListElement>(null);
  const pinned = useRef(true);
  useEffect(() => {
    const el = list.current;
    if (el && pinned.current) el.scrollTop = el.scrollHeight;
  }, [entries.length]);
  // A link to one line: show every line and stay with it.
  useEffect(() => {
    if (!linkTarget.value?.startsWith('ch-')) return;
    pinned.current = false;
    setAll(true);
  }, [linkTarget.value]);
  const member = (who: string) => project.team.find((m) => m.personaId === who);
  const nameOf = (who?: string) => (!who ? 'the team' : who === 'owner' ? 'you' : who === 'chief' ? 'Chief of Staff' : (member(who)?.name.split(' ')[0] ?? who));
  const open = project.status !== 'cancelled';
  const post = async (e: Event) => {
    e.preventDefault();
    const t = text.trim();
    if (!t || busy) return;
    setBusy(true);
    setError(null);
    try {
      const r = await api.postChannel(id, t);
      mergeChannel(id, [r.entry]);
      setText('');
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'That did not send. Try again.');
    } finally {
      setBusy(false);
    }
  };
  return (
    <section class="panel team-channel" aria-labelledby="channel-title">
      <header class="plan-head">
        <h2 id="channel-title" class="panel-title">
          Team channel
        </h2>
      </header>
      {entries.length > SHOWN && !all && (
        <button type="button" class="link-button channel-more" onClick={() => setAll(true)}>
          Show all {entries.length}
        </button>
      )}
      {!entries.length && <p class="page-fine">Nothing said yet. The team writes here as they work, and you can too.</p>}
      <ol
        class="channel-list"
        ref={list}
        onScroll={(e) => {
          const el = e.currentTarget;
          pinned.current = el.scrollHeight - el.scrollTop - el.clientHeight < 40;
        }}
      >
        {shown.map((e) => {
          const who = e.fromId === 'owner' || e.fromId === 'chief' ? null : member(e.fromId);
          return (
            <li key={e.seq} id={`ch-${e.seq}`} class="channel-entry" data-kind={e.kind} data-owner={e.fromId === 'owner' || undefined}>
              <span class="channel-face" aria-hidden="true">
                {who ? <MemberFace member={who} /> : <span class="face-initials">{e.fromId === 'owner' ? 'You' : 'CoS'}</span>}
              </span>
              <div class="channel-main">
                <p class="channel-head">
                  <span class="channel-who">{e.fromId === 'owner' ? 'You' : nameOf(e.fromId)}</span>
                  {e.toId && <span class="channel-to"> → {nameOf(e.toId)}</span>}
                  <CopyLink page={paths.project(id)} at={`ch-${e.seq}`} label="Copy link to this line" what="Link to this line" class="channel-link" />
                  {e.kind !== 'owner' && <span class="channel-kind">{e.kind === 'discussion' && e.phase ? (e.phase === 'moderator' || e.phase === 'reply' ? PHASE[e.phase] : `${PHASE[e.phase]} · round ${e.round ?? 1}`) : KIND[e.kind]}</span>}
                </p>
                <Markdown text={e.text} class="channel-text" />
              </div>
            </li>
          );
        })}
      </ol>
      {open && (
        <form class="note-form channel-form needs-contributor" onSubmit={post}>
          <label class="visually-hidden" for="channel-text">
            Write to the team
          </label>
          <textarea
            id="channel-text"
            class="channel-input"
            rows={2}
            maxLength={2000}
            placeholder={`Write to the team. @${project.team[1]?.name.split(' ')[0] ?? 'Name'} to ask someone; they answer right away.`}
            value={text}
            onInput={(e) => setText((e.target as HTMLTextAreaElement).value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !e.shiftKey) void post(e);
            }}
          />
          <button type="submit" class="button-primary" disabled={!text.trim() || busy}>
            Post
          </button>
        </form>
      )}
      {error && (
        <p class="form-error" role="alert">
          {error}
        </p>
      )}
      <TalkGraph project={project} entries={entries} />
    </section>
  );
}

/** Who talked to whom (biz-bot graph.js Room view, compact): members on a ring, lines weighted by how often. */
export function TalkGraph({ project, entries }: { project: TeamProjectSnapshot; entries: readonly ChannelEntry[] }) {
  const people = ['owner', ...project.team.map((m) => m.personaId)];
  const edges = useMemo(() => {
    const count = new Map<string, number>();
    const order = (x: string, y: string) => people.indexOf(x) - people.indexOf(y);
    for (const e of entries) {
      if (!e.toId || e.fromId === 'chief' || e.toId === e.fromId) continue;
      if (!['ask', 'answer', 'handoff', 'review', 'owner'].includes(e.kind)) continue;
      if (!people.includes(e.fromId) || !people.includes(e.toId)) continue;
      const key = [e.fromId, e.toId].sort(order).join('|');
      count.set(key, (count.get(key) ?? 0) + 1);
    }
    return [...count.entries()].map(([k, n]) => ({ a: k.split('|')[0]!, b: k.split('|')[1]!, n }));
  }, [entries, project.team]);
  if (!edges.length) return null;
  const R = 88;
  const C = 110;
  const at = (id: string) => {
    const i = people.indexOf(id);
    const t = (i / people.length) * Math.PI * 2 - Math.PI / 2;
    return { x: C + R * Math.cos(t), y: C + R * Math.sin(t) };
  };
  const label = (id: string) => (id === 'owner' ? 'You' : (project.team.find((m) => m.personaId === id)?.name.split(' ')[0] ?? id));
  const max = Math.max(...edges.map((e) => e.n));
  return (
    <figure class="talk-graph">
      <figcaption class="field-label">Who talked to whom</figcaption>
      <svg viewBox="0 0 220 220" width="220" height="220" role="img" aria-label={edges.map((e) => `${label(e.a)} and ${label(e.b)}: ${e.n}`).join('; ')}>
        {edges.map((e) => {
          const p = at(e.a);
          const q = at(e.b);
          return <line key={`${e.a}-${e.b}`} class="talk-edge" x1={p.x} y1={p.y} x2={q.x} y2={q.y} stroke-width={1 + (3 * e.n) / max} />;
        })}
        {people.map((id) => {
          const p = at(id);
          return (
            <g key={id} class="talk-node" data-owner={id === 'owner' || undefined}>
              <circle cx={p.x} cy={p.y} r={14} />
              <text class="talk-initial" x={p.x} y={p.y + 4} text-anchor="middle">
                {label(id).slice(0, 1)}
              </text>
              <text x={p.x} y={p.y + 28} text-anchor="middle">
                {label(id)}
              </text>
            </g>
          );
        })}
      </svg>
    </figure>
  );
}
