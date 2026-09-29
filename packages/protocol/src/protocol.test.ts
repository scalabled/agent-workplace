import { describe, expect, it } from 'vitest';
import {
  CHIEF_ID,
  LandmarksError,
  PERSISTED_FRAME_TYPES,
  EPHEMERAL_FRAME_TYPES,
  ROUTES,
  ROUTE_IDS,
  coworkerAgentId,
  makeFrame,
  matchRoute,
  mergePresence,
  newId,
  normalizeLandmarks,
  parseFrame,
  personaIdFromAgentId,
  projectStream,
  routePath,
  ulid,
  workspaceStream,
  type FrameType,
} from './index';

describe('ids', () => {
  it('makes sortable prefixed ids', () => {
    const a = newId('job', 1_000);
    const b = newId('job', 2_000);
    expect(a).toMatch(/^job_[0-9a-z]{26}$/);
    expect(a < b).toBe(true);
    expect(ulid()).toHaveLength(26);
  });
  it('maps personas to agent ids and back', () => {
    expect(coworkerAgentId('fractional-cfo')).toBe('cw_fractional-cfo');
    expect(personaIdFromAgentId('cw_fractional-cfo')).toBe('fractional-cfo');
    expect(personaIdFromAgentId(CHIEF_ID)).toBeNull();
  });
  it('names streams', () => {
    expect(workspaceStream('local')).toBe('ws:local');
    expect(projectStream('local', 'everyday')).toBe('p:everyday:local');
    expect(projectStream('local', 'prj_x')).toBe('p:prj_x');
  });
});

describe('frames', () => {
  it('classifies every frame type exactly once', () => {
    const all: FrameType[] = ['ready', 'talk.owner', 'talk.delta', 'talk.message', 'talk.done', 'job.started', 'job.progress', 'job.steered', 'job.done', 'job.failed', 'job.cancelled', 'presence', 'workspace.updated', 'error'];
    for (const t of all) expect(PERSISTED_FRAME_TYPES.has(t) !== EPHEMERAL_FRAME_TYPES.has(t)).toBe(true);
  });
  it('builds and parses envelopes', () => {
    const f = makeFrame('ws:local', { type: 'talk.owner', data: { turnId: 'turn_1', messageId: 'msg_1', text: 'hi', via: 'text' }, opId: 'op1', actor: 'owner' }, { seq: 3 }, new Date(0));
    expect(f).toMatchObject({ v: 1, seq: 3, streamId: 'ws:local', ts: '1970-01-01T00:00:00.000Z', opId: 'op1' });
    expect(parseFrame(JSON.stringify(f))).toEqual(f);
    expect(parseFrame('{"op":"pong"}')).toBeNull();
    const e = makeFrame('ws:local', { type: 'presence', data: { agentId: CHIEF_ID, state: 'thinking', label: 'Thinking', causeSeq: 3 } }, { after: 3 });
    expect(e.seq).toBeUndefined();
    expect(e.after).toBe(3);
  });
});

describe('presence', () => {
  it('merges by priority', () => {
    expect(mergePresence([{ state: 'working' }, { state: 'speaking' }, { state: 'thinking' }])?.state).toBe('speaking');
    expect(mergePresence([])).toBeNull();
  });
});

describe('routes', () => {
  it('matches every route by its own method and path', () => {
    for (const id of ROUTE_IDS) {
      const path = routePath(id as 'steerJob', { id: 'job_1', personaId: 'p1', agentId: 'cw_chief', clipKey: 'c1_x', runId: 'pv_1', roomId: 'huddle:k2p9', stepId: 's1' } as never);
      const m = matchRoute(ROUTES_METHOD(id), path);
      expect(m && 'match' in m && m.match.id).toBe(id);
    }
  });
  it('extracts params and reports 405/404', () => {
    expect(matchRoute('POST', '/api/jobs/job_abc/steer')).toEqual({ match: { id: 'steerJob', params: { id: 'job_abc' } } });
    expect(matchRoute('DELETE', '/api/workspace')).toEqual({ allowed: ['GET', 'PUT'] });
    expect(matchRoute('GET', '/api/nope')).toBeNull();
    expect(routePath('getLandmarks', { personaId: 'a b' })).toBe('/api/portraits/a%20b/landmarks');
    // Collections and items do not shadow each other.
    expect(matchRoute('GET', '/api/jobs')).toEqual({ match: { id: 'listJobs', params: {} } });
    expect(matchRoute('GET', '/api/jobs/job_abc')).toEqual({ match: { id: 'getJob', params: { id: 'job_abc' } } });
    expect(matchRoute('GET', '/api/portraits')).toEqual({ match: { id: 'listPortraits', params: {} } });
    expect(matchRoute('GET', '/api/portraits/lead-x')).toEqual({ match: { id: 'getPortrait', params: { personaId: 'lead-x' } } });
  });
});

function ROUTES_METHOD(id: string): string {
  return ROUTES[id as keyof typeof ROUTES].method;
}

describe('landmarks (ported from personagram-ai/src/shared/landmarks.ts)', () => {
  const base = { face: { x: 0.2, y: 0.2, width: 0.6, height: 0.6, centerX: 0.5, centerY: 0.5 }, mouth: { x: 0.5, y: 0.7 }, leftEye: { x: 0.4, y: 0.4 }, rightEye: { x: 0.6, y: 0.4 }, eyeSpan: 0.2, leftEyeWidth: 0.05, rightEyeWidth: 0.05, mouthWidth: 0.1, mouthHeight: 0.03 };
  const contour = [{ x: 0.1, y: 0.1 }, { x: 0.2, y: 0.2 }, { x: 0.3, y: 0.3 }];
  it('accepts valid geometry and strips unknown keys', () => {
    const out = normalizeLandmarks({ ...base, secret: 'x' });
    expect(out).not.toHaveProperty('secret');
    expect(out?.mouthWidth).toBe(0.1);
  });
  it('rejects out-of-range numbers and incomplete lips', () => {
    expect(() => normalizeLandmarks({ ...base, eyeSpan: 2 })).toThrow(LandmarksError);
    expect(() => normalizeLandmarks({ ...base, lipUpperOuter: contour })).toThrow('Incomplete face contours');
    expect(normalizeLandmarks(null)).toBeNull();
  });
});
