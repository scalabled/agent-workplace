-- Google sign-in (docs/DEPLOY.md, Phase B). Ported from personagram-ai's auth tables, simplified for a single-owner
-- workspace: no users table, the session carries the verified Google email (checked against OWNER_EMAILS on sign-in).

-- One row per sign-in attempt in flight: the state is stored hashed; the PKCE verifier never leaves the worker.
CREATE TABLE IF NOT EXISTS oauth_states (
  state_hash TEXT PRIMARY KEY,
  verifier   TEXT NOT NULL,
  return_to  TEXT NOT NULL DEFAULT '/app',
  expires_at INTEGER NOT NULL
);

-- Sessions: only the SHA-256 of the cookie token is stored.
CREATE TABLE IF NOT EXISTS auth_sessions (
  token_hash TEXT PRIMARY KEY,
  email      TEXT NOT NULL,
  name       TEXT NOT NULL DEFAULT '',
  created_at INTEGER NOT NULL,
  expires_at INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS auth_sessions_expires ON auth_sessions (expires_at);
CREATE INDEX IF NOT EXISTS oauth_states_expires ON oauth_states (expires_at);
