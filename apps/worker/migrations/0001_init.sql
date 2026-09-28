-- 0001_init: workspace records and the ledger roll-up (ARCHITECTURE §15.1). Owned by worker-core.
-- Every row carries ws_id; Inc 0 has one workspace ("local").

CREATE TABLE IF NOT EXISTS workspaces (
  id           TEXT PRIMARY KEY,
  name         TEXT NOT NULL DEFAULT 'My workspace',
  lead_id      TEXT,
  chief_name   TEXT,
  voice_on     INTEGER NOT NULL DEFAULT 1,
  d1_shard     TEXT NOT NULL DEFAULT 'main',
  created_at   TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  updated_at   TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

-- Roll-up of persisted frames from every stream (writers keep the hot copy in DO SQLite).
CREATE TABLE IF NOT EXISTS ledger_events (
  stream     TEXT NOT NULL,
  seq        INTEGER NOT NULL,
  ws_id      TEXT NOT NULL,
  ts         TEXT NOT NULL,
  type       TEXT NOT NULL,
  actor      TEXT,
  op_id      TEXT,
  cause      TEXT,
  data       TEXT NOT NULL,
  PRIMARY KEY (stream, seq)
);
CREATE INDEX IF NOT EXISTS ledger_events_ws_type ON ledger_events (ws_id, type, ts);

-- Jobs across projects, for the Activity rail and "what ran while I was away".
CREATE TABLE IF NOT EXISTS jobs (
  id           TEXT PRIMARY KEY,
  ws_id        TEXT NOT NULL,
  project_id   TEXT NOT NULL,
  title        TEXT NOT NULL,
  status       TEXT NOT NULL,
  label        TEXT NOT NULL DEFAULT '',
  created_at   TEXT NOT NULL,
  updated_at   TEXT NOT NULL,
  finished_at  TEXT,
  summary      TEXT
);
CREATE INDEX IF NOT EXISTS jobs_ws_status ON jobs (ws_id, status, updated_at);
