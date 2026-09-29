// One voice per workspace (owner report: duplicate responses spoken out loud): the WorkspaceDO tracks which client
// (browser tab) speaks, moves it on every owner interaction, echoes socket claims, and hands proactive speech to the
// most recently active connected client when the owner's tab is gone (after a grace for a reload).
import { CHIEF_ID, ids, parseFrame, type Frame } from '@headcount/protocol';
import type { VoiceOwnerData } from '@headcount/protocol/ext/voice-owner';
import { afterEach, describe, expect, it } from 'vitest';
import { exprSetup, useProviders, viewerOp } from '../../test/expr-kit';
import { FakeSqlStorage, FakeWebSocket } from '../../test/fake-cloud';
import { defaultRuntime, runtime } from './runtime';
import { VOICE_GRACE_MS, VoiceOwnership } from './voice';

afterEach(() => Object.assign(runtime, defaultRuntime));

const A = 'cAAAAAAAAAAAAAAAA';
const B = 'cBBBBBBBBBBBBBBBB';
const C = 'cCCCCCCCCCCCCCCCC';

/** A VoiceOwnership over real SQLite with a hand-driven clock, sockets and timers. */
function harness() {
  let t = 1_000_000;
  let seq = 0;
  const sockets: FakeWebSocket[] = [];
  const said: VoiceOwnerData[] = [];
  const timers: { at: number; fn: () => void }[] = [];
  const sql = new FakeSqlStorage();
  const make = () =>
    new VoiceOwnership({
      sql: sql as unknown as SqlStorage,
      sockets: () => sockets,
      broadcast: (d) => said.push(d),
      now: () => t,
      later: (fn, ms) => timers.push({ at: t + ms, fn }),
      head: () => seq,
    });
  let v = make();
  const connect = (clientId: string | null) => {
    const ws = new FakeWebSocket();
    sockets.push(ws);
    v.attach(ws, clientId);
    const snap = v.snapshot();
    v.connected();
    return { ws, snap };
  };
  const close = (ws: FakeWebSocket) => {
    sockets.splice(sockets.indexOf(ws), 1);
    ws.close();
    v.closed(ws);
  };
  const advance = (ms: number) => {
    t += ms;
    for (const x of timers.splice(0).sort((a, b) => a.at - b.at)) {
      if (x.at <= t) x.fn();
      else timers.push(x);
    }
  };
  return {
    get v() {
      return v;
    },
    said,
    sockets,
    sql,
    /** Persisted feed lines (the ledger's last seq moves on). */
    append: (n = 1) => (seq += n),
    connect,
    close,
    advance,
    /** A new object over the same storage and sockets (hibernation: memory and timers are gone). */
    revive: () => {
      timers.length = 0;
      v = make();
    },
  };
}

describe('VoiceOwnership', () => {
  it('gives the voice to the first client, and a tab that only opens never takes it', () => {
    const h = harness();
    expect(h.connect(A).snap.clientId).toBe(A);
    expect(h.said.map((d) => d.clientId)).toEqual([A]);
    expect(h.connect(B).snap.clientId).toBe(A);
    expect(h.said).toHaveLength(1);
    expect(h.v.effective()).toBe(A);
  });

  it('moves the voice with every owner interaction; a socket claim is always echoed with its claim id', () => {
    const h = harness();
    h.connect(A);
    h.connect(B);
    h.v.claim(B, 'talk');
    expect(h.said.at(-1)).toMatchObject({ clientId: B, reason: 'talk' });
    const n = h.said.length;
    h.v.claim(B, 'steer'); // no move, no news
    expect(h.said).toHaveLength(n);
    h.v.claim(B, 'claim', 'k1'); // no move, but the claiming tab settles on the echo
    expect(h.said.at(-1)).toMatchObject({ clientId: B, reason: 'claim', claimId: 'k1' });
    h.v.claim(A, 'desk');
    expect(h.said.at(-1)).toMatchObject({ clientId: A, reason: 'desk' });
    h.v.claim('not a client id', 'claim', 'k2');
    expect(h.v.effective()).toBe(A);
  });

  it('keeps the voice with a reloading owner; after the grace, proactive speech goes to the most recently active client', () => {
    const h = harness();
    const a = h.connect(A);
    h.connect(B);
    h.connect(C);
    h.v.claim(C, 'talk');
    h.advance(1000);
    h.v.claim(A, 'claim', 'k1');
    const before = h.said.length;
    // A reload: the socket closes and the same tab is back within the grace. Nobody else speaks meanwhile.
    h.close(a.ws);
    expect(h.v.effective()).toBe(A);
    h.advance(1500);
    const again = h.connect(A);
    expect(again.snap.clientId).toBe(A);
    h.advance(VOICE_GRACE_MS + 100);
    expect(h.said).toHaveLength(before);
    // The tab closes for good: C (active more recently than B, who never interacted) takes over.
    h.close(again.ws);
    h.advance(VOICE_GRACE_MS - 200);
    expect(h.said).toHaveLength(before);
    h.advance(300);
    expect(h.said.at(-1)).toMatchObject({ clientId: C, reason: 'fallback' });
    // The owner's tab coming back takes the voice again (it holds the most recent interaction).
    h.connect(A);
    expect(h.said.at(-1)).toMatchObject({ clientId: A, reason: 'connect' });
  });

  it('keeps a fallback stable while it is connected, and says nobody when no client is left', () => {
    const h = harness();
    const a = h.connect(A);
    const b = h.connect(B);
    h.v.claim(A, 'talk');
    h.close(a.ws);
    h.advance(VOICE_GRACE_MS + 100);
    expect(h.v.effective()).toBe(B);
    h.connect(C); // a new tab does not take the voice from the fallback
    expect(h.v.effective()).toBe(B);
    h.close(b.ws);
    h.close(h.sockets[0]!);
    h.advance(VOICE_GRACE_MS + 100);
    expect(h.v.effective()).toBeNull();
    expect(h.said.at(-1)?.clientId).toBeNull();
  });

  it('never counts a socket without a client id (a tab from before voice ownership)', () => {
    const h = harness();
    expect(h.connect(null).snap.clientId).toBeNull();
    expect(h.v.effective()).toBeNull();
  });

  it('re-checks after hibernation: a tab that closed while the object slept never keeps the voice', () => {
    const h = harness();
    const a = h.connect(A);
    h.connect(B);
    h.v.claim(A, 'talk');
    h.sockets.splice(h.sockets.indexOf(a.ws), 1); // closed while the object slept: no close event, no timer
    h.revive(); // a wake: B's socket survived, so no restart grace for A
    h.v.refresh();
    expect(h.said.at(-1)).toMatchObject({ clientId: B, reason: 'fallback' });
    expect(h.said.at(-1)?.unvoicedAfter).toBeUndefined(); // when A went is unknown
  });

  it('keeps the voice with the tab left behind through every wake from hibernation', () => {
    const h = harness();
    const a = h.connect(A);
    const b = h.connect(B);
    h.v.claim(A, 'talk');
    h.close(a.ws);
    h.advance(VOICE_GRACE_MS + 100);
    expect(h.said.at(-1)).toMatchObject({ clientId: B, reason: 'fallback' });
    const told = h.said.length;
    // Idle: each ping (every 25 s) wakes a new object over the same storage, with B's socket still open.
    for (let i = 0; i < 4; i++) {
      h.advance(25_000);
      h.revive();
      expect(h.connect(C).snap.clientId).toBe(B); // and a tab opening meanwhile is told B
      h.close(h.sockets.at(-1)!);
      h.v.refresh();
      expect(h.v.effective()).toBe(B);
    }
    h.advance(VOICE_GRACE_MS + 100);
    // Nothing was re-announced (who speaks is kept in storage), and nothing ever named A again.
    expect(h.said.slice(told)).toEqual([]);
    expect(h.v.clientOf(b.ws)).toBe(B);
  });

  it('a lone tab on a cold workspace gets the voice at once (or after the grace, on storage from before voice_published)', () => {
    const h = harness();
    const a = h.connect(A);
    h.v.claim(A, 'talk');
    h.close(a.ws);
    h.advance(VOICE_GRACE_MS + 100);
    expect(h.said.at(-1)?.clientId).toBeNull();
    h.advance(10 * 60_000);
    h.revive(); // cold: no sockets, nobody spoke
    expect(h.connect(C).snap.clientId).toBe(C);
    // Storage written before the published row existed: the stored owner gets the restart grace, then the lone tab speaks.
    h.close(h.sockets[0]!);
    h.advance(VOICE_GRACE_MS + 100);
    h.sql.exec('DELETE FROM voice_published');
    h.revive();
    expect(h.connect(B).snap.clientId).toBe(A);
    h.advance(VOICE_GRACE_MS + 60);
    expect(h.said.at(-1)).toMatchObject({ clientId: B, reason: 'fallback' });
  });

  it('a fallback says where the lines nobody voiced begin (the feed seq when the owner’s tab went away)', () => {
    const h = harness();
    const a = h.connect(A);
    h.connect(B);
    h.v.claim(A, 'talk');
    h.append(7);
    h.close(a.ws);
    h.append(2); // an announcement during the grace: silent in B
    h.advance(VOICE_GRACE_MS + 100);
    expect(h.said.at(-1)).toMatchObject({ clientId: B, reason: 'fallback', unvoicedAfter: 7 });
    // A claim or a tab coming back is never a fallback: nothing to catch up.
    h.connect(A);
    expect(h.said.at(-1)).toMatchObject({ clientId: A, reason: 'connect' });
    expect(h.said.at(-1)?.unvoicedAfter).toBeUndefined();
  });

  it('after a restart, the first tab back does not take the voice from the owner reconnecting a moment later', () => {
    const h = harness();
    h.connect(A);
    h.connect(B);
    h.v.claim(A, 'talk');
    h.sockets.splice(0); // every socket closed with the old object
    h.revive();
    expect(h.connect(B).snap.clientId).toBe(A);
    h.advance(800);
    h.connect(A);
    expect(h.v.effective()).toBe(A);
    h.advance(VOICE_GRACE_MS + 100);
    expect(h.said.filter((d) => d.clientId === B)).toEqual([]);
  });

  it('after a restart, the tab that spoke keeps the grace (not a stored owner that had left), and the voice falls back when it ends', () => {
    const h = harness();
    const a = h.connect(A);
    h.connect(B);
    h.connect(C);
    h.v.claim(A, 'talk');
    h.close(a.ws);
    h.advance(VOICE_GRACE_MS + 100);
    expect(h.v.effective()).toBe(B);
    h.sockets.splice(0);
    h.revive();
    expect(h.connect(C).snap.clientId).toBe(B); // B spoke: C, back first, waits for it
    h.advance(VOICE_GRACE_MS + 60); // B never comes back
    expect(h.said.at(-1)).toMatchObject({ clientId: C, reason: 'fallback' });
  });
});

describe('WorkspaceDO voice ownership', () => {
  /** Frames a socket received, parsed. */
  const framesOf = (ws: FakeWebSocket): Frame[] => ws.sent.map((m) => parseFrame(m)).filter((f): f is Frame => !!f);

  async function twoTabs() {
    useProviders();
    const s = await exprSetup();
    const a = new FakeWebSocket();
    const b = new FakeWebSocket();
    const open: FakeWebSocket[] = [];
    s.state.getWebSockets = () => open as unknown as WebSocket[];
    open.push(a);
    s.ws.openFeed(a as unknown as WebSocket, 0, A);
    open.push(b);
    s.ws.openFeed(b as unknown as WebSocket, 0, B);
    return { s, a, b, open };
  }

  it('says who speaks in every ready frame, before anything live', async () => {
    const { a, b } = await twoTabs();
    const ready = (ws: FakeWebSocket) => framesOf(ws).find((f) => f.type === 'ready');
    expect(ready(a)?.data).toMatchObject({ voice: { clientId: A } });
    expect(ready(b)?.data).toMatchObject({ voice: { clientId: A } });
  });

  it('a talk from a tab makes it the voice owner before the first frame of its turn', async () => {
    const { s, a, b } = await twoTabs();
    await s.ws.talk({ text: 'What should we focus on?', opId: ids.op(), via: 'text', clientId: B });
    await s.drain();
    const types = framesOf(a).map((f) => f.type);
    const moved = framesOf(a).findIndex((f) => f.type === 'voice.owner' && f.data.clientId === B);
    expect(moved).toBeGreaterThan(-1);
    expect(moved).toBeLessThan(types.indexOf('talk.owner'));
    expect(framesOf(b).some((f) => f.type === 'voice.owner' && f.data.clientId === B && f.data.reason === 'talk')).toBe(true);
  });

  it('echoes a socket claim with its claim id, and ignores a claim from a socket without a client', async () => {
    const { s, a, b } = await twoTabs();
    await s.ws.webSocketMessage(b as unknown as WebSocket, JSON.stringify({ op: 'voice.claim', claimId: 'k42' }));
    expect(framesOf(a).at(-1)).toMatchObject({ type: 'voice.owner', data: { clientId: B, reason: 'claim', claimId: 'k42' } });
    const stranger = new FakeWebSocket();
    await s.ws.webSocketMessage(stranger as unknown as WebSocket, JSON.stringify({ op: 'voice.claim', claimId: 'k43' }));
    await s.ws.webSocketMessage(b as unknown as WebSocket, JSON.stringify({ op: 'voice.claim', claimId: 'bad id!' }));
    expect((await s.ws.voiceOwner()).clientId).toBe(B);
    expect(framesOf(a).filter((f) => f.type === 'voice.owner' && f.data.claimId !== undefined)).toHaveLength(1);
  });

  it('owner actions over HTTP claim the voice: talk, steer and a desk reply', async () => {
    const { s } = await twoTabs();
    expect((await s.api('POST', '/api/talk', { text: 'hi', opId: ids.op(), clientId: B })).status).toBe(202);
    await s.drain();
    expect((await s.ws.voiceOwner()).clientId).toBe(B);
    expect((await s.api('POST', '/api/desk/tech-lead/say', { text: 'hi', opId: ids.op(), clientId: A })).status).toBe(202);
    await s.drain();
    expect((await s.ws.voiceOwner()).clientId).toBe(A);
    await s.talk('Look into three packaging suppliers for me');
    const job = (await s.project.listJobs())[0]!;
    expect((await s.api('POST', `/api/jobs/${job.jobId}/steer`, { text: 'Also check eco options', clientId: B })).status).toBe(202);
    expect((await s.ws.voiceOwner()).clientId).toBe(B);
    // A request without a client id (curl, an older tab) never moves the voice.
    expect((await s.api('POST', '/api/talk', { text: 'hello', opId: ids.op() })).status).toBe(202);
    await s.drain();
    expect((await s.ws.voiceOwner()).clientId).toBe(B);
  });

  it('when the owner tab closes, the other tab gets the voice after the grace', async () => {
    const { s, a, b, open } = await twoTabs();
    await s.ws.webSocketMessage(b as unknown as WebSocket, JSON.stringify({ op: 'voice.claim', claimId: 'k1' }));
    let now = Date.now();
    runtime.now = () => now;
    open.splice(open.indexOf(b), 1);
    await s.ws.webSocketClose(b as unknown as WebSocket, 1001, 'gone');
    expect((await s.ws.voiceOwner()).clientId).toBe(B);
    now += VOICE_GRACE_MS + 100;
    await s.ws.webSocketMessage(a as unknown as WebSocket, JSON.stringify({ op: 'ping', t: 1 }));
    expect(framesOf(a).at(-1)).toMatchObject({ type: 'voice.owner', data: { clientId: A, reason: 'fallback' } });
  });

  it('plans event reflexes for the voice owner’s view when several tabs are at Talk', async () => {
    const { s, a, b } = await twoTabs();
    await s.ws.webSocketMessage(a as unknown as WebSocket, JSON.stringify(viewerOp({ tzOffsetMin: 60 })));
    await s.ws.webSocketMessage(b as unknown as WebSocket, JSON.stringify(viewerOp({ tzOffsetMin: 120 })));
    // The viewer op keeps the socket's client id (one attachment holds both).
    expect(s.ws.voice.clientOf(b as unknown as WebSocket)).toBe(B);
    expect(s.ws.expr.stageViewer(CHIEF_ID)?.tzOffsetMin).toBe(60); // A has the voice
    await s.ws.webSocketMessage(b as unknown as WebSocket, JSON.stringify({ op: 'voice.claim', claimId: 'k1' }));
    expect(s.ws.expr.stageViewer(CHIEF_ID)?.tzOffsetMin).toBe(120);
  });
});
