import { expect, test } from '@playwright/test';
import { onboarded, recordFrames, say, waitForFrame } from './helpers';

// Inc 1, "Hire a team in a sentence": one sentence in Talk staffs a named team with a reviewed plan, the plan waits
// as a raised hand in the Inbox, the owner approves it, the team works (owners and reviewers show it on their faces),
// and the Chief of Staff announces the deliverable. Keyless: the Mock provider plays every role.
test.beforeEach(async ({ request }) => {
  await onboarded(request);
});

test('staff a team in a sentence, approve the plan, watch it work, read the deliverable', async ({ page }) => {
  await page.goto('/app/talk');
  await recordFrames(page);

  // 1. One sentence: the Chief staffs a team and drafts the plan; it waits for the owner (a raised hand).
  await say(page, 'Put together a team to launch our spring menu with a small campaign');
  const proposed = await waitForFrame(page, (f) => f.type === 'project.proposed' && f.live);
  const project = proposed.data.project as { projectId: string; title: string; team: { name: string }[]; steps: { title: string }[] };
  expect(project.team.length).toBeGreaterThanOrEqual(2);
  await waitForFrame(page, (f) => f.type === 'talk.done' && f.data.route === 'project');
  await expect(page.locator('.msg-chief .msg-body').last()).toContainText('Inbox');
  await expect(page.getByRole('link', { name: /Inbox, 1 waiting/ })).toBeVisible();

  // 2. The Inbox shows the hand with the team and the plan.
  await page.getByRole('link', { name: /Inbox/ }).first().click();
  const card = page.locator('.decision-card');
  await expect(card).toHaveCount(1);
  await expect(card.locator('.decision-steps li').first()).toHaveText(project.steps[0]!.title);

  // 3. See the plan, approve it there; the hand comes down.
  await card.getByRole('button', { name: 'See the plan' }).click();
  await expect(page).toHaveURL(new RegExp(`/app/projects/${project.projectId}$`));
  await expect(page.getByRole('heading', { level: 1, name: project.title })).toBeVisible();
  await expect(page.locator('.team-member')).toHaveCount(project.team.length);
  await expect(page.locator('.project-forecast')).toContainText(/About \d+ to \d+ minutes once you approve/);
  // Direction before the start: it waits for the first step, which picks it up.
  await page.getByLabel('Tell the team').fill('Keep it playful, and the budget is $500.');
  await page.getByRole('button', { name: 'Send' }).click();
  await expect(page.locator('.note[data-status="queued"]')).toContainText('waiting for the next step');
  await page.getByRole('button', { name: 'Approve and start' }).click();
  await expect(page.getByRole('button', { name: 'Stop project' })).toBeVisible();
  await expect(page.getByRole('link', { name: /Inbox, \d+ waiting/ })).toHaveCount(0);

  // 4. The team works: steps are done and reviewed, then the deliverable arrives.
  await waitForFrame(page, (f) => f.type === 'project.updated' && (f.data.project as { status: string }).status === 'done', 75_000);
  await expect(page.locator('.project-status-line')).toContainText('Finished');
  await expect(page.locator('.deliverable-panel')).toBeVisible();
  await expect(page.locator('.step[data-status="done"]')).toHaveCount(project.steps.length);
  await expect(page.locator('.note[data-status="applied"]', { hasText: 'Keep it playful' })).toContainText('picked up in');
  // The team channel: the kickoff, work handed in and reviews, with who talked to whom.
  await expect(page.locator('.channel-entry[data-kind="work"]').first()).toBeVisible();
  await expect(page.locator('.channel-entry[data-kind="discussion"]').first()).toBeVisible();
  await page.locator('.team-channel').screenshot({ path: process.env.SHOT_DIR ? `${process.env.SHOT_DIR}/channel.png` : undefined });
  const first = page.locator('.step').first();
  await first.getByRole('button', { name: `Show ${project.steps[0]!.title}` }).click();
  await expect(first.locator('.step-body')).not.toBeEmpty();

  // 5. The Chief of Staff announces it in Talk, linking to the deliverable.
  await waitForFrame(page, (f) => f.type === 'talk.message' && f.data.kind === 'announcement' && f.data.projectId === project.projectId && /is done/.test(String(f.data.text)));
  await page.getByRole('link', { name: /^Talk/ }).first().click();
  const link = page.locator('.msg-chief').last().locator('.msg-project');
  await expect(link).toContainText('Read the deliverable');
  await link.click();
  await expect(page).toHaveURL(new RegExp(`/app/projects/${project.projectId}$`));
});

test('"Not now" in the Inbox declines the plan', async ({ page }) => {
  await page.goto('/app/talk');
  await recordFrames(page);
  await say(page, 'Assemble a team for a marketing plan for our bakery');
  const proposed = await waitForFrame(page, (f) => f.type === 'project.proposed' && f.live);
  const { projectId } = proposed.data.project as { projectId: string };
  await page.goto('/app/inbox');
  await page.locator('.decision-card').getByRole('button', { name: 'Not now' }).click();
  await expect(page.getByText('Nothing needs you')).toBeVisible();
  await page.goto(`/app/projects/${projectId}`);
  await expect(page.locator('.project-status-line')).toContainText('Stopped');
});
