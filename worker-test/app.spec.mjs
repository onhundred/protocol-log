import { env, exports } from "cloudflare:workers";
import { describe, expect, it } from "vitest";
import { createApiKey, viewPass } from "../src/auth.mjs";

const BASE = "https://log.example.com";
const app = () => exports.default;

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

const loop = (name, area = "P-HOM") => ({ area, name: { en: name }, doneWhen: { en: "The result is visible outside my head" }, evidence: "Calendar: a recurring block" });

async function ownerCookie() {
  const res = await app().fetch(
    new Request(`${BASE}/login`, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded", Origin: BASE },
      body: "password=test-owner-password&next=%2F",
      redirect: "manual",
    })
  );
  expect(res.status).toBe(303);
  return res.headers.get("Set-Cookie").split(";")[0];
}

describe("fresh install", () => {
  it("starts empty in building mode and shows the private page", async () => {
    const res = await app().fetch(new Request(`${BASE}/`));
    expect(res.status).toBe(200);
    const page = await res.text();
    expect(page).toContain("This log is private.");
    expect(page).toContain(`${BASE}/mcp`);
    expect(res.headers.get("Content-Security-Policy")).toContain("frame-ancestors 'none'");
    const row = await env.DB.prepare("SELECT value FROM meta WHERE key = 'mode'").first();
    expect(JSON.parse(row.value)).toBe("building");
    const version = await env.DB.prepare("SELECT value FROM meta WHERE key = 'protocolVersion'").first();
    expect(JSON.parse(version.value)).toBe("1.5");
  });

  it("keeps /public.json private until publishing", async () => {
    const res = await app().fetch(new Request(`${BASE}/public.json`));
    expect(res.status).toBe(404);
  });

  it("starts the empty log with the first prompt: connect first, then open it in an app", async () => {
    const cookie = await ownerCookie();
    const ownerPage = async () => (await app().fetch(new Request(`${BASE}/`, { headers: { Cookie: cookie } }))).text();
    const before = await ownerPage();
    expect(before).toContain("No loops yet");
    const empties = (html) => html.match(/data-s="empty"/g) || [];
    expect(empties(before.match(/<a class="grid mini"[\s\S]*?<\/a>/)[0])).toHaveLength(100);
    expect(empties(before.match(/id="activity"[\s\S]*?<ul class="legend">/)[0])).toHaveLength(100);
    expect(before).toMatch(/<li data-level="empty">[\s\S]*?<span class="n">100<\/span>/);
    expect(before).toMatch(/<li data-level="still">[\s\S]*?<span class="n">0<\/span>/);
    expect(before).not.toContain('data-copy="#first-prompt"');
    expect(before).toContain('href="/connect">CONNECT YOUR AI');
    expect(before).not.toContain("claude.ai/new");

    await createApiKey(env.DB, { name: "claude", access: "owner" });
    const after = await ownerPage();
    const q = encodeURIComponent("Use Onhundred to help me build my 100 loops.");
    expect(after).toContain(`https://claude.ai/new?q=${q}`);
    expect(after).toContain(`https://chatgpt.com/?q=${q}`);
    expect(after).toContain(`https://grok.com/?q=${q}`);
    expect(after).toContain(`https://cursor.com/link/prompt?text=${q}`);
    expect(after).toContain('data-copy="#first-prompt"');
    expect(after).not.toContain("CONNECT YOUR AI");
  });
});

describe("OAuth discovery", () => {
  it("answers /mcp without a token with a 401 pointing at the metadata", async () => {
    const res = await app().fetch(new Request(`${BASE}/mcp`, { method: "POST", body: "{}" }));
    expect(res.status).toBe(401);
    expect(res.headers.get("WWW-Authenticate")).toContain("resource_metadata");
  });

  it("publishes protected resource and authorization server metadata", async () => {
    const pr = await (await app().fetch(new Request(`${BASE}/.well-known/oauth-protected-resource/mcp`))).json();
    expect(pr.resource).toBe(`${BASE}/mcp`);
    const as = await (await app().fetch(new Request(`${BASE}/.well-known/oauth-authorization-server`))).json();
    expect(as.authorization_endpoint).toBe(`${BASE}/authorize`);
    expect(as.registration_endpoint).toBe(`${BASE}/oauth/register`);
  });

  it("sends /authorize to sign-in first", async () => {
    const res = await app().fetch(new Request(`${BASE}/authorize?response_type=code&client_id=x`, { redirect: "manual" }));
    expect(res.status).toBe(303);
    expect(res.headers.get("Location")).toMatch(/^\/login\?next=/);
  });
});

describe("MCP with API keys", () => {
  it("rejects an unknown key", async () => {
    const r = await mcp("ohk_nope", "tools/list");
    expect(r.status).toBe(401);
  });

  it("initializes and lists tools, with owner tools hidden from agent keys", async () => {
    const owner = (await createApiKey(env.DB, { name: "test-owner", access: "owner" })).key;
    const agent = (await createApiKey(env.DB, { name: "grok-bot", access: "agent" })).key;
    const init = await mcp(agent, "initialize", { protocolVersion: "2025-06-18", capabilities: {}, clientInfo: { name: "t", version: "1" } });
    expect(init.body.result.serverInfo.name).toBe("onhundred-protocol");
    expect(init.body.result.instructions).toContain("pending");

    const names = (k) => mcp(k, "tools/list").then((r) => r.body.result.tools.map((t) => t.name));
    const agentTools = await names(agent);
    const ownerTools = await names(owner);
    expect(agentTools).toContain("propose_loops");
    expect(agentTools).not.toContain("approve_text");
    expect(ownerTools).toContain("approve_text");
    const tools = (await mcp(owner, "tools/list")).body.result.tools;
    expect(tools.find((t) => t.name === "get_state").annotations.readOnlyHint).toBe(true);
    expect(tools.find((t) => t.name === "approve_text").annotations.destructiveHint).toBe(true);

    const res = await mcp(agent, "resources/read", { uri: "onhundred://docs/voice" });
    expect(res.body.result.contents[0].text.length).toBeGreaterThan(100);
    const prompts = await mcp(agent, "prompts/list");
    expect(prompts.body.result.prompts.map((p) => p.name)).toContain("build_inventory");
  });

  it("rejects a bad loop name, saves a good one, and logs the agent's name", async () => {
    const key = (await createApiKey(env.DB, { name: "grok-bot", access: "agent" })).key;
    const bad = await call(key, "propose_loops", { loops: [loop("Remember to water the plants")] });
    expect(bad.error).toMatch(/Rejected/);

    const good = await call(key, "propose_loops", { loops: [loop("Water the plants")] });
    expect(good.error).toBeNull();
    const code = good.data.result.proposed[0];
    const events = await call(key, "get_events", { target: code });
    expect(events.data[0].actor).toBe("grok-bot");

    const denied = await call(key, "approve_loops", { codes: [code] });
    expect(denied.error).toMatch(/Only the owner/);
  });

  it("keeps agent text pending until approve_text, then publishes it", async () => {
    const key = (await createApiKey(env.DB, { name: "claude", access: "owner" })).key;
    const { data } = await call(key, "propose_loops", { loops: [loop("Pay the rent")] });
    const code = data.result.proposed[0];
    expect((await call(key, "approve_loops", { codes: [code] })).error).toBeNull();

    await call(key, "rename_loop", { code, name: { en: "Pay rent and utilities" } });
    let l = (await call(key, "get_loop", { code })).data;
    expect(l.name.en).toBe("Pay the rent");
    expect(l.pending.name.en).toBe("Pay rent and utilities");
    const pending = (await call(key, "list_pending")).data;
    expect(pending.text.map((t) => t.target)).toContain(code);

    expect((await call(key, "approve_text", { targets: [code] })).error).toBeNull();
    l = (await call(key, "get_loop", { code })).data;
    expect(l.name.en).toBe("Pay rent and utilities");
    expect(l.pending).toBeUndefined();
  });

  it("refuses to freeze below 100 loops", async () => {
    const key = (await createApiKey(env.DB, { name: "claude", access: "owner" })).key;
    const r = await call(key, "freeze_inventory");
    expect(r.error).toMatch(/exactly 100/);
  });

  it("runs simultaneous writes one at a time with distinct codes", async () => {
    const key = (await createApiKey(env.DB, { name: "claude", access: "owner" })).key;
    const results = await Promise.all(
      ["Book the vet", "Renew the lease", "Fix the sink", "Pay the gardener", "Buy the groceries"].map((n) => call(key, "propose_loops", { loops: [loop(n, "P-HOM")] }))
    );
    const codes = results.map((r) => r.data.result.proposed[0]);
    expect(new Set(codes).size).toBe(5);
    expect((await call(key, "check_rules")).data).toEqual([]);
  });

  it("undo_event restores the previous value as a new event", async () => {
    const key = (await createApiKey(env.DB, { name: "claude", access: "owner" })).key;
    const { data } = await call(key, "propose_loops", { loops: [loop("Walk the dog", "R-FAM")] });
    const code = data.result.proposed[0];
    const renamed = await call(key, "rename_loop", { code, name: { en: "Walk the dog twice" } });
    expect((await call(key, "get_loop", { code })).data.name.en).toBe("Walk the dog twice");
    const undo = await call(key, "undo_event", { id: renamed.data.event });
    expect(undo.error).toBeNull();
    expect((await call(key, "get_loop", { code })).data.name.en).toBe("Walk the dog");
  });

  it("stops a revoked key at once", async () => {
    const k = await createApiKey(env.DB, { name: "temp", access: "agent" });
    expect((await mcp(k.key, "ping")).status).toBe(200);
    await env.DB.prepare("UPDATE agents SET revoked_at = ? WHERE id = ?").bind(new Date().toISOString(), k.id).run();
    expect((await mcp(k.key, "ping")).status).toBe(401);
  });
});

describe("owner pages", () => {
  it("refuses a wrong password", async () => {
    const res = await app().fetch(
      new Request(`${BASE}/login`, { method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded", Origin: BASE }, body: "password=wrong" })
    );
    expect(res.status).toBe(401);
  });

  it("shows the grid, pending items and history to the signed-in owner", async () => {
    const cookie = await ownerCookie();
    const res = await app().fetch(new Request(`${BASE}/`, { headers: { Cookie: cookie } }));
    const page = await res.text();
    expect(page).toContain("HANDED OFF");
    expect(page).toMatch(/<li data-level="still">[\s\S]*?STILL YOURS/);
    expect(page).toContain("DO IT, I APPROVE");
    expect(page).not.toMatch(/UNMAPPED|data-s="mapped"/);
    expect(page).toMatch(/\d+ of 100 approved/);
    expect(page).toContain("HISTORY");
    const cells = (html) => html.match(/class="cell"/g) || [];
    const grid = page.match(/<div class="grid" data-grid[\s\S]*?<ul class="legend">/)[0];
    expect(grid).toMatch(/data-loop=/);
    expect(cells(grid)).toHaveLength(100);
    expect(cells(page.match(/<a class="grid mini"[\s\S]*?<\/a>/)[0])).toHaveLength(100);
    const connect = await (await app().fetch(new Request(`${BASE}/connect`, { headers: { Cookie: cookie } }))).text();
    expect(connect).toContain("https://grok.com/connectors");
    expect(connect).toContain(
      `https://claude.ai/customize/connectors?modal=add-custom-connector&amp;connectorName=Onhundred&amp;connectorUrl=${encodeURIComponent(`${BASE}/mcp`)}`
    );
    expect(connect).toContain('href="https://chatgpt.com/plugins" target="_blank" rel="noopener" data-copy="#mcp-url"');
  });

  it("creates an API key from the Connections page and shows it once", async () => {
    const cookie = await ownerCookie();
    const res = await app().fetch(
      new Request(`${BASE}/owner/action`, {
        method: "POST",
        headers: { Cookie: cookie, Origin: BASE, "Content-Type": "application/x-www-form-urlencoded" },
        body: "op=create_key&name=grok-bot&access=agent",
      })
    );
    const page = await res.text();
    const key = page.match(/ohk_[A-Za-z0-9_-]+/)[0];
    expect((await mcp(key, "ping")).status).toBe(200);
  });

  it("approves proposed loops one at a time, with a confirmation that explains approving", async () => {
    const key = (await createApiKey(env.DB, { name: "claude", access: "agent" })).key;
    const { data } = await call(key, "propose_loops", { loops: [loop("Renew the car insurance"), loop("Book the boiler service")] });
    const [first, second] = data.result.proposed;
    const cookie = await ownerCookie();
    const page = await (await app().fetch(new Request(`${BASE}/`, { headers: { Cookie: cookie } }))).text();
    expect(page).not.toContain("APPROVE SELECTED");
    expect(page).toContain(`aria-label="Approve ${first}: Renew the car insurance"`);
    expect(page).toContain("data-approve-dialog");
    expect(page).toContain("Approving adds a loop to your list for good");
    expect(page).toContain("proposed loops that pass the rules");

    const res = await app().fetch(
      new Request(`${BASE}/owner/action`, {
        method: "POST",
        headers: { Cookie: cookie, Origin: BASE, "Content-Type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({ op: "approve_loops", codes: first }),
        redirect: "manual",
      })
    );
    expect(res.status).toBe(303);
    const pending = (await call(key, "list_pending")).data.proposedLoops.map((l) => l.code);
    expect(pending).not.toContain(first);
    expect(pending).toContain(second);
  });

  it("exports the whole log as JSON", async () => {
    const cookie = await ownerCookie();
    const res = await app().fetch(new Request(`${BASE}/export`, { headers: { Cookie: cookie } }));
    const snap = await res.json();
    expect(snap.protocolVersion).toBe("1.5");
    expect(Array.isArray(snap.events)).toBe(true);
  });

  it("explains the export in a dialog that still downloads from /export", async () => {
    const cookie = await ownerCookie();
    const page = await (await app().fetch(new Request(`${BASE}/connect`, { headers: { Cookie: cookie } }))).text();
    expect(page).toContain('<a href="/export" data-export-open>EXPORT</a>');
    expect(page).toContain('<form method="get" action="/export">');
    expect(page).toContain("It leaves out your password, API keys and connections.");
    const signedOut = await (await app().fetch(new Request(`${BASE}/login`))).text();
    expect(signedOut).not.toContain("data-export-dialog");
  });

  it("sends /export to sign-in without a session", async () => {
    const res = await app().fetch(new Request(`${BASE}/export`, { redirect: "manual" }));
    expect(res.status).toBe(303);
  });
});

describe("OAuth sign-in, as Claude and ChatGPT do it", () => {
  const b64url = (buf) => btoa(String.fromCharCode(...new Uint8Array(buf))).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");

  it("registers, signs in, consents, gets a token, calls /mcp as a named agent, and can be revoked", async () => {
    const redirectUri = "https://claude.ai/api/mcp/auth_callback";
    const reg = await app().fetch(
      new Request(`${BASE}/oauth/register`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ client_name: "Claude", redirect_uris: [redirectUri], token_endpoint_auth_method: "none", grant_types: ["authorization_code", "refresh_token"], response_types: ["code"] }),
      })
    );
    expect(reg.status).toBe(201);
    const { client_id } = await reg.json();

    const verifier = b64url(crypto.getRandomValues(new Uint8Array(32)));
    const challenge = b64url(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(verifier)));
    const q = new URLSearchParams({ response_type: "code", client_id, redirect_uri: redirectUri, scope: "mcp", state: "s1", code_challenge: challenge, code_challenge_method: "S256", resource: `${BASE}/mcp` });

    const cookie = await ownerCookie();
    const page = await app().fetch(new Request(`${BASE}/authorize?${q}`, { headers: { Cookie: cookie } }));
    expect(page.status).toBe(200);
    const html = await page.text();
    expect(html).toContain("Allow Claude?");
    expect(html).toContain("claude.ai");
    const handle = html.match(/name="handle" value="([^"]+)"/)[1];
    const binding = page.headers.getSetCookie().map((c) => c.split(";")[0]);

    const approve = await app().fetch(
      new Request(`${BASE}/authorize`, {
        method: "POST",
        headers: { Cookie: [cookie, ...binding].join("; "), Origin: BASE, "Content-Type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({ handle, decision: "approve" }),
        redirect: "manual",
      })
    );
    expect(approve.status).toBe(302);
    const back = new URL(approve.headers.get("Location"));
    expect(back.origin + back.pathname).toBe(redirectUri);
    expect(back.searchParams.get("state")).toBe("s1");

    const tok = await app().fetch(
      new Request(`${BASE}/oauth/token`, {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({ grant_type: "authorization_code", code: back.searchParams.get("code"), redirect_uri: redirectUri, client_id, code_verifier: verifier, resource: `${BASE}/mcp` }),
      })
    );
    expect(tok.status).toBe(200);
    const { access_token } = await tok.json();

    const r = await call(access_token, "propose_loops", { loops: [loop("Book the dentist", "P-HLT")] });
    expect(r.error).toBeNull();
    const ev = await call(access_token, "get_events", { target: r.data.result.proposed[0] });
    expect(ev.data[0].actor).toBe("claude");
    const tools = (await mcp(access_token, "tools/list")).body.result.tools.map((t) => t.name);
    expect(tools).toContain("approve_text");

    const agent = await env.DB.prepare("SELECT id FROM agents WHERE client_id = ?").bind(client_id).first();
    const revoke = await app().fetch(
      new Request(`${BASE}/owner/action`, {
        method: "POST",
        headers: { Cookie: cookie, Origin: BASE, "Content-Type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({ op: "revoke", id: agent.id }),
        redirect: "manual",
      })
    );
    expect(revoke.status).toBe(303);
    expect((await mcp(access_token, "ping")).status).toBe(401);
  });

  it("rejects a cross-site form post", async () => {
    const cookie = await ownerCookie();
    const res = await app().fetch(
      new Request(`${BASE}/owner/action`, {
        method: "POST",
        headers: { Cookie: cookie, Origin: "https://evil.example", "Content-Type": "application/x-www-form-urlencoded" },
        body: "op=create_key&name=x",
      })
    );
    expect(res.status).toBe(403);
  });
});

describe("backups", () => {
  it("writes a snapshot to R2", async () => {
    const { backup } = await import("../src/worker.mjs");
    const key = await backup(env);
    const obj = await env.BACKUPS.get(key);
    expect(JSON.parse(await obj.text()).meta.mode).toBe("building");
  });
});

describe("protocol versions", () => {
  // An install created before v1.1: same database, older version in meta.
  async function onV10() {
    await env.DB.batch([
      env.DB.prepare("UPDATE meta SET value = '\"1.0\"' WHERE key = 'protocolVersion'"),
      env.DB.prepare("DELETE FROM meta WHERE key IN ('protocolChange', 'protocolUpgrade')"),
    ]);
  }
  const ownerPage = async (cookie) => (await app().fetch(new Request(`${BASE}/`, { headers: { Cookie: cookie } }))).text();

  it("offers ADOPT v1.5 on the owner page, and the button adopts it", async () => {
    await onV10();
    const cookie = await ownerCookie();
    const before = await ownerPage(cookie);
    expect(before).toContain('name="op" value="adopt_protocol"');
    expect(before).toContain("ADOPT v1.5");
    expect(before).toContain("takes effect now, since check-ins haven't started");

    const res = await app().fetch(
      new Request(`${BASE}/owner/action`, {
        method: "POST",
        headers: { Cookie: cookie, Origin: BASE, "Content-Type": "application/x-www-form-urlencoded" },
        body: "op=adopt_protocol",
        redirect: "manual",
      })
    );
    expect(res.status).toBe(303);
    expect(decodeURIComponent(res.headers.get("Location"))).toContain("Protocol v1.5 is adopted.");
    const after = await ownerPage(cookie);
    expect(after).not.toContain("ADOPT v1.5");
    expect(after).toMatch(/Adopted [A-Z][a-z]{2} \d+: assisted counts half; 4 levels: still yours replaces unmapped and mapped/);
    expect(after).not.toContain("Handed off went from 0 to 0");
  });

  it("adopts through MCP, lists what breaks the new rules, and shows the change note publicly", async () => {
    await onV10();
    const key = (await createApiKey(env.DB, { name: "claude", access: "owner" })).key;
    const proposed = await call(key, "propose_loops", { loops: [loop("Decide what the kids eat", "P-HOM")] });
    expect(proposed.error).toBeNull();
    const code = proposed.data.result.proposed[0];
    expect((await call(key, "approve_loops", { codes: [code] })).error).toBeNull();

    const state = (await call(key, "get_state")).data;
    expect(state.protocolVersion).toMatchObject({ log: "1.0", template: "1.5", upgradeAvailable: true });
    expect(state.metrics.delegated).toMatch(/ of 100$/);
    const ahead = (await call(key, "list_pending")).data.breaksNewRules;
    expect(ahead).toMatchObject({ version: "1.5", adopted: false });
    expect(ahead.items.some((m) => m.startsWith(`${code}: name`))).toBe(true);

    const tools = (await mcp(key, "tools/list")).body.result.tools;
    expect(tools.find((t) => t.name === "adopt_protocol").annotations.destructiveHint).toBe(true);
    const adopted = await call(key, "adopt_protocol");
    expect(adopted.error).toBeNull();
    expect(adopted.data.result).toMatchObject({ from: "1.0", to: "1.5", takesEffect: "now" });
    expect(adopted.data.result.breaksNewRules.some((m) => m.startsWith(code))).toBe(true);
    expect(adopted.data.result.protocolChange).toMatchObject({ from: "1.0", to: "1.5" });
    expect((await call(key, "adopt_protocol")).error).toMatch(/already runs v1.5/);

    const now = (await call(key, "list_pending")).data.breaksNewRules;
    expect(now).toMatchObject({ version: "1.5", adopted: true });
    expect((await call(key, "propose_loops", { loops: [loop("Choose the summer camp", "R-KID")] })).error).toMatch(/failing verb \(choose\)/);

    const cookie = await ownerCookie();
    const page = await ownerPage(cookie);
    expect(page).toContain("Breaks v1.5 rules");
    expect(page).toContain(`data-fix="Use Onhundred to fix ${code} in my log. It breaks the protocol v1.5 rules: name (en) starts with a failing verb (decide).`);
    expect(page).toContain(`aria-label="Fix ${code} with AI"`);
    expect(page).toMatch(new RegExp(`data-target="${code}"><svg[^]*?</svg>FIX</button></li>`));
    expect(page).toContain("data-fix-dialog");
    expect(page).toContain('data-copy="#fix-prompt"');
    expect(page).toContain('data-app-href="https://claude.ai/new?q={q}"');

    expect((await call(key, "set_meta", { publish: true })).error).toBeNull();
    const view = await (await app().fetch(new Request(`${BASE}/public.json`))).json();
    expect(view.protocolVersion).toBe("1.5");
    expect(view.protocolChange).toMatchObject({ from: "1.0", to: "1.5" });
    expect(view.attribution).toMatchObject({ text: "Onhundred Protocol by Ale Sánchez", url: "https://onhundred.com" });
    const publicPage = await (await app().fetch(new Request(`${BASE}/`))).text();
    expect(publicPage).toMatch(/Adopted [A-Z][a-z]{2} \d+: assisted counts half; 4 levels: still yours replaces unmapped and mapped/);
    expect(publicPage).toContain(
      'Follows the <a href="https://onhundred.com" rel="noopener">Onhundred Protocol by Ale Sánchez</a> and <a href="https://4geeks.com" rel="noopener">4Geeks.com</a>.'
    );
    expect(publicPage).not.toContain("Your data lives in your Cloudflare account.");
    expect(await ownerPage(cookie)).toContain("Your data lives in your Cloudflare account.");
    expect(publicPage).toContain(`<meta property="og:image" content="${BASE}/og.png">`);
  });

  it("offers FIX in the rule dialog of a proposed loop that breaks a rule", async () => {
    await onV10();
    const key = (await createApiKey(env.DB, { name: "claude", access: "owner" })).key;
    const code = (await call(key, "propose_loops", { loops: [loop("Decide what the guests drink", "P-HOM")] })).data.result.proposed[0];
    expect((await call(key, "adopt_protocol")).error).toBeNull();

    const page = await ownerPage(await ownerCookie());
    expect(page).toContain(`data-fix-prompt="Use Onhundred to fix ${code} in my log. It breaks the protocol v1.5 rules: name (en) starts with a failing verb (decide).`);
    expect(page).toMatch(/data-dialog-close data-rule-fix><svg[^]*?<\/svg>FIX<\/button>/);
    expect(page.match(/data-fix-dialog/g)).toHaveLength(1);
    expect(page).toContain('<textarea class="prompt-box" id="fix-prompt"');
  });

  it("offers ADD NEW LOOP next to the branch tabs, with an editable prompt, once an AI app is connected", async () => {
    const key = (await createApiKey(env.DB, { name: "claude", access: "agent" })).key;
    await call(key, "propose_loops", { loops: [loop("Renew the car insurance")] });
    const page = await ownerPage(await ownerCookie());
    expect(page).toMatch(/<div class="card-tools"><div class="tabs"[^]*?<\/div><button[^>]*data-add-loop><svg[^]*?<\/svg>ADD NEW LOOP<\/button>/);
    expect(page.match(/data-add-loop-dialog/g)).toHaveLength(1);
    expect(page).toMatch(/<textarea class="prompt-box" id="add-loop-prompt"[^>]*>Use Onhundred to help me add new loops to my log\./);
    expect(page).toContain('data-prompt-source="#add-loop-prompt"');
    expect(page).toContain('data-app-href="https://claude.ai/new?q={q}"');
  });

  it("saves a scheduled upgrade once its cycle starts, as a system event", async () => {
    await onV10();
    const set = (k, v) => env.DB.prepare("INSERT INTO meta (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value").bind(k, JSON.stringify(v));
    await env.DB.batch([set("cycleOneStart", "2026-01-05"), set("protocolUpgrade", { version: "1.1", fromCycle: 2, adoptedAt: "2026-01-06T00:00:00.000Z" })]);
    const { writer } = await import("../src/writer.mjs");
    expect(await writer(env).write({ actor: "system", access: "owner" })).toEqual({ ok: true, changed: true });
    const row = (k) => env.DB.prepare("SELECT value FROM meta WHERE key = ?").bind(k).first();
    expect(JSON.parse((await row("protocolVersion")).value)).toBe("1.1");
    expect(await row("protocolUpgrade")).toBeNull();
    expect(JSON.parse((await row("protocolChange")).value)).toMatchObject({ from: "1.0", to: "1.1", cycle: 2, at: "2026-01-19" });
    const ev = await env.DB.prepare("SELECT actor, tool FROM events ORDER BY id DESC LIMIT 1").first();
    expect(ev).toEqual({ actor: "system", tool: "adopt_protocol" });
    expect(await writer(env).write({ actor: "system", access: "owner" })).toEqual({ ok: true, changed: false });
  });
});

describe("loop pages", () => {
  const setPublish = (on) =>
    env.DB.prepare("INSERT INTO meta (key, value) VALUES ('publish', ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value").bind(JSON.stringify(on)).run();
  const get = (path, cookie) => app().fetch(new Request(`${BASE}${path}`, { headers: cookie ? { Cookie: cookie } : {}, redirect: "manual" }));
  async function approvedLoop(key, spec) {
    const code = (await call(key, "propose_loops", { loops: [spec] })).data.result.proposed[0];
    expect((await call(key, "approve_loops", { codes: [code] })).error).toBeNull();
    return code;
  }
  const cooking = {
    ...loop("Cook the Sunday batch", "P-HOM"),
    evidence: "Calendar: Sunday cooking block",
    triage: { time: 3, frequency: 4, rules: 4, digital: 3, risk: 1 },
  };

  it("shows the owner every field, history and the AI prompts", async () => {
    const key = (await createApiKey(env.DB, { name: "claude", access: "owner" })).key;
    const code = await approvedLoop(key, cooking);
    const cookie = await ownerCookie();
    const res = await get(`/loop/${code}`, cookie);
    expect(res.status).toBe(200);
    const page = await res.text();
    expect(page).toContain("<h1>Cook the Sunday batch</h1>");
    expect(page).toContain("DONE WHEN</span>The result is visible outside my head");
    expect(page).toContain("Calendar: Sunday cooking block");
    expect(page).toContain("data-level-stack");
    expect(page).toContain("NO EXPERIMENTS YET");
    expect(page).toContain("Approved by the owner");
    expect(page).toContain("score 13, Automate now");
    expect(page).toContain("NEXT ACTIONS");
    expect(page).toContain(`data-loop-prompt="Use Onhundred to rename ${code}, Cook the Sunday batch.`);
    expect(page).toContain("data-loop-prompt-dialog");
    expect(page).toContain('data-app-href="https://claude.ai/new?q={q}"');
    expect(page).toContain('<a href="/">LOG</a></li><li>PERSONAL</li><li>HOME</li>');

    const log = await (await get("/", cookie)).text();
    expect(log).toContain(`data-loop="${code}"`);
  });

  it("canonicalizes the code and answers 404 for codes that aren't loops", async () => {
    const cookie = await ownerCookie();
    const lower = await get("/loop/p-hom-01", cookie);
    expect(lower.status).toBe(303);
    expect(lower.headers.get("Location")).toBe("/loop/P-HOM-01");
    expect((await get("/loop/P-HOM-99", cookie)).status).toBe(404);
    expect((await get("/loop/NOPE", cookie)).status).toBe(404);
  });

  it("sends visitors to sign-in while the log is private", async () => {
    await setPublish(false);
    const res = await get("/loop/P-HOM-01");
    expect(res.status).toBe(303);
    expect(res.headers.get("Location")).toMatch(/^\/login\?next=%2Floop%2FP-HOM-01/);
  });

  it("shows visitors only public fields, and no name for a private partner loop", async () => {
    const key = (await createApiKey(env.DB, { name: "claude", access: "owner" })).key;
    const code = await approvedLoop(key, cooking);
    const partner = await approvedLoop(key, loop("Plan the date night", "R-PAR"));
    await setPublish(true);

    const res = await get(`/loop/${code}`);
    expect(res.status).toBe(200);
    expect(res.headers.get("Cache-Control")).toBe("public, max-age=30");
    const page = await res.text();
    expect(page).toContain("Cook the Sunday batch");
    expect(page).not.toContain("Calendar: Sunday cooking block");
    expect(page).not.toContain("NEXT ACTIONS");
    expect(page).not.toContain("data-loop-prompt");
    expect(page).not.toContain("Approved by the owner");

    const hidden = await (await get(`/loop/${partner}`)).text();
    expect(hidden).toContain("<h1>Private loop</h1>");
    expect(hidden).not.toContain("Plan the date night");
    expect(hidden).not.toContain("The result is visible outside my head");
  });
});

describe("publishing from the owner page", () => {
  it("warns while the log is private, and PUBLISH makes it public", async () => {
    await env.DB.prepare("INSERT INTO meta (key, value) VALUES ('publish', 'false') ON CONFLICT(key) DO UPDATE SET value = excluded.value").run();
    const cookie = await ownerCookie();
    const ownerPage = async () => (await app().fetch(new Request(`${BASE}/`, { headers: { Cookie: cookie } }))).text();
    expect(await ownerPage()).toContain("Your progress is private. You can publish it here.");

    const res = await app().fetch(
      new Request(`${BASE}/owner/action`, {
        method: "POST",
        headers: { Cookie: cookie, Origin: BASE, "Content-Type": "application/x-www-form-urlencoded" },
        body: "op=set_meta&publish=false&ownerName=Someone",
        redirect: "manual",
      })
    );
    expect(res.status).toBe(303);
    expect(decodeURIComponent(res.headers.get("Location"))).toContain("Your log is public.");
    expect((await app().fetch(new Request(`${BASE}/public.json`))).status).toBe(200);
    const after = await ownerPage();
    expect(after).not.toContain("Your progress is private.");
    expect(after).not.toContain("SOMEONE");
  });

  it("puts the name, why and FOLLOW links above the numbers; the owner also gets SHARE", async () => {
    const key = (await createApiKey(env.DB, { name: "claude", access: "owner" })).key;
    expect((await call(key, "set_meta", { links: [{ kind: "x", url: "https://evil.example/sam" }] })).error).toMatch(/not x\.com or twitter\.com/);
    expect((await call(key, "set_meta", { links: [{ kind: "website", url: "javascript:alert(1)" }] })).error).toMatch(/https/);
    expect((await call(key, "set_meta", { languages: ["en"], about: { en: "I want my evenings back!" } })).error).toMatch(/exclamation/);
    const about = "I run a small design studio and want my evenings back.";
    const set = await call(key, "set_meta", {
      languages: ["en"],
      ownerName: "Sam Rivera",
      publish: true,
      about: { en: about },
      links: [
        { kind: "x", url: "https://x.com/samrivera" },
        { kind: "website", url: "https://sam.example" },
      ],
    });
    expect(set.error).toBeNull();

    const view = await (await app().fetch(new Request(`${BASE}/public.json`))).json();
    expect(view.meta).toMatchObject({ ownerName: "Sam Rivera", about: { en: about }, links: [{ kind: "x" }, { kind: "website" }] });

    const page = await (await app().fetch(new Request(`${BASE}/`))).text();
    expect(page).toContain('<h1 class="profile-name">Sam Rivera</h1>');
    expect(page).toContain(`<p class="profile-about">${about}</p>`);
    expect(page).toContain('<p class="figure">');
    expect(page).toContain('href="https://x.com/samrivera" target="_blank" rel="me noopener"');
    expect(page).toContain(`<meta property="og:description" content="${about}">`);
    expect(page).toContain('<span class="label" id="follow-label">FOLLOW SAM</span>');
    expect(page).not.toContain("SHARE");
    expect(page.indexOf('class="profile"')).toBeLessThan(page.indexOf('class="readout"'));
    expect(page).not.toContain("data-profile-dialog");

    const owner = await (await app().fetch(new Request(`${BASE}/`, { headers: { Cookie: await ownerCookie() } }))).text();
    expect(owner).toContain("FOLLOW SAM");
    expect(owner).toContain(`id="share-url" value="${BASE}/"`);
    expect(owner).toContain(`https://x.com/intent/post?text=${encodeURIComponent("Sam Rivera ")}`);
    expect(owner).toContain('data-open-dialog="[data-profile-dialog]">EDIT WITH AI');
    expect(owner).toContain("set_meta with about and links");

    expect((await call(key, "set_meta", { about: null, links: null })).error).toBeNull();
    const cleared = await (await app().fetch(new Request(`${BASE}/`))).text();
    expect(cleared).not.toContain("profile-about");
    expect(cleared).not.toContain("profile-links");
  });

  it("asks the owner for social links on the page and in every new MCP conversation until they answer", async () => {
    const key = (await createApiKey(env.DB, { name: "claude", access: "owner" })).key;
    expect((await call(key, "set_meta", { ownerName: "Sam Rivera", publish: true, links: null })).error).toBeNull();
    const cookie = await ownerCookie();
    const ownerPage = async () => (await app().fetch(new Request(`${BASE}/`, { headers: { Cookie: cookie } }))).text();
    const post = (fields, headers = {}) =>
      app().fetch(
        new Request(`${BASE}/owner/action`, {
          method: "POST",
          headers: { Cookie: cookie, Origin: BASE, "Content-Type": "application/x-www-form-urlencoded", ...headers },
          body: new URLSearchParams({ op: "set_meta", setting: "links", ...fields }),
          redirect: "manual",
        })
      );

    const before = await ownerPage();
    expect(before).toContain("Visitors can't follow you yet.");
    expect(before).toContain('data-open-dialog="[data-links-dialog]">ADD YOUR LINKS');
    expect(before).toContain('name="link_x"');
    expect(before).toContain('data-open-dialog="[data-links-dialog]">ADD LINKS');
    expect(await (await app().fetch(new Request(`${BASE}/`))).text()).not.toContain("data-links-dialog");

    const init = await mcp(key, "initialize", { protocolVersion: "2025-06-18", capabilities: {}, clientInfo: { name: "t", version: "1" } });
    expect(init.body.result.instructions).toContain("hasn't added their social accounts");
    const state = (await call(key, "get_state")).data;
    expect(state.profile).toMatchObject({ ownerName: "Sam Rivera", links: null });
    expect(state.profile.missing).toContain("links");
    expect(state.profile.ask).toMatch(/set_meta/);
    expect((await call(key, "list_pending")).data.profile.missing).toContain("links");

    const bad = await (await post({ link_x: "instagram.com/sam" }, { Accept: "application/json" })).json();
    expect(bad.ok).toBe(false);
    expect(bad.error).toMatch(/not x\.com/);

    const saved = await (await post({ link_x: "@samrivera", link_github: "http://www.github.com/@sam/", link_website: "" }, { Accept: "application/json" })).json();
    expect(saved).toEqual({ ok: true, done: "Your links are saved." });
    const view = await (await app().fetch(new Request(`${BASE}/public.json`))).json();
    expect(view.meta.links).toEqual([
      { kind: "x", url: "https://x.com/samrivera" },
      { kind: "github", url: "https://github.com/sam" },
    ]);
    const after = await ownerPage();
    expect(after).not.toContain("Visitors can't follow you yet.");
    expect(after).toContain('value="https://x.com/samrivera"');
    expect(after).toContain('data-open-dialog="[data-links-dialog]">EDIT LINKS');

    const none = await post({ none: "1", link_x: "@samrivera" });
    expect(none.status).toBe(303);
    expect(decodeURIComponent(none.headers.get("Location"))).toContain("Nobody will ask for your links again.");
    expect((await (await app().fetch(new Request(`${BASE}/public.json`))).json()).meta.links).toEqual([]);
    const declined = await ownerPage();
    expect(declined).not.toContain("Visitors can't follow you yet.");
    expect(declined).not.toContain("profile-links");
    expect(declined).toMatch(/name="none" value="1" checked/);
    const quiet = await mcp(key, "initialize", { protocolVersion: "2025-06-18", capabilities: {}, clientInfo: { name: "t", version: "1" } });
    expect(quiet.body.result.instructions).not.toContain("social accounts");
    expect((await call(key, "get_state")).data.profile.missing).not.toContain("links");

    expect((await call(key, "set_meta", { links: null })).error).toBeNull();
    expect(await ownerPage()).toContain("Visitors can't follow you yet.");
  });

  it("lets the owner write the about line from the pencil, checked like any public text", async () => {
    const key = (await createApiKey(env.DB, { name: "claude", access: "owner" })).key;
    expect((await call(key, "set_meta", { languages: ["en"], publish: true, about: null })).error).toBeNull();
    const cookie = await ownerCookie();
    const ownerPage = async () => (await app().fetch(new Request(`${BASE}/`, { headers: { Cookie: cookie } }))).text();
    const save = async (text) =>
      (
        await app().fetch(
          new Request(`${BASE}/owner/action`, {
            method: "POST",
            headers: { Cookie: cookie, Origin: BASE, "Content-Type": "application/x-www-form-urlencoded", Accept: "application/json" },
            body: new URLSearchParams({ op: "set_meta", setting: "about", about_en: text, about_zz: "Sneaky." }),
          })
        )
      ).json();

    const empty = await ownerPage();
    expect(empty).toMatch(/<p class="profile-about empty">[^<]*<span class="nowrap">for\. <button class="pencil"[^>]*data-open-dialog="\[data-about-dialog\]"/);
    expect(empty).toContain('name="about_en"');
    expect(await (await app().fetch(new Request(`${BASE}/`))).text()).not.toContain("data-about-dialog");

    const bad = await save("I want my evenings back!");
    expect(bad.ok).toBe(false);
    expect(bad.error).toMatch(/exclamation/);

    const line = "I run a small design studio and want my evenings back.";
    expect(await save(`  ${line} `)).toEqual({ ok: true, done: "Your line is saved." });
    expect((await (await app().fetch(new Request(`${BASE}/public.json`))).json()).meta.about).toEqual({ en: line });
    const after = await ownerPage();
    expect(after).toContain(`<p class="profile-about">I run a small design studio and want my evenings <span class="nowrap">back. <button class="pencil"`);
    expect(after).toContain(`>${line}</textarea>`);

    expect(await save(" ")).toEqual({ ok: true, done: "Your line is removed." });
    expect((await (await app().fetch(new Request(`${BASE}/public.json`))).json()).meta.about).toBeUndefined();
  });

  it("lets the owner rename themselves from the pencil on the name, never to an empty name", async () => {
    const key = (await createApiKey(env.DB, { name: "claude", access: "owner" })).key;
    expect((await call(key, "set_meta", { ownerName: "Sam Rivera", publish: true })).error).toBeNull();
    expect((await call(key, "set_meta", { ownerName: "   " })).error).toMatch(/can't be empty/);
    const cookie = await ownerCookie();
    const save = async (name) =>
      (
        await app().fetch(
          new Request(`${BASE}/owner/action`, {
            method: "POST",
            headers: { Cookie: cookie, Origin: BASE, "Content-Type": "application/x-www-form-urlencoded", Accept: "application/json" },
            body: new URLSearchParams({ op: "set_meta", setting: "name", ownerName: name }),
          })
        )
      ).json();

    const page = await (await app().fetch(new Request(`${BASE}/`, { headers: { Cookie: cookie } }))).text();
    expect(page).toMatch(/<h1 class="profile-name">Sam <span class="nowrap">Rivera <button class="pencil"[^>]*data-open-dialog="\[data-name-dialog\]"/);
    expect(page).toContain('name="ownerName" value="Sam Rivera"');
    expect(await (await app().fetch(new Request(`${BASE}/`))).text()).toContain('<h1 class="profile-name">Sam Rivera</h1>');

    expect((await save(" ")).error).toMatch(/can't be empty/);
    expect(await save("  Samantha Rivera ")).toEqual({ ok: true, done: "Your name is saved." });
    expect((await (await app().fetch(new Request(`${BASE}/public.json`))).json()).meta.ownerName).toBe("Samantha Rivera");

    const toasted = await (await app().fetch(new Request(`${BASE}/?done=${encodeURIComponent("Your name is saved.")}`, { headers: { Cookie: cookie } }))).text();
    expect(toasted).toMatch(/<div class="toast" role="status" aria-live="polite" data-toast>.*<span>Your name is saved\.<\/span>/);
    expect(toasted).not.toContain('class="notice good"');
    const failed = await (await app().fetch(new Request(`${BASE}/?error=${encodeURIComponent("Nope.")}`, { headers: { Cookie: cookie } }))).text();
    expect(failed).toContain('<p class="notice bad">Nope.</p>');
    expect(failed).not.toContain("data-toast");
  });

  it("shows the owner what visitors see at /?view=public", async () => {
    const cookie = await ownerCookie();
    const get = async (path, headers = {}) => (await app().fetch(new Request(`${BASE}${path}`, { headers }))).text();
    expect(await get("/", { Cookie: cookie })).toContain('href="/?view=public"');

    const preview = await get("/?view=public", { Cookie: cookie });
    expect(preview).toContain("This is what visitors see.");
    expect(preview).toMatch(/<div class="notice good closable">[\s\S]*?data-dismiss[\s\S]*?<\/div>/);
    expect(preview).toContain("HANDED OFF");
    expect(preview).not.toContain("HISTORY");
    expect(preview).not.toContain('href="/?view=public"');
    expect(preview).not.toContain('class="grid mini"');
    expect(preview).toContain('id="activity" data-open');
    expect(preview).toContain('<nav class="nav"><a href="/">BACK TO YOUR LOG</a><form method="post" action="/logout">');
    expect(preview).not.toContain('href="/login"');
    expect(await get("/?view=public")).toContain('<nav class="nav"><a href="/login">SIGN IN</a></nav>');
    expect(await get("/", { Cookie: cookie })).toContain('class="grid mini"');
    expect(await get("/?view=public")).not.toContain("This is what visitors see.");

    await env.DB.prepare("INSERT INTO meta (key, value) VALUES ('publish', 'false') ON CONFLICT(key) DO UPDATE SET value = excluded.value").run();
    const hidden = await get("/?view=public", { Cookie: cookie });
    expect(hidden).toContain("This is what visitors see.");
    expect(hidden).toContain("This log is private.");
  });
});

describe("public activity", () => {
  it("shows visitors what moved and who moved it, without private loops, app names, event ids or clock times", async () => {
    await env.DB.prepare("INSERT INTO meta (key, value) VALUES ('publish', 'true') ON CONFLICT(key) DO UPDATE SET value = excluded.value").run();
    const key = (await createApiKey(env.DB, { name: "claude", access: "owner" })).key;
    const [pub, priv] = (await call(key, "propose_loops", { loops: [loop("Water the balcony plants"), loop("Plan the anniversary dinner", "R-PAR")] })).data.result
      .proposed;
    expect((await call(key, "approve_loops", { codes: [pub, priv] })).error).toBeNull();
    const waiting = (await call(key, "propose_loops", { loops: [loop("Sort the recycling")] })).data.result.proposed[0];

    const page = await (await app().fetch(new Request(`${BASE}/`))).text();
    const section = page.match(/<section class="block pulse" id="pulse">[\s\S]*?<\/section>/)[0];
    expect(section).toContain("ACTIVITY");
    expect(section).toContain("data-spark");
    expect(section).toMatch(/Added to the list<\/b> <a class="code" href="\/loop\/[^"]+">/);
    expect(section).toContain(`href="/loop/${pub}"`);
    expect(section).toContain('<span class="by" data-by="agent">BY AN AGENT</span>');
    expect(section).not.toContain(priv);
    expect(section).not.toContain(waiting);
    expect(section).not.toContain("claude");
    expect(section).not.toMatch(/#\d+ ·/);
    expect(section).not.toMatch(/<small>\d\d:\d\d<\/small>/);

    const view = await (await app().fetch(new Request(`${BASE}/public.json`))).json();
    expect(view.activity.some((a) => a.tool === "approve_loops" && a.codes.includes(pub) && a.by === "agent")).toBe(true);
    expect(JSON.stringify(view.activity)).not.toContain(priv);
    expect(JSON.stringify(view.activity)).not.toContain(waiting);

    const owner = await (await app().fetch(new Request(`${BASE}/`, { headers: { Cookie: await ownerCookie() } }))).text();
    expect(owner).not.toContain('id="pulse"');
    expect(owner).toContain("HISTORY");
  });
});

describe("links after writes", () => {
  const get = (path, cookie) => app().fetch(new Request(`${BASE}${path}`, { headers: cookie ? { Cookie: cookie } : {}, redirect: "manual" }));

  it("tells the agent to end its reply with links.open", async () => {
    const key = (await createApiKey(env.DB, { name: "claude", access: "owner" })).key;
    const init = await mcp(key, "initialize", { protocolVersion: "2025-06-18", capabilities: {}, clientInfo: { name: "t", version: "1" } });
    expect(init.body.result.instructions).toContain("links.open");
  });

  it("sends a proposal to the approve link, with a graph link that skips sign-in", async () => {
    const key = (await createApiKey(env.DB, { name: "claude", access: "owner" })).key;
    const { data } = await call(key, "propose_loops", { loops: [loop("Water the ferns")] });
    expect(data.grid.delta).toBeNull();
    expect(data.links.approve).toBe(`${BASE}/login?next=/`);
    expect(data.links.open).toBe(data.links.approve);
    expect(data.links.graph.startsWith(`${BASE}/v/view.`)).toBe(true);
    expect(Date.parse(data.links.expiresAt) - Date.now()).toBeGreaterThan(23 * 3600000);
  });

  it("reports what moved, and the link opens a view-only log with the moved squares named", async () => {
    const key = (await createApiKey(env.DB, { name: "claude", access: "owner" })).key;
    const code = (await call(key, "propose_loops", { loops: [loop("Clean the gutters")] })).data.result.proposed[0];
    const approved = await call(key, "approve_loops", { codes: [code] });
    expect(approved.data.grid.delta.moved).toEqual([{ code, from: null, to: "still" }]);
    expect((await call(key, "record_baseline", { code, occurrences: 4, hoursPerWeek: 2 })).error).toBeNull();
    const measured = await call(key, "approve_baseline", { code });
    expect(measured.error).toBeNull();
    expect(measured.data.result).toMatchObject({ level: "still", measured: true });
    expect(measured.data.grid.delta).toBeNull();
    const r = approved;
    expect(r.data.grid.now.levels.still).toBeGreaterThan(0);
    expect(r.data.links.open).toBe(r.data.links.graph);
    expect(r.data.links.open).toContain(`?moved=${code}`);
    expect(r.data.links.loop).toContain(`?to=/loop/${code}`);

    const res = await get(r.data.links.open.slice(BASE.length));
    expect(res.status).toBe(302);
    expect(res.headers.get("Location")).toBe(`/?moved=${code}#activity`);
    expect(res.headers.get("Referrer-Policy")).toBe("no-referrer");
    const cookie = res.headers.get("Set-Cookie").split(";")[0];
    expect(cookie.startsWith("__Host-onhundred-view=")).toBe(true);

    const page = await (await get(`/?moved=${code}`, cookie)).text();
    expect(page).toContain("VIEW ONLY.");
    expect(page).toContain(`data-loop="${code}"`);
    expect(page).toContain("HISTORY");
    expect(page).not.toContain('action="/owner/action"');
    expect(page).not.toContain('href="/connections"');

    const loopRes = await get(r.data.links.loop.slice(BASE.length));
    expect(loopRes.headers.get("Location")).toBe(`/loop/${code}`);
    const loopPage = await (await get(`/loop/${code}`, cookie)).text();
    expect(loopPage).toContain("VIEW ONLY.");
    expect(loopPage).toContain("Clean the gutters");
    expect(loopPage).not.toContain("NEXT ACTIONS");

    const post = await app().fetch(
      new Request(`${BASE}/owner/action`, {
        method: "POST",
        headers: { Cookie: cookie, Origin: BASE, "Content-Type": "application/x-www-form-urlencoded" },
        body: "op=set_meta",
        redirect: "manual",
      })
    );
    expect(post.status).toBe(401);
  });

  it("refuses forged and expired passes, and stops every link once the connection is revoked", async () => {
    const k = await createApiKey(env.DB, { name: "claude", access: "owner" });
    const { data } = await call(k.key, "get_state");
    expect(data.links.open).toBe(data.links.graph);
    expect(data.grid.now.levels).toBeDefined();
    const path = data.links.graph.slice(BASE.length);

    const parts = path.split(".");
    parts[2] = String(Number(parts[2]) + 1000);
    expect((await get(parts.join("."))).status).toBe(410);
    const expired = await viewPass(env, k.id, Date.now() - 25 * 3600000);
    expect((await get(`/v/${expired.pass}`)).status).toBe(410);

    const res = await get(path);
    expect(res.status).toBe(302);
    const cookie = res.headers.get("Set-Cookie").split(";")[0];
    await env.DB.prepare("UPDATE agents SET revoked_at = ? WHERE id = ?").bind(new Date().toISOString(), k.id).run();
    const gone = await get(path);
    expect(gone.status).toBe(410);
    expect(await gone.text()).toContain("This link expired");
    expect(await (await get("/", cookie)).text()).not.toContain("VIEW ONLY.");
  });

  it("gives agent-access connections plain links", async () => {
    const key = (await createApiKey(env.DB, { name: "grok-bot", access: "agent" })).key;
    const { data } = await call(key, "propose_loops", { loops: [loop("Sweep the porch")] });
    expect(data.links.graph).toBe(`${BASE}/#activity`);
    expect(data.links.expiresAt).toBeUndefined();
    expect(JSON.stringify(data.links)).not.toContain("/v/");
  });
});
