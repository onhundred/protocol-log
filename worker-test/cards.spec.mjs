import { env, exports } from "cloudflare:workers";
import { beforeAll, describe, expect, it } from "vitest";
import { createApiKey, renderToken } from "../src/auth.mjs";
import { shootOne } from "../src/cards.mjs";
import { ensureSchema, getCard } from "../src/store.mjs";

beforeAll(() => ensureSchema(env.DB));

const BASE = "https://log.example.com";
const app = () => exports.default;
const DAY = 86400000;
const dayAgo = (n) => new Date(Date.now() - n * DAY).toISOString().slice(0, 10);
const PNG = new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10]);
const fakeShot = async () => PNG;
const brokenShot = async () => {
  throw new Error("Browser Rendering ran out of time");
};

async function mcp(key, method, params = {}, id = 1) {
  const res = await app().fetch(
    new Request(`${BASE}/mcp`, {
      method: "POST",
      headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json", Accept: "application/json, text/event-stream" },
      body: JSON.stringify({ jsonrpc: "2.0", id, method, params }),
    })
  );
  return { status: res.status, body: res.status === 200 ? await res.json() : await res.text() };
}

const call = async (key, name, args = {}) => {
  const r = await mcp(key, "tools/call", { name, arguments: args });
  const result = r.body.result;
  return { error: result.isError ? result.content[0].text : null, data: result.isError ? null : JSON.parse(result.content[0].text) };
};

async function ownerCookie() {
  const res = await app().fetch(
    new Request(`${BASE}/login`, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded", Origin: BASE },
      body: "password=test-owner-password&next=%2F",
      redirect: "manual",
    })
  );
  return res.headers.get("Set-Cookie").split(";")[0];
}

const get = (path, { cookie, ua } = {}) =>
  app().fetch(new Request(`${BASE}${path}`, { headers: { ...(cookie ? { Cookie: cookie } : {}), ...(ua ? { "User-Agent": ua } : {}) }, redirect: "manual" }));
const ownerPost = async (cookie, fields, headers = {}) =>
  app().fetch(
    new Request(`${BASE}/owner/action`, {
      method: "POST",
      headers: { Cookie: cookie, Origin: BASE, "Content-Type": "application/x-www-form-urlencoded", ...headers },
      body: new URLSearchParams(fields),
      redirect: "manual",
    })
  );
const shootAll = async (take = fakeShot) => {
  for (let i = 0; i < 20 && (await shootOne(env, BASE, take)); i++);
};
const meta = (k, v) => env.DB.prepare("INSERT INTO meta (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value").bind(k, JSON.stringify(v)).run();

const both = (en, es) => ({ en, es });
const loopSpec = (area, en, es) => ({
  area,
  name: both(en, es),
  doneWhen: both("The payment shows in the bank", "El pago aparece en el banco"),
  evidence: "Email: the monthly bill",
  triage: { time: 3, frequency: 4, rules: 4, digital: 4, risk: 1 },
  estimate: { howOften: "monthly", hoursPerWeek: 0.5 },
});
const bet = (slot, loops, extra = {}) => ({
  slot,
  question: both("Can an agent pay this bill on time?", "¿Puede un agente pagar esta factura a tiempo?"),
  hypothesis: both("If it has the login, then it pays on time, because the amount never changes.", "Si tiene el acceso, entonces paga a tiempo, porque el monto nunca cambia."),
  odds: 60,
  loops,
  goal: "assisted",
  peopleInvolved: "Nobody else. Private note.",
  ...extra,
});

describe("tools after this change", () => {
  it("lists 42 tools for an owner, with the merged ones and without the old connection tools", async () => {
    const owner = (await createApiKey(env.DB, { name: "claude", access: "owner" })).key;
    const init = await mcp(owner, "initialize", { protocolVersion: "2025-06-18", capabilities: {}, clientInfo: { name: "t", version: "1" } });
    expect(init.body.result.serverInfo.version).toBe("1.2.0");
    const tools = (await mcp(owner, "tools/list")).body.result.tools;
    const names = tools.map((t) => t.name);
    expect(names).toHaveLength(42);
    for (const n of ["manage_card", "manage_connections", "respond_nudge", "get_check_in", "get_video_brief", "grow_list", "add_translations"]) expect(names).toContain(n);
    for (const n of ["list_connections", "create_api_key", "revoke_api_key", "get_nudges"]) expect(names).not.toContain(n);
    expect(tools.find((t) => t.name === "manage_card").annotations.destructiveHint).toBe(true);
    expect(tools.find((t) => t.name === "manage_connections").annotations.destructiveHint).toBe(true);

    const resources = (await mcp(owner, "resources/list")).body.result.resources.map((r) => r.uri);
    expect(resources).toContain("onhundred://docs/playbook");
    const playbook = (await mcp(owner, "resources/read", { uri: "onhundred://docs/playbook" })).body.result.contents[0].text;
    expect(playbook).toContain("Want a square or story version to post?");
    const prompts = (await mcp(owner, "prompts/list")).body.result.prompts.map((p) => p.name);
    expect(prompts).toContain("plan_video");
    const review = (await mcp(owner, "prompts/get", { name: "cycle_review" })).body.result.messages[0].content.text;
    expect(review).toMatch(/^Run my check-in\. Call get_check_in first/);
    expect(init.body.result.instructions).toContain("Challenge or ask only with the nudge from get_state");
    expect(init.body.result.instructions).toContain("links.card");
  });

  it("manage_connections lists, creates and revokes, owner only", async () => {
    const owner = (await createApiKey(env.DB, { name: "claude", access: "owner" })).key;
    const made = await call(owner, "manage_connections", { action: "create", name: "grok-bot" });
    expect(made.data).toMatchObject({ name: "grok-bot", access: "agent" });
    expect((await mcp(made.data.key, "ping")).status).toBe(200);
    expect((await call(owner, "manage_connections", { action: "list" })).data.connections.some((c) => c.id === made.data.id)).toBe(true);
    expect((await call(made.data.key, "manage_connections", { action: "list" })).error).toMatch(/Only the owner/);
    expect((await call(owner, "manage_connections", { action: "revoke", id: made.data.id })).data).toEqual({ revoked: made.data.id });
    expect((await mcp(made.data.key, "ping")).status).toBe(401);
  });

  it("register_experiment without odds fails with the plain error", async () => {
    const owner = (await createApiKey(env.DB, { name: "claude", access: "owner" })).key;
    const { odds, ...noOdds } = bet("easy", ["P-FIN-99"]);
    expect(odds).toBe(60);
    expect((await call(owner, "register_experiment", noOdds)).error).toMatch(/odds is required: ask the person what chance, from 20 to 80, they give the bet/);
  });
});

describe("nudges through get_state", () => {
  const clear = () => env.DB.prepare("DELETE FROM nudge_activity").run();

  it("hands an owner 1 nudge with its notice once, then waits; limited keys get none", async () => {
    await clear();
    const owner = (await createApiKey(env.DB, { name: "claude", access: "owner" })).key;
    const agent = (await createApiKey(env.DB, { name: "grok-bot", access: "agent" })).key;
    expect((await call(agent, "get_state")).data.nudge).toBeUndefined();

    const first = (await call(owner, "get_state")).data;
    expect(first.nudge.type).toBe("question");
    expect(first.nudge.kind).toBe("gaps");
    expect(first.nudge.outs.map((o) => o.answer)).toEqual(["took", "not_now", "pause", "stop"]);
    expect(first.questionNotice).toBe("If you'd rather I don't ask about the empty parts of your list, just say so.");
    expect(first).toMatchObject({ checkInDue: false, pausedUntil: null });
    expect(Array.isArray(first.cardsReady)).toBe(true);

    const again = (await call(owner, "get_state")).data;
    expect(again.nudge).toBeUndefined();
    expect(again.questionNotice).toBeUndefined();

    expect((await call(agent, "respond_nudge", { id: first.nudge.id, answer: "took" })).error).toMatch(/Only the owner/);
    expect((await call(owner, "respond_nudge", { id: "gaps:nowhere", answer: "took" })).error).toMatch(/no nudge with this id was shown/);
    expect((await call(owner, "respond_nudge", { id: first.nudge.id, answer: "not_now" })).data).toEqual({ answered: "not_now" });

    const history = (await call(owner, "get_events", { limit: 50 })).data.map((e) => e.tool);
    expect(history).not.toContain("respond_nudge");
    const exported = await (await get("/export", { cookie: await ownerCookie() })).json();
    expect(exported.nudgeActivity.map((r) => r.event)).toEqual(expect.arrayContaining(["shown", "noticed", "answered"]));
  });

  it("two get_state calls at the same moment hand out only 1 nudge", async () => {
    await clear();
    const owner = (await createApiKey(env.DB, { name: "claude", access: "owner" })).key;
    const [a, b] = await Promise.all([call(owner, "get_state"), call(owner, "get_state")]);
    expect([a.data.nudge, b.data.nudge].filter(Boolean)).toHaveLength(1);
    const shown = await env.DB.prepare("SELECT COUNT(*) AS n FROM nudge_activity WHERE event = 'shown'").first();
    expect(shown.n).toBe(1);
  });

  it("stop turns off that kind of question; pause sets pausedUntil and hides every nudge", async () => {
    await clear();
    const owner = (await createApiKey(env.DB, { name: "claude", access: "owner" })).key;
    const { nudge } = (await call(owner, "get_state")).data;
    const stopped = await call(owner, "respond_nudge", { id: nudge.id, answer: "stop" });
    expect(stopped.data.questions).toEqual({ [nudge.kind]: false });
    expect((await call(owner, "get_state")).data.settings.questions[nudge.kind]).toBe(false);

    await clear();
    const next = (await call(owner, "get_state")).data.nudge;
    expect(next.kind).not.toBe(nudge.kind);
    expect((await call(owner, "respond_nudge", { id: next.id, answer: "pause" })).error).toMatch(/weeks is 2 or 4/);
    const paused = await call(owner, "respond_nudge", { id: next.id, answer: "pause", weeks: 2 });
    expect(paused.data.pausedUntil).toBe(new Date(Date.now() + 14 * DAY).toISOString().slice(0, 10));

    await clear();
    const state = (await call(owner, "get_state")).data;
    expect(state.nudge).toBeUndefined();
    expect(state.pausedUntil).toBe(paused.data.pausedUntil);
    const init = await mcp(owner, "initialize", { protocolVersion: "2025-06-18", capabilities: {}, clientInfo: { name: "t", version: "1" } });
    expect(init.body.result.instructions).not.toContain("Challenge or ask only with the nudge");

    expect((await call(owner, "set_meta", { pausedUntil: null, questions: { [nudge.kind]: true } })).error).toBeNull();
  });
});

describe("share cards", () => {
  let owner;
  let agent;
  let code;
  let card;
  let holdEvent;

  it("a proving that passes makes 1 card for the biggest moment, with 1 link per language", async () => {
    owner = (await createApiKey(env.DB, { name: "claude", access: "owner" })).key;
    agent = (await createApiKey(env.DB, { name: "grok-bot", access: "agent" })).key;
    expect((await call(owner, "set_meta", { languages: ["en", "es"], publish: true })).error).toBeNull();
    code = (await call(owner, "propose_loops", { loops: [loopSpec("P-FIN", "Pay the water bill", "Pagar la factura del agua")] })).data.result.proposed[0];
    expect((await call(owner, "approve_loops", { codes: [code] })).error).toBeNull();
    expect((await call(owner, "register_experiment", bet("easy", [code]))).error).toBeNull();
    expect((await call(owner, "approve_text", { all: true })).error).toBeNull();
    const started = await call(owner, "register_stage_try", { experiment: "EXP-01", start: dayAgo(40), deadline: dayAgo(27), approach: "Pay it from the bank app", successTests: "Paid 2 of 2 on time" });
    expect(started.error).toBeNull();
    expect(started.data.moment).toMatchObject({ moment: "betPlaced", kind: "challenge" });
    expect(started.data.moment.card.urls.en).toBe(`${BASE}/exp/EXP-01?c=${started.data.moment.card.id}&lang=en`);
    const closed = await call(owner, "close_stage_try", { experiment: "EXP-01", outcome: "achieved", closedAt: dayAgo(27) });
    expect(closed.data.moment).toBeUndefined();

    const held = await call(owner, "record_hold", { experiment: "EXP-01", result: "passed" });
    expect(held.error).toBeNull();
    holdEvent = held.data.event;
    const m = held.data.moment;
    expect(m).toMatchObject({ kind: "congratulate", moment: "firstGreen" });
    expect(m.also.map((x) => x.moment)).toEqual(["itHeld"]);
    expect(m.facts.loop.code).toBe(code);
    expect(JSON.stringify(m)).not.toContain("Private note");
    expect(m.card.status).toBe("ready");
    expect(m.card.postImages).toBe("available");
    expect(m.card.urls).toEqual({ en: `${BASE}/loop/${code}?c=${m.card.id}&lang=en`, es: `${BASE}/loop/${code}?c=${m.card.id}&lang=es` });
    expect(held.data.links.card).toBe(m.card.urls.en);
    card = m.card;

    const row = await getCard(env.DB, card.id);
    expect(row.images).toEqual({ en: { og: "queued" }, es: { og: "queued" } });
    const events = (await call(owner, "get_events", { limit: 5 })).data.map((e) => e.tool);
    expect(events).toContain("card_created");
  });

  it("?c= swaps the preview and shows the banner; views count visitors, not the owner or preview bots", async () => {
    const page = await (await get(`/loop/${code}?c=${card.id}&lang=es`)).text();
    expect(page).toContain(`<meta property="og:image" content="${BASE}/c/${card.id}/og.png?lang=es">`);
    expect(page).toMatch(/<meta property="og:title" content="[^"]+">/);
    expect(page).toContain('class="share-banner"');
    expect(page).toContain('<html lang="es"');
    expect(page).toContain("EMPIEZA TUS 10");
    expect(page).not.toContain("GET IMAGES TO POST");
    await get(`/loop/${code}?c=${card.id}`, { ua: "Slackbot-LinkExpanding 1.0" });
    const cookie = await ownerCookie();
    const mine = await (await get(`/loop/${code}?c=${card.id}`, { cookie })).text();
    expect(mine).toContain("GET IMAGES TO POST (SQUARE AND STORY)");
    expect(mine).toContain(`data-card-copied="${card.id}"`);
    expect((await getCard(env.DB, card.id)).views).toBe(1);

    const wrongPage = await (await get(`/?c=${card.id}`)).text();
    expect(wrongPage).not.toContain("share-banner");
    expect(wrongPage).toContain(`<meta property="og:image" content="${BASE}/og.png">`);
    const unknown = await (await get(`/loop/${code}?c=ZZZZZZZZ`)).text();
    expect(unknown).not.toContain("share-banner");
  });

  it("images fall back to /og.png until the queue draws them; a failed screenshot stays queued", async () => {
    const before = await get(`/c/${card.id}/og.png?lang=en`);
    expect(before.status).toBe(302);
    expect(before.headers.get("Location")).toBe("/og.png");

    expect(await shootOne(env, BASE, brokenShot)).toBe(false);
    expect((await getCard(env.DB, card.id)).images.en.og).toBe("queued");

    await shootAll();
    expect((await getCard(env.DB, card.id)).images).toEqual({ en: { og: "ready" }, es: { og: "ready" } });
    const after = await get(`/c/${card.id}/og.png?lang=es`);
    expect(after.status).toBe(200);
    expect(after.headers.get("Content-Type")).toBe("image/png");
  });

  it("the render page only answers with a valid token", async () => {
    expect((await get(`/c/${card.id}/render?size=og`)).status).toBe(403);
    expect((await get(`/c/${card.id}/render?size=og&t=render.${card.id}.9999999999999.bad`)).status).toBe(403);
    const t = encodeURIComponent(await renderToken(env, card.id));
    const ok = await get(`/c/${card.id}/render?size=tall&lang=es&t=${t}`);
    expect(ok.status).toBe(200);
    const page = await ok.text();
    expect(page).toContain("width: 1080px; height: 1920px");
    expect(page).toContain("Pagar la factura del agua");
    expect(page).toContain('class="card t-dark s-tall m-firstGreen"');
    expect(page).toContain("PRIMER CUADRO VERDE");
    expect(page).toMatch(/<h1 style="--fit:[\d.]+">[^<]*<em>/);
    expect(page).toContain('url("/fonts/inter-tight.woff2")');
  });

  it("post_images queues square and tall; postImages goes from available to queued to ready", async () => {
    expect((await call(agent, "manage_card", { action: "post_images", id: card.id })).error).toMatch(/only the owner/);
    const listed = (await call(agent, "manage_card", { action: "list" })).data.cards.find((c) => c.id === card.id);
    expect(listed.postImages).toBe("available");

    const cookie = await ownerCookie();
    const res = await ownerPost(cookie, { op: "card_images", id: card.id, next: `/loop/${code}?c=${card.id}` });
    expect(res.status).toBe(303);
    expect(res.headers.get("Location")).toContain(`/loop/${code}?c=${card.id}&`);
    expect((await getCard(env.DB, card.id)).images.en).toEqual({ og: "ready", square: "queued", tall: "queued" });
    expect((await call(owner, "manage_card", { action: "list" })).data.cards.find((c) => c.id === card.id).postImages).toBe("queued");

    await shootAll();
    const ready = (await call(owner, "get_state")).data.cardsReady.find((c) => c.id === card.id);
    expect(ready.postImages).toBe("ready");
    expect(ready.images.es.tall).toBe(`${BASE}/c/${card.id}/tall.png?lang=es`);
    const page = await (await get(`/loop/${code}?c=${card.id}`, { cookie })).text();
    expect(page).toContain(`href="/c/${card.id}/square.png?lang=en" download>SQUARE`);
    expect(page).not.toContain("GET IMAGES TO POST");
  });

  it("the owner's log page shows Your card is ready until a link is copied", async () => {
    const cookie = await ownerCookie();
    const page = await (await get("/", { cookie })).text();
    expect(page).toContain("YOUR CARD IS READY");
    expect(page).toContain(`data-card-copied="${card.id}"`);
    const copied = await ownerPost(cookie, { op: "card_copied", id: card.id }, { Accept: "application/json" });
    expect(await copied.json()).toEqual({ ok: true });
    expect((await call(owner, "get_state")).data.cardsReady.some((c) => c.id === card.id)).toBe(false);
    expect(await (await get("/", { cookie })).text()).not.toContain(`data-card-copied="${card.id}"`);
  });

  it("remake keeps the link, refuses an unknown headline and a 4th remake in a day", async () => {
    expect((await call(agent, "manage_card", { action: "remake", id: card.id, headline: 1 })).error).toMatch(/only the owner/);
    const choices = (await call(owner, "manage_card", { action: "remake", id: card.id })).data.choices;
    expect(choices.length).toBeGreaterThanOrEqual(2);
    expect(Object.keys(choices[0].text)).toEqual(["en", "es"]);
    expect((await call(owner, "manage_card", { action: "remake", id: card.id, headline: 99 })).error).toMatch(/headline is 0, 1/);
    for (const h of [1, 0, 1]) {
      const r = await call(owner, "manage_card", { action: "remake", id: card.id, headline: h });
      expect(r.error).toBeNull();
      expect(r.data.card.url).toBe(card.url);
    }
    expect((await getCard(env.DB, card.id)).images.en).toEqual({ og: "queued", square: "queued", tall: "queued" });
    expect((await call(owner, "manage_card", { action: "remake", id: card.id, headline: 0 })).error).toMatch(/remade 3 times today/);
  });

  it("a video brief has the facts, the limits and the card links, never a script", async () => {
    const brief = (await call(owner, "get_video_brief", { card: card.id })).data;
    expect(brief.offLimits).toEqual(expect.arrayContaining(["children's lives", "a partner who hasn't agreed to publish"]));
    expect(brief.numbers.every((n) => ["log", "measured", "estimated"].includes(n.source))).toBe(true);
    expect(brief.links.en).toBe(card.urls.en);
    expect(brief.postImages).toContain("post_images");
    expect(brief).not.toHaveProperty("script");
  });

  it("a private log sends ?c= visitors to /c/:id, which counts views and keeps working", async () => {
    expect((await call(owner, "set_meta", { publish: false })).error).toBeNull();
    const res = await get(`/loop/${code}?c=${card.id}&lang=es`);
    expect(res.status).toBe(303);
    expect(res.headers.get("Location")).toBe(`/c/${card.id}?lang=es`);
    const views = (await getCard(env.DB, card.id)).views;
    const standalone = await get(`/c/${card.id}`);
    expect(standalone.status).toBe(200);
    const page = await standalone.text();
    expect(page).toContain(`<meta property="og:image" content="${BASE}/c/${card.id}/og.png?lang=en">`);
    expect(page).not.toContain(`href="/loop/`);
    await get(`/c/${card.id}`, { cookie: await ownerCookie() });
    expect((await getCard(env.DB, card.id)).views).toBe(views + 1);
    const listed = (await call(owner, "manage_card", { action: "list" })).data.cards.find((c) => c.id === card.id);
    expect(listed.urls.en).toBe(`${BASE}/c/${card.id}?lang=en`);
    expect((await call(owner, "set_meta", { publish: true })).error).toBeNull();
  });

  it("undoing the write takes its card down and deletes its images", async () => {
    const undo = await call(owner, "undo_event", { id: holdEvent });
    expect(undo.error).toBeNull();
    expect(undo.data.cardsTakenDown).toEqual([card.id]);
    expect(undo.data.note).toMatch(/Chat apps keep previews/);
    expect((await get(`/c/${card.id}`)).status).toBe(410);
    expect(await env.BACKUPS.get(`cards/${card.id}/en/og.png`)).toBeNull();
    const page = await (await get(`/loop/${code}?c=${card.id}`)).text();
    expect(page).not.toContain("share-banner");
  });

  it("a card waits for pending text and gets its link when the owner approves it on the page", async () => {
    const gas = (await call(owner, "propose_loops", { loops: [loopSpec("P-FIN", "Pay the gas bill", "Pagar la factura del gas")] })).data.result.proposed[0];
    expect((await call(owner, "approve_loops", { codes: [gas] })).error).toBeNull();
    const r = await call(owner, "register_experiment", bet("fun", [gas], { funReason: "It makes a good story." }));
    expect(r.error).toBeNull();
    const exp = r.data.target;
    const wrong = await call(owner, "conclude_experiment", { experiment: exp, hypothesis: "refuted" });
    expect(wrong.data.moment).toMatchObject({ kind: "honest", moment: "wrongBet" });
    expect(wrong.data.moment.card).toMatchObject({ status: "waiting", waiting: [`${exp} question`, `${exp} bet`] });
    expect(wrong.data.links.card).toBeUndefined();

    const cookie = await ownerCookie();
    const res = await ownerPost(cookie, { op: "approve_text", targets: exp });
    expect(decodeURIComponent(res.headers.get("Location"))).toContain("Your card is ready.");
    const ready = (await call(owner, "get_state")).data.cardsReady.find((c) => c.id === wrong.data.moment.card.id);
    expect(ready.url).toBe(`${BASE}/exp/${exp}?c=${ready.id}&lang=en`);
    const panel = await (await get("/", { cookie })).text();
    expect(panel).toContain("YOUR CARD IS READY");
    expect(panel).toContain(`data-card-copied="${ready.id}"`);

    const visitor = await (await get(`/exp/${exp}?c=${ready.id}`)).text();
    expect(visitor).toContain("Can an agent pay this bill on time?");
    expect(visitor).toContain("60 in 100");
    expect(visitor).toContain("share-banner");
    expect(visitor).not.toContain("Private note");
  });

  it("no card while an unpublished partner loop is involved, and its experiment page stays closed", async () => {
    const partner = (await call(owner, "propose_loops", { loops: [loopSpec("R-PAR", "Book the date night", "Reservar la cita")] })).data.result.proposed[0];
    expect((await call(owner, "approve_loops", { codes: [partner] })).error).toBeNull();
    const r = await call(owner, "register_experiment", bet("fun", [partner], { funReason: "It makes a good story." }));
    expect(r.error).toBeNull();
    expect((await call(owner, "approve_text", { all: true })).error).toBeNull();
    const ended = await call(owner, "conclude_experiment", { experiment: r.data.target, hypothesis: "refuted" });
    expect(ended.data.moment.card).toEqual({ none: "partner hasn't agreed to publish" });
    expect((await get(`/exp/${r.data.target}`)).status).toBe(404);
    expect((await get(`/exp/${r.data.target}`, { cookie: await ownerCookie() })).status).toBe(200);
  });
});

describe("check-ins", () => {
  it("marks the check-in once inside the window from an owner, never while paused or from a limited key", async () => {
    const owner = (await createApiKey(env.DB, { name: "claude", access: "owner" })).key;
    const agent = (await createApiKey(env.DB, { name: "grok-bot", access: "agent" })).key;
    await meta("cycleOneStart", dayAgo(12));
    await meta("pausedUntil", dayAgo(-7));
    const paused = (await call(owner, "get_check_in")).data;
    expect(paused.checkIn).toMatchObject({ due: false, window: 1, paused: true });
    expect((await call(owner, "get_state")).data.checkInDue).toBe(false);

    await env.DB.prepare("DELETE FROM meta WHERE key = 'pausedUntil'").run();
    expect((await call(owner, "get_state")).data.checkInDue).toBe(true);
    const fromBot = (await call(agent, "get_check_in")).data;
    expect(fromBot.checkIn.due).toBe(false);
    expect(fromBot.roundsEnded).toBeDefined();
    expect((await call(owner, "get_state")).data.checkInDue).toBe(true);

    const marked = (await call(owner, "get_check_in")).data;
    expect(marked.checkIn).toEqual({ due: true, marked: 1 });
    expect(marked.moment).toMatchObject({ moment: "checkIn", kind: "challenge" });
    expect(marked.moment.card.url).toBe(`${BASE}/?c=${marked.moment.card.id}&lang=en`);
    expect((await call(owner, "get_check_in")).data.checkIn.due).toBe(false);
    expect((await call(owner, "get_state")).data.checkInDue).toBe(false);
    const cards = await env.DB.prepare("SELECT COUNT(*) AS n FROM cards WHERE moment = 'checkIn'").first();
    expect(cards.n).toBe(1);
  });
});
