// GET /api/expr/catalog and /api/expr/agents/:id, and the Ambience setting (INC05-PLAN §3.2, §4 A1, A4, A5).
import { compileCatalog, type ExpressionCatalogInput } from '@headcount/expressions';
import { fullIndex } from '@headcount/catalog/full';
import { afterEach, describe, expect, it } from 'vitest';
import { exprSetup, useProviders } from '../../test/expr-kit';
import { defaultRuntime, runtime } from '../workspace/runtime';
import { EXPR_BUNDLE, EXPR_CATALOG_VERSION } from './catalog';

afterEach(() => Object.assign(runtime, defaultRuntime));

describe('GET /api/expr/catalog', () => {
  it('serves the bundle with its version (and the huddles version) as the ETag, and 304 on a repeat', async () => {
    useProviders();
    const s = await exprSetup();
    const r = await s.api('GET', '/api/expr/catalog');
    expect(r.status).toBe(200);
    // Office Phase 2 §4.2.9: a small-talk content change is fetched; the manifests' catalog version does not change.
    const etag = `"${EXPR_CATALOG_VERSION}.${EXPR_BUNDLE.huddles!.version}"`;
    expect(r.headers.get('etag')).toBe(etag);
    expect(r.headers.get('cache-control')).toBe('private, no-cache');
    expect(r.body).toMatchObject({ kind: 'expression_bundle', version: EXPR_CATALOG_VERSION });
    // The browser compiles the same input to the same version.
    expect(compileCatalog(r.body.input as ExpressionCatalogInput).version).toBe(EXPR_CATALOG_VERSION);
    const again = await s.api('GET', '/api/expr/catalog', undefined, { 'if-none-match': etag });
    expect(again.status).toBe(304);
    expect(await again.res.text()).toBe('');
    expect((await s.api('GET', '/api/expr/catalog', undefined, { 'if-none-match': `"${EXPR_CATALOG_VERSION}"` })).status).toBe(200);
    expect((await s.api('GET', '/api/expr/catalog', undefined, { 'if-none-match': '"e1_old"' })).status).toBe(200);
  });
});

describe('GET /api/expr/agents/:agentId', () => {
  it('builds the Chief from the chosen lead in the owner’s name for it', async () => {
    useProviders();
    const s = await exprSetup({}, { chiefName: 'Rosa' });
    const r = await s.api('GET', '/api/expr/agents/cw_chief');
    expect(r.status).toBe(200);
    const lead = fullIndex.lead('lead-warm-mentor')!;
    expect(r.body).toMatchObject({
      agentId: 'cw_chief',
      personaId: lead.id,
      catalogVersion: EXPR_CATALOG_VERSION,
      staffed: true,
      provider: 'browser',
      prevoice: null,
      mood: null,
      profile: { agentId: 'cw_chief', personaId: lead.id, firstName: 'Rosa', teamRole: 'chief', personality: { leadId: lead.id, traits: lead.personality.traits }, voice: { xai: lead.voice.xai_tts, openai: lead.voice.openai_tts } },
      manifest: { agentId: 'cw_chief', provider: 'browser', clips: {} },
      attention: { agentId: 'cw_chief', focus: null, background: [] },
    });
    expect(r.body.reactivity).toBeGreaterThan(0);
    expect(r.headers.get('cache-control')).toBe('no-store');
  });

  it('builds an unstaffed coworker from the persona catalog', async () => {
    useProviders();
    const s = await exprSetup({ MOCK_MEDIA: 'true' });
    const p = fullIndex.persona('tech-lead')!;
    const r = await s.api('GET', '/api/expr/agents/cw_tech-lead');
    expect(r.body).toMatchObject({
      agentId: 'cw_tech-lead',
      personaId: 'tech-lead',
      staffed: false,
      provider: 'mock',
      attention: null,
      profile: { firstName: p.name.split(' ')[0], personality: { seniority: p.seniority, traits: p.personality.traits }, voice: { xai: p.voice.xai.voice, openai: p.voice.openai.voice } },
    });
    expect(r.body.profile.teamRole).toBeUndefined();
    expect(r.body.profile.personality.roles.every((x: string) => p.team_roles.includes(x))).toBe(true);
  });

  it('answers 404 for an unknown agent and for the Chief before a lead is chosen', async () => {
    useProviders();
    const s = await exprSetup();
    expect((await s.api('GET', '/api/expr/agents/cw_nobody-at-all')).status).toBe(404);
    expect((await s.api('GET', '/api/expr/agents/nobody')).status).toBe(404);
    const fresh = await exprSetup({}, { lead: null });
    expect((await fresh.api('GET', '/api/expr/agents/cw_chief')).status).toBe(404);
  });
});

describe('Ambience (A5)', () => {
  it('defaults to Lively, validates, persists and tells every tab', async () => {
    useProviders();
    const s = await exprSetup({}, { lead: null });
    expect((await s.api('GET', '/api/workspace')).body.ambience).toBe('lively');
    expect((await s.api('PUT', '/api/workspace', { ambience: 'loud' })).status).toBe(400);
    const put = await s.api('PUT', '/api/workspace', { ambience: 'quiet' });
    expect(put).toMatchObject({ status: 200, body: { ambience: 'quiet' } });
    expect((await s.api('GET', '/api/workspace')).body.ambience).toBe('quiet');
    expect((await s.ofType('workspace.updated')).at(-1)!.data.settings.ambience).toBe('quiet');
    // Settings stored before Inc 0.5 carry no ambience: that means Lively.
    await s.state.storage.put('settings', { workspaceId: 'local', leadId: null, chiefName: null, voiceOn: true, updatedAt: new Date(0).toISOString() });
    expect((await s.api('GET', '/api/workspace')).body.ambience).toBe('lively');
  });

  it('turns Floor-grade event lines into faces in Quiet, while replies still speak', async () => {
    useProviders();
    const s = await exprSetup();
    await s.ws.updateSettings({ ambience: 'quiet' });
    await s.view();
    await s.talk('Look into three packaging suppliers');
    await s.runJobs();
    const says = s.liveOf('reflex.say').map((f) => f.data.intent);
    expect(says).not.toContain('celebrate');
    expect(says).not.toContain('micro_status');
    expect(s.liveOf('reflex.face').some((f) => f.data.cue.gesture === 'smile')).toBe(true); // the celebration as a face
    await s.talk('thanks');
    expect((await s.ofType('talk.message')).at(-1)!.data).toMatchObject({ kind: 'reflex', intent: 'gratitude_reply' });
  });
});
