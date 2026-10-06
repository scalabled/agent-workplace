-- Organizations (multi-tenant Headcount, packages/protocol/src/ext/orgs.ts). Each organization is a workspace: its id
-- names its Durable Objects (ws:<id>, p:everyday:<id>), its rows here (ws_id) and its R2 prefix (ws/<id>/…). The
-- deployment's own workspace (WORKSPACE_ID, usually "local") is the home organization; its owners are OWNER_EMAILS.
CREATE TABLE IF NOT EXISTS orgs (
  org_id     TEXT PRIMARY KEY,
  name       TEXT NOT NULL,
  created_at TEXT NOT NULL,
  created_by TEXT NOT NULL DEFAULT '',
  status     TEXT NOT NULL DEFAULT 'active'
);

-- The organization a session works in (NULL: none chosen yet).
ALTER TABLE auth_sessions ADD COLUMN org_id TEXT;

-- Someone's organizations, by email.
CREATE INDEX IF NOT EXISTS members_email ON members (email);
