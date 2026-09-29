// Inc 4 · context and memory (Mock provider and embeddings): recall (BM25 + meaning, fused), files read to text,
// the Handbook and its interview, memories told, distilled from conversations and meetings, recalled into the Chief's
// turn (with chips) and into a coworker's work.
import { ids, parseFrame, type Frame } from '@headcount/protocol';
import type { CardResponse, HandbookResponse, MemoryItem } from '@headcount/protocol/ext/memory';
import type { PromptView, RunsResponse } from '@headcount/protocol/ext/agents';
import type { Decision, TeamProjectSnapshot } from '@headcount/protocol/ext/projects';
import { strToU8, zipSync } from 'fflate';
import { describe, expect, it } from 'vitest';
import { docxText, readFile, xlsxText } from '../src/memory/files';
import { bm25, chunk, rrf, similar, tokens } from '../src/memory/recall';
import type { Env } from '../src/env';
import { handle } from '../src/index';
import type { ProjectDO } from '../src/jobs/project-do';
import type { WorkspaceDO } from '../src/workspace/workspace-do';
import { createTestEnv } from './fake-cloud';

describe('recall (pure)', () => {
  it('matches words, fuses rankings, spots near-duplicates, and cuts text into pieces', () => {
    expect(tokens('We close early on Sundays!')).toEqual(['close', 'early', 'sunday']);
    expect(tokens('Café opening')).toEqual(tokens('cafe open'));
    const docs = [
      { id: 'a', tokens: tokens('The café closes early on Sundays') },
      { id: 'b', tokens: tokens('Oat milk costs 40p extra') },
      { id: 'c', tokens: tokens('Sunday brunch starts at ten') },
    ];
    const s = bm25(tokens('when do we close on sunday'), docs);
    expect([...s.keys()].sort()).toEqual(['a', 'c']);
    expect(s.get('a')!).toBeGreaterThan(s.get('c')!);
    const fused = rrf([['a', 'b'], ['b', 'c']]);
    expect(fused.get('b')!).toBeGreaterThan(fused.get('a')!);
    expect(similar('We close early on Sundays.', 'we close EARLY on sundays')).toBe(true);
    expect(similar('We close early on Sundays.', 'Oat milk costs extra')).toBe(false);
    const pieces = chunk(`${'A line of the menu.\n'.repeat(200)}`, 900, 120);
    expect(pieces.length).toBeGreaterThan(3);
    expect(pieces.every((p) => p.length <= 900)).toBe(true);
  });
});

describe('files (pure)', () => {
  it('reads Word, Excel, CSV and text; refuses what it cannot read', async () => {
    const docx = zipSync({ 'word/document.xml': strToU8('<w:document><w:body><w:p><w:r><w:t>Opening hours</w:t></w:r></w:p><w:p><w:r><w:t xml:space="preserve">Mon–Fri 7am &amp; 4pm</w:t></w:r></w:p></w:body></w:document>') });
    expect(docxText(docx)).toBe('Opening hours\nMon–Fri 7am & 4pm');
    const xlsx = zipSync({
      'xl/workbook.xml': strToU8('<workbook><sheets><sheet name="Prices" sheetId="1"/></sheets></workbook>'),
      'xl/sharedStrings.xml': strToU8('<sst><si><t>Item</t></si><si><t>Price</t></si><si><t>Oat milk, extra</t></si></sst>'),
      'xl/worksheets/sheet1.xml': strToU8('<worksheet><sheetData><row r="1"><c r="A1" t="s"><v>0</v></c><c r="B1" t="s"><v>1</v></c></row><row r="2"><c r="A2" t="s"><v>2</v></c><c r="B2"><v>0.4</v></c></row></sheetData></worksheet>'),
    });
    expect(xlsxText(xlsx)).toBe('## Prices\nItem,Price\n"Oat milk, extra",0.4');
    expect(await readFile('menu.csv', 'text/csv', strToU8('item,price\nlatte,3.20'))).toEqual({ kind: 'csv', text: 'item,price\nlatte,3.20' });
    await expect(readFile('photo.png', 'image/png', new Uint8Array([1, 2, 3]))).rejects.toThrow(/PDF, Word/);
    await expect(readFile('broken.docx', '', new Uint8Array([1, 2, 3]))).rejects.toThrow(/could not be opened/);
  });
});

async function setup(overrides: Partial<Env> = {}) {
  const t = await createTestEnv(overrides);
  const ws = t.namespaces.WORKSPACE.getByName('ws:local') as WorkspaceDO;
  const project = t.namespaces.PROJECT.getByName('p:everyday:local') as ProjectDO;
  t.namespaces.WORKSPACE.state('ws:local').getWebSockets = () => [{ send: (m: string) => void parseFrame(m) } as unknown as WebSocket];
  const raw = (method: string, path: string, init: RequestInit = {}) => handle(new Request(`http://localhost${path}`, { method, ...init }), t.env, t.ctx);
  const api = async (method: string, path: string, body?: unknown) => {
    const res = await raw(method, path, body !== undefined ? { headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) } : {});
    return { status: res.status, body: (await res.json()) as any };
  };
  const talk = async (text: string) => {
    await api('POST', '/api/talk', { text, opId: ids.op() });
    await t.ctx.drain();
  };
  const memories = async (q = '') => ((await api('GET', `/api/memory${q ? `?q=${encodeURIComponent(q)}` : ''}`)).body.memories as MemoryItem[]);
  const lastReply = async () => (await ws.frames(0, 5000)).filter((f): f is Extract<Frame, { type: 'talk.message' }> => f.type === 'talk.message').at(-1)!.data;
  await api('PUT', '/api/workspace', { leadId: 'lead-steady-operator', chiefName: 'Eddie' });
  return { t, ws, project, raw, api, talk, memories, lastReply };
}

describe('memory in the workspace', () => {
  it('remembers what it is told, and recalls it into the next reply (with a chip)', async () => {
    const s = await setup();
    await s.talk('Remember that we always close early on Sundays, at 2pm.');
    const told = await s.memories();
    expect(told).toEqual(expect.arrayContaining([expect.objectContaining({ text: 'we always close early on Sundays, at 2pm.', kind: 'rule', source: 'owner' })]));
    await s.talk('What time do we close on Sundays?');
    const reply = await s.lastReply();
    expect(reply.recalled?.map((r) => r.text)).toContain('we always close early on Sundays, at 2pm.');
  });

  it('distils durable facts from a conversation, merging repeats', async () => {
    const s = await setup();
    await s.talk('Our café is on Market Street in Leeds and we open at 7am every weekday.');
    await s.talk('Our café is on Market Street in Leeds and we open at 7am every weekday!');
    const all = await s.memories();
    const facts = all.filter((m) => m.source === 'talk');
    expect(facts).toHaveLength(1);
    expect(facts[0]!.text).toContain('Market Street');
    expect(facts[0]!.sourceLabel).toMatch(/^Talk, \d{4}-\d{2}-\d{2}$/);
    // Search finds it by its words, and by meaning (mock embeddings).
    expect((await s.memories('where is the café')).map((m) => m.memoryId)).toContain(facts[0]!.memoryId);
    // The owner edits, pins and forgets.
    const id = facts[0]!.memoryId;
    expect((await s.api('PUT', `/api/memory/${id}`, { pinned: true, text: 'The café is at 12 Market Street, Leeds; it opens at 7am on weekdays.' })).body.memory).toMatchObject({ pinned: true });
    expect((await s.api('DELETE', `/api/memory/${id}`)).status).toBe(200);
    expect((await s.memories()).some((m) => m.memoryId === id)).toBe(false);
  });

  it('the Handbook interview: one section at a time, written up, then finished', async () => {
    const s = await setup();
    const started = (await s.api('POST', '/api/handbook/interview')).body as HandbookResponse;
    expect(started.interviewing).toBe(true);
    expect((await s.lastReply()).text).toContain('what the business is');
    await s.talk('We are a small café in Leeds, open since 2019, known for our sourdough.');
    let hb = (await s.api('GET', '/api/handbook')).body as HandbookResponse;
    expect(hb.sections.find((x) => x.id === 'business')).toMatchObject({ content: 'We are a small café in Leeds, open since 2019, known for our sourdough.', updatedBy: 'chief' });
    expect((await s.lastReply()).text).toContain('who the customers are');
    await s.talk('Please finish the interview for now');
    hb = (await s.api('GET', '/api/handbook')).body as HandbookResponse;
    expect(hb.interviewing).toBe(false);
    expect(hb.markdown).toContain('## The business\n\nWe are a small café in Leeds');
    // The owner edits a section directly; the Chief's prompt carries the Handbook.
    await s.api('PUT', '/api/handbook/rules', { content: '- Never discount bread after 3pm.' });
    const view = (await s.api('GET', '/api/chief/prompt')).body as PromptView;
    expect(view.text).toContain('- Never discount bread after 3pm.');
    expect(view.tools.map((x) => x.name)).toEqual(expect.arrayContaining(['handbook_interview', 'remember_this', 'update_handbook']));
    expect((await s.api('PUT', '/api/handbook/nope', { content: 'x' })).status).toBe(404);
  });

  it('files: read, summarised, searchable by their contents, removed with their excerpts', async () => {
    const s = await setup();
    const csv = 'item,price\nlatte,3.20\noat milk (extra),0.40\nsourdough loaf,4.50';
    const res = await s.raw('POST', '/api/cards', { headers: { 'content-type': 'text/csv', 'x-file-name': encodeURIComponent('prices.csv') }, body: csv });
    expect(res.status).toBe(201);
    const card = ((await res.json()) as CardResponse).card;
    expect(card).toMatchObject({ name: 'prices.csv', kind: 'csv', scope: 'workspace', chunks: 1 });
    await s.t.ctx.drain();
    const got = (await s.api('GET', `/api/cards/${card.cardId}`)).body as CardResponse;
    expect(got.card.summary).toContain('prices.csv');
    expect(got.text).toContain('sourdough loaf,4.50');
    const found = await s.ws.memoryList({ q: 'how much is a sourdough loaf' });
    expect(found.some((m) => m.kind === 'excerpt' && m.sourceRef === card.cardId)).toBe(true);
    // Bad scope, unreadable type.
    expect((await s.raw('POST', '/api/cards?scope=elsewhere', { headers: { 'x-file-name': 'a.txt' }, body: 'hello there' })).status).toBe(400);
    expect((await s.raw('POST', '/api/cards', { headers: { 'content-type': 'image/png', 'x-file-name': 'a.png' }, body: 'x' })).status).toBe(400);
    expect((await s.raw('POST', '/api/cards', { headers: { 'content-type': 'text/plain', 'x-file-name': 'a.zip' }, body: 'x' })).status).toBe(400);
    expect((await s.api('DELETE', `/api/cards/${card.cardId}`)).status).toBe(200);
    expect((await s.ws.memoryList({ q: 'sourdough loaf' })).some((m) => m.sourceRef === card.cardId)).toBe(false);
  });

  it('a coworker’s work carries the Handbook and what is remembered; a meeting feeds the memory', async () => {
    const s = await setup();
    await s.api('PUT', '/api/handbook/business', { content: 'A small café in Leeds known for sourdough.' });
    await s.api('POST', '/api/memory', { text: 'The spring menu launch budget is 500 pounds.', kind: 'decision' });
    await s.talk('Put together a team to launch our spring menu with a small campaign');
    await s.project.alarm();
    await s.t.ctx.drain();
    const { project } = (await s.ws.frames(0, 5000)).filter((f) => f.type === 'project.proposed').at(-1)!.data as { project: TeamProjectSnapshot; decision: Decision };
    await s.api('POST', `/api/projects/${project.projectId}/approve`);
    for (let i = 0; i < 20; i++) {
      const p = (await s.project.getProject(project.projectId))!;
      if (p.status !== 'running') break;
      await s.project.alarm();
      await s.t.ctx.drain();
    }
    const runs = ((await s.api('GET', `/api/projects/${project.projectId}/runs`)).body as RunsResponse).runs.filter((r) => r.phase === 'work');
    expect(runs.length).toBeGreaterThan(0);
    expect(runs[0]!.prompt).toContain('<handbook>');
    expect(runs[0]!.prompt).toContain('A small café in Leeds known for sourdough.');
    expect(runs.some((r) => r.prompt.includes('The spring menu launch budget is 500 pounds.'))).toBe(true);
    // The kickoff meeting was distilled into the project's memory.
    const fromMeeting = (await s.ws.memoryList({ scope: `project:${project.projectId}` })).filter((m) => m.source === 'meeting');
    expect(fromMeeting.length).toBeGreaterThan(0);
    expect(fromMeeting[0]!.sourceLabel).toMatch(/^Kickoff: /);
  });
});
