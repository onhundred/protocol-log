// Owner sign-in (password + signed cookie), API keys for API agents, and connection records.
const enc = new TextEncoder();
export const COOKIE = "__Host-onhundred";
const SESSION_DAYS = 30;
const MAX_FAILS = 10;
const FAIL_WINDOW_S = 900;
export const KEY_PREFIX = "ohk_";

const b64url = (buf) => btoa(String.fromCharCode(...new Uint8Array(buf))).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");

export async function sha256(text) {
  const digest = await crypto.subtle.digest("SHA-256", enc.encode(text));
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

export function randomToken(bytes = 32) {
  return b64url(crypto.getRandomValues(new Uint8Array(bytes)));
}

async function hmac(secret, data) {
  const key = await crypto.subtle.importKey("raw", enc.encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  return b64url(await crypto.subtle.sign("HMAC", key, enc.encode(data)));
}

async function safeEqual(a, b) {
  const [x, y] = await Promise.all([sha256(a), sha256(b)]);
  return crypto.subtle.timingSafeEqual(enc.encode(x), enc.encode(y));
}

export function configured(env) {
  return Boolean(env.OWNER_PASSWORD && env.COOKIE_ENCRYPTION_KEY && env.COOKIE_ENCRYPTION_KEY.length >= 32);
}

export async function checkPassword(env, password) {
  return configured(env) && typeof password === "string" && (await safeEqual(password, env.OWNER_PASSWORD));
}

// Failed sign-ins per IP, kept in KV for 15 minutes.
export async function loginLocked(env, ip) {
  const n = Number(await env.OAUTH_KV.get(`login-fail:${ip}`)) || 0;
  return n >= MAX_FAILS;
}

export async function recordFailure(env, ip) {
  const key = `login-fail:${ip}`;
  const n = (Number(await env.OAUTH_KV.get(key)) || 0) + 1;
  await env.OAUTH_KV.put(key, String(n), { expirationTtl: FAIL_WINDOW_S });
}

export async function sessionCookie(env) {
  const exp = Date.now() + SESSION_DAYS * 86400000;
  const payload = `owner.${exp}`;
  const sig = await hmac(env.COOKIE_ENCRYPTION_KEY, payload);
  return `${COOKIE}=${payload}.${sig}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=${SESSION_DAYS * 86400}`;
}

export const clearCookie = () => `${COOKIE}=; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=0`;

// View passes: links an owner connection hands out. They show the owner view, never change anything,
// and stop working after VIEW_HOURS or as soon as the connection that made them is removed.
export const VIEW_COOKIE = "__Host-onhundred-view";
export const VIEW_HOURS = 24;

export async function viewPass(env, agentId, now = Date.now()) {
  const exp = now + VIEW_HOURS * 3600000;
  const payload = `view.${agentId}.${exp}`;
  return { pass: `${payload}.${await hmac(env.COOKIE_ENCRYPTION_KEY, payload)}`, exp };
}

export async function checkViewPass(env, pass) {
  if (!configured(env) || typeof pass !== "string") return null;
  const [kind, agentId, exp, sig, ...rest] = pass.split(".");
  if (kind !== "view" || !agentId || !sig || rest.length || !(Number(exp) > Date.now())) return null;
  if (!(await safeEqual(sig, await hmac(env.COOKIE_ENCRYPTION_KEY, `${kind}.${agentId}.${exp}`)))) return null;
  const row = await env.DB.prepare("SELECT 1 AS one FROM agents WHERE id = ? AND access = 'owner' AND revoked_at IS NULL").bind(agentId).first();
  return row ? { agentId, exp: Number(exp) } : null;
}

export const viewCookie = (pass, exp) =>
  `${VIEW_COOKIE}=${pass}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=${Math.max(0, Math.floor((exp - Date.now()) / 1000))}`;

export async function viewerFrom(request, env) {
  const cookie = request.headers.get("Cookie") || "";
  const m = cookie.split(/;\s*/).find((c) => c.startsWith(VIEW_COOKIE + "="));
  return m ? checkViewPass(env, m.slice(VIEW_COOKIE.length + 1)) : null;
}

// Render tokens: let the screenshot browser open a card's render page for 10 minutes. Nobody else can.
const RENDER_MS = 10 * 60000;

export async function renderToken(env, cardId, now = Date.now()) {
  const payload = `render.${cardId}.${now + RENDER_MS}`;
  return `${payload}.${await hmac(env.COOKIE_ENCRYPTION_KEY || "", payload)}`;
}

export async function checkRenderToken(env, cardId, token) {
  if (!configured(env) || typeof token !== "string") return false;
  const [kind, id, exp, sig, ...rest] = token.split(".");
  if (kind !== "render" || id !== cardId || !sig || rest.length || !(Number(exp) > Date.now())) return false;
  return safeEqual(sig, await hmac(env.COOKIE_ENCRYPTION_KEY, `${kind}.${id}.${exp}`));
}

export async function isOwner(request, env) {
  if (!configured(env)) return false;
  const cookie = request.headers.get("Cookie") || "";
  const m = cookie.split(/;\s*/).find((c) => c.startsWith(COOKIE + "="));
  if (!m) return false;
  const [who, exp, sig] = m.slice(COOKIE.length + 1).split(".");
  if (who !== "owner" || !(Number(exp) > Date.now()) || !sig) return false;
  return safeEqual(sig, await hmac(env.COOKIE_ENCRYPTION_KEY, `${who}.${exp}`));
}

// POSTs from the owner's pages must come from this origin (SameSite=Lax already blocks most).
export function sameOrigin(request, origin) {
  const o = request.headers.get("Origin");
  return !o || o === origin;
}

// ---------------------------------------------------------------------------
// Connections: every OAuth client and API key is a named agent.

export const slug = (name) =>
  String(name || "agent")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 40) || "agent";

export async function createApiKey(db, { name, access = "owner" }) {
  if (!["owner", "agent"].includes(access)) throw new Error("access is owner or agent.");
  const key = KEY_PREFIX + randomToken(32);
  const id = "key-" + randomToken(6);
  await db
    .prepare("INSERT INTO agents (id, name, kind, access, token_hash, created_at) VALUES (?, ?, 'key', ?, ?, ?)")
    .bind(id, slug(name), access, await sha256(key), new Date().toISOString())
    .run();
  return { id, name: slug(name), access, key };
}

export async function resolveApiKey(db, token) {
  if (!token?.startsWith(KEY_PREFIX)) return null;
  const row = await db
    .prepare("SELECT id, name, access FROM agents WHERE token_hash = ? AND kind = 'key' AND revoked_at IS NULL")
    .bind(await sha256(token))
    .first();
  return row ? { agentId: row.id, name: row.name, access: row.access } : null;
}

export async function recordOAuthAgent(db, { clientId, clientName }) {
  const id = "oauth-" + (await sha256(clientId)).slice(0, 16);
  const name = slug(clientName || clientId);
  await db
    .prepare(
      `INSERT INTO agents (id, name, kind, access, client_id, created_at) VALUES (?, ?, 'oauth', 'owner', ?, ?)
       ON CONFLICT(id) DO UPDATE SET name = excluded.name, revoked_at = NULL`
    )
    .bind(id, name, clientId, new Date().toISOString())
    .run();
  return { agentId: id, name, access: "owner" };
}

export async function listAgents(db) {
  return (await db.prepare("SELECT id, name, kind, access, client_id, created_at, revoked_at FROM agents ORDER BY created_at DESC").all()).results;
}

export async function revokeAgent(db, id) {
  const r = await db.prepare("UPDATE agents SET revoked_at = ? WHERE id = ? AND revoked_at IS NULL").bind(new Date().toISOString(), id).run();
  return r.meta.changes > 0;
}

export async function hasConnections(db) {
  return Boolean(await db.prepare("SELECT 1 AS one FROM agents WHERE revoked_at IS NULL LIMIT 1").first());
}
