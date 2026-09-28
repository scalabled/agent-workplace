-- 0002_media: generated portraits, their face landmarks, and daily usage counters. Owned by media.
-- Portraits belong to catalog subjects (persona or lead ids), which are the same in every workspace,
-- so they are keyed by persona_id alone. Images live in R2 at portraits/<persona_id>.<ext>.

CREATE TABLE IF NOT EXISTS portraits (
  persona_id      TEXT PRIMARY KEY,           -- catalog persona id or lead id (lead-…)
  subject_kind    TEXT NOT NULL,              -- lead | persona
  r2_key          TEXT,                       -- current image; NULL until the first one is stored
  mime            TEXT,                       -- image/png | image/jpeg | image/webp
  bytes           INTEGER,
  version         TEXT,                       -- new on every stored image: ETag and landmark binding
  provider        TEXT,
  model           TEXT,
  prompt_hash     TEXT,                       -- sha-256 prefix of the prompt sent (detects catalog edits)
  generated_at    TEXT,
  landmarks       TEXT,                       -- normalized FaceLandmarks JSON for this version; first valid write wins
  landmarks_at    TEXT,
  job_id          TEXT,                       -- generation lock holder
  job_status      TEXT,                       -- generating | failed | NULL
  job_started_at  INTEGER,                    -- ms since epoch; a lock older than the stale window can be taken over
  job_error       TEXT,                       -- owner-facing sentence, never provider payloads
  created_at      TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  updated_at      TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

-- Per-day counters for paid media calls (portraits today). Counts saturate at limit + 1 so refused
-- attempts do not use anything up (after personagram-ai security.ts rateLimit).
CREATE TABLE IF NOT EXISTS media_usage (
  ws_id  TEXT NOT NULL,
  day    TEXT NOT NULL,                       -- UTC YYYY-MM-DD
  kind   TEXT NOT NULL,                       -- portrait
  count  INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (ws_id, day, kind)
);
