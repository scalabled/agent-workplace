import { expect, test } from '@playwright/test';
import { frames, onboarded, recordFrames, say, waitForFrame } from './helpers';

// Talk (D2): streaming replies, and delegation that never blocks the conversation — status from live job state,
// steering at the next checkpoint, a completion announcement, cancel.
test.beforeEach(async ({ request }) => {
  await onboarded(request);
});

test('a reply streams in, then lands as one message', async ({ page }) => {
  await page.goto('/app/talk');
  await expect(page.getByRole('heading', { level: 1, name: 'Rosa' })).toBeVisible();
  await recordFrames(page);
  const before = await page.locator('.msg-chief').count();
  await say(page, 'Tell me what you can do for me');
  // The owner's message shows at once.
  await expect(page.locator('.msg-owner .msg-body').last()).toHaveText('Tell me what you can do for me');
  const done = await waitForFrame(page, (f) => f.type === 'talk.done' && f.live);
  const seen = await frames(page);
  const turnId = done.data.turnId;
  const deltas = seen.filter((f) => f.type === 'talk.delta' && f.data.turnId === turnId);
  const message = seen.find((f) => f.type === 'talk.message' && f.data.turnId === turnId)!;
  expect(deltas.length).toBeGreaterThan(1);
  expect(deltas.map((d) => d.data.delta).join('')).toBe(message.data.text);
  expect(done.data).toMatchObject({ finish: 'stop', route: 'answer' });
  await expect(page.locator('.msg-chief')).toHaveCount(before + 1);
  await expect(page.locator('.msg-chief').last()).not.toHaveAttribute('data-streaming', /.*/);
  await expect(page.locator('.msg-chief .msg-body').last()).toContainText(String(message.data.text).slice(0, 30));
});

test('delegate, ask how it is going while it runs, steer it, hear it finish', async ({ page }) => {
  await page.goto('/app/talk');
  await recordFrames(page);

  // 1. Delegate: the turn ends at once with an acknowledgement; the job runs in the Everyday project.
  await say(page, 'Look into coffee suppliers in Portland for me');
  const started = await waitForFrame(page, (f) => f.type === 'job.started' && f.live);
  const job = started.data.job as { jobId: string; title: string };
  expect(job.title).toBe('Coffee suppliers in Portland');
  const row = page.locator('.activity .job', { hasText: job.title });
  await expect(row).toBeVisible();
  await expect(row).toHaveAttribute('data-status', 'running');
  await expect(row.locator('.job-sentence')).not.toBeEmpty();
  const ack = await waitForFrame(page, (f) => f.type === 'talk.done' && f.data.route === 'delegate');
  expect(ack.data.finish).toBe('stop');

  // 2. Status from live state: answered while the job is still running (it is not paused or re-run).
  await waitForFrame(page, (f) => f.type === 'job.progress' && f.data.jobId === job.jobId);
  await say(page, "How's it going?");
  const status = await waitForFrame(page, (f) => f.type === 'talk.message' && f.data.kind === 'status', 10_000);
  expect(String(status.data.text)).toMatch(/step \d+ of \d+/);
  const doneYet = (await frames(page)).some((f) => f.type === 'job.done' && f.data.jobId === job.jobId && f.at <= status.at);
  expect(doneYet, 'the status answer arrived before the job finished').toBe(false);
  await expect(page.locator('.msg-chief[data-kind="status"]').last()).toContainText(/step \d+ of \d+/);
  await expect(row).toHaveAttribute('data-status', 'running');

  // 3. Steer: queued now, applied at the next checkpoint (shown on the job row).
  await say(page, 'Also check which ones are fair trade certified');
  const queued = await waitForFrame(page, (f) => f.type === 'job.steered' && f.data.status === 'queued');
  await row.locator('.job-head').click();
  await expect(row.locator('.job-steers li')).toContainText('fair trade');
  await waitForFrame(page, (f) => f.type === 'job.steered' && f.data.status === 'applied' && f.data.steerId === queued.data.steerId);
  await expect(row.locator('.job-steers li[data-status="applied"]')).toContainText('Applied');

  // 4. Completion: job.done, then the Chief of Staff says so in the thread, with the deliverable to read.
  await waitForFrame(page, (f) => f.type === 'job.done' && f.data.jobId === job.jobId, 45_000);
  const announcement = page.locator('.msg-chief[data-kind="announcement"]', { hasText: job.title });
  await expect(announcement).toBeVisible();
  await expect(announcement).toContainText('is done');
  await announcement.getByRole('button', { name: new RegExp(job.title) }).click();
  await expect(announcement.locator('.deliverable-body')).toContainText(/fair trade/i);

  // The Projects place lists it as done, with the write-up.
  await page.getByRole('navigation', { name: 'Places' }).getByRole('link', { name: 'Projects' }).click();
  const listed = page.locator('.job', { hasText: job.title }).first();
  await expect(listed).toHaveAttribute('data-status', 'done');
});

test('stop a running job from its row', async ({ page }) => {
  await page.goto('/app/talk');
  await recordFrames(page);
  await say(page, 'Research standing desks under 500 dollars');
  const started = await waitForFrame(page, (f) => f.type === 'job.started' && f.live);
  const job = started.data.job as { jobId: string; title: string };
  const row = page.locator('.activity .job', { hasText: job.title });
  await row.locator('.job-head').click();
  // Stop sits apart from Steer, at the far end of the panel.
  await expect(row.locator('.job-steer')).not.toContainText('Stop');
  await row.getByRole('button', { name: 'Stop this job' }).click();
  await waitForFrame(page, (f) => f.type === 'job.cancelled' && f.data.jobId === job.jobId);
  // The Chief of Staff acknowledges it in the thread, so the promise to report back is not left hanging.
  const ack = page.locator('.msg-chief[data-kind="announcement"]', { hasText: `Stopped “${job.title}”` });
  await expect(ack).toBeVisible();
  await page.getByRole('navigation', { name: 'Places' }).getByRole('link', { name: 'Projects' }).click();
  await expect(page.locator('.job', { hasText: job.title }).first()).toHaveAttribute('data-status', 'cancelled');
});

test('steering sent while the write-up is being written is folded in, not dropped', async ({ page, request }) => {
  await page.goto('/app/talk');
  await recordFrames(page);
  await say(page, 'Look into bike racks for a small office');
  const started = await waitForFrame(page, (f) => f.type === 'job.started' && f.live);
  const job = started.data.job as { jobId: string; title: string };
  // Wait for the write-up checkpoint, then steer.
  await waitForFrame(page, (f) => f.type === 'job.progress' && f.data.jobId === job.jobId && f.data.step === f.data.of, 45_000);
  const r = await request.post(`/api/jobs/${job.jobId}/steer`, { data: { text: 'also check the warranty terms' } });
  expect(r.status()).toBe(202);
  await waitForFrame(page, (f) => f.type === 'job.done' && f.data.jobId === job.jobId, 45_000);
  const done = (await (await request.get(`/api/jobs/${job.jobId}`)).json()) as { status: string; result: string; steers: { status: string }[] };
  expect(done.status).toBe('done');
  expect(done.steers.every((s) => s.status === 'applied')).toBe(true);
  expect(done.result).toContain('warranty terms');
});

test('a reload rebuilds the thread and jobs from the feed replay', async ({ page, request }) => {
  await page.goto('/app/talk');
  await recordFrames(page);
  await say(page, 'Remember this for later');
  await waitForFrame(page, (f) => f.type === 'talk.done' && f.live);
  await say(page, 'Look into office plants that need little light');
  await waitForFrame(page, (f) => f.type === 'job.started' && f.live);
  const owners = await page.locator('.msg-owner').count();
  await page.reload();
  await expect(page.locator('.msg-owner')).toHaveCount(owners);
  // Replayed frames are never treated as live (nothing is spoken or animated on reload). Floor quick-chats replay
  // too (surface 'floor'), into their side-threads, never into Talk.
  const toChief = (f: { type: string; data: Record<string, unknown> }) => f.type === 'talk.owner' && f.data.surface !== 'floor';
  await expect.poll(async () => (await frames(page)).filter(toChief).length).toBe(owners);
  const replayed = (await frames(page)).filter(toChief);
  expect(replayed.length).toBe(owners);
  expect(replayed.every((f) => !f.live)).toBe(true);
  const jobs = (await (await request.get('/api/jobs')).json()).jobs as { jobId: string; status: string }[];
  expect(jobs.length).toBeGreaterThan(0);
  await page.goto('/app/projects');
  await expect(page.locator('.job')).toHaveCount(jobs.length);
});
