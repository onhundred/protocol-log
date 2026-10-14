-- Share cards and nudge activity. Same statements as the V2 list in src/schema.mjs.
CREATE TABLE IF NOT EXISTS cards (
  id TEXT PRIMARY KEY,
  kind TEXT NOT NULL,
  moment TEXT NOT NULL,
  page TEXT NOT NULL,
  target TEXT,
  facts TEXT NOT NULL,
  headline INTEGER NOT NULL DEFAULT 0,
  event_id INTEGER,
  waiting TEXT,
  created_at TEXT NOT NULL,
  ready_at TEXT,
  copied_at TEXT,
  revoked_at TEXT,
  views INTEGER NOT NULL DEFAULT 0,
  images TEXT,
  images_at TEXT,
  remakes TEXT
);

CREATE INDEX IF NOT EXISTS cards_event ON cards (event_id);

CREATE TABLE IF NOT EXISTS nudge_activity (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  nudge_id TEXT NOT NULL,
  kind TEXT NOT NULL,
  about TEXT,
  event TEXT NOT NULL,
  answer TEXT,
  at TEXT NOT NULL,
  actor TEXT
);

CREATE INDEX IF NOT EXISTS nudge_activity_at ON nudge_activity (at);

UPDATE meta SET value = '2' WHERE key = 'schemaVersion' AND CAST(value AS INTEGER) < 2;
