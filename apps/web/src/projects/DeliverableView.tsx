// The deliverable in its kind (biz-bot parity: plan.js result modal): a document rendered as Markdown, a web page
// running in a sandboxed frame (scripts only: no same-origin access, no top navigation) with its source, or a code
// file. Copy and download for each; the reviewer's check underneath.
import type { TeamProjectSnapshot } from '@headcount/protocol/ext/projects';
import { useMemo, useState } from 'preact/hooks';
import { api } from '../api/client';
import { ExportMenu } from '../components/ExportMenu';
import { Markdown } from '../components/Markdown';
import { DocAsk, DocThreads } from '../docs/DocAsk';
import { paths } from '../router';

const slug = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 60) || 'deliverable';

export function download(name: string, text: string, type: string): void {
  const url = URL.createObjectURL(new Blob([text], { type }));
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export function DeliverableView({ project, reviewerName }: { project: TeamProjectSnapshot; reviewerName?: string }) {
  const kind = project.deliverableKind ?? 'document';
  const content = project.deliverable ?? '';
  const [source, setSource] = useState(false);
  // Whoever put it together answers questions about it.
  const finisher = (project.team.find((m) => m.personaId === project.finisherId) ?? project.team.find((m) => m.role === 'lead') ?? project.team[0])?.name.split(' ')[0] ?? 'the team';
  const file = useMemo(() => {
    if (kind === 'web') return { name: `${slug(project.title)}.html`, type: 'text/html' };
    if (kind === 'code') return { name: project.deliverableFilename ?? `${slug(project.title)}.txt`, type: 'text/plain' };
    return { name: `${slug(project.title)}.md`, type: 'text/markdown' };
  }, [kind, project.title, project.deliverableFilename]);
  return (
    <section class="panel deliverable-panel" aria-labelledby="deliverable-title">
      <header class="project-deliverable-head">
        <h2 id="deliverable-title">{kind === 'web' ? 'The page' : kind === 'code' ? file.name : 'The deliverable'}</h2>
        <span class="deliverable-actions">
          {kind === 'web' && (
            <button type="button" class="button-quiet" aria-pressed={source} onClick={() => setSource(!source)}>
              {source ? 'Show the page' : 'View source'}
            </button>
          )}
          <button type="button" class="button-quiet" onClick={() => void navigator.clipboard?.writeText(content)}>
            Copy
          </button>
          {kind === 'document' ? (
            // The frame carries a clipped copy: the export reads the whole deliverable.
            <ExportMenu title={project.title} markdown={async () => (await api.getProject(project.projectId).catch(() => null))?.deliverable ?? content} />
          ) : (
            <button type="button" class="button-quiet" onClick={() => download(file.name, content, file.type)}>
              Download
            </button>
          )}
        </span>
      </header>
      {kind === 'web' && !source && <iframe class="deliverable-frame" title={`${project.title} (preview)`} sandbox="allow-scripts" srcdoc={content} />}
      {(kind === 'code' || (kind === 'web' && source)) && <pre class="deliverable-code">{content}</pre>}
      {kind === 'document' && (
        <DocAsk doc={`deliverable:${project.projectId}`} page={paths.project(project.projectId)} agent={finisher}>
          <Markdown text={content} anchors="dl-" />
        </DocAsk>
      )}
      {project.qa && (
        <p class="deliverable-qa" data-approved={project.qa.approved || undefined}>
          <strong>{reviewerName ?? 'The reviewer'} checked it:</strong> {project.qa.notes}
        </p>
      )}
      {kind === 'document' && <DocThreads doc={`deliverable:${project.projectId}`} page={paths.project(project.projectId)} agent={finisher} />}
    </section>
  );
}
