import type { Frame, JobSnapshot, WorkspaceSettings } from '@headcount/protocol';

// D1 roll-up (ARCHITECTURE §2.5): writers keep the hot copy in DO SQLite and copy persisted frames to
// D1 `ledger_events` with INSERT OR IGNORE on (stream, seq), so a retried batch never duplicates.
// Tables come from migrations/0001_init.sql.

const INSERT_EVENT = 'INSERT OR IGNORE INTO ledger_events (stream, seq, ws_id, ts, type, actor, op_id, cause, data) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)';

export async function rollupEvents(db: D1Database, wsId: string, frames: Frame[]): Promise<void> {
  const rows = frames.filter((f) => typeof f.seq === 'number');
  if (!rows.length) return;
  await db.batch(
    rows.map((f) =>
      db.prepare(INSERT_EVENT).bind(f.streamId, f.seq, wsId, f.ts, f.type, f.actor ?? null, f.opId ?? null, f.cause ? JSON.stringify(f.cause) : null, JSON.stringify(f.data)),
    ),
  );
}

const UPSERT_JOB = `INSERT INTO jobs (id, ws_id, project_id, title, status, label, created_at, updated_at, finished_at, summary)
  VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  ON CONFLICT(id) DO UPDATE SET status = excluded.status, label = excluded.label, updated_at = excluded.updated_at,
    finished_at = excluded.finished_at, summary = excluded.summary`;

export async function upsertJobs(db: D1Database, wsId: string, jobs: JobSnapshot[]): Promise<void> {
  if (!jobs.length) return;
  await db.batch(
    jobs.map((j) => db.prepare(UPSERT_JOB).bind(j.jobId, wsId, j.projectId, j.title, j.status, j.label, j.startedAt, j.updatedAt, j.finishedAt ?? null, j.summary ?? null)),
  );
}

const UPSERT_WORKSPACE = `INSERT INTO workspaces (id, lead_id, chief_name, voice_on, updated_at) VALUES (?, ?, ?, ?, ?)
  ON CONFLICT(id) DO UPDATE SET lead_id = excluded.lead_id, chief_name = excluded.chief_name, voice_on = excluded.voice_on, updated_at = excluded.updated_at`;

export async function upsertWorkspace(db: D1Database, s: WorkspaceSettings): Promise<void> {
  await db.prepare(UPSERT_WORKSPACE).bind(s.workspaceId, s.leadId, s.chiefName, s.voiceOn ? 1 : 0, s.updatedAt).run();
}
