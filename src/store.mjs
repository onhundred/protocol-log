// D1 access: load the whole log (it's small) and save a diff plus its event in one batch.
import { QUESTION_KINDS, isActive, protocol as P, upgradeLevels, versionChange } from "../lib/protocol.mjs";
import { SCHEMA_VERSION, STATEMENTS } from "./schema.mjs";

const DAY = 86400000;
const QUESTION_DEFAULTS = Object.fromEntries(QUESTION_KINDS.map((k) => [k, true]));
let schemaReady = false;

export async function ensureSchema(db) {
  if (schemaReady) return;
  try {
    const row = await db.prepare("SELECT value FROM meta WHERE key = 'schemaVersion'").first();
    if (row && Number(row.value) >= SCHEMA_VERSION) {
      schemaReady = true;
      return;
    }
  } catch {
    // No tables yet: a fresh install.
  }
  await db.batch(STATEMENTS.map((s) => db.prepare(s)));
  schemaReady = true;
}

const LOOP_COLUMNS = ["proposed", "pending", "retired"];

export async function loadState(db) {
  const [m, l, e, t] = await db.batch([
    db.prepare("SELECT key, value FROM meta"),
    db.prepare("SELECT code, data, proposed, pending, retired FROM loops ORDER BY code"),
    db.prepare("SELECT code, card FROM experiments ORDER BY code"),
    db.prepare("SELECT experiment_code, data FROM stage_tries ORDER BY experiment_code, stage, try"),
  ]);
  const meta = Object.fromEntries(m.results.map((r) => [r.key, JSON.parse(r.value)]));
  delete meta.schemaVersion;
  const loops = l.results.map((r) => ({
    ...JSON.parse(r.data),
    ...(r.proposed ? { proposed: true } : {}),
    ...(r.pending ? { pending: JSON.parse(r.pending) } : {}),
    ...(r.retired ? { retired: true } : {}),
  }));
  const tries = new Map();
  for (const r of t.results) {
    if (!tries.has(r.experiment_code)) tries.set(r.experiment_code, []);
    tries.get(r.experiment_code).push(JSON.parse(r.data));
  }
  const experiments = e.results.map((r) => ({ ...JSON.parse(r.card), stages: tries.get(r.code) || [] }));
  return upgradeLevels({ meta, loops, experiments });
}

// Settings the owner hasn't stored fall back to the Worker's vars, then to protocol defaults.
// loops: needed to apply a scheduled protocol upgrade once its cycle starts, and to pick the list size.
// A log that never chose a size starts at 10 (protocol 3.1). One holding more than 10 active loops was built
// as a list of 100 before sizes existed, so it stays at 100. A write never sees the size move: it's picked on load.
export function effectiveMeta(meta, env, today, loops = []) {
  const languages = String(env.LANGUAGES || "en")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
  const m = {
    mode: "building",
    listSize: loops.filter(isActive).length > 10 ? P.limits.loops : 10,
    protocolVersion: P.version,
    languages,
    ownerName: env.OWNER_NAME || "",
    stillMetric: false,
    publish: false,
    companyFigures: false,
    cycle: 0,
    day: 0,
    stage: "map",
    grid: { cols: { R: 4, P: 4, C: 4 }, seeds: { R: 7, P: 13, C: 29 } },
    challenge: "normal",
    cards: true,
    pausedUntil: null,
    checkIns: [],
    ...meta,
    questions: { ...QUESTION_DEFAULTS, ...(meta.questions || {}) },
  };
  if (m.cycleOneStart) {
    const days = Math.floor((Date.parse(today) - Date.parse(m.cycleOneStart)) / DAY);
    if (days >= 0) {
      const len = P.limits.cycleWeeks * 7;
      m.cycle = Math.floor(days / len) + 1;
      m.day = (days % len) + 1;
    }
  }
  const u = m.protocolUpgrade;
  if (u && m.cycle >= u.fromCycle) {
    const start = new Date(Date.parse(m.cycleOneStart) + (u.fromCycle - 1) * P.limits.cycleWeeks * 7 * DAY).toISOString();
    m.protocolChange = versionChange({ meta: m, loops }, u.version, { at: start, cycle: u.fromCycle });
    m.protocolVersion = u.version;
    delete m.protocolUpgrade;
  }
  return m;
}

// The meta keys effectiveMeta changed when a scheduled upgrade came due, as a diff the writer saves.
export function upgradeDiff(rawMeta, meta) {
  if (!rawMeta.protocolUpgrade || meta.protocolUpgrade) return null;
  const keys = ["protocolVersion", "protocolChange", "protocolUpgrade"];
  return {
    before: Object.fromEntries(keys.map((k) => [`meta:${k}`, rawMeta[k] ?? null])),
    after: Object.fromEntries(keys.map((k) => [`meta:${k}`, meta[k] ?? null])),
  };
}

export const isPublished = (meta, env) => env.PUBLISH === "true" || meta.publish === true;

export async function readState(env) {
  await ensureSchema(env.DB);
  const raw = await loadState(env.DB);
  return { ...raw, meta: effectiveMeta(raw.meta, env, new Date().toISOString().slice(0, 10), raw.loops) };
}

function loopRow(loop) {
  const data = { ...loop };
  for (const k of LOOP_COLUMNS) delete data[k];
  return [JSON.stringify(data), loop.proposed ? 1 : 0, loop.pending ? JSON.stringify(loop.pending) : null, loop.retired ? 1 : 0];
}

// diff: { before, after } keyed "loop:CODE", "exp:CODE", "meta:key" (null = absent).
export async function saveDiff(db, diff, event) {
  const now = event.at;
  const stmts = [];
  for (const [key, value] of Object.entries(diff.after)) {
    const i = key.indexOf(":");
    const kind = key.slice(0, i);
    const id = key.slice(i + 1);
    if (kind === "meta") {
      stmts.push(
        value === null
          ? db.prepare("DELETE FROM meta WHERE key = ?").bind(id)
          : db.prepare("INSERT INTO meta (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value").bind(id, JSON.stringify(value))
      );
    } else if (kind === "loop") {
      stmts.push(
        value === null
          ? db.prepare("DELETE FROM loops WHERE code = ?").bind(id)
          : db
              .prepare(
                `INSERT INTO loops (code, data, proposed, pending, retired, updated_at) VALUES (?, ?, ?, ?, ?, ?)
                 ON CONFLICT(code) DO UPDATE SET data = excluded.data, proposed = excluded.proposed,
                 pending = excluded.pending, retired = excluded.retired, updated_at = excluded.updated_at`
              )
              .bind(id, ...loopRow(value), now)
      );
    } else if (kind === "exp") {
      if (value === null) {
        stmts.push(db.prepare("DELETE FROM stage_tries WHERE experiment_code = ?").bind(id));
        stmts.push(db.prepare("DELETE FROM experiments WHERE code = ?").bind(id));
        continue;
      }
      const { stages = [], ...card } = value;
      stmts.push(
        db
          .prepare("INSERT INTO experiments (code, card, updated_at) VALUES (?, ?, ?) ON CONFLICT(code) DO UPDATE SET card = excluded.card, updated_at = excluded.updated_at")
          .bind(id, JSON.stringify(card), now)
      );
      for (const t of stages)
        stmts.push(
          db
            .prepare(
              `INSERT INTO stage_tries (experiment_code, stage, try, data, updated_at) VALUES (?, ?, ?, ?, ?)
               ON CONFLICT(experiment_code, stage, try) DO UPDATE SET data = excluded.data, updated_at = excluded.updated_at`
            )
            .bind(id, t.stage, t.try, JSON.stringify(t), now)
        );
      stmts.push(
        db
          .prepare("DELETE FROM stage_tries WHERE experiment_code = ? AND (stage * 1000 + try) NOT IN (SELECT value FROM json_each(?))")
          .bind(id, JSON.stringify(stages.map((t) => t.stage * 1000 + t.try)))
      );
    }
  }
  stmts.push(
    db
      .prepare("INSERT INTO events (at, actor, tool, target, args, before, after) VALUES (?, ?, ?, ?, ?, ?, ?)")
      .bind(event.at, event.actor, event.tool, event.target ?? null, event.args ?? null, JSON.stringify(diff.before), JSON.stringify(diff.after))
  );
  const results = await db.batch(stmts);
  return results.at(-1).meta?.last_row_id ?? null;
}

export async function logEvent(db, event) {
  await db
    .prepare("INSERT INTO events (at, actor, tool, target, args, before, after) VALUES (?, ?, ?, ?, ?, NULL, NULL)")
    .bind(event.at, event.actor, event.tool, event.target ?? null, event.args ?? null)
    .run();
}

export async function getEvents(db, { limit = 20, target, id } = {}) {
  if (id != null) {
    const r = await db.prepare("SELECT * FROM events WHERE id = ?").bind(Number(id)).first();
    if (!r) return null;
    return { ...r, args: r.args && JSON.parse(r.args), before: r.before && JSON.parse(r.before), after: r.after && JSON.parse(r.after) };
  }
  const n = Math.min(Math.max(Number(limit) || 20, 1), 200);
  const q = target
    ? db.prepare("SELECT id, at, actor, tool, target FROM events WHERE target LIKE ? ORDER BY id DESC LIMIT ?").bind(`%${target}%`, n)
    : db.prepare("SELECT id, at, actor, tool, target FROM events ORDER BY id DESC LIMIT ?").bind(n);
  return (await q.all()).results;
}

// Rows for publicActivity: the allowed tools, undo events with the id they undid, and the one arg a label needs.
// Args can be cut at 8000 characters, so they're read only when they're valid JSON.
export async function getPublicEvents(db, tools, { limit = 500 } = {}) {
  const list = [...tools, "undo_event"];
  const sql = `SELECT id, at, actor, tool, target,
    CASE WHEN json_valid(args) THEN
      CASE REPLACE(tool, 'override:', '')
        WHEN 'undo_event' THEN json_extract(args, '$.id')
      END
    END AS undid,
    CASE WHEN json_valid(args) THEN
      CASE REPLACE(tool, 'override:', '')
        WHEN 'close_stage_try' THEN json_extract(args, '$.outcome')
        WHEN 'record_hold' THEN json_extract(args, '$.result')
        WHEN 'conclude_experiment' THEN json_extract(args, '$.hypothesis')
      END
    END AS result
    FROM events WHERE REPLACE(tool, 'override:', '') IN (${list.map(() => "?").join(", ")}) ORDER BY id DESC LIMIT ?`;
  return (await db.prepare(sql).bind(...list, Math.min(Math.max(Number(limit) || 500, 1), 1000)).all()).results;
}

export async function snapshot(env) {
  const state = await readState(env);
  const [events, cards, nudges] = await env.DB.batch([
    env.DB.prepare("SELECT * FROM events ORDER BY id"),
    env.DB.prepare("SELECT * FROM cards ORDER BY created_at"),
    env.DB.prepare("SELECT * FROM nudge_activity ORDER BY id"),
  ]);
  return {
    exportedAt: new Date().toISOString(),
    protocolVersion: state.meta.protocolVersion,
    meta: state.meta,
    loops: state.loops,
    experiments: state.experiments,
    events: events.results.map((e) => ({ ...e, args: e.args && JSON.parse(e.args), before: e.before && JSON.parse(e.before), after: e.after && JSON.parse(e.after) })),
    cards: cards.results.map(cardRow),
    nudgeActivity: nudges.results,
  };
}

// ---------------------------------------------------------------------------
// Share cards and nudge activity: written straight to D1, outside the log's history, so undo never touches them.

const BASE62 = "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz";
const CARD_JSON = new Set(["facts", "waiting", "images", "remakes"]);

export function cardId() {
  return [...crypto.getRandomValues(new Uint8Array(8))].map((b) => BASE62[b % 62]).join("");
}

const parse = (v, fallback) => (v == null ? fallback : JSON.parse(v));
function cardRow(r) {
  if (!r) return null;
  return { ...r, facts: parse(r.facts, {}), waiting: parse(r.waiting, null), images: parse(r.images, {}), remakes: parse(r.remakes, null) };
}

export async function saveCard(db, card) {
  const cols = ["id", "kind", "moment", "page", "target", "facts", "headline", "event_id", "waiting", "created_at", "ready_at", "images"];
  const value = (k) => (CARD_JSON.has(k) ? (card[k] == null ? null : JSON.stringify(card[k])) : (card[k] ?? null));
  await db
    .prepare(`INSERT INTO cards (${cols.join(", ")}) VALUES (${cols.map(() => "?").join(", ")})`)
    .bind(...cols.map(value))
    .run();
}

export async function updateCard(db, id, fields) {
  const keys = Object.keys(fields);
  if (!keys.length) return;
  const value = (k) => (CARD_JSON.has(k) && fields[k] != null ? JSON.stringify(fields[k]) : fields[k]);
  await db
    .prepare(`UPDATE cards SET ${keys.map((k) => `${k} = ?`).join(", ")} WHERE id = ?`)
    .bind(...keys.map(value), id)
    .run();
}

export async function getCard(db, id) {
  if (!/^[0-9A-Za-z]{8}$/.test(String(id || ""))) return null;
  return cardRow(await db.prepare("SELECT * FROM cards WHERE id = ?").bind(id).first());
}

export async function listCards(db, { limit = 50, eventId, waiting = false, queued = false } = {}) {
  const where = [];
  const binds = [];
  if (eventId != null) {
    where.push("event_id = ?");
    binds.push(Number(eventId));
  }
  if (waiting) where.push("waiting IS NOT NULL AND revoked_at IS NULL");
  if (queued) where.push("revoked_at IS NULL AND images LIKE '%queued%'");
  const sql = `SELECT * FROM cards${where.length ? ` WHERE ${where.join(" AND ")}` : ""} ORDER BY created_at DESC LIMIT ?`;
  return (await db.prepare(sql).bind(...binds, Math.min(Math.max(Number(limit) || 50, 1), 200)).all()).results.map(cardRow);
}

export async function countCardView(db, id) {
  await db.prepare("UPDATE cards SET views = views + 1 WHERE id = ?").bind(id).run();
}

export async function nudgeActivity(db, since) {
  return (await db.prepare("SELECT nudge_id, kind, about, event, answer, at FROM nudge_activity WHERE at >= ? ORDER BY id").bind(since).all()).results;
}

// Hands out a nudge only if no other call showed one within the cooldown, in 1 statement, so 2 calls at once get 1.
export async function recordShown(db, nudge, { at, actor, coolSince }) {
  const r = await db
    .prepare(
      `INSERT INTO nudge_activity (nudge_id, kind, about, event, at, actor)
       SELECT ?, ?, ?, 'shown', ?, ? WHERE NOT EXISTS (SELECT 1 FROM nudge_activity WHERE event = 'shown' AND at > ?)`
    )
    .bind(nudge.id, nudge.kind, nudge.about ?? null, at, actor ?? null, coolSince)
    .run();
  return r.meta.changes > 0;
}

export async function noticeGiven(db, kind) {
  return Boolean(await db.prepare("SELECT 1 AS one FROM nudge_activity WHERE event = 'noticed' AND kind = ? LIMIT 1").bind(kind).first());
}

export async function lastShown(db, nudgeId) {
  return db.prepare("SELECT nudge_id, kind, about, at FROM nudge_activity WHERE event = 'shown' AND nudge_id = ? ORDER BY id DESC LIMIT 1").bind(nudgeId).first();
}

export async function recordNudge(db, { nudge_id, kind, about = null, event, answer = null, at, actor = null }) {
  await db
    .prepare("INSERT INTO nudge_activity (nudge_id, kind, about, event, answer, at, actor) VALUES (?, ?, ?, ?, ?, ?, ?)")
    .bind(nudge_id, kind, about, event, answer, at, actor)
    .run();
}
