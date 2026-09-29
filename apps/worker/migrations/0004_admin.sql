-- Admin (packages/protocol/src/ext/admin.ts): people and roles, settings changed on the admin page, and token usage.

-- Invited members. Owners named in OWNER_EMAILS are owners without a row here.
CREATE TABLE IF NOT EXISTS members (
  ws_id        TEXT NOT NULL,
  email        TEXT NOT NULL,                  -- lower-cased
  name         TEXT NOT NULL DEFAULT '',
  role         TEXT NOT NULL,                  -- owner | contributor | reader
  added_at     TEXT NOT NULL,
  added_by     TEXT NOT NULL DEFAULT '',
  last_seen_at TEXT,
  PRIMARY KEY (ws_id, email)
);

-- Settings changed on the admin page; they override the deployment's environment. Keys are sealed (AES-GCM).
CREATE TABLE IF NOT EXISTS settings_kv (
  ws_id      TEXT NOT NULL,
  key        TEXT NOT NULL,
  value      TEXT NOT NULL,
  sealed     INTEGER NOT NULL DEFAULT 0,
  updated_at TEXT NOT NULL,
  updated_by TEXT NOT NULL DEFAULT '',
  PRIMARY KEY (ws_id, key)
);

-- Model calls per UTC day, surface, coworker, provider, model and capability.
CREATE TABLE IF NOT EXISTS model_usage (
  ws_id       TEXT NOT NULL,
  day         TEXT NOT NULL,
  surface     TEXT NOT NULL,
  agent_id    TEXT NOT NULL DEFAULT '',
  provider    TEXT NOT NULL,
  model       TEXT NOT NULL,
  capability  TEXT NOT NULL,
  calls       INTEGER NOT NULL DEFAULT 0,
  errors      INTEGER NOT NULL DEFAULT 0,
  input       INTEGER NOT NULL DEFAULT 0,
  output      INTEGER NOT NULL DEFAULT 0,
  cached      INTEGER NOT NULL DEFAULT 0,
  usd         REAL NOT NULL DEFAULT 0,        -- reported by the provider
  usd_calls   INTEGER NOT NULL DEFAULT 0,     -- calls whose cost the provider reported
  ms          INTEGER NOT NULL DEFAULT 0,
  first_ms    INTEGER NOT NULL DEFAULT 0,
  first_calls INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (ws_id, day, surface, agent_id, provider, model, capability)
);

-- The latest calls, one row each (pruned to the newest few thousand).
CREATE TABLE IF NOT EXISTS model_calls (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  ws_id       TEXT NOT NULL,
  at          TEXT NOT NULL,
  surface     TEXT NOT NULL,
  agent_id    TEXT NOT NULL DEFAULT '',
  project_id  TEXT NOT NULL DEFAULT '',
  provider    TEXT NOT NULL,
  model       TEXT NOT NULL,
  capability  TEXT NOT NULL,
  input       INTEGER NOT NULL DEFAULT 0,
  output      INTEGER NOT NULL DEFAULT 0,
  cached      INTEGER NOT NULL DEFAULT 0,
  usd         REAL,
  ms          INTEGER NOT NULL DEFAULT 0,
  first_ms    INTEGER,
  ok          INTEGER NOT NULL DEFAULT 1,
  error       TEXT
);
CREATE INDEX IF NOT EXISTS model_calls_ws ON model_calls (ws_id, id);

-- Prices set by the owner (USD per million tokens), for providers that do not report a cost.
CREATE TABLE IF NOT EXISTS model_prices (
  ws_id    TEXT NOT NULL,
  provider TEXT NOT NULL,
  model    TEXT NOT NULL,
  input    REAL NOT NULL,
  output   REAL NOT NULL,
  cached   REAL,
  PRIMARY KEY (ws_id, provider, model)
);
