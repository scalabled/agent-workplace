// A raised hand (Inbox and the project page): a plan to approve, a teammate's question, reviewers' remaining issues,
// the deliverable's check, the token budget, a connector call that waits for the owner's OK (once, for the project,
// or always), emails waiting to be sent (Inc 6: once, or a grant that reaches further, only the kinds allowed), or a
// change inside Headcount (a coworker's own instructions, a Handbook section). Each kind offers its own answers.
import type { ConnectorScope, Decision } from '@headcount/protocol/ext/projects';
import { GRANT_WORDS, type GrantKind } from '@headcount/protocol/ext/trust';
import { useState } from 'preact/hooks';
import { catalog } from '../catalog';
import { chiefName } from '../chief';
import { answerDecision, decisionBusy, decisionError } from '../projects/actions';
import { navigate, paths } from '../router';
import { teamProjects } from '../store';
import { Face, personaSubject } from './Face';
import { TeamStrip } from './ProjectCard';

const KIND_LABEL: Record<Decision['kind'], string> = {
  plan_approval: 'Start the plan?',
  input: 'A question',
  review: 'Review issues',
  deliverable: 'The deliverable',
  budget: 'Budget',
  connector: 'Permission',
  automation: 'Automation',
  effect: 'Send email?',
  change: 'A change for your OK',
};

import { CopyLink } from '../links/CopyLink';
import { Markdown } from './Markdown';
export function DecisionCard({ decision: d, showProject = true }: { decision: Decision; showProject?: boolean }) {
  const [text, setText] = useState('');
  const [grant, setGrant] = useState<GrantKind>('once');
  const project = teamProjects.value[d.projectId];
  const busy = !!decisionBusy.value[d.decisionId];
  const error = decisionError.value[d.decisionId];
  const asker = d.fromId ? catalog.value?.persona(d.fromId) : undefined;
  const answer = (action: 'approve' | 'decline' | 'answer', scope?: ConnectorScope) =>
    void answerDecision(d.decisionId, action === 'answer' ? { action, text: text.trim() } : { action, ...(scope ? { scope } : {}), ...(d.kind === 'effect' && action === 'approve' ? { grant } : {}) }).then((ok) => ok && setText(''));
  const emails = d.effect?.emails ?? [];
  const words = d.kind === 'input' || d.kind === 'review' || d.kind === 'deliverable';
  const placeholder = d.kind === 'input' ? 'Your answer…' : 'Or give direction: what should change…';
  return (
    <article class="panel decision decision-card" id={d.decisionId} data-kind={d.kind} aria-labelledby={`dec-${d.decisionId}`}>
      <div class="decision-hand" aria-hidden={asker ? undefined : 'true'}>
        {asker ? <Face subject={personaSubject(asker)} tier="token" state="raised_hand" label={asker.name} agentId={`cw_${asker.id}`} /> : '✋'}
      </div>
      <div class="decision-body">
        <p class="decision-kind">
          {KIND_LABEL[d.kind]}
          {showProject && project && (
            <>
              {' · '}
              <button type="button" class="link-button" onClick={() => navigate(paths.project(project.projectId))}>
                {project.title}
              </button>
            </>
          )}
        </p>
        <div class="page-title-row">
          <h2 id={`dec-${d.decisionId}`} class="decision-title">
            {d.title}
          </h2>
          <CopyLink page={paths.inbox} at={d.decisionId} label="Copy link to this" what="Link to it" />
        </div>
        {d.effect ? (
          <>
            {d.effect.unknown && <p class="decision-text">It is not certain whether this went out: the email provider can no longer tell. Sending it again may send it twice.</p>}
            <ul class="decision-emails" aria-label={emails.length === 1 ? 'The email' : `The ${emails.length} emails`}>
              {emails.map((e, i) => (
                <li key={e.key}>
                  <details open={emails.length === 1 || undefined}>
                    <summary>
                      <span class="decision-email-to">To {e.to.join(', ')}</span>
                      {e.cc?.length ? <span class="decision-email-to"> · cc {e.cc.join(', ')}</span> : null} · <strong>{e.subject}</strong>
                    </summary>
                    <pre class="decision-email-text" aria-label={`Email ${i + 1}`}>
                      {e.text}
                    </pre>
                  </details>
                </li>
              ))}
            </ul>
            <p class="page-fine">Nothing goes out until you say so. A line saying an AI coworker wrote it is added.</p>
          </>
        ) : d.change ? (
          <>
            <p class="decision-text">{d.change.why}</p>
            <p class="decision-kind">{d.change.change === 'instructions' ? `Added to how ${d.change.targetLabel.split(' ')[0]} works` : `The new “${d.change.targetLabel}”`}</p>
            <pre class="decision-args">{d.change.after.startsWith(d.change.before) && d.change.before ? d.change.after.slice(d.change.before.length).trim() : d.change.after}</pre>
            <p class="page-fine">You can undo it later from Admin → Audit log.</p>
          </>
        ) : d.automation ? (
          <>
            <p class="decision-text">{d.automation.describe}</p>
            <p class="decision-text automation-goal">{d.automation.action.goal}</p>
          </>
        ) : d.connector ? (
          <>
            <p class="decision-text">{d.projectId ? d.body.split('\n')[0] : `${chiefName.value} is waiting for your answer.`}</p>
            {d.connector.args.trim() !== '{}' && (
              <pre class="decision-args" aria-label="The details they would send">
                {d.connector.args}
              </pre>
            )}
          </>
        ) : (
          <Markdown text={d.body} class="decision-text" />
        )}
        {d.kind === 'plan_approval' && project && (
          <>
            <TeamStrip team={project.team} max={8} />
            <ol class="decision-steps">
              {project.steps.map((s) => (
                <li key={s.id}>{s.title}</li>
              ))}
            </ol>
          </>
        )}
        {words && (
          <form
            class="decision-answer needs-contributor"
            onSubmit={(e) => {
              e.preventDefault();
              if (text.trim()) answer('answer');
            }}
          >
            <label class="visually-hidden" for={`ans-${d.decisionId}`}>
              {placeholder}
            </label>
            <textarea id={`ans-${d.decisionId}`} class="note-input" rows={2} maxLength={4000} placeholder={placeholder} value={text} onInput={(e) => setText((e.target as HTMLTextAreaElement).value)} />
          </form>
        )}
        {error && (
          <p class="form-error" role="alert">
            {error}
          </p>
        )}
      </div>
      <div class="decision-actions needs-contributor">
        {d.kind === 'plan_approval' && (
          <>
            <button type="button" class="button-primary" disabled={busy} onClick={() => answer('approve')}>
              {busy ? 'Starting…' : 'Approve and start'}
            </button>
            <button type="button" class="button-quiet" disabled={busy} onClick={() => answer('decline')}>
              Not now
            </button>
            {showProject && (
              <button type="button" class="button-quiet" onClick={() => navigate(paths.project(d.projectId))}>
                See the plan
              </button>
            )}
          </>
        )}
        {d.kind === 'input' && (
          <>
            <button type="button" class="button-primary" disabled={busy || !text.trim()} onClick={() => answer('answer')}>
              Send answer
            </button>
            <button type="button" class="button-quiet" disabled={busy} onClick={() => answer('approve')}>
              Go with their recommendation
            </button>
            <button type="button" class="button-quiet" disabled={busy} onClick={() => answer('decline')}>
              Let them decide
            </button>
          </>
        )}
        {(d.kind === 'review' || d.kind === 'deliverable') && (
          <>
            <button type="button" class="button-primary" disabled={busy} onClick={() => answer('approve')}>
              Accept as it is
            </button>
            <button type="button" class="button-quiet" disabled={busy || !text.trim()} onClick={() => answer('answer')}>
              Send direction
            </button>
          </>
        )}
        {d.kind === 'connector' && (
          <>
            <button type="button" class="button-primary" disabled={busy} onClick={() => answer('approve', 'once')}>
              Allow once
            </button>
            {d.projectId && (
              <button type="button" class="button-quiet" disabled={busy} onClick={() => answer('approve', 'project')}>
                Allow for this project
              </button>
            )}
            <button type="button" class="button-quiet" disabled={busy} onClick={() => answer('approve', 'always')}>
              Always allow
            </button>
            <button type="button" class="button-quiet" disabled={busy} onClick={() => answer('decline')}>
              Don’t allow
            </button>
          </>
        )}
        {d.kind === 'effect' && d.effect && (
          <>
            <button type="button" class="button-primary" disabled={busy} onClick={() => answer('approve')}>
              {busy ? 'Sending…' : d.effect.unknown ? 'Send again' : emails.length === 1 ? 'Send it' : `Send all ${emails.length}`}
            </button>
            {d.effect.allowedGrants.length > 1 && (
              <label class="decision-grant">
                <span>Allow</span>
                <select class="field-input field-compact" value={grant} onChange={(e) => setGrant((e.target as HTMLSelectElement).value as GrantKind)}>
                  {d.effect.allowedGrants.map((g) => (
                    <option key={g} value={g}>
                      {g === 'once' ? 'just these' : GRANT_WORDS[g].toLowerCase()}
                    </option>
                  ))}
                </select>
              </label>
            )}
            <button type="button" class="button-quiet" disabled={busy} onClick={() => answer('decline')}>
              Don’t send
            </button>
          </>
        )}
        {d.kind === 'change' && (
          <>
            <button type="button" class="button-primary" disabled={busy} onClick={() => answer('approve')}>
              Approve the change
            </button>
            <button type="button" class="button-quiet" disabled={busy} onClick={() => answer('decline')}>
              Not now
            </button>
          </>
        )}
        {d.kind === 'automation' && (
          <>
            <button type="button" class="button-primary" disabled={busy} onClick={() => answer('approve')}>
              Set it up
            </button>
            <button type="button" class="button-quiet" disabled={busy} onClick={() => answer('decline')}>
              Not now
            </button>
          </>
        )}
        {d.kind === 'budget' && (
          <>
            <button type="button" class="button-primary" disabled={busy} onClick={() => answer('approve')}>
              Raise it and continue
            </button>
            <button type="button" class="button-quiet" disabled={busy} onClick={() => answer('decline')}>
              Keep it paused
            </button>
          </>
        )}
      </div>
    </article>
  );
}
