// Projects (Inc 0): the Everyday project and its jobs. Staffed projects with plans arrive in Inc 1.
import { chiefName } from '../chief';
import { Icon } from '../components/Icon';
import { JobRow } from '../components/JobRow';
import { navigate, paths } from '../router';
import { activeJobs, jobList } from '../store';
import { prefillComposer } from '../talk/draft';
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
  return (
    <section class="page projects" aria-labelledby="projects-title">
      <header class="page-head">
        <h1 id="projects-title">Projects</h1>
        <p class="page-lede">Each project keeps its work, its team and its results in one place.</p>
      </header>

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
