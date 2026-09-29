// GET /api/office/people (Office Phase 2 §4.2.8): every persona plus the Chief, relationships as agent ids, blends,
// profiles as /api/expr/agents builds them, and ETag revalidation.
import { catalogFull, fullIndex } from '@headcount/catalog/full';
import { CHIEF_ID } from '@headcount/protocol';
import type { OfficePeopleResponse, OfficePersonDto } from '@headcount/protocol/ext/rooms';
import { afterEach, describe, expect, it } from 'vitest';
import { exprSetup, useProviders } from '../../test/expr-kit';
import { EXPR_BUNDLE } from '../expr/catalog';
import { defaultRuntime, runtime } from '../workspace/runtime';

afterEach(() => Object.assign(runtime, defaultRuntime));

describe('GET /api/office/people', () => {
  it('lists every persona and the Chief with relationships, blends and profiles', async () => {
    useProviders();
    const s = await exprSetup({}, { chiefName: 'Rosa' });
    const r = await s.api('GET', '/api/office/people');
    expect(r.status).toBe(200);
    expect(r.headers.get('cache-control')).toBe('private, no-cache');
    const body = r.body as OfficePeopleResponse;
    expect(r.headers.get('etag')).toBe(`"${body.version}"`);
    expect(body.people).toHaveLength(catalogFull.personas.length + 1);
    const byId = new Map<string, OfficePersonDto>(body.people.map((p) => [p.agentId, p]));

    const chief = byId.get(CHIEF_ID)!;
    expect(chief).toMatchObject({ groupId: 'chief', isChief: true, teamRoles: [], pairsWellWith: [], tensionWith: [] });
    expect(chief.profile).toMatchObject({ agentId: CHIEF_ID, firstName: 'Rosa', teamRole: 'chief' });
    expect(chief.blend).toEqual(EXPR_BUNDLE.input.archetypes.lead_blends['lead-warm-mentor']);

    const p = fullIndex.persona('contracts-analyst')! as unknown as { department: string; team_roles: string[]; pairs_well_with: string[]; productive_tension_with: { persona_id: string }[] };
    const dto = byId.get('cw_contracts-analyst')!;
    expect(dto).toMatchObject({ groupId: p.department, isChief: false, teamRoles: p.team_roles });
    expect(dto.pairsWellWith).toEqual(p.pairs_well_with.filter((id) => fullIndex.persona(id)).map((id) => `cw_${id}`));
    expect(dto.tensionWith).toEqual(p.productive_tension_with.map((t) => t.persona_id).filter((id) => fullIndex.persona(id)).map((id) => `cw_${id}`));
    // Every relationship points at someone in the roster.
    for (const person of body.people) for (const id of [...person.pairsWellWith, ...person.tensionWith]) expect(byId.has(id), id).toBe(true);
    // Signature blends where a persona has a signature pack.
    const sig = EXPR_BUNDLE.input.signatures.flatMap((f) => f.packs).find((pk) => fullIndex.persona(pk.persona_id));
    if (sig) expect(byId.get(`cw_${sig.persona_id}`)!.blend).toEqual(sig.archetypes);
    // The profile is the one GET /api/expr/agents/:id serves.
    const agent = await s.api('GET', '/api/expr/agents/cw_contracts-analyst');
    expect(dto.profile).toEqual(agent.body.profile);
    // Small enough to ship on every office open.
    expect(JSON.stringify(body).length).toBeLessThan(200_000);
  });

  it('revalidates with the ETag, and a new name or lead is a new version', async () => {
    useProviders();
    const s = await exprSetup();
    const first = await s.api('GET', '/api/office/people');
    const etag = first.headers.get('etag')!;
    expect((await s.api('GET', '/api/office/people', undefined, { 'if-none-match': etag })).status).toBe(304);
    await s.api('PUT', '/api/workspace', { chiefName: 'Rosa' });
    const renamed = await s.api('GET', '/api/office/people', undefined, { 'if-none-match': etag });
    expect(renamed.status).toBe(200);
    expect(renamed.headers.get('etag')).not.toBe(etag);
    expect((renamed.body as OfficePeopleResponse).people.find((p) => p.agentId === CHIEF_ID)!.profile.firstName).toBe('Rosa');
  });

  it('has no Chief before a lead is chosen', async () => {
    useProviders();
    const s = await exprSetup({}, { lead: null });
    const body = (await s.api('GET', '/api/office/people')).body as OfficePeopleResponse;
    expect(body.people.some((p) => p.agentId === CHIEF_ID)).toBe(false);
    expect(body.people).toHaveLength(catalogFull.personas.length);
  });
});
