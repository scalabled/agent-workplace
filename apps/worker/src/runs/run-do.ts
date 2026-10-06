import { configured, loadConfig } from '../admin/config';
import { tenantOf, withTenant } from '../lib/tenant';
import { DurableObject } from 'cloudflare:workers';
import { newId } from '@headcount/protocol';
import type { ExprPrevoiceStatus, ExprPrevoiceTier, ExprTtsProvider } from '@headcount/protocol/ext/expressions';
import type { TtsDelivery } from '@headcount/expressions';
import type { Env } from '../env';
import { renderClip, type ClipScope } from '../expr/clips';
import type { ManifestRow } from '../expr/host';
import { HttpError } from '../lib/http';
import { workspaceStub } from '../lib/stubs';
import { logError, models, runtime } from '../workspace/runtime';

/** Clips rendered at once per tick (A3). */
export const PREVOICE_PARALLEL = 3;
/** Keep-alive while a tick renders: if the object dies mid-tick, the alarm fires again and resumes. */
export const PREVOICE_LEASE_MS = 60_000;
/** Gap between ticks while work remains. */
export const PREVOICE_TICK_MS = 20;

/** One clip of a run (a line of an agent; two lines sharing a voice and text share the clip). */
export interface PrevoiceRunItem {
  clipKey: string;
  agentId: string;
  lineKey: string;
  lineId: string;
  fillKey: string;
  tier: ExprPrevoiceTier;
  scope: ClipScope;
  delivery: TtsDelivery;
  text: string;
  voiceKey: string;
  catalogVersion: string;
}

export interface PrevoiceEnqueue {
  fingerprint: string;
  /** The request as sent (JSON), for the record. */
  request: string;
  provider: ExprTtsProvider;
  tiers: ExprPrevoiceTier[];
  agentIds: string[];
  /** Planned clips (cached + to render). */
  planned: number;
  /** Clips that already existed (recorded in the manifests without TTS). */
  cached: number;
  items: PrevoiceRunItem[];
}

type RunRow = {
  run_id: string;
  fingerprint: string;
  state: ExprPrevoiceStatus['state'];
  provider: string;
  tiers: string;
  agent_ids: string;
  planned: number;
  cached: number;
  rendered: number;
  failed: number;
  started_at: string;
  finished_at: string | null;
  error: string | null;
};

type ItemRow = {
  run_id: string;
  clip_key: string;
  agent_id: string;
  line_key: string;
  tier: string;
  delivery: string;
  scope: string;
  state: string;
  seq: number;
  meta: string;
};

const SCHEMA = [
  `CREATE TABLE IF NOT EXISTS prevoice_runs (
     run_id TEXT PRIMARY KEY, fingerprint TEXT NOT NULL, request TEXT NOT NULL, state TEXT NOT NULL, provider TEXT NOT NULL,
     tiers TEXT NOT NULL, agent_ids TEXT NOT NULL, planned INTEGER NOT NULL, cached INTEGER NOT NULL DEFAULT 0,
     rendered INTEGER NOT NULL DEFAULT 0, failed INTEGER NOT NULL DEFAULT 0, started_at TEXT NOT NULL, finished_at TEXT,
     error TEXT, created INTEGER NOT NULL)`,
  `CREATE INDEX IF NOT EXISTS prevoice_runs_fp ON prevoice_runs (fingerprint, created)`,
  `CREATE TABLE IF NOT EXISTS prevoice_items (
     run_id TEXT NOT NULL, clip_key TEXT NOT NULL, agent_id TEXT NOT NULL, line_key TEXT NOT NULL, tier TEXT NOT NULL,
     delivery TEXT NOT NULL, scope TEXT NOT NULL, state TEXT NOT NULL, seq INTEGER NOT NULL, meta TEXT NOT NULL,
     PRIMARY KEY (run_id, agent_id, line_key))`,
  `CREATE INDEX IF NOT EXISTS prevoice_items_next ON prevoice_items (run_id, state, tier, seq)`,
];

const ACTIVE = `('queued', 'running')`;

function status(r: RunRow): ExprPrevoiceStatus {
  return {
    runId: r.run_id,
    state: r.state,
    provider: r.provider as ExprTtsProvider,
    tiers: JSON.parse(r.tiers) as ExprPrevoiceTier[],
    agentIds: JSON.parse(r.agent_ids) as string[],
    planned: Number(r.planned),
    cached: Number(r.cached),
    rendered: Number(r.rendered),
    failed: Number(r.failed),
    startedAt: r.started_at,
    ...(r.finished_at ? { finishedAt: r.finished_at } : {}),
    ...(r.error ? { error: r.error } : {}),
  };
}

/**
 * RunDO — one long job (ARCHITECTURE §2.2). In Inc 0.5 the instance `run:expr-prevoice:<ws>` pre-voices expression
 * lines: an alarm loop renders up to 3 clips per tick, P0 before P1 before P2 and by prior within a tier, records each
 * in the agent's manifest (WorkspaceDO), stops with `stopped_budget` when the daily clip budget runs out, and keeps its
 * queue in SQLite so it resumes after a restart. It only ever starts from an explicit POST /api/expr/prevoice.
 */
export class RunDO extends DurableObject<Env> {
  constructor(ctx: DurableObjectState, env: Env) {
    // The organization this object works for comes from its name (run:expr-prevoice:<org>); its settings over the deployment's.
    super(ctx, configured(withTenant(env, tenantOf(ctx, env, 'run:expr-prevoice:'))));
    void ctx.blockConcurrencyWhile(() => loadConfig(this.env));
    // Everything below reads the admin page's settings over the deployment's.
    env = this.env;
    for (const stmt of SCHEMA) ctx.storage.sql.exec(stmt);
    // A run that was in flight when the object stopped resumes on the next alarm.
    void ctx.blockConcurrencyWhile(async () => {
      if (this.activeRun() && (await ctx.storage.getAlarm()) === null) await ctx.storage.setAlarm(runtime.now());
    });
  }

  async ping(): Promise<'pong'> {
    return 'pong';
  }

  private sql() {
    return this.ctx.storage.sql;
  }

  private activeRun(): RunRow | undefined {
    return this.sql().exec<RunRow>(`SELECT * FROM prevoice_runs WHERE state IN ${ACTIVE} ORDER BY created ASC LIMIT 1`).toArray()[0];
  }

  private row(runId: string): RunRow | undefined {
    return this.sql().exec<RunRow>('SELECT * FROM prevoice_runs WHERE run_id = ?', runId).toArray()[0];
  }

  /** Queue a run (a run with no items is done at once). Returns its status. */
  async prevoiceEnqueue(run: PrevoiceEnqueue): Promise<ExprPrevoiceStatus> {
    const now = runtime.now();
    const runId = newId('pv');
    const iso = new Date(now).toISOString();
    const empty = run.items.length === 0;
    this.ctx.storage.transactionSync(() => {
      this.sql().exec(
        `INSERT INTO prevoice_runs (run_id, fingerprint, request, state, provider, tiers, agent_ids, planned, cached, started_at, finished_at, created)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        runId,
        run.fingerprint,
        run.request,
        empty ? 'done' : 'queued',
        run.provider,
        JSON.stringify(run.tiers),
        JSON.stringify(run.agentIds),
        run.planned,
        run.cached,
        iso,
        empty ? iso : null,
        now,
      );
      run.items.forEach((it, seq) => {
        const meta = JSON.stringify({ lineId: it.lineId, fillKey: it.fillKey, text: it.text, voiceKey: it.voiceKey, catalogVersion: it.catalogVersion });
        this.sql().exec(
          `INSERT OR IGNORE INTO prevoice_items (run_id, clip_key, agent_id, line_key, tier, delivery, scope, state, seq, meta) VALUES (?, ?, ?, ?, ?, ?, ?, 'pending', ?, ?)`,
          runId,
          it.clipKey,
          it.agentId,
          it.lineKey,
          it.tier,
          JSON.stringify(it.delivery),
          it.scope,
          seq,
          meta,
        );
      });
    });
    if (!empty) {
      const alarm = await this.ctx.storage.getAlarm();
      if (alarm === null || alarm > now) await this.ctx.storage.setAlarm(now);
    }
    return status(this.row(runId)!);
  }

  async prevoiceStatus(runId: string): Promise<ExprPrevoiceStatus | null> {
    const r = this.row(runId);
    return r ? status(r) : null;
  }

  /**
   * A run with this fingerprint that finished cleanly (reuse) or is still going (join), newest first; else null. A
   * finished run with failed items is never reused: the caller plans again and renders only what is not stored.
   */
  async prevoiceFind(fingerprint: string): Promise<ExprPrevoiceStatus | null> {
    const r = this.sql()
      .exec<RunRow>(`SELECT * FROM prevoice_runs WHERE fingerprint = ? AND (state IN ('queued', 'running') OR (state = 'done' AND failed = 0)) ORDER BY created DESC LIMIT 1`, fingerprint)
      .toArray()[0];
    return r ? status(r) : null;
  }

  /** The latest run that covered an agent, or null. */
  async prevoiceLatestFor(agentId: string): Promise<ExprPrevoiceStatus | null> {
    const r = this.sql()
      .exec<RunRow>(`SELECT * FROM prevoice_runs WHERE agent_ids LIKE ? ORDER BY created DESC LIMIT 1`, `%${JSON.stringify(agentId)}%`)
      .toArray()[0];
    return r ? status(r) : null;
  }

  /** Pending items of a run (tests, debugging). */
  async prevoicePending(runId: string): Promise<number> {
    return Number(this.sql().exec<{ n: number }>(`SELECT COUNT(*) AS n FROM prevoice_items WHERE run_id = ? AND state = 'pending'`, runId).toArray()[0]?.n ?? 0);
  }

  /** One tick: render the next ≤ 3 clips of the oldest active run, record them, re-arm. */
  override async alarm(): Promise<void> {
    const now = runtime.now();
    await this.ctx.storage.setAlarm(now + PREVOICE_LEASE_MS);
    const run = this.activeRun();
    if (!run) {
      await this.ctx.storage.deleteAlarm();
      return;
    }
    if (run.state === 'queued') this.sql().exec(`UPDATE prevoice_runs SET state = 'running' WHERE run_id = ?`, run.run_id);
    const batch = this.sql()
      .exec<ItemRow>(`SELECT * FROM prevoice_items WHERE run_id = ? AND state = 'pending' ORDER BY tier ASC, seq ASC LIMIT ?`, run.run_id, PREVOICE_PARALLEL)
      .toArray();
    if (!batch.length) {
      this.finish(run.run_id, 'done');
      await this.rearm();
      return;
    }
    const registry = models(this.env, { surface: 'speech' });
    let budgetOut: string | null = null;
    const rows: ManifestRow[] = [];
    const results = await Promise.allSettled(
      batch.map((it) => {
        const meta = JSON.parse(it.meta) as { lineId: string; fillKey: string; text: string; voiceKey: string; catalogVersion: string };
        return renderClip(this.env, registry, {
          delivery: JSON.parse(it.delivery) as TtsDelivery,
          clipKey: it.clip_key,
          scope: it.scope === 'workspace' ? 'workspace' : 'shared',
          text: meta.text,
          lineId: meta.lineId,
          fillKey: meta.fillKey,
          voiceKey: meta.voiceKey,
          catalogVersion: meta.catalogVersion,
        }).then((clip) => ({ clip, meta }));
      }),
    );
    results.forEach((r, i) => {
      const it = batch[i]!;
      if (r.status === 'fulfilled') {
        const { clip, meta } = r.value;
        this.sql().exec(`UPDATE prevoice_items SET state = ? WHERE run_id = ? AND agent_id = ? AND line_key = ?`, clip.cached ? 'cached' : 'done', it.run_id, it.agent_id, it.line_key);
        this.sql().exec(`UPDATE prevoice_runs SET ${clip.cached ? 'cached = cached + 1' : 'rendered = rendered + 1'} WHERE run_id = ?`, it.run_id);
        rows.push({ agentId: it.agent_id, voiceKey: meta.voiceKey, catalogVersion: meta.catalogVersion, lineKey: it.line_key, clipKey: clip.clipKey, durationMs: clip.durationMs, scope: clip.scope, tier: it.tier as ManifestRow['tier'] });
      } else if (r.reason instanceof HttpError && r.reason.code === 'rate_limited') {
        budgetOut = r.reason.message; // stays pending: the run stops below
      } else {
        logError('expr.prevoice', r.reason);
        this.sql().exec(`UPDATE prevoice_items SET state = 'failed' WHERE run_id = ? AND agent_id = ? AND line_key = ?`, it.run_id, it.agent_id, it.line_key);
        this.sql().exec(`UPDATE prevoice_runs SET failed = failed + 1 WHERE run_id = ?`, it.run_id);
      }
    });
    if (rows.length) {
      try {
        await workspaceStub(this.env).exprRecordClips(rows);
      } catch (err) {
        logError('expr.prevoice.manifest', err);
      }
    }
    if (budgetOut) {
      this.sql().exec(`UPDATE prevoice_items SET state = 'skipped' WHERE run_id = ? AND state = 'pending'`, run.run_id);
      this.finish(run.run_id, 'stopped_budget', budgetOut);
    }
    await this.rearm();
  }

  private finish(runId: string, state: 'done' | 'stopped_budget' | 'failed', error?: string): void {
    this.sql().exec(`UPDATE prevoice_runs SET state = ?, finished_at = ?, error = ? WHERE run_id = ?`, state, new Date(runtime.now()).toISOString(), error ?? null, runId);
  }

  private async rearm(): Promise<void> {
    if (this.activeRun()) await this.ctx.storage.setAlarm(runtime.now() + PREVOICE_TICK_MS);
    else await this.ctx.storage.deleteAlarm();
  }
}
