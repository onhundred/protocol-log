// Share cards: made by the writer from a moment, kept outside the log's history, and drawn as screenshots
// of a card-only page. The agent never writes on a card: facts come from publicView() and headlines from protocol.json.
import { cardFacts, protocol as P } from "../lib/protocol.mjs";
import { renderToken } from "./auth.mjs";
import { cardId, getCard, listCards, logEvent, saveCard, updateCard } from "./store.mjs";

export const SIZES = { og: [1200, 630], square: [1080, 1080], tall: [1080, 1920] };
export const POST_SIZES = ["square", "tall"];
export const READY_DAYS = 14;
export const REMAKES_PER_DAY = 3;
const DAY = 86400000;

export const cardPath = (card) => (card.page === "loop" ? `/loop/${card.target}` : card.page === "exp" ? `/exp/${card.target}` : "/");

// One link per language. A published log opens the real page with ?c=; a private one opens /c/:id.
export function cardUrls(origin, card, { published, languages }) {
  const base = published ? `${origin}${cardPath(card)}?c=${card.id}` : `${origin}/c/${card.id}`;
  const sep = base.includes("?") ? "&" : "?";
  return Object.fromEntries(languages.map((lang) => [lang, languages.length > 1 ? `${base}${sep}lang=${lang}` : base]));
}

export const imageUrl = (origin, card, size, lang, languages) =>
  `${origin}/c/${card.id}/${size}.png${languages.length > 1 ? `?lang=${lang}` : ""}`;

// Square and tall images exist only after someone asks for them: available, queued, then ready.
export function postImages(card, languages) {
  const all = languages.flatMap((l) => POST_SIZES.map((s) => card.images?.[l]?.[s]));
  if (all.every((s) => s === "ready")) return "ready";
  return all.some(Boolean) ? "queued" : "available";
}

export function queueSizes(images, languages, sizes) {
  const out = structuredClone(images || {});
  for (const lang of languages) {
    out[lang] = out[lang] || {};
    for (const s of sizes) out[lang][s] = "queued";
  }
  return out;
}

const status = (card) => (card.revoked_at ? "takenDown" : card.waiting ? "waiting" : "ready");

// What tools, get_state and pages say about a card.
export function cardSummary(card, { origin, published, languages }) {
  const s = status(card);
  const post = postImages(card, languages);
  const out = { id: card.id, moment: card.moment, kind: card.kind, status: s, createdAt: card.created_at };
  if (s === "waiting") return { ...out, waiting: card.waiting, note: "Approve this text and the card is ready." };
  if (s === "takenDown") return { ...out, takenDownAt: card.revoked_at };
  const urls = cardUrls(origin, card, { published, languages });
  return {
    ...out,
    url: urls[languages[0]],
    urls,
    views: card.views || 0,
    copied: Boolean(card.copied_at),
    postImages: post,
    ...(post === "ready"
      ? { images: Object.fromEntries(languages.map((l) => [l, Object.fromEntries(POST_SIZES.map((s) => [s, imageUrl(origin, card, s, l, languages)]))])) }
      : {}),
  };
}

// The writer calls this with the top moment of a write. Returns the card, or { none } when no card may be made.
export async function createCard(env, moment, state, eventId, now) {
  const r = cardFacts(state, moment.moment, moment.target);
  if (r.none) return { none: r.none };
  const languages = state.meta.languages;
  const card = {
    id: cardId(),
    kind: moment.kind,
    moment: moment.moment,
    page: moment.page,
    target: moment.target,
    facts: r.facts || { moment: moment.moment },
    headline: 0,
    event_id: eventId,
    waiting: r.waiting || null,
    created_at: now,
    ready_at: r.waiting ? null : now,
    images: r.waiting ? {} : queueSizes({}, languages, ["og"]),
  };
  await saveCard(env.DB, card);
  await logEvent(env.DB, { at: now, actor: "system", tool: "card_created", target: card.id, args: JSON.stringify({ moment: card.moment, event: eventId }) });
  return { card: { ...card, views: 0 } };
}

// After text is approved, waiting cards whose text is now public get their link and their preview image.
export async function releaseWaiting(env, state, now) {
  const ready = [];
  for (const card of await listCards(env.DB, { waiting: true })) {
    const r = cardFacts(state, card.moment, card.target);
    if (r.waiting) continue;
    if (r.none) {
      await updateCard(env.DB, card.id, { waiting: null, revoked_at: now });
      continue;
    }
    const fields = { waiting: null, facts: r.facts, ready_at: now, images: queueSizes(card.images, state.meta.languages, ["og"]) };
    await updateCard(env.DB, card.id, fields);
    ready.push({ ...card, ...fields });
  }
  return ready;
}

export async function takeDown(env, card, now = new Date().toISOString()) {
  if (!card.revoked_at) await updateCard(env.DB, card.id, { revoked_at: now });
  const listed = await env.BACKUPS.list({ prefix: `cards/${card.id}/` });
  if (listed.objects.length) await env.BACKUPS.delete(listed.objects.map((o) => o.key));
  return { ...card, revoked_at: card.revoked_at || now };
}

// Remakes rebuild the card from today's public facts with 1 of the prewritten headlines. Same id, same link.
export async function remakeCard(env, card, state, headline, now) {
  const today = now.slice(0, 10);
  const used = card.remakes?.day === today ? card.remakes.n : 0;
  if (used >= REMAKES_PER_DAY) throw new Error(`this card was remade ${REMAKES_PER_DAY} times today. Try again tomorrow.`);
  const r = cardFacts(state, card.moment, card.target);
  if (r.none) throw new Error(`this card can't be remade: ${r.none}.`);
  if (r.waiting) throw new Error(`this card waits for ${r.waiting.join(" and ")} to be approved.`);
  const languages = state.meta.languages;
  const sizes = ["og", ...POST_SIZES.filter((s) => languages.some((l) => card.images?.[l]?.[s]))];
  const fields = { facts: r.facts, headline, remakes: { day: today, n: used + 1 }, images: queueSizes(card.images, languages, sizes) };
  await updateCard(env.DB, card.id, fields);
  return { ...card, ...fields };
}

export async function requestPostImages(env, card, languages, now) {
  if (postImages(card, languages) !== "available") return card;
  const fields = { images: queueSizes(card.images, languages, POST_SIZES), images_at: now };
  await updateCard(env.DB, card.id, fields);
  return { ...card, ...fields };
}

// Cards with a link nobody copied yet, from the last 2 weeks: the agent offers them next time.
export async function readyCards(db, now = Date.now()) {
  const since = new Date(now - READY_DAYS * DAY).toISOString();
  return (await listCards(db, { limit: 20 })).filter((c) => c.ready_at && c.ready_at >= since && !c.copied_at && !c.revoked_at);
}

export const cardKey = (id, lang, size) => `cards/${id}/${lang}/${size}.png`;

// One screenshot per call, never during a visitor's request. A failure leaves the image queued for the next run.
export async function shootOne(env, origin, take = screenshot) {
  const [card] = await listCards(env.DB, { queued: true, limit: 1 });
  if (!card) return false;
  const pairs = Object.entries(card.images).flatMap(([lang, sizes]) => Object.entries(sizes).filter(([, s]) => s === "queued").map(([size]) => [lang, size]));
  const [lang, size] = pairs.find(([, s]) => s === "og") || pairs[0];
  const url = `${origin}/c/${card.id}/render?size=${size}&lang=${lang}&t=${encodeURIComponent(await renderToken(env, card.id))}`;
  let png;
  try {
    png = await take(env, url, SIZES[size]);
  } catch (err) {
    console.log("card screenshot failed", card.id, size, err?.message);
    return false;
  }
  await env.BACKUPS.put(cardKey(card.id, lang, size), png, { httpMetadata: { contentType: "image/png" } });
  const fresh = await getCard(env.DB, card.id);
  if (!fresh || fresh.revoked_at) {
    await env.BACKUPS.delete(cardKey(card.id, lang, size));
    return true;
  }
  const images = structuredClone(fresh.images);
  images[lang] = { ...images[lang], [size]: "ready" };
  await updateCard(env.DB, card.id, { images });
  return true;
}

export const imagesQueued = async (db) => (await listCards(db, { queued: true, limit: 1 })).length > 0;

export async function screenshot(env, url, [width, height]) {
  const { default: puppeteer } = await import("@cloudflare/puppeteer");
  const browser = await puppeteer.launch(env.BROWSER);
  try {
    const page = await browser.newPage();
    await page.setViewport({ width, height });
    await page.goto(url, { waitUntil: "networkidle0" });
    await page.evaluate(() => document.fonts.ready);
    return await page.screenshot({ type: "png" });
  } finally {
    await browser.close();
  }
}

export const screenshotsOn = (env) => Boolean(env.BROWSER) && env.CARD_IMAGES !== "off";

export const HEADLINES = P.cards.headlines;
