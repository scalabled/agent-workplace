// A team project at a glance (Projects list, Inbox): status, the team's faces, step progress and the staffing note.
import type { ProjectStep, TeamMember, TeamProjectSnapshot } from '@headcount/protocol/ext/projects';
import { catalog } from '../catalog';
import { navigate, paths } from '../router';
import { presenceFor } from '../store';
import { Face, personaSubject } from './Face';

export const PROJECT_STATUS_WORDS: Record<TeamProjectSnapshot['status'], string> = {
  proposed: 'Waiting for your OK',
  running: 'Working',
  paused: 'Paused',
  done: 'Finished',
  failed: 'Failed',
  cancelled: 'Stopped',
};

export const STEP_STATUS_WORDS: Record<ProjectStep['status'], string> = {
  waiting: 'Up next',
  working: 'Working',
  reviewing: 'In review',
  revising: 'Revising',
  done: 'Done',
  failed: 'Failed',
};

/** Job glyph statuses reused for projects and steps (one visual language for work). */
export const projectGlyph = (s: TeamProjectSnapshot['status']) => ({ proposed: 'queued', running: 'running', paused: 'queued', done: 'done', failed: 'failed', cancelled: 'cancelled' })[s];
export const stepGlyph = (s: ProjectStep['status']) => ({ waiting: 'queued', working: 'running', reviewing: 'running', revising: 'running', done: 'done', failed: 'failed' })[s];

export function progressOf(p: TeamProjectSnapshot): { done: number; total: number; pct: number } {
  const total = p.steps.length;
  const done = p.steps.filter((s) => s.status === 'done').length;
  const pct = p.status === 'done' ? 100 : total ? Math.round((done / total) * 100) : 0;
  return { done, total, pct };
}

export function MemberFace({ member, tier = 'token', live = false }: { member: TeamMember; tier?: 'token' | 'tile'; live?: boolean }) {
  const persona = catalog.value?.persona(member.personaId);
  const shown = live ? presenceFor(`cw_${member.personaId}`) : null;
  // The catalog loads lazily: initials until the face can draw.
  if (!persona)
    return (
      <span class="face-initials" data-tier={tier} aria-label={`${member.name}, ${member.title}`}>
        {member.name
          .split(/\s+/)
          .map((w) => w[0] ?? '')
          .join('')
          .slice(0, 2)}
      </span>
    );
  return (
    <Face
      subject={personaSubject(persona)}
      tier={tier}
      {...(shown ? { state: shown.state } : {})}
      label={`${member.name}, ${member.title}${shown && shown.state !== 'idle' ? `: ${shown.label}` : ''}`}
      agentId={`cw_${member.personaId}`}
    />
  );
}

export function TeamStrip({ team, max = 6 }: { team: TeamMember[]; max?: number }) {
  const shown = team.slice(0, max);
  return (
    <span class="team-strip" aria-label={`Team: ${team.map((m) => m.name).join(', ')}`}>
      {shown.map((m) => (
        <span key={m.personaId} class="team-strip-face">
          <MemberFace member={m} />
        </span>
      ))}
      {team.length > max && <span class="team-strip-more">+{team.length - max}</span>}
    </span>
  );
}

export function ProjectCard({ project }: { project: TeamProjectSnapshot }) {
  const { done, total, pct } = progressOf(project);
  const open = () => navigate(paths.project(project.projectId));
  return (
    <button type="button" class="project-card" data-status={project.status} onClick={open}>
      <span class="project-card-top">
        <span class="job-glyph" data-status={projectGlyph(project.status)} aria-hidden="true" />
        <span class="project-card-title">{project.title}</span>
        <span class="project-card-status">{PROJECT_STATUS_WORDS[project.status]}</span>
      </span>
      <span class="project-card-mid">
        <TeamStrip team={project.team} />
        <span class="project-card-steps tabular">
          {done} of {total} steps
        </span>
      </span>
      {project.status !== 'proposed' && project.status !== 'cancelled' && (
        <span class="job-progress" role="progressbar" aria-label="Progress" aria-valuemin={0} aria-valuemax={100} aria-valuenow={pct}>
          <span style={{ width: `${Math.max(4, pct)}%` }} />
        </span>
      )}
      <span class="project-card-note">{project.status === 'done' && project.summary ? project.summary : project.staffingNote}</span>
    </button>
  );
}
