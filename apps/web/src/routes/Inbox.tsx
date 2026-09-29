// Inbox: raised hands only (decisions), so it can reach zero (X1). Inc 1: plan approvals for team projects.
import { useEffect } from 'preact/hooks';
import { loadCatalog } from '../catalog';
import { chiefName } from '../chief';
import { Icon } from '../components/Icon';
import { TeamStrip } from '../components/ProjectCard';
import { approveProject, cancelProject, projectBusy, projectError } from '../projects/actions';
import { navigate, paths } from '../router';
import { decisionList, teamProjects } from '../store';
import './pages.css';

export function Inbox() {
  useEffect(() => void loadCatalog(), []);
  const decisions = decisionList.value;
  const name = chiefName.value;
  return (
    <section class="page inbox" aria-labelledby="inbox-title">
      <header class="page-head">
        <h1 id="inbox-title">Inbox</h1>
        {decisions.length > 0 && <p class="page-lede">{decisions.length === 1 ? 'One decision needs you.' : `${decisions.length} decisions need you.`}</p>}
      </header>
      {decisions.length === 0 && (
        <div class="panel empty">
          <Icon name="inbox" size={28} class="empty-icon" />
          <p class="empty-title">Nothing needs you</p>
          <p class="empty-text">When a coworker needs a decision from you, it arrives here as a raised hand, and their face shows the hand too. Updates stay in Talk, so this only fills when you are needed.</p>
        </div>
      )}
      <div class="decision-list">
        {decisions.map((d) => {
          const project = teamProjects.value[d.projectId];
          const busy = projectBusy.value[d.projectId];
          const error = projectError.value[d.projectId];
          return (
            <article key={d.decisionId} class="panel decision decision-card" aria-labelledby={`dec-${d.decisionId}`}>
              <p class="decision-hand" aria-hidden="true">
                ✋
              </p>
              <div class="decision-body">
                <h2 id={`dec-${d.decisionId}`} class="decision-title">
                  {d.title}
                </h2>
                <p class="decision-text">{d.body}</p>
                {project && (
                  <>
                    <TeamStrip team={project.team} max={8} />
                    <ol class="decision-steps">
                      {project.steps.map((s) => (
                        <li key={s.id}>{s.title}</li>
                      ))}
                    </ol>
                  </>
                )}
                {error && (
                  <p class="form-error" role="alert">
                    {error}
                  </p>
                )}
              </div>
              <div class="decision-actions">
                <button type="button" class="button-primary" disabled={!!busy} onClick={() => void approveProject(d.projectId)}>
                  {busy === 'approve' ? 'Starting…' : 'Approve and start'}
                </button>
                <button type="button" class="button-quiet" disabled={!!busy} onClick={() => void cancelProject(d.projectId)}>
                  Not now
                </button>
                <button type="button" class="button-quiet" onClick={() => navigate(paths.project(d.projectId))}>
                  See the plan
                </button>
              </div>
            </article>
          );
        })}
      </div>
      {decisions.length > 0 && <p class="page-fine">You can also just tell {name} “go ahead”.</p>}
    </section>
  );
}
