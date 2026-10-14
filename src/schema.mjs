// D1 schema. Each migrations/NNNN_*.sql file holds the statements of its version (a test checks it), and the
// Worker also applies them on first use, so a one-click install works with no manual step.
// Changes are additive only: new tables, columns or indexes, never DROP or RENAME, so an install
// can roll back to older code at any time (a test checks it).
import P from "../protocol.json" with { type: "json" };

export const SCHEMA_VERSION = 2;

const V1 = [
  `CREATE TABLE IF NOT EXISTS meta (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL
)`,
  `CREATE TABLE IF NOT EXISTS loops (
  code TEXT PRIMARY KEY,
  data TEXT NOT NULL,
  proposed INTEGER NOT NULL DEFAULT 0,
  pending TEXT,
  retired INTEGER NOT NULL DEFAULT 0,
  updated_at TEXT NOT NULL
)`,
  `CREATE TABLE IF NOT EXISTS experiments (
  code TEXT PRIMARY KEY,
  card TEXT NOT NULL,
  updated_at TEXT NOT NULL
)`,
  `CREATE TABLE IF NOT EXISTS stage_tries (
  experiment_code TEXT NOT NULL,
  stage INTEGER NOT NULL,
  try INTEGER NOT NULL,
  data TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  PRIMARY KEY (experiment_code, stage, try)
)`,
  `CREATE TABLE IF NOT EXISTS agents (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  kind TEXT NOT NULL,
  access TEXT NOT NULL,
  token_hash TEXT UNIQUE,
  client_id TEXT,
  grant_id TEXT,
  created_at TEXT NOT NULL,
  revoked_at TEXT
)`,
  `CREATE TABLE IF NOT EXISTS events (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  at TEXT NOT NULL,
  actor TEXT NOT NULL,
  tool TEXT NOT NULL,
  target TEXT,
  args TEXT,
  before TEXT,
  after TEXT
)`,
  `CREATE INDEX IF NOT EXISTS events_target ON events (target)`,
  `CREATE TRIGGER IF NOT EXISTS events_no_update BEFORE UPDATE ON events
BEGIN SELECT RAISE(ABORT, 'events are append-only'); END`,
  `CREATE TRIGGER IF NOT EXISTS events_no_delete BEFORE DELETE ON events
BEGIN SELECT RAISE(ABORT, 'events are append-only'); END`,
  `INSERT OR IGNORE INTO meta (key, value) VALUES ('schemaVersion', '1')`,
  `INSERT OR IGNORE INTO meta (key, value) VALUES ('mode', '"building"')`,
  `INSERT OR IGNORE INTO meta (key, value) VALUES ('protocolVersion', '${JSON.stringify(P.version)}')`,
];

// Share cards, and the nudges the agent showed and how the person answered. Neither is part of the log's history.
const V2 = [
  `CREATE TABLE IF NOT EXISTS cards (
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
)`,
  `CREATE INDEX IF NOT EXISTS cards_event ON cards (event_id)`,
  `CREATE TABLE IF NOT EXISTS nudge_activity (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  nudge_id TEXT NOT NULL,
  kind TEXT NOT NULL,
  about TEXT,
  event TEXT NOT NULL,
  answer TEXT,
  at TEXT NOT NULL,
  actor TEXT
)`,
  `CREATE INDEX IF NOT EXISTS nudge_activity_at ON nudge_activity (at)`,
  `UPDATE meta SET value = '2' WHERE key = 'schemaVersion' AND CAST(value AS INTEGER) < 2`,
];

export const VERSIONS = { 1: V1, 2: V2 };
export const STATEMENTS = [...V1, ...V2];

export const migrationSql = (version = 1) => VERSIONS[version].join(";\n\n") + ";\n";
