// Projects: team projects (Inc 1: staffed from the catalog, a reviewed plan, a deliverable) and the Everyday project's jobs.
import { chiefName } from '../chief';
import { Icon } from '../components/Icon';
import { JobRow } from '../components/JobRow';
import { ProjectCard } from '../components/ProjectCard';
import { loadCatalog } from '../catalog';
import { navigate, paths } from '../router';
import { useEffect, useState } from 'preact/hooks';
import { stopAllBusy, stopAllResult, stopAllWork } from '../projects/actions';
import { activeJobs, jobList, projectList } from '../store';
import { prefillComposer } from '../talk/draft';
import { PageTitle } from '../links/CopyLink';
import './pages.css';

export function Projects() {
  const list = jobList.value;
  const running = activeJobs.value.length;
  const finished = list.filter((j) => j.status === 'done').length;
  const name = chiefName.value;
  const delegate = () => {
    prefillComposer('Look into ');
    navigate(paths.talk);
  };
  const staff = () => {
    prefillComposer('Put together a team to ');
    navigate(paths.talk);
  };
  const teams = projectList.value;
  useEffect(() => {
    void loadCatalog();
    // The Everyone stop outcome belongs to this visit.
    return () => void (stopAllResult.value = null);
  }, []);
  return (
    <section class="page projects" aria-labelledby="projects-title">
      <header class="page-head projects-head">
        <div>
          <PageTitle id="projects-title">Projects</PageTitle>
          <p class="page-lede">Each project keeps its work, its team and its results in one place.</p>
        </div>
        <EveryoneStop working={running + teams.filter((p) => p.status === 'running' || p.status === 'paused').length} />
      </header>
      {stopAllResult.value && (
        <p class="page-fine" role="status">
          {stopAllResult.value}
        </p>
      )}

      <section class="panel project" aria-labelledby="teams-title">
        <header class="project-head">
          <div>
            <h2 id="teams-title">Team projects</h2>
            <p class="project-sub">Outcomes {name} staffs with a team, a reviewed plan and a deliverable</p>
          </div>
          {teams.length > 0 && (
            <div class="project-actions">
              <button type="button" class="button-primary" onClick={staff}>
                Staff a team
              </button>
            </div>
          )}
        </header>
        {teams.length ? (
          <div class="project-grid">
            {teams.map((p) => (
              <ProjectCard key={p.projectId} project={p} />
            ))}
          </div>
        ) : (
          <div class="empty">
            <Icon name="projects" size={28} class="empty-icon" />
            <p class="empty-title">Hire a team in a sentence</p>
            <p class="empty-text">
              Tell {name} the outcome: “put together a team to launch our spring menu”. They pick the right specialists from the office, draft a plan where every step is reviewed, and ask for your OK before anyone starts.
            </p>
            <button type="button" class="button-primary" onClick={staff}>
              Staff a team
            </button>
          </div>
        )}
      </section>

      <section class="panel project" aria-labelledby="everyday-title">
        <header class="project-head">
          <div>
            <h2 id="everyday-title">Everyday</h2>
            <p class="project-sub">One-off tasks you delegate in Talk</p>
          </div>
          {list.length > 0 && (
            <div class="project-actions">
              <p class="project-stats tabular">
                {running > 0 ? `${running} running` : 'Nothing running'}
                {finished > 0 && ` · ${finished} finished`}
              </p>
              <button type="button" class="button-primary" onClick={delegate}>
                Delegate something
              </button>
            </div>
          )}
        </header>
        {list.length ? (
          <div class="job-list">
            {list.map((j) => (
              <JobRow key={j.jobId} job={j} />
            ))}
          </div>
        ) : (
          <div class="empty">
            <Icon name="projects" size={28} class="empty-icon" />
            <p class="empty-title">Nothing delegated yet</p>
            <p class="empty-text">
              Your Everyday project holds one-off tasks. Ask {name} to look into something; it runs here in the background while you keep talking, and the result lands in Talk.
            </p>
            <button type="button" class="button-primary" onClick={delegate}>
              Delegate something
            </button>
          </div>
        )}
      </section>
    </section>
  );
}

/** "Everyone stop" (MVP-PLAN Inc 1): halts every running job and team project, after one confirming tap. */
function EveryoneStop({ working }: { working: number }) {
  const [asking, setAsking] = useState(false);
  if (!working && !stopAllBusy.value) return null;
  if (!asking)
    return (
      <button type="button" class="button-quiet everyone-stop" onClick={() => setAsking(true)}>
        <Icon name="close" size={16} />
        Everyone stop
      </button>
    );
  return (
    <div class="everyone-stop-confirm" role="group" aria-label="Stop all work?">
      <span>
        Stop {working === 1 ? 'the one thing' : `all ${working} things`} running?
      </span>
      <button
        type="button"
        class="button-primary"
        disabled={stopAllBusy.value}
        onClick={async () => {
          await stopAllWork();
          setAsking(false);
        }}
      >
        {stopAllBusy.value ? 'Stopping…' : 'Stop everything'}
      </button>
      <button type="button" class="button-quiet" onClick={() => setAsking(false)}>
        Keep going
      </button>
    </div>
  );
}
