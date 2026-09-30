-- Inc 6 · trust and real actions (packages/protocol/src/ext/trust.ts): the autonomy dial, grants, and the audit trail.
-- Effects and receipts live with the work, in the Everyday ProjectDO (the one place a real action runs).

-- The owner's autonomy level per kind of action. A missing row is the default.
CREATE TABLE IF NOT EXISTS autonomy (
  ws_id        TEXT NOT NULL,
  action_class TEXT NOT NULL,
  level        TEXT NOT NULL,                  -- ask | propose | act_report | act_quiet
  updated_at   TEXT NOT NULL,
  updated_by   TEXT NOT NULL DEFAULT '',
  PRIMARY KEY (ws_id, action_class)
);

-- Approvals that reach past one action: this task, this project, or 24 hours (a one-off OK is not stored as a grant).
CREATE TABLE IF NOT EXISTS grants (
  grant_id     TEXT PRIMARY KEY,
  ws_id        TEXT NOT NULL,
  action_class TEXT NOT NULL,
  tool         TEXT NOT NULL,
  kind         TEXT NOT NULL,                  -- task | project | day
  subject      TEXT NOT NULL,                  -- an agent id, or * for anyone
  task_id      TEXT,
  project_id   TEXT,
  expires_at   TEXT,
  created_at   TEXT NOT NULL,
  created_by   TEXT NOT NULL,
  uses         INTEGER NOT NULL DEFAULT 0,
  used_at      TEXT,
  revoked_at   TEXT,
  note         TEXT
);
CREATE INDEX IF NOT EXISTS grants_active ON grants (ws_id, tool, revoked_at);

-- One append-only log of what happened: emails asked, approved, sent (with receipts) or declined; grants; changes the
-- team made inside Headcount (with what Undo restores); autonomy changes; Everyone stop.
CREATE TABLE IF NOT EXISTS audit_log (
  audit_id   TEXT PRIMARY KEY,
  ws_id      TEXT NOT NULL,
  at         TEXT NOT NULL,
  actor      TEXT NOT NULL,
  kind       TEXT NOT NULL,
  action     TEXT NOT NULL,
  summary    TEXT NOT NULL,
  target     TEXT,
  link       TEXT,
  receipt    TEXT,                             -- JSON Receipt
  undo       TEXT,                             -- JSON: what Undo does, or why it cannot
  undone_at  TEXT,
  undone_by  TEXT
);
CREATE INDEX IF NOT EXISTS audit_ws_at ON audit_log (ws_id, at DESC, audit_id DESC);
