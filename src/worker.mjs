// Entry point: OAuth for chat apps, API keys for API agents, MCP at /mcp, the log page, backups.
import { AuthorizationError, CimdFetchError, OAuthProvider } from "@cloudflare/workers-oauth-provider";
import { PROFILE_LINKS, PUBLIC_TOOLS, cardHeadline, compareVersions, normalizeLink, parseCode, publicActivity, publicView, protocol as P } from "../lib/protocol.mjs";
import {
  checkPassword,
  checkRenderToken,
  checkViewPass,
  clearCookie,
  configured,
  createApiKey,
  hasConnections,
  isOwner,
  listAgents,
  loginLocked,
  recordFailure,
  recordOAuthAgent,
  resolveApiKey,
  revokeAgent,
  sameOrigin,
  sessionCookie,
  viewCookie,
  viewerFrom,
} from "./auth.mjs";
import { POST_SIZES, SIZES, cardKey, cardUrls, imageUrl, postImages, readyCards, requestPostImages } from "./cards.mjs";
import { handleMcp } from "./mcp.mjs";
import { cardPage, cardRenderPage, connectPage, connectionsPage, consentPage, expPage, html, logPage, loginPage, loopPage, messagePage, privatePage } from "./pages.mjs";
import { countCardView, getCard, getEvents, getPublicEvents, isPublished, logEvent, readState, snapshot, updateCard } from "./store.mjs";
import { writer } from "./writer.mjs";

export { Writer } from "./writer.mjs";

const OWNER_USER = "owner";
const SCOPES = ["mcp", "offline_access"];

// PUBLIC_URL counts only when it's a real http(s) URL; a placeholder falls back to the request's origin.
function originOf(request, env) {
  if (/^https?:\/\//i.test(env.PUBLIC_URL || "")) {
    try {
      return new URL(env.PUBLIC_URL).origin;
    } catch {}
  }
  return new URL(request.url).origin;
}

// The MCP endpoint. Signed-in apps carry props from consent; API keys carry props from resolveApiKey.
const apiHandler = {
  async fetch(request, env, ctx) {
    const props = ctx.props || {};
    if (props.agentId) {
      const row = await env.DB.prepare("SELECT revoked_at FROM agents WHERE id = ?").bind(props.agentId).first();
      if (!row || row.revoked_at)
        return new Response(JSON.stringify({ error: "invalid_token", error_description: "This connection was revoked." }), {
          status: 401,
          headers: { "Content-Type": "application/json", "WWW-Authenticate": 'Bearer error="invalid_token"' },
        });
    }
    return handleMcp(request, env, {
      agentId: props.agentId,
      name: props.name || "agent",
      access: props.access === "owner" ? "owner" : "agent",
      origin: originOf(request, env),
    });
  },
};

const defaultHandler = {
  async fetch(request, env, ctx) {
    try {
      return await route(request, env, ctx);
    } catch (err) {
      if (err instanceof AuthorizationError && err.redirectTo) return Response.redirect(err.redirectTo, 302);
      if (err instanceof AuthorizationError || err instanceof CimdFetchError) {
        const text = err instanceof AuthorizationError ? err.description : "This app could not be verified. Try connecting again.";
        return messagePage({ title: "Connection failed", text });
      }
      throw err;
    }
  },
};

const providers = new Map();
function providerFor(origin) {
  if (!providers.has(origin))
    providers.set(
      origin,
      new OAuthProvider({
        apiRoute: "/mcp",
        apiHandler,
        defaultHandler,
        authorizeEndpoint: "/authorize",
        tokenEndpoint: "/oauth/token",
        clientRegistrationEndpoint: "/oauth/register",
        scopesSupported: SCOPES,
        requiredScopes: ["mcp"],
        clientIdMetadataDocumentEnabled: true,
        resourceMetadata: { resource: `${origin}/mcp`, authorization_servers: [origin], resource_name: "Onhundred Protocol log" },
        resolveExternalToken: async ({ token, env }) => {
          const props = await resolveApiKey(env.DB, token);
          return props ? { props, audience: `${origin}/mcp` } : null;
        },
      })
    );
  return providers.get(origin);
}

export default {
  fetch(request, env, ctx) {
    return providerFor(originOf(request, env)).fetch(request, env, ctx);
  },

  // Nightly: saves what came due, backs up, and retries card images that failed.
  async scheduled(_controller, env, ctx) {
    const w = writer(env);
    ctx.waitUntil(w.write({ actor: "system", access: "owner" }).then(() => backup(env)).then(() => w.queueShots()));
  },
};

export async function backup(env) {
  const snap = await snapshot(env);
  const key = `snapshots/${snap.exportedAt.slice(0, 10)}.json`;
  await env.BACKUPS.put(key, JSON.stringify(snap), { httpMetadata: { contentType: "application/json" } });
  return key;
}

// ---------------------------------------------------------------------------

const redirect = (to, headers = {}) => new Response(null, { status: 303, headers: { Location: to, ...headers } });
const withQuery = (path, key, value) => `${path}?${key}=${encodeURIComponent(value)}`;
const safeNext = (next) => (typeof next === "string" && next.startsWith("/") && !next.startsWith("//") && !next.startsWith("/\\") ? next : "/");

// Where a view link lands: the log page with the grid open, or one loop's page. Only valid codes pass through.
function viewTarget(url) {
  const to = url.searchParams.get("to") || "/";
  const loop = /^\/loop\/(.+)$/.exec(to)?.[1];
  if (loop && parseCode(loop)) return `/loop/${loop}`;
  const moved = (url.searchParams.get("moved") || "").split(",").filter((c) => parseCode(c));
  return `/${moved.length ? `?moved=${moved.join(",")}` : ""}#activity`;
}

// ---------------------------------------------------------------------------
// Share cards

const CARD_PATH = /^\/c\/([0-9A-Za-z]{8})(?:\/(render|og\.png|square\.png|tall\.png))?$/;
// Link-preview fetchers from chat apps and social sites: they don't count as views.
const PREVIEW_BOT = /bot|crawl|spider|preview|facebookexternalhit|slack|discord|whatsapp|telegram|twitter|linkedin|embedly|skype|pinterest|vkshare/i;
const isBot = (request) => PREVIEW_BOT.test(request.headers.get("User-Agent") || "");
const pickLang = (url, languages) => (languages.includes(url.searchParams.get("lang")) ? url.searchParams.get("lang") : languages[0]);
const addQuery = (path, key, value) => `${path}${path.includes("?") ? "&" : "?"}${key}=${encodeURIComponent(value)}`;

// Everything a page needs to show a card: headline, preview image, links per language and the images to post.
function shareView(card, { origin, url, languages, published, owner, next = "/" }) {
  const lang = pickLang(url, languages);
  const q = languages.length > 1 ? `?lang=${lang}` : "";
  return {
    card,
    lang,
    languages,
    headline: cardHeadline(card.facts, card.headline, lang),
    image: imageUrl(origin, card, "og", lang, languages),
    imagePath: `/c/${card.id}/og.png${q}`,
    urls: cardUrls(origin, card, { published, languages }),
    post: postImages(card, languages),
    images: POST_SIZES.map((s) => ({ label: s === "square" ? "SQUARE" : "STORY", url: `/c/${card.id}/${s}.png${q}` })),
    running: card.page === "exp" && Boolean(card.facts.experiment?.running),
    owner,
    next,
  };
}

// The card in ?c=, when it's up, ready and made for this page. Otherwise the page looks normal.
async function shareFor(request, env, url, page, target, ctx) {
  const id = url.searchParams.get("c");
  if (!id) return null;
  const card = await getCard(env.DB, id);
  if (!card || card.revoked_at || card.waiting || card.page !== page || (card.target || null) !== (target || null)) return null;
  if (!ctx.owner && !ctx.viewer && !isBot(request)) await countCardView(env.DB, card.id);
  return shareView(card, { ...ctx, url, next: url.pathname + url.search });
}

async function cardRoute(request, env, url, [, id, part], { state, origin, owner, viewer, published }) {
  const meta = state.meta;
  const languages = meta.languages;
  const card = await getCard(env.DB, id);
  if (part?.endsWith(".png")) {
    const size = part.slice(0, -".png".length);
    const obj = card && !card.revoked_at ? await env.BACKUPS.get(cardKey(card.id, pickLang(url, languages), size)) : null;
    if (!obj) return new Response(null, { status: 302, headers: { Location: "/og.png", "Cache-Control": "no-store" } });
    return new Response(obj.body, { headers: { "Content-Type": "image/png", "Cache-Control": "public, max-age=300", "X-Content-Type-Options": "nosniff" } });
  }
  if (part === "render") {
    const size = url.searchParams.get("size") || "og";
    if (!card || !Object.hasOwn(SIZES, size) || !(await checkRenderToken(env, card.id, url.searchParams.get("t"))))
      return messagePage({ meta, title: "Not allowed", text: "This page only draws card images.", status: 403 });
    return html(cardRenderPage({ meta, card, size, lang: pickLang(url, languages), dims: SIZES[size] }));
  }
  if (!card || card.waiting) return messagePage({ meta, title: "Not found", text: "No card has this link.", status: 404 });
  if (card.revoked_at) return messagePage({ meta, title: "This card was taken down", text: "The person who shared it took it down.", status: 410 });
  if (!owner && !viewer && !isBot(request)) await countCardView(env.DB, card.id);
  return html(cardPage({ meta, origin, share: shareView(card, { origin, url, languages, published, owner, next: url.pathname + url.search }) }));
}

async function route(request, env) {
  const url = new URL(request.url);
  const origin = originOf(request, env);
  const path = url.pathname;
  const method = request.method;

  if (path === "/authorize") return authorize(request, env, url);
  if (path === "/login") return login(request, env, url);
  if (path === "/logout" && method === "POST") return redirect("/", { "Set-Cookie": clearCookie() });

  const state = await readState(env);
  const meta = state.meta;
  const owner = await isOwner(request, env);
  const published = isPublished(meta, env);

  // A view pass from an agent's link: trade it for a view cookie and land on the page without it.
  if (path.startsWith("/v/") && method === "GET") {
    const pass = decodeURIComponent(path.slice("/v/".length));
    const ok = await checkViewPass(env, pass);
    if (!ok) {
      const page = messagePage({ meta, title: "This link expired", text: "Ask your agent for a fresh link, or sign in to see your log.", status: 410 });
      page.headers.set("Referrer-Policy", "no-referrer");
      return page;
    }
    return new Response(null, {
      status: 302,
      headers: { Location: viewTarget(url), "Set-Cookie": viewCookie(pass, ok.exp), "Cache-Control": "no-store", "Referrer-Policy": "no-referrer" },
    });
  }
  const viewer = owner ? null : await viewerFrom(request, env);
  const shareCtx = { origin, languages: meta.languages, published, owner, viewer: Boolean(viewer) };

  const cardMatch = CARD_PATH.exec(path);
  if (cardMatch && method === "GET") return cardRoute(request, env, url, cardMatch, { state, origin, owner, viewer: Boolean(viewer), published });

  // A shared link on a private log: visitors get the card's own page, never the log.
  if (!published && !owner && !viewer && url.searchParams.has("c") && (path === "/" || path.startsWith("/loop/") || path.startsWith("/exp/"))) {
    const card = await getCard(env.DB, url.searchParams.get("c"));
    if (card && !card.revoked_at && !card.waiting) {
      const lang = url.searchParams.get("lang");
      return redirect(`/c/${card.id}${lang && meta.languages.includes(lang) ? `?lang=${lang}` : ""}`);
    }
  }

  if (path === "/public.json") {
    if (!published) return Response.json({ error: "This log is private." }, { status: 404 });
    const view = publicView(state, { generatedAt: new Date().toISOString() });
    return Response.json({ ...view, activity: publicActivity(await getPublicEvents(env.DB, PUBLIC_TOOLS), view) }, {
      headers: { "Cache-Control": "no-cache", "Access-Control-Allow-Origin": "*" },
    });
  }

  if (path === "/") {
    const connected = await hasConnections(env.DB);
    const share = await shareFor(request, env, url, "home", null, shareCtx);
    if (owner && url.searchParams.get("view") === "public") {
      return html(
        published
          ? logPage({ state, owner: false, publicEvents: await getPublicEvents(env.DB, PUBLIC_TOOLS), url, configured: true, preview: true, share })
          : privatePage({ meta, origin, configured: true, hasConnections: true, preview: true })
      );
    }
    if (owner) {
      const events = await getEvents(env.DB, { limit: 30 });
      const ready = (await readyCards(env.DB)).map((c) => shareView(c, { ...shareCtx, url, next: "/" }));
      return html(logPage({ state, owner, events, url, upgrade: compareVersions(meta.protocolVersion, P.version) < 0, configured: configured(env), hasConnections: connected, published, share, ready }));
    }
    if (viewer) {
      const events = await getEvents(env.DB, { limit: 30 });
      return html(logPage({ state, owner: true, viewOnly: true, events, url, configured: true, hasConnections: connected, published, share }));
    }
    if (published)
      return html(logPage({ state, owner: false, publicEvents: await getPublicEvents(env.DB, PUBLIC_TOOLS), url, configured: true, share }), share ? {} : { cache: "public, max-age=30" });
    return html(privatePage({ meta, origin, configured: configured(env), hasConnections: connected }));
  }

  // An experiment's page: the same access rule as a loop's page.
  if (path.startsWith("/exp/") && method === "GET" && (owner || viewer || published)) {
    const raw = path.slice("/exp/".length);
    const code = raw.toUpperCase();
    if (raw !== code) return redirect(`/exp/${code}${url.search}`);
    const sees = owner || Boolean(viewer);
    const share = /^EXP-\d+$/.test(code) ? await shareFor(request, env, url, "exp", code, shareCtx) : null;
    const page = /^EXP-\d+$/.test(code) ? expPage({ state, owner: sees, viewOnly: !owner && sees, code, url, share }) : null;
    if (!page) return messagePage({ meta, title: "Not found", text: `No experiment has the code ${code}.`, status: 404 });
    return html(page, sees || share ? {} : { cache: "public, max-age=30" });
  }

  // A loop's page: public once the log is published, with private fields and actions for the owner.
  if (path.startsWith("/loop/") && method === "GET" && (owner || viewer || published)) {
    const raw = path.slice("/loop/".length);
    const code = raw.toUpperCase();
    if (raw !== code) return redirect(`/loop/${code}${url.search}`);
    const sees = owner || Boolean(viewer);
    const events = sees
      ? (await getEvents(env.DB, { target: code, limit: 200 })).filter((e) => String(e.target || "").split(",").includes(code))
      : [];
    const share = await shareFor(request, env, url, "loop", code, shareCtx);
    const page = loopPage({ state, owner: sees, viewOnly: !owner && sees, code, events, connected: owner && (await hasConnections(env.DB)), url, share });
    if (!page) return messagePage({ meta, title: "Not found", text: `No loop has the code ${code}.`, status: 404 });
    return html(page, sees || share ? {} : { cache: "public, max-age=30" });
  }

  // Owner only from here.
  if (!owner) {
    if (method === "GET") return redirect(withQuery("/login", "next", path + url.search));
    return messagePage({ meta, title: "Sign in first", text: "Your session ended. Sign in and try again.", status: 401 });
  }

  if (path === "/connect" && method === "GET") return html(connectPage({ meta, origin }));
  if (path === "/connections" && method === "GET") return html(connectionsPage({ meta, agents: await listAgents(env.DB), url }));
  if (path === "/export" && method === "GET") {
    const snap = await snapshot(env);
    return new Response(JSON.stringify(snap, null, 2), {
      headers: {
        "Content-Type": "application/json",
        "Content-Disposition": `attachment; filename="onhundred-log-${snap.exportedAt.slice(0, 10)}.json"`,
        "Cache-Control": "no-store",
      },
    });
  }
  if (path === "/owner/action" && method === "POST") {
    if (!sameOrigin(request, url.origin)) return messagePage({ meta, title: "Blocked", text: "This form came from another site.", status: 403 });
    return ownerAction(request, env, meta);
  }
  return messagePage({ meta, title: "Not found", text: "This page doesn't exist.", status: 404 });
}

const OWNER_PAGE_OPS = {
  adopt_protocol: () => ({}),
  approve_loops: (f) => ({ codes: f.getAll("codes").map(String), retire: f.getAll("retire").map(String) }),
  approve_text: (f) => ({ targets: f.getAll("targets").map(String) }),
  reject_text: (f) => ({ targets: f.getAll("targets").map(String) }),
  approve_baseline: (f) => ({ code: String(f.get("code") || "") }),
  // The page publishes and saves the header (name, about line, links); every other setting changes through set_meta in an AI app.
  set_meta: (f, meta) => {
    const setting = f.get("setting");
    if (setting === "links") return { links: linksFromForm(f) };
    if (setting === "about") return { about: aboutFromForm(f, meta.languages || ["en"]) };
    if (setting === "name") return { ownerName: String(f.get("ownerName") || "") };
    return { publish: true };
  },
};

// One textarea per language of the log. All empty clears the line.
function aboutFromForm(f, languages) {
  const about = Object.fromEntries(languages.map((lang) => [lang, String(f.get(`about_${lang}`) || "").trim()]));
  return Object.values(about).some(Boolean) ? about : null;
}

// One field per kind, each a handle or an address. "none" saves an empty list: the person has no accounts
// to show, so nobody asks again. All fields empty clears the setting, so the reminder comes back.
function linksFromForm(f) {
  if (f.get("none")) return [];
  const links = Object.keys(PROFILE_LINKS)
    .map((kind) => ({ kind, url: normalizeLink(kind, f.get(`link_${kind}`)) }))
    .filter((l) => l.url);
  return links.length ? links : null;
}

function doneMessage(op, args) {
  if (op !== "set_meta") return "Saved.";
  if ("ownerName" in args) return "Your name is saved.";
  if ("about" in args) return args.about ? "Your line is saved." : "Your line is removed.";
  if (!("links" in args)) return "Your log is public.";
  if (args.links?.length) return "Your links are saved.";
  return args.links ? "Saved. Nobody will ask for your links again." : "Your links are removed.";
}

async function ownerAction(request, env, meta) {
  const form = await request.formData();
  const op = String(form.get("op") || "");

  if (op === "create_key") {
    const name = String(form.get("name") || "").trim();
    if (!name) return redirect(withQuery("/connections", "error", "A key needs a name."));
    const key = await createApiKey(env.DB, { name, access: form.get("access") === "owner" ? "owner" : "agent" });
    await logEvent(env.DB, { at: new Date().toISOString(), actor: OWNER_USER, tool: "create_api_key", target: key.id });
    return html(connectionsPage({ meta, agents: await listAgents(env.DB), url: new URL(request.url), newKey: key }));
  }

  if (op === "revoke") {
    const id = String(form.get("id") || "");
    const agent = (await listAgents(env.DB)).find((a) => a.id === id);
    if (!agent || !(await revokeAgent(env.DB, id))) return redirect(withQuery("/connections", "error", "No active connection has this id."));
    if (agent.kind === "oauth" && agent.client_id) {
      const grants = await env.OAUTH_PROVIDER.listUserGrants(OWNER_USER);
      for (const g of grants.items.filter((x) => x.clientId === agent.client_id)) await env.OAUTH_PROVIDER.revokeGrant(g.id, OWNER_USER);
    }
    await logEvent(env.DB, { at: new Date().toISOString(), actor: OWNER_USER, tool: "revoke_connection", target: id });
    return redirect(withQuery("/connections", "done", `${agent.name} is revoked.`));
  }

  // The copy buttons on a card: the first copy means the person has the link, so agents stop offering it.
  if (op === "card_copied") {
    const card = await getCard(env.DB, String(form.get("id") || ""));
    if (card && !card.copied_at) await updateCard(env.DB, card.id, { copied_at: new Date().toISOString() });
    return Response.json({ ok: Boolean(card) }, { status: card ? 200 : 404 });
  }

  if (op === "card_images") {
    const next = safeNext(String(form.get("next") || "/"));
    const card = await getCard(env.DB, String(form.get("id") || ""));
    if (!card || card.revoked_at || card.waiting) return redirect(addQuery(next, "error", "This card can't make images now."));
    await requestPostImages(env, card, meta.languages, new Date().toISOString());
    const on = await writer(env).queueShots(originOf(request, env));
    return redirect(addQuery(next, on ? "done" : "error", on ? "Images to post are on the way. Reload in a minute." : "Card images are off on this log (CARD_IMAGES or Browser Rendering)."));
  }

  if (!Object.hasOwn(OWNER_PAGE_OPS, op)) return redirect(withQuery("/", "error", "Unknown action."));
  const args = OWNER_PAGE_OPS[op](form, meta);
  const r = await writer(env).write({ op, args, actor: OWNER_USER, access: "owner", directText: true, origin: originOf(request, env) });
  const cardNote = r.cardsReady?.length || r.moment?.card?.status === "ready" ? " Your card is ready." : "";
  const done = (op === "adopt_protocol" && r.ok ? adoptedMessage(r.result) : doneMessage(op, args)) + cardNote;
  // app.js asks for JSON to approve a loop or save the header without leaving the page.
  if (request.headers.get("Accept")?.includes("application/json"))
    return Response.json(r.ok ? { ok: true, done } : { ok: false, error: r.error }, { status: r.ok ? 200 : 400 });
  if (!r.ok) return redirect(withQuery("/", "error", r.error));
  return redirect(withQuery("/", "done", done));
}

function adoptedMessage({ to, takesEffect, breaksNewRules }) {
  const when = takesEffect === "now" ? `Protocol v${to} is adopted.` : `Protocol v${to} takes effect ${takesEffect}.`;
  const n = breaksNewRules.length;
  return n ? `${when} ${n} ${n === 1 ? "item breaks" : "items break"} the new rules. They're listed under Waiting for you.` : when;
}

// ---------------------------------------------------------------------------
// Sign-in

async function login(request, env, url) {
  const meta = (await readState(env)).meta;
  const isConfigured = configured(env);
  if (request.method === "GET") return html(loginPage({ meta, next: safeNext(url.searchParams.get("next")), configured: isConfigured }));
  if (request.method !== "POST") return messagePage({ meta, title: "Not allowed", text: "Use the sign-in form.", status: 405 });
  if (!sameOrigin(request, url.origin)) return messagePage({ meta, title: "Blocked", text: "This form came from another site.", status: 403 });

  const form = await request.formData();
  const next = safeNext(String(form.get("next") || "/"));
  const ip = request.headers.get("CF-Connecting-IP") || "local";
  if (await loginLocked(env, ip))
    return html(loginPage({ meta, next, configured: isConfigured, error: "Too many wrong passwords. Wait 15 minutes and try again." }), { status: 429 });
  if (!(await checkPassword(env, String(form.get("password") || "")))) {
    await recordFailure(env, ip);
    return html(loginPage({ meta, next, configured: isConfigured, error: "Wrong password." }), { status: 401 });
  }
  return redirect(next, { "Set-Cookie": await sessionCookie(env) });
}

// OAuth consent: the owner signs in, sees which app asks, and allows or denies.
async function authorize(request, env, url) {
  const oauth = env.OAUTH_PROVIDER;
  const meta = (await readState(env)).meta;
  if (!(await isOwner(request, env))) {
    if (request.method === "GET") return redirect(withQuery("/login", "next", url.pathname + url.search));
    return messagePage({ meta, title: "Sign in first", text: "Your session ended. Start the connection again from your app.", status: 401 });
  }

  if (request.method === "GET") {
    const authRequest = await oauth.parseAuthRequest(request);
    const details = await oauth.describeConsent(authRequest);
    const consent = await oauth.beginConsent(authRequest);
    return html(consentPage({ meta, details, handle: consent.handle }), { headers: consent.headers, formAction: false });
  }

  if (request.method !== "POST") return messagePage({ meta, title: "Not allowed", text: "Use the consent form.", status: 405 });
  const form = await request.formData();
  const handle = String(form.get("handle") || "");
  if (form.get("decision") !== "approve") {
    const denied = await oauth.denyConsent(request, handle);
    return new Response(null, { status: 302, headers: denied.headers });
  }
  const approved = await oauth.approveConsent(request, handle);
  const client = await oauth.lookupClient(approved.request.clientId);
  const agent = await recordOAuthAgent(env.DB, { clientId: approved.request.clientId, clientName: client?.clientName });
  const scope = approved.request.scope.length ? approved.request.scope : ["mcp"];
  const { redirectTo } = await oauth.completeAuthorization({
    request: approved.request,
    userId: OWNER_USER,
    metadata: { agentId: agent.agentId, name: agent.name },
    scope,
    props: agent,
  });
  await logEvent(env.DB, { at: new Date().toISOString(), actor: OWNER_USER, tool: "connect", target: agent.agentId });
  approved.headers.set("Location", redirectTo);
  return new Response(null, { status: 302, headers: approved.headers });
}
