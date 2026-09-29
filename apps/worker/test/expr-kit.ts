// Test kit for the living-workforce suites (Inc 0.5): an in-process workspace with a viewer socket, scripted chat and
// speech providers, and route calls that share the Durable Objects' registry.
import { createMockProvider, createRegistry, type ChatProvider, type ChatRequest, type ModelEvent, type ProviderFactory, type Registry, type SpeechProvider, type TtsRequest } from '@headcount/models';
import { CHIEF_ID, ids, matchRoute, parseFrame, type Frame, type FrameType } from '@headcount/protocol';
import type { ViewerOp } from '@headcount/protocol/ext/expressions';
import type { Env } from '../src/env';
import { HANDLERS, toErrorResponse } from '../src/index';
import type { ProjectDO } from '../src/jobs/project-do';
import type { RouteContext } from '../src/lib/http';
import type { RunDO } from '../src/runs/run-do';
import { runtime } from '../src/workspace/runtime';
import type { WorkspaceDO } from '../src/workspace/workspace-do';
import { FakeWebSocket, createTestEnv, type TestEnv } from './fake-cloud';

export interface SpeechCall {
  provider: 'xai' | 'openai';
  req: TtsRequest;
}

/** A cloud TTS provider that records calls (tiny MP3-labelled bytes, character alignment when asked). */
export function fakeTts(id: 'xai' | 'openai', calls: SpeechCall[], opts: { fail?: () => Error } = {}): ProviderFactory {
  const speech: SpeechProvider = {
    id,
    kind: 'cloud',
    family: id === 'openai' ? 'gpt' : 'grok',
    async tts(req) {
      calls.push({ provider: id, req });
      if (opts.fail) throw opts.fail();
      const chars = Array.from(req.text).slice(0, 40);
      return {
        audio: new Uint8Array([0x49, 0x44, 0x33, 4, 0, 0, 0, 0, 0, 0]).buffer,
        mime: 'audio/mpeg',
        provider: id,
        voice: (id === 'xai' ? req.voice.xai : req.voice.openai) ?? 'default',
        alignment: req.withAlignment ? { chars, startsMs: chars.map((_, i) => i * 60), endsMs: chars.map((_, i) => (i + 1) * 60) } : null,
      };
    },
  };
  return () => ({ speech });
}

export interface ChatScript {
  /** Called before each chat request (await a gate here to hold a turn). */
  before?: (req: ChatRequest) => Promise<void> | void;
  /** Scripted events for a request, or null for the Mock answer. */
  events?: (req: ChatRequest) => ModelEvent[] | null;
}

export const isTalk = (req: ChatRequest) => typeof req.system === 'string' && req.system.includes('Your job in this conversation');
export const isDesk = (req: ChatRequest) => typeof req.system === 'string' && req.system.includes('## Your status');

/** Registry for the DOs and the routes: Mock chat (recorded, scriptable) plus optional fake cloud speech. */
export function useProviders(opts: { chat?: ChatScript; speech?: Partial<Record<'xai' | 'openai', ProviderFactory>> } = {}) {
  const requests: ChatRequest[] = [];
  const mock = createMockProvider().chat;
  const chat: ChatProvider = {
    id: 'mock',
    kind: 'mock',
    family: 'mock',
    defaultModel: () => 'mock-1',
    async *chat(req) {
      requests.push(req);
      await opts.chat?.before?.(req);
      const scripted = opts.chat?.events?.(req);
      if (scripted) {
        for (const e of scripted) yield e;
        return;
      }
      yield* mock.chat(req);
    },
  };
  const registryFor = (env: Env): Registry => createRegistry(env, { providers: { mock: () => ({ ...createMockProvider(), chat }), ...(opts.speech ?? {}) } });
  runtime.registry = registryFor;
  return { requests, registryFor };
}

export function gate() {
  let open!: () => void;
  const opened = new Promise<void>((r) => (open = r));
  return { opened, open };
}

export const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export function viewerOp(over: Partial<ViewerOp> = {}): ViewerOp {
  return {
    op: 'viewer',
    surface: 'talk',
    stageAgentId: CHIEF_ID,
    floorVisible: false,
    visibleProjectIds: [],
    listeningProjectIds: [],
    audioArmed: true,
    voiceOn: true,
    pageVisible: true,
    reducedMotion: false,
    quietHours: false,
    tzOffsetMin: 0,
    voice: null,
    ...over,
  };
}

/** A workspace with a chosen lead, one feed socket, and helpers for routes, frames and jobs. */
export async function exprSetup(overrides: Partial<Env> = {}, opts: { lead?: string | null; chiefName?: string | null } = {}) {
  const t: TestEnv = await createTestEnv(overrides);
  const ws = t.namespaces.WORKSPACE.getByName('ws:local') as WorkspaceDO;
  const project = t.namespaces.PROJECT.getByName('p:everyday:local') as ProjectDO;
  const state = t.namespaces.WORKSPACE.state('ws:local');
  const socket = new FakeWebSocket();
  state.getWebSockets = () => [socket as unknown as WebSocket];
  const live = (): Frame[] => socket.sent.map((m) => parseFrame(m)).filter((f): f is Frame => !!f);
  const liveOf = <T extends FrameType>(type: T) => live().filter((f): f is Extract<Frame, { type: T }> => f.type === type);

  /** Call a route handler with the runtime registry (so routes and Durable Objects see the same providers). */
  const api = async (method: string, path: string, body?: unknown, headers: Record<string, string> = {}) => {
    const url = new URL(`http://localhost${path}`);
    const found = matchRoute(method, url.pathname);
    if (!found || !('match' in found)) throw new Error(`no route ${method} ${path}`);
    const { id, params } = found.match;
    let registry: Registry | undefined;
    const rc: RouteContext = { env: t.env, identity: { email: '', name: '', role: 'owner', actualRole: 'owner' }, ctx: t.ctx, route: id, params, url, registry: () => (registry ??= runtime.registry(t.env)) };
    const init: RequestInit = { method, headers: { ...(body !== undefined ? { 'content-type': 'application/json' } : {}), ...headers }, ...(body !== undefined ? { body: JSON.stringify(body) } : {}) };
    let res: Response;
    try {
      res = await HANDLERS[id](new Request(url, init), rc);
    } catch (err) {
      res = toErrorResponse(err, id);
    }
    const type = res.headers.get('content-type') ?? '';
    const parsed = type.includes('json') && res.status !== 304 ? ((await res.json()) as any) : null;
    return { status: res.status, headers: res.headers, body: parsed, res };
  };
  const drain = () => t.ctx.drain();
  const talk = async (text: string, via: 'text' | 'voice' = 'text', opId: string = ids.op()) => {
    const r = await ws.talk({ text, opId, via });
    await drain();
    return r;
  };
  const view = async (over: Partial<ViewerOp> = {}) => ws.webSocketMessage(socket as unknown as WebSocket, JSON.stringify(viewerOp(over)));
  const frames = () => ws.frames(0, 5000);
  const ofType = async <T extends FrameType>(type: T) => (await frames()).filter((f): f is Extract<Frame, { type: T }> => f.type === type);
  const runJobs = async (max = 20) => {
    for (let i = 0; i < max; i++) {
      await project.alarm();
      await drain();
      if (!(await project.listJobs()).some((j) => j.status === 'running')) return i + 1;
    }
    return max;
  };
  const runner = () => t.namespaces.RUN.getByName(`run:expr-prevoice:local`) as RunDO;
  /** Tick the pre-voice runner until nothing is active (or `max` ticks). */
  const runPrevoice = async (max = 400) => {
    for (let i = 0; i < max; i++) {
      const alarm = t.namespaces.RUN.state('run:expr-prevoice:local').storage.alarmAt;
      if (alarm === null) return i;
      await runner().alarm();
      await drain();
    }
    return max;
  };
  if (opts.lead !== null) await ws.updateSettings({ leadId: opts.lead ?? 'lead-warm-mentor', ...(opts.chiefName !== undefined ? { chiefName: opts.chiefName } : {}) });
  return { t, ws, project, state, socket, live, liveOf, api, drain, talk, view, frames, ofType, runJobs, runner, runPrevoice };
}

export type ExprSetup = Awaited<ReturnType<typeof exprSetup>>;
