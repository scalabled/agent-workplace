import { slimIndex } from '@headcount/catalog/slim';
import { CHIEF_ID, type JobSnapshot } from '@headcount/protocol';
import { render } from 'preact';
import { act } from 'preact/test-utils';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { isEmptyComposer, spaceStartsPtt } from './app';
import { Announcer } from './components/Announcer';
import { ChiefBubble } from './components/ChiefBubble';
import { catalog } from './catalog';
import { JobRow } from './components/JobRow';
import { navigate, path, paths } from './router';
import { Floor } from './routes/Floor';
import { headlineWithoutName, Onboarding, quizIntro } from './routes/Onboarding';
import { Talk } from './routes/Talk';
import { applyFrame, capabilities, jobs, lastSeq, replayThrough, settings, thread } from './store';
import { startUnread, unread } from './ui/unread';
import { retryOwnerMessage, sendOwnerMessage } from './talk/actions';
import { createFakeAudio } from './test/fake-audio';
import { setAudioEngine } from './voice/engine';

type Call = { url: string; method: string; body: unknown };
let calls: Call[] = [];
let respond: (c: Call) => Response = () => json({});
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

let host: HTMLElement;
const mount = async (vnode: preact.ComponentChild) => {
  await act(() => render(vnode, host));
};
const flush = () => act(async () => void (await new Promise((r) => setTimeout(r, 0))));
const click = (el: Element | null | undefined) => act(() => void (el as HTMLElement).click());
const typeInto = (el: Element | null | undefined, value: string) =>
  act(() => {
    const input = el as HTMLInputElement;
    input.value = value;
    input.dispatchEvent(new Event('input', { bubbles: true }));
  });

beforeAll(() => {
  setAudioEngine(createFakeAudio());
});

beforeEach(() => {
  calls = [];
  respond = () => json({});
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string, init: RequestInit = {}) => {
      const call = { url, method: init.method ?? 'GET', body: typeof init.body === 'string' ? JSON.parse(init.body) : init.body };
      calls.push(call);
      return respond(call);
    }),
  );
  host = document.createElement('div');
  document.body.appendChild(host);
  catalog.value = slimIndex;
  capabilities.value = null;
  settings.value = { workspaceId: 'local', leadId: null, chiefName: null, voiceOn: true, updatedAt: '' };
  thread.value = [];
});

afterEach(() => {
  render(null, host);
  host.remove();
  vi.unstubAllGlobals();
});

describe('Onboarding', () => {
  it('shows all twelve leads and chooses one with a name, then lands in Talk', async () => {
    navigate(paths.onboarding);
    respond = (c) => json({ ...settings.value, ...(c.body as object), updatedAt: 'now' });
    await mount(<Onboarding />);
    expect(host.querySelectorAll('.gallery-card')).toHaveLength(slimIndex.catalog.leads.length);
    // No TTS configured: the voice sample is absent, not broken (X8).
    expect(host.querySelector('.voice-sample')).toBeNull();
    const second = slimIndex.catalog.leads[1]!;
    await click(host.querySelectorAll('.gallery-card')[1]);
    expect(host.querySelector('.stage-name')?.textContent).toBe(second.name);
    await typeInto(host.querySelector('.stage-choose .stage-name-field input'), 'Robin');
    const choose = [...host.querySelectorAll('button')].find((b) => b.textContent?.startsWith('Choose '));
    await act(() => void choose!.closest('form')!.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true })));
    await flush();
    expect(calls.find((c) => c.method === 'PUT')?.body).toEqual({ leadId: second.id, chiefName: 'Robin' });
    expect(settings.value?.leadId).toBe(second.id);
    expect(path.value).toBe(paths.talk);
  });

  it('runs the match quiz (catalog or built-in) and marks the top three', async () => {
    await mount(<Onboarding />);
    await click(host.querySelector('.welcome-quiz'));
    // The catalog quiz (catalog/leads/match-quiz.json) replaces the 4-question built-in one when present.
    const steps = slimIndex.catalog.matchQuiz?.questions.length ?? 4;
    for (let i = 0; i < steps; i++) {
      // Single-choice questions advance on click; scale and multi questions advance with Next.
      const next = document.querySelector('.quiz-next');
      await click(next ?? document.querySelector('.quiz-option'));
    }
    expect(document.querySelector('.sheet')).toBeNull();
    expect(host.querySelectorAll('.matches .match')).toHaveLength(3);
    expect(host.querySelectorAll('.gallery-rank')).toHaveLength(3);
    expect(host.querySelector('.stage-why')?.textContent).toMatch(/Your top match/);
  });
});

describe('JobRow', () => {
  const job: JobSnapshot = {
    jobId: 'job_1',
    projectId: 'everyday',
    title: 'Packaging suppliers',
    brief: 'look into packaging suppliers',
    status: 'running',
    label: 'Reading supplier reviews',
    step: 2,
    of: 5,
    agentId: CHIEF_ID,
    startedAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    steers: [],
  };

  it('shows the running sentence and progress; expands to Steer and Stop', async () => {
    respond = () => json({ accepted: true, jobId: 'job_1', steerId: 'steer_1' }, 202);
    await mount(<JobRow job={job} />);
    expect(host.querySelector('.job-sentence')?.textContent).toBe('Reading supplier reviews');
    // One truth: the bar shows the percent the Chief of Staff says (steps before the current one are done).
    const bar = host.querySelector('[role=progressbar]');
    expect(bar?.getAttribute('aria-valuetext')).toBe('Step 2 of 5, 20% done');
    expect(bar?.getAttribute('aria-valuenow')).toBe('20');
    expect((bar?.firstElementChild as HTMLElement).style.width).toBe('20%');
    await click(host.querySelector('.job-head'));
    await typeInto(host.querySelector('.job-steer input'), 'Also check recycled mailers');
    await act(() => void host.querySelector('.job-steer')!.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true })));
    await flush();
    const steer = calls.find((c) => c.url.endsWith('/api/jobs/job_1/steer'))!;
    expect(steer.method).toBe('POST');
    expect(steer.body).toMatchObject({ text: 'Also check recycled mailers' });
    expect(host.querySelector('.job-note')?.textContent).toMatch(/next checkpoint/);
    // Stop sits apart from Steer, at the far end of the foot line.
    expect(host.querySelector('.job-steer')?.textContent).not.toContain('Stop');
    await click([...host.querySelectorAll('button')].find((b) => b.textContent === 'Stop this job'));
    await flush();
    expect(calls.some((c) => c.url.endsWith('/api/jobs/job_1/cancel') && c.method === 'POST')).toBe(true);
  });

  it('leaves the write-up to the thread when the row is in Talk\'s Activity', async () => {
    await mount(<JobRow job={{ ...job, status: 'done', summary: 'Done.', result: '## Shortlist' }} defaultOpen inActivity />);
    expect(host.querySelector('.deliverable')).toBeNull();
  });

  it('shows the deliverable inline when done', async () => {
    await mount(<JobRow job={{ ...job, status: 'done', summary: 'Three suppliers compared.', result: '## Shortlist\n\n- **Acme**' }} defaultOpen />);
    expect(host.querySelector('.job-sentence')?.textContent).toBe('Three suppliers compared.');
    expect(host.querySelector('.deliverable-body')).toBeNull();
    await click(host.querySelector('.deliverable-head'));
    expect(host.querySelector('.deliverable-body')?.textContent).toContain('Shortlist');
    expect(host.querySelector('.deliverable-head')?.getAttribute('aria-expanded')).toBe('true');
  });
});

describe('JobRow: a failed job', () => {
  it('offers Ask again, which puts the same ask in the composer and opens Talk', async () => {
    const { draft } = await import('./talk/draft');
    draft.value = '';
    const failed: JobSnapshot = {
      jobId: 'job_2',
      projectId: 'everyday',
      title: 'Packaging suppliers',
      brief: 'look into packaging suppliers',
      status: 'failed',
      label: '',
      step: 2,
      of: 5,
      agentId: CHIEF_ID,
      startedAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      steers: [],
      error: { code: 'provider_error', message: 'The model kept failing.' },
    };
    navigate(paths.projects);
    await mount(<JobRow job={failed} defaultOpen />);
    await click([...host.querySelectorAll('button')].find((b) => b.textContent === 'Ask again'));
    expect(draft.value).toBe('look into packaging suppliers');
    expect(path.value).toBe(paths.talk);
  });

  it('labels the write-up instead of repeating the job title', async () => {
    await mount(<JobRow job={{ jobId: 'job_3', projectId: 'everyday', title: 'Coffee suppliers', brief: 'b', status: 'done', label: '', step: 3, of: 3, agentId: CHIEF_ID, startedAt: new Date().toISOString(), updatedAt: new Date().toISOString(), steers: [], summary: 'Done.', result: '## x' }} defaultOpen />);
    expect(host.querySelector('.deliverable-title')?.textContent).toBe('The write-up');
  });
});

describe('Floor', () => {
  it('lists every coworker by department and filters by search', async () => {
    await mount(<Floor />);
    expect(host.textContent).toMatch(new RegExp(`${slimIndex.catalog.personas.length} coworkers across ${slimIndex.catalog.departments.length} departments`));
    expect(host.querySelectorAll('.cw-card')).toHaveLength(slimIndex.catalog.personas.length);
    await typeInto(host.querySelector('input[type=search]'), 'pricing strategist');
    const names = [...host.querySelectorAll('.cw-name')].map((n) => n.textContent);
    expect(names.length).toBeGreaterThan(0);
    expect(names.length).toBeLessThan(10);
    expect(host.querySelector('.floor-count')?.textContent).toMatch(/coworker/);
    expect(host.querySelector('.cw-card')?.getAttribute('href')).toMatch(/^\/app\/desk\/[^/]+\/profile$/);
  });
});

describe('sending', () => {
  it('shows the message at once, keeps it on failure and retries with the same opId', async () => {
    respond = () => json({ error: { code: 'internal', message: 'The worker is restarting. Try again.' } }, 500);
    await sendOwnerMessage('look into suppliers');
    expect(thread.value[0]).toMatchObject({ text: 'look into suppliers', status: 'failed', error: 'The worker is restarting. Try again.' });
    const opId = (calls[0]!.body as { opId: string }).opId;
    respond = (c) => json({ accepted: true, opId: (c.body as { opId: string }).opId, turnId: 'turn_1', messageId: 'msg_1' }, 202);
    await retryOwnerMessage(thread.value[0]!);
    expect((calls[1]!.body as { opId: string }).opId).toBe(opId);
    expect(thread.value[0]).toMatchObject({ messageId: 'msg_1', status: undefined });
  });
});

describe('hold Space to talk', () => {
  it('starts outside text fields, never inside them or on a keyboard-focused control', () => {
    const div = document.createElement('div');
    const input = document.createElement('input');
    const textarea = document.createElement('textarea');
    expect(spaceStartsPtt(div)).toBe(true);
    expect(spaceStartsPtt(document.body)).toBe(true);
    expect(spaceStartsPtt(input)).toBe(false);
    expect(spaceStartsPtt(textarea)).toBe(false);
  });
});

describe('renamed Chief of Staff', () => {
  it('greets with the owner\'s name for them, never the catalog one', async () => {
    const lead = slimIndex.catalog.leads.find((l) => l.communication.greeting.includes(l.name.split(' ')[0]!))!;
    const first = lead.name.split(' ')[0]!;
    settings.value = { workspaceId: 'local', leadId: lead.id, chiefName: 'Rosa', voiceOn: false, updatedAt: 'x' };
    navigate(paths.talk);
    await mount(<Talk />);
    const greeting = host.querySelector('.msg[data-first] .msg-body')?.textContent ?? '';
    expect(greeting).toContain('Rosa');
    expect(greeting).not.toMatch(new RegExp(`\\b${first}\\b`));
    // The first starter always shows delegation.
    expect(host.querySelector('.starter')?.textContent).toMatch(/^Look into/);
  });

  it('labels Choose with the typed name', async () => {
    navigate(paths.onboarding);
    await mount(<Onboarding />);
    await typeInto(host.querySelector('.stage-choose .stage-name-field input'), 'Robin');
    expect([...host.querySelectorAll('button')].some((b) => b.textContent === 'Choose Robin')).toBe(true);
  });
});

describe('onboarding copy', () => {
  it('shows each name once in the match list and never promises voices keyless', () => {
    // Data-driven: every lead's first name is stripped from a headline that starts with it.
    for (const lead of slimIndex.catalog.leads) {
      const first = lead.name.split(' ')[0]!;
      expect(headlineWithoutName(`${first}: explains the why, so you grow`, first)).toBe('explains the why, so you grow');
      expect(headlineWithoutName('Calm plans', first)).toBe('Calm plans');
    }
    const intro = "Eight quick taps, about a minute. You'll hear your top three before you choose, and you can switch any time.";
    expect(quizIntro(intro, true)).toBe(intro);
    expect(quizIntro(intro, false)).toBe('Eight quick taps, about a minute. You can switch any time.');
  });
});

describe('news while you are elsewhere', () => {
  const lead = () => slimIndex.catalog.leads[0]!;
  const ann = (seq: number) =>
    ({ v: 1, streamId: 'ws:local', seq, type: 'talk.message', ts: new Date().toISOString(), actor: CHIEF_ID, data: { turnId: null, messageId: `msg_${seq}`, agentId: CHIEF_ID, text: '“Suppliers” is done. Three picks.', kind: 'announcement', jobId: 'job_1' } }) as never;

  it('counts Chief of Staff messages off Talk, shows them on the bubble and announces them on any screen', async () => {
    settings.value = { workspaceId: 'local', leadId: lead().id, chiefName: null, voiceOn: false, updatedAt: 'x' };
    lastSeq.value = 0;
    replayThrough.value = 0;
    jobs.value = {};
    navigate(paths.floor);
    const stop = startUnread();
    await mount(
      <>
        <ChiefBubble />
        <Announcer />
      </>,
    );
    await act(() => void applyFrame(ann(1)));
    expect(unread.value).toBe(1);
    expect(host.querySelector('.bubble-badge[data-kind="unread"]')?.textContent).toBe('1');
    expect(host.querySelector('.chief-bubble')?.hasAttribute('data-pulse')).toBe(true);
    expect(host.querySelector('[data-announcer]')?.textContent).toContain('is done');
    await act(() => navigate(paths.talk));
    expect(unread.value).toBe(0);
    stop();
  });
});

describe('Space in the empty composer', () => {
  it('is a hold-to-talk candidate only while the composer is empty', () => {
    const box = document.createElement('textarea');
    box.id = 'composer';
    expect(isEmptyComposer(box)).toBe(true);
    box.value = 'hi';
    expect(isEmptyComposer(box)).toBe(false);
    expect(isEmptyComposer(document.createElement('textarea'))).toBe(false);
  });
});
