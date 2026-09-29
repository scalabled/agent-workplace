// One background job: its running sentence and progress; expand to Steer or Stop; the deliverable when done.
// The conversation never waits on it (D2): steering and stopping are separate, non-blocking commands.
import type { JobSnapshot } from '@headcount/protocol';
import { jobProgressPercent } from '@headcount/protocol/ext/worker-core';
import { useEffect, useRef, useState } from 'preact/hooks';
import { createPortal } from 'preact/compat';
import { ago, now } from '../lib/time';
import { navigate, paths, linkTarget } from '../router';
import { steerJob, stopJob } from '../talk/actions';
import { prefillComposer } from '../talk/draft';
import { Icon } from './Icon';
import { Markdown } from './Markdown';

const STATUS_WORDS: Record<JobSnapshot['status'], string> = {
  queued: 'Queued',
  running: 'Running',
  done: 'Finished',
  failed: 'Failed',
  cancelled: 'Stopped',
};

export function StatusGlyph({ status }: { status: JobSnapshot['status'] }) {
  return <span class="job-glyph" data-status={status} aria-hidden="true" />;
}

/** One truth for progress: the same percent the Chief of Staff says out loud (steps before `step` are done). */
export function Progress({ job }: { job: JobSnapshot }) {
  if (!job.of || job.of <= 0) return null;
  const pct = jobProgressPercent(job);
  const step = Math.min(job.step, job.of);
  return (
    <span class="job-progress" role="progressbar" aria-label="Progress" aria-valuemin={0} aria-valuemax={100} aria-valuenow={pct} aria-valuetext={`Step ${step} of ${job.of}, ${pct}% done`}>
      <span style={{ width: `${Math.max(4, pct)}%` }} />
    </span>
  );
}

/** Phone width (bottom tabs): a job opened from Activity becomes a bottom sheet so Steer and Stop stay in view. */
function usePhone(): boolean {
  const query = typeof matchMedia === 'function' ? matchMedia('(max-width: 767px)') : null;
  const [phone, setPhone] = useState(query?.matches ?? false);
  useEffect(() => {
    if (!query) return;
    const on = () => setPhone(query.matches);
    query.addEventListener?.('change', on);
    return () => query.removeEventListener?.('change', on);
  }, []);
  return phone;
}

/** The one sentence a row shows: what it is doing now, or how it ended. */
export function jobSentence(job: JobSnapshot): string {
  if (job.status === 'failed') return job.error?.message ?? 'It did not finish.';
  if (job.status === 'cancelled') return 'Stopped by you.';
  if (job.status === 'done') return job.summary || job.label || 'Finished.';
  return job.label || 'Getting started';
}

/**
 * `inActivity`: the row sits in Talk's Activity dock, where the thread already carries the write-up (so the
 * deliverable is not repeated) and, on phones, the detail opens as a bottom sheet.
 */
export function JobRow({ job, defaultOpen = false, inActivity = false }: { job: JobSnapshot; defaultOpen?: boolean; inActivity?: boolean }) {
  const [open, setOpen] = useState(defaultOpen);
  const phone = usePhone();
  const asSheet = inActivity && phone;
  const running = job.status === 'queued' || job.status === 'running';
  const panelId = `job-${job.jobId}`;
  // A link to this job opens it.
  useEffect(() => {
    if (!inActivity && linkTarget.value === job.jobId) setOpen(true);
  }, [linkTarget.value]);
  const panel = useRef<HTMLDivElement>(null);
  const head = useRef<HTMLButtonElement>(null);
  void now.value; // re-render as elapsed time moves
  // An opened row inside the scrolling dock shows its whole panel (Steer and Stop included).
  useEffect(() => {
    if (open && !asSheet) panel.current?.scrollIntoView?.({ block: 'nearest' });
  }, [open, asSheet]);
  return (
    <div class="job" id={inActivity ? undefined : job.jobId} data-status={job.status} data-open={(open && !asSheet) || undefined}>
      <button ref={head} type="button" class="job-head" aria-expanded={open} aria-controls={panelId} aria-haspopup={asSheet ? 'dialog' : undefined} onClick={() => setOpen(!open)}>
        <StatusGlyph status={job.status} />
        <span class="job-text">
          <span class="job-title">{job.title}</span>
          <span class="job-sentence">{jobSentence(job)}</span>
        </span>
        <span class="job-meta tabular">
          {running && job.of ? `${Math.min(job.step, job.of)}/${job.of}` : STATUS_WORDS[job.status]}
          <span class="visually-hidden">, started {ago(job.startedAt)}</span>
        </span>
        <Icon name="chevronDown" size={18} class="job-chevron" />
      </button>
      {running && <Progress job={job} />}
      {open && !asSheet && (
        <div class="job-panel" id={panelId} ref={panel}>
          <JobDetail job={job} showDeliverable={!inActivity} />
        </div>
      )}
      {open && asSheet && (
        <JobSheet
          job={job}
          id={panelId}
          onClose={() => {
            setOpen(false);
            head.current?.focus();
          }}
        />
      )}
    </div>
  );
}

function JobSheet({ job, id, onClose }: { job: JobSnapshot; id: string; onClose: () => void }) {
  const sheet = useRef<HTMLDivElement>(null);
  useEffect(() => {
    sheet.current?.querySelector<HTMLElement>('input, button')?.focus();
  }, []);
  if (typeof document === 'undefined') return null;
  return createPortal(
    <div class="sheet-scrim" onPointerDown={(e) => e.target === e.currentTarget && onClose()}>
      <div
        class="sheet job-sheet"
        role="dialog"
        aria-modal="true"
        aria-labelledby={`${id}-title`}
        id={id}
        ref={sheet}
        onKeyDown={(e) => {
          if (e.key === 'Escape') {
            e.stopPropagation();
            onClose();
          }
        }}
      >
        <div class="job-sheet-top">
          <h2 id={`${id}-title`} class="job-sheet-title">
            {job.title}
          </h2>
          <button type="button" class="icon-button" aria-label="Close" onClick={onClose}>
            <Icon name="close" />
          </button>
        </div>
        <p class="job-sheet-sentence">{jobSentence(job)}</p>
        {(job.status === 'queued' || job.status === 'running') && <Progress job={job} />}
        <div class="job-panel">
          <JobDetail job={job} showDeliverable={false} />
        </div>
      </div>
    </div>,
    document.body,
  );
}

export function JobDetail({ job, showDeliverable = true }: { job: JobSnapshot; showDeliverable?: boolean }) {
  const running = job.status === 'queued' || job.status === 'running';
  return (
    <>
      <p class="job-brief">
        <span class="job-k">You asked</span> {job.brief}
      </p>
      {job.partial && running && (
        <p class="job-brief">
          <span class="job-k">So far</span> {job.partial}
        </p>
      )}
      {job.steers.length > 0 && (
        <ul class="job-steers" aria-label="Your changes">
          {job.steers.map((s) => (
            <li key={s.steerId} data-status={s.status}>
              <Icon name={s.status === 'applied' ? 'check' : 'steer'} size={16} />
              <span>{s.text}</span>
              <span class="job-steer-state">{s.status === 'applied' ? 'Applied' : 'At the next checkpoint'}</span>
            </li>
          ))}
        </ul>
      )}
      {running && <SteerForm job={job} />}
      {(job.status === 'failed' || job.status === 'cancelled') && (
        <div class="job-again">
          <button
            type="button"
            class="button-primary"
            onClick={() => {
              // The obvious next action (D3): the same ask, ready to send (or edit) in Talk.
              prefillComposer(job.brief);
              navigate(paths.talk);
            }}
          >
            Ask again
          </button>
        </div>
      )}
      {showDeliverable && job.status === 'done' && job.result && <Deliverable job={job} label="The write-up" />}
      <div class="job-foot tabular">
        <span>
          Started {ago(job.startedAt)}
          {job.finishedAt ? ` · ${STATUS_WORDS[job.status].toLowerCase()} ${ago(job.finishedAt)}` : ''}
        </span>
        {running && <StopButton job={job} />}
      </div>
    </>
  );
}

/** Stop sits apart from Steer (the far end of the foot line), so one slip never cancels a job. */
function StopButton({ job }: { job: JobSnapshot }) {
  const [note, setNote] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  return (
    <>
      <button
        type="button"
        class="link-button job-stop needs-contributor"
        disabled={busy}
        onClick={async () => {
          setBusy(true);
          const err = await stopJob(job.jobId);
          setBusy(false);
          if (err) setNote(err);
        }}
      >
        Stop this job
      </button>
      {note && (
        <span class="job-note" role="alert">
          {note}
        </span>
      )}
    </>
  );
}

function SteerForm({ job }: { job: JobSnapshot }) {
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<string | null>(null);
  const input = useRef<HTMLInputElement>(null);
  const inputId = `steer-${job.jobId}`;
  return (
    <form
      class="job-steer needs-contributor"
      onSubmit={async (e) => {
        e.preventDefault();
        const value = input.current?.value ?? text; // the live field, even before a re-render
        if (!value.trim() || busy) return;
        setBusy(true);
        const err = await steerJob(job.jobId, value);
        setBusy(false);
        if (err) setNote(err);
        else {
          setText('');
          setNote('Got it. It applies at the next checkpoint.');
        }
      }}
    >
      <label class="visually-hidden" for={inputId}>
        Steer this job
      </label>
      <input ref={input} id={inputId} value={text} onInput={(e) => setText(e.currentTarget.value)} placeholder="Also check…" autoComplete="off" maxLength={2000} />
      <button type="submit" class="button-quiet" disabled={busy}>
        Steer
      </button>
      {note && (
        <p class="job-note" role="status">
          {note}
        </p>
      )}
    </form>
  );
}

/** A finished job's result, expandable in place. Long-form reads in the serif. */
export function Deliverable({ job, startOpen = false, label }: { job: JobSnapshot; startOpen?: boolean; /** Instead of the job title, where the title is already shown above. */ label?: string }) {
  const [open, setOpen] = useState(startOpen);
  if (!job.result) return null;
  return (
    <div class="deliverable" data-open={open || undefined}>
      <button type="button" class="deliverable-head" aria-expanded={open} onClick={() => setOpen(!open)}>
        <Icon name="check" size={18} />
        <span class="deliverable-title">{label ?? job.title}</span>
        <span class="deliverable-action">{open ? 'Hide' : 'Read'}</span>
      </button>
      {open && <Markdown text={job.result} class="deliverable-body" />}
    </div>
  );
}
