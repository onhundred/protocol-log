-- Onhundred protocol log. Same statements as src/schema.mjs.
CREATE TABLE IF NOT EXISTS meta (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS loops (
  code TEXT PRIMARY KEY,
  data TEXT NOT NULL,
  proposed INTEGER NOT NULL DEFAULT 0,
  pending TEXT,
  retired INTEGER NOT NULL DEFAULT 0,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS experiments (
  code TEXT PRIMARY KEY,
  card TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS stage_tries (
  experiment_code TEXT NOT NULL,
  stage INTEGER NOT NULL,
  try INTEGER NOT NULL,
  data TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  PRIMARY KEY (experiment_code, stage, try)
);

CREATE TABLE IF NOT EXISTS agents (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  kind TEXT NOT NULL,
  access TEXT NOT NULL,
  token_hash TEXT UNIQUE,
  client_id TEXT,
  grant_id TEXT,
  created_at TEXT NOT NULL,
  revoked_at TEXT
);

CREATE TABLE IF NOT EXISTS events (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  at TEXT NOT NULL,
  actor TEXT NOT NULL,
  tool TEXT NOT NULL,
  target TEXT,
  args TEXT,
  before TEXT,
  after TEXT
);

CREATE INDEX IF NOT EXISTS events_target ON events (target);

CREATE TRIGGER IF NOT EXISTS events_no_update BEFORE UPDATE ON events
BEGIN SELECT RAISE(ABORT, 'events are append-only'); END;

CREATE TRIGGER IF NOT EXISTS events_no_delete BEFORE DELETE ON events
BEGIN SELECT RAISE(ABORT, 'events are append-only'); END;

INSERT OR IGNORE INTO meta (key, value) VALUES ('schemaVersion', '1');

INSERT OR IGNORE INTO meta (key, value) VALUES ('mode', '"building"');

INSERT OR IGNORE INTO meta (key, value) VALUES ('protocolVersion', '"1.6"');
