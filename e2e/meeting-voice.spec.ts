import { expect, test } from '@playwright/test';
import { onboarded, recordFrames, say, waitForFrame } from './helpers';

// Inc 2 with voice (project "living-voice": Mock TTS with timing): listening in voices each meeting line in its
// speaker's team voice through the replay cache; a second replay is served from the cache (no provider call).
test.beforeEach(async ({ request }) => {
  await onboarded(request, 'Rosa', true);
});

test('a meeting is voiced line by line in team voices, and a replay comes from the cache', async ({ page }) => {
  const tts: { cache: boolean; speakerId: string; provider?: string; hit: string | null }[] = [];
  page.on('response', async (res) => {
    if (!res.url().endsWith('/api/speech/tts')) return;
    const body = res.request().postDataJSON() as { cache?: boolean; speakerId: string; voiceRef: { provider?: string } };
    tts.push({ cache: body.cache === true, speakerId: body.speakerId, ...(body.voiceRef?.provider ? { provider: body.voiceRef.provider } : {}), hit: res.headers()['x-tts-cache'] ?? null });
  });
  await page.goto('/app/talk');
  await recordFrames(page);
  await say(page, 'Put together a team to launch our spring menu with a small campaign');
  const proposed = await waitForFrame(page, (f) => f.type === 'project.proposed' && f.live);
  const project = proposed.data.project as { projectId: string; team: { personaId: string }[] };
  expect((await page.request.post(`/api/projects/${project.projectId}/approve`)).status()).toBe(202);
  await page.goto(`/app/projects/${project.projectId}`);
  const kickoff = page.locator('.meeting', { hasText: 'Kickoff' });
  await expect(kickoff.locator('.connector-meta')).toContainText(/Held .* lines/, { timeout: 30_000 });

  const start = tts.length;
  const members = new Set(project.team.map((m) => `cw_${m.personaId}`));
  const lines = () => tts.slice(start).filter((t) => members.has(t.speakerId));
  await kickoff.getByRole('button', { name: 'Replay' }).click();
  const bar = page.getByRole('complementary', { name: 'Now playing' });
  await expect(bar).toBeVisible();
  await expect(bar.locator('.np-note')).toHaveCount(0); // voiced, not reading along
  // The lead chairs after the Chief: their line is synthesised in their voice, kept for replay.
  const lead = project.team[0]!.personaId;
  await expect.poll(() => tts.filter((t) => t.speakerId === `cw_${lead}`).length, { timeout: 20_000 }).toBeGreaterThan(0);
  expect(lines().every((t) => t.cache)).toBe(true);
  const heard = new Set(lines().map((t) => t.speakerId));
  await bar.getByRole('button', { name: 'Stop listening' }).click();

  // Replay: the same lines come back from the cache.
  const before = tts.length;
  await kickoff.getByRole('button', { name: 'Replay' }).click();
  await expect.poll(() => tts.slice(before).filter((t) => heard.has(t.speakerId)).length, { timeout: 20_000 }).toBeGreaterThan(0);
  expect(tts.slice(before).filter((t) => heard.has(t.speakerId)).every((t) => t.hit === 'hit')).toBe(true);
  await bar.getByRole('button', { name: 'Stop listening' }).click();
});
