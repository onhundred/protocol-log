// Server-rendered pages. Dark first. Every value that came from a client or an agent is escaped.
import {
  ABOUT_MAX_WORDS,
  LEVELS,
  MAX_LINKS,
  PROFILE_LINKS,
  assistedWeight,
  ceilingOf,
  changeIsCurrent,
  compareVersions,
  derive,
  esc,
  estimateCanStart,
  isFallback,
  isHardEligible,
  isMeasured,
  levelName,
  listSize,
  logVersion,
  parseCode,
  pendingRuleBreaks,
  pickText,
  progressStep,
  protocol as P,
  publicActivity,
  publicView,
  renderGrid,
  triageGroup,
  triageScore,
  validate,
} from "../lib/protocol.mjs";
import { VIEW_HOURS } from "./auth.mjs";
import { UI_LANGUAGES, ruleText, t } from "./i18n.mjs";
import { pendingItems } from "./ops.mjs";
import { PROMPTS } from "./mcp.mjs";

// The language of the page being drawn. Pages render synchronously from start to end, so it can live here:
// every exported page sets it first with usePage(), and no other page renders in between.
let LANG = "en";
let MAIN = "en";
let TAGS = false;
function usePage(meta, lang, { tags = false } = {}) {
  const langs = meta?.languages?.length ? meta.languages : UI_LANGUAGES;
  MAIN = meta?.languages?.[0] || "en";
  LANG = langs.includes(lang) ? lang : MAIN;
  TAGS = tags;
}
const w = (key, ...args) => t(LANG, key, ...args);
const txt = (value) => pickText(value, LANG, MAIN);
const langName = (l) => w("languageNames")[l] || l.toUpperCase();

// Escaped text in the page's language. On the owner's pages, text not written in it yet carries the code of the language it shows in.
function shown(value) {
  const out = esc(txt(value));
  if (!TAGS || !isFallback(value, LANG)) return out;
  const from = [MAIN, ...Object.keys(value)].find((l) => typeof value[l] === "string" && value[l].trim());
  return `${out} <span class="lang-tag" title="${esc(w("untranslated", langName(LANG)))}">${esc(from.toUpperCase())}</span>`;
}

const lvName = (l) => levelName(l, LANG);
const levelLabel = (l) => (l === "empty" ? w("levels.empty") : lvName(l).toUpperCase());
const levelNote = (l) => w(`levels.notes.${l}`);
const branchName = (b) => w("branches")[b] || P.branches[b]?.name || b;
const areaLabel = (areaCode) => w("areas")[areaCode] || P.branches[areaCode[0]]?.areas[areaCode.slice(2)] || areaCode;
// A rule a text breaks, without its "TARGET: " prefix.
const ruleWords = (v) => ruleText(LANG, v.message.slice(v.target.length + 2));
const gridTip = () => ({
  levels: Object.fromEntries(["empty", ...LEVELS].map((l) => [l, levelLabel(l)])),
  measured: w("grid.measured"),
  flags: w("grid.flags"),
  outcomes: w("grid.outcomes"),
  open: w("grid.open"),
  areaWords: w("grid.areaWords"),
});

const CSP_BASE = "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; base-uri 'none'; frame-ancestors 'none'";

export function html(body, { status = 200, headers = {}, cache = "no-store", formAction = true } = {}) {
  const h = new Headers(headers);
  h.set("Content-Type", "text/html; charset=utf-8");
  if (!h.has("Cache-Control")) h.set("Cache-Control", cache);
  h.set("Content-Security-Policy", CSP_BASE + (formAction ? "; form-action 'self'" : ""));
  h.set("X-Content-Type-Options", "nosniff");
  h.set("Referrer-Policy", "same-origin");
  return new Response(body, { status, headers: h });
}

const CREDIT = P.attribution;

// The version the log runs, not the one in this code. Until the next check-in after an adoption, it opens the change note.
// A <details> can't sit inside a link, so then only the wordmark links home.
function brand(meta) {
  const mark = `<img src="/wordmark.svg" alt="Onhundred" width="68" height="9">`;
  const tag = w("protocol.tag", esc(logVersion(meta)));
  const who = meta?.ownerName ? ` · ${esc(meta.ownerName.toUpperCase())}` : "";
  const change = meta?.protocolChange;
  if (!changeIsCurrent(change, new Date().toISOString().slice(0, 10))) return `<a class="brand" href="/">${mark}<span>${tag}${who}</span></a>`;
  return `<div class="brand"><a href="/">${mark}</a><span><details class="note term version-note" data-menu><summary>${tag}</summary><span class="note-pop" role="note">${esc(changeNote(change))}</span></details>${who}</span></div>`;
}

// signedIn without owner: the owner previewing the visitor's page. The body is the visitor's; the nav still knows who's here.
// ogImage, ogTitle and ogDescription replace the link preview: a shared card swaps in its own image and headline.
// url: the page's address, so the language switch keeps the rest of it.
function layout({ title, meta, owner = false, signedIn = owner, body, current = "", origin = "", url = null, description: about = "", ogImage = "", ogTitle = "", ogDescription = "" }) {
  const ownerName = meta?.ownerName;
  const link = (href, label) => `<a href="${href}"${current === href ? ' aria-current="page"' : ""}>${label}</a>`;
  const description = about || w("site.description", ownerName, CREDIT.text);
  const image = ogImage || `${origin}/og.png`;
  const signOut = `<form method="post" action="/logout"><button type="submit" class="linkish">${w("nav.signOut")}</button></form>`;
  const langs = langSwitch(meta, url);
  const nav = owner
    ? `<nav class="nav">${langs}${link("/", w("nav.log"))}${link("/connections", w("nav.connections"))}<a href="/export" data-export-open>${w("nav.export")}</a>${signOut}</nav>`
    : signedIn
      ? `<nav class="nav">${langs}<a href="/">${w("nav.back")}</a>${signOut}</nav>`
      : `<nav class="nav">${langs}<a href="/login">${w("nav.signIn")}</a></nav>`;
  return `<!doctype html>
<html lang="${esc(LANG)}" class="dark">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="color-scheme" content="dark">
<meta name="robots" content="noindex">
<title>${esc(title)}</title>
<meta name="description" content="${esc(description)}">
<meta property="og:type" content="website">
<meta property="og:site_name" content="Onhundred Protocol">
<meta property="og:title" content="${esc(ogTitle || title)}">
<meta property="og:description" content="${esc(ogDescription || description)}">
<meta property="og:image" content="${esc(image)}">
<meta property="og:image:width" content="1200">
<meta property="og:image:height" content="630">
<meta property="og:image:alt" content="${esc(ogTitle || "Onhundred")}">
<meta name="twitter:card" content="summary_large_image">
<link rel="icon" href="/favicon.ico" sizes="48x48">
<link rel="icon" href="/favicon.svg" type="image/svg+xml">
<link rel="apple-touch-icon" href="/apple-touch-icon.png">
<link rel="stylesheet" href="/app.css">
<script src="/app.js" defer></script>
</head>
<body data-words="${esc(JSON.stringify(w("app")))}">
<header class="top">
${brand(meta)}
${nav}
</header>
<main>
${body}
</main>
${owner ? exportDialog() : ""}
<footer class="foot"><a class="foot-mark" href="${esc(CREDIT.url)}" rel="noopener" aria-label="Onhundred"><img src="/on100.svg" alt="" width="32" height="32"></a><span>${w("site.follows", `<a href="${esc(CREDIT.url)}" rel="noopener">${esc(CREDIT.text)}</a>`, `<a href="https://4geeks.com" rel="noopener">4Geeks.com</a>`, esc(P.version))}${owner ? w("site.dataLives") : ""}</span></footer>
</body>
</html>`;
}

// ES | EN, only on a log with more than one language. Each link keeps the page and its query, minus one-time notes.
function langSwitch(meta, url) {
  const langs = meta?.languages || [];
  if (langs.length < 2) return "";
  const href = (l) => {
    const q = new URLSearchParams(url?.search || "");
    for (const k of ["lang", "done", "error"]) q.delete(k);
    q.set("lang", l);
    return `?${q}`;
  };
  const items = langs.map((l) =>
    l === LANG
      ? `<span aria-current="true" lang="${esc(l)}">${esc(l.toUpperCase())}</span>`
      : `<a href="${esc(href(l))}" lang="${esc(l)}" title="${esc(t(l, "languageNames")[l] || l)}">${esc(l.toUpperCase())}</a>`
  );
  return `<span class="lang-switch" role="group" aria-label="${esc(w("switchLabel"))}">${items.join("")}</span>`;
}

// The EXPORT link downloads directly without JavaScript; with it, this dialog explains the file first.
const exportDialog = () => `<dialog class="modal" data-export-dialog aria-labelledby="export-title">
<form method="get" action="/export">
<h3 id="export-title">${w("exportDialog.title")}</h3>
<p class="modal-loop">${w("exportDialog.file", `onhundred-log-${new Date().toISOString().slice(0, 10)}.json`)}</p>
<p>${w("exportDialog.contains")}</p>
<ul class="modal-list">
${w("exportDialog.items").map((i) => `<li>${i}</li>`).join("\n")}
</ul>
<p>${w("exportDialog.private")}</p>
<p class="muted">${w("exportDialog.leaves")}</p>
<div class="actions"><button class="btn signal" type="submit">${w("exportDialog.download")}</button><button class="btn" type="button" data-export-cancel>${w("common.cancel")}</button></div>
</form>
</dialog>`;

const notice = (text, kind = "") => `<p class="notice${kind ? " " + kind : ""}">${text}</p>`;

// Saves confirm in a toast that leaves on its own; errors stay in the page until the person acts on them.
const toast = (text) =>
  `<div class="toast" role="status" aria-live="polite" data-toast>${CHECK_CIRCLE_ICON}<span>${text}</span><button class="notice-close" type="button" data-dismiss aria-label="${w("common.closeAria")}">${CLOSE_ICON}</button></div>`;

function flash(url) {
  const done = url.searchParams.get("done");
  const error = url.searchParams.get("error");
  if (error) return notice(esc(error), "bad");
  if (done) return toast(esc(done));
  return "";
}

// ---------------------------------------------------------------------------
// Log page

// What each version between the log's and the code's changes, in one line: "assisted counts half".
const changesSince = (from, to = P.version) =>
  Object.entries(P.changes || {})
    .filter(([v]) => compareVersions(v, from) > 0 && compareVersions(v, to) <= 0)
    .map(([v, words]) => `v${v}: ${words[LANG] || words.en}`)
    .join("; ");

function protocolNotice(meta, upgrade) {
  const u = meta.protocolUpgrade;
  if (u)
    return notice(w("protocol.adoptedWaits", esc(u.version), esc(u.fromCycle - 1), esc(meta.protocolVersion)));
  if (!upgrade) return "";
  const running = meta.mode === "frozen" && meta.cycle >= 1;
  const when = running ? w("protocol.afterCheckIn", meta.cycle) : w("protocol.now");
  const what = changesSince(meta.protocolVersion);
  return `<form method="post" action="/owner/action" class="notice upgrade"><input type="hidden" name="op" value="adopt_protocol"><span>${w("protocol.upgrade", esc(P.version), esc(meta.protocolVersion), esc(what), when)}</span><button class="btn signal small" type="submit">${w("protocol.adopt", esc(P.version))}</button></form>`;
}

const shortDate = (day) =>
  new Date(`${day}T00:00:00Z`).toLocaleDateString(LANG === "en" ? "en-US" : LANG, { month: "short", day: "numeric", timeZone: "UTC" }).replace(".", "");

// Until the next check-in after an adoption: what changed, and the handed-off figure under both versions with the same loops.
export function changeNote(change) {
  const what = Object.entries(P.changes || {})
    .filter(([v]) => compareVersions(v, change.from) > 0 && compareVersions(v, change.to) <= 0)
    .map(([, words]) => words[LANG] || words.en)
    .join("; ");
  const head = w("protocol.adoptedOn", shortDate(change.at), what);
  if (change.delegatedBefore === change.delegatedAfter) return head;
  return head + w("protocol.handedOffMoved", change.delegatedBefore, change.delegatedAfter);
}

// Empty squares pad each branch toward its share of the 100, so the grid always shows what's left to fill.
// A branch past its share takes squares from the others: the total never exceeds 100.
// A list of 10 holds the loops that take the most hours, from any area, so its empty squares belong to none: null.
const per = Math.floor(P.limits.loops / P.branchOrder.length);
const SHARES = Object.fromEntries(
  P.branchOrder.map((b, i) => [b, i === P.branchOrder.length - 1 ? P.limits.loops - per * i : per])
);
function emptySlots(loops, size = P.limits.loops) {
  if (size < P.limits.loops) return null;
  let free = P.limits.loops - loops.length;
  return Object.fromEntries(
    P.branchOrder.map((b) => {
      const n = loops.filter((l) => l.code.startsWith(b + "-")).length;
      const pad = Math.max(0, Math.min(SHARES[b] - n, free));
      free -= pad;
      return [b, n + pad];
    })
  );
}

const drawGrid = (view, meta, opts = {}) =>
  renderGrid(
    { ...view, meta: { ...view.meta, grid: meta.grid } },
    {
      lang: LANG,
      main: MAIN,
      metric: "delegated",
      labels: { areas: w("grid.areas"), private: w("grid.private"), empty: w("grid.empty") },
      slots: emptySlots(view.loops, listSize(meta)) || {},
      size: listSize(meta),
      ...opts,
    }
  );

// The check-in closes the last day of each 2-week period.
function nextCheckIn(day) {
  const left = P.limits.cycleWeeks * 7 - (Number(day) || 1);
  if (left <= 0) return w("checkIn.today");
  return left === 1 ? w("checkIn.tomorrow") : w("checkIn.inDays", left);
}

// Profile and share icons from Phosphor (MIT license), bold weight. Bluesky uses the butterfly.
const LINK_ICONS = {
  x:
    "M218.12,209.56l-61-95.8,59.72-65.69a12,12,0,0,0-17.76-16.14L143.81,92.77,106.12,33.56A12,12,0,0,0,96,28H48A12,12,0,0,0,37.88,46.44l61,95.8L39.12,207.93a12,12,0,1,0,17.76,16.14l55.31-60.84,37.69,59.21A12,12,0,0,0,160,228h48a12,12,0,0,0,10.12-18.44ZM166.59,204,69.86,52H89.41l96.73,152Z",
  linkedin:
    "M216,20H40A20,20,0,0,0,20,40V216a20,20,0,0,0,20,20H216a20,20,0,0,0,20-20V40A20,20,0,0,0,216,20Zm-4,192H44V44H212ZM112,176V120a12,12,0,0,1,21.43-7.41A40,40,0,0,1,192,148v28a12,12,0,0,1-24,0V148a16,16,0,0,0-32,0v28a12,12,0,0,1-24,0ZM96,120v56a12,12,0,0,1-24,0V120a12,12,0,0,1,24,0ZM68,80A16,16,0,1,1,84,96,16,16,0,0,1,68,80Z",
  github:
    "M212.62,75.17A63.7,63.7,0,0,0,206.39,26,12,12,0,0,0,196,20a63.71,63.71,0,0,0-50,24H126A63.71,63.71,0,0,0,76,20a12,12,0,0,0-10.39,6,63.7,63.7,0,0,0-6.23,49.17A61.5,61.5,0,0,0,52,104v8a60.1,60.1,0,0,0,45.76,58.28A43.66,43.66,0,0,0,92,192v4H76a20,20,0,0,1-20-20,44.05,44.05,0,0,0-44-44,12,12,0,0,0,0,24,20,20,0,0,1,20,20,44.05,44.05,0,0,0,44,44H92v12a12,12,0,0,0,24,0V192a20,20,0,0,1,40,0v40a12,12,0,0,0,24,0V192a43.66,43.66,0,0,0-5.76-21.72A60.1,60.1,0,0,0,220,112v-8A61.5,61.5,0,0,0,212.62,75.17ZM196,112a36,36,0,0,1-36,36H112a36,36,0,0,1-36-36v-8a37.87,37.87,0,0,1,6.13-20.12,11.65,11.65,0,0,0,1.58-11.49,39.9,39.9,0,0,1-.4-27.72,39.87,39.87,0,0,1,26.41,17.8A12,12,0,0,0,119.82,68h32.35a12,12,0,0,0,10.11-5.53,39.84,39.84,0,0,1,26.41-17.8,39.9,39.9,0,0,1-.4,27.72,12,12,0,0,0,1.61,11.53A37.85,37.85,0,0,1,196,104Z",
  instagram:
    "M128,80a48,48,0,1,0,48,48A48.05,48.05,0,0,0,128,80Zm0,72a24,24,0,1,1,24-24A24,24,0,0,1,128,152ZM176,20H80A60.07,60.07,0,0,0,20,80v96a60.07,60.07,0,0,0,60,60h96a60.07,60.07,0,0,0,60-60V80A60.07,60.07,0,0,0,176,20Zm36,156a36,36,0,0,1-36,36H80a36,36,0,0,1-36-36V80A36,36,0,0,1,80,44h96a36,36,0,0,1,36,36ZM196,76a16,16,0,1,1-16-16A16,16,0,0,1,196,76Z",
  youtube:
    "M170.49,117.91l-56-36A12,12,0,0,0,96,92v72a12,12,0,0,0,18.49,10.09l56-36a12,12,0,0,0,0-20.18ZM120,142V114l21.81,14Zm118.21-73.5a28.05,28.05,0,0,0-16.93-19.14C186.4,35.91,131.29,36,128,36s-58.4-.09-93.28,13.38A28.05,28.05,0,0,0,17.79,68.52C15.15,78.72,12,97.32,12,128s3.15,49.28,5.79,59.48a28.05,28.05,0,0,0,16.93,19.14C68.21,219.55,120.36,220,127.37,220h1.26c7,0,59.16-.45,92.65-13.38a28.05,28.05,0,0,0,16.93-19.14c2.64-10.2,5.79-28.8,5.79-59.48S240.85,78.72,238.21,68.52ZM215,181.46a4,4,0,0,1-2.34,2.77C182.78,195.76,132.27,196,128.32,196h-.39c-.53,0-53.64.17-84.56-11.77A4,4,0,0,1,41,181.46c-1.88-7.24-5-23.82-5-53.46s3.15-46.22,5-53.46a4,4,0,0,1,2.34-2.77C74.29,59.83,127.39,60,127.92,60h.15c.54,0,53.64-.17,84.56,11.77A4,4,0,0,1,215,74.54c1.88,7.24,5,23.82,5,53.46S216.85,174.22,215,181.46Z",
  tiktok:
    "M224,68a44.05,44.05,0,0,1-44-44,12,12,0,0,0-12-12H128a12,12,0,0,0-12,12V156a16,16,0,1,1-22.85-14.47A12,12,0,0,0,100,130.69V88A12,12,0,0,0,85.9,76.19a79.35,79.35,0,0,0-47.08,27.74A81.84,81.84,0,0,0,20,156a80,80,0,0,0,160,0V122.67A107.47,107.47,0,0,0,224,132a12,12,0,0,0,12-12V80A12,12,0,0,0,224,68Zm-12,39.15a83.05,83.05,0,0,1-37-14.91A12,12,0,0,0,156,102v54a56,56,0,0,1-112,0,57.86,57.86,0,0,1,32-51.56V124a40,40,0,1,0,64,32V36h17.06A68.21,68.21,0,0,0,212,90.94Z",
  threads:
    "M188.84,120.46a68.14,68.14,0,0,0-10-6.23c-3.72-21.68-16.41-37.41-35.52-43.2C121.94,64.55,97.29,72.42,86,89.34a12,12,0,0,0,20,13.32c5.47-8.2,19.11-12.08,30.41-8.66a24.72,24.72,0,0,1,14.88,12.24,86.73,86.73,0,0,0-8.86-.45C108.56,105.79,84,125.22,84,152c0,22.9,17.54,39.52,41.71,39.52a52,52,0,0,0,37.23-16c6-6.23,12.88-16.46,15.72-32.07,6.2,6.42,9.34,14.67,9.34,24.59,0,17.74-19.07,44-60,44-45.76,0-68-27.48-68-84s22.24-84,68-84c31.08,0,51,12.42,60.8,38a12,12,0,0,0,22.4-8.62C197.77,38.44,169,20,128,20,68.67,20,36,58.35,36,128s32.67,108,92,108c31.36,0,51.08-12.05,62.11-22.15C203.81,201.28,212,184.14,212,168,212,148.36,204,131.92,188.84,120.46Zm-43.2,38.39a27.9,27.9,0,0,1-19.93,8.67c-8.17,0-17.71-4.06-17.71-15.52,0-15.26,17.84-22.21,34.41-22.21a60.23,60.23,0,0,1,13.51,1.52C155.36,142.93,151.84,152.41,145.64,158.85Z",
  bluesky:
    "M235.79,48c-4.27-5.48-12.4-12-26.88-12-17.86,0-40.5,11.7-60.57,31.3-3,2.89-5.74,5.85-8.34,8.84V56a12,12,0,0,0-24,0V76.14c-2.6-3-5.38-6-8.34-8.84C87.59,47.7,65,36,47.09,36c-14.48,0-22.61,6.54-26.88,12C7,65,12,93.91,19.28,122.66c5.75,22.64,17.8,33,28.88,37.69A48.12,48.12,0,0,0,92,228a47.87,47.87,0,0,0,36-16.28A48,48,0,0,0,212,180a48.51,48.51,0,0,0-4.14-19.65c11.08-4.67,23.13-15,28.88-37.69C244,93.91,249,65,235.79,48ZM92,204a24,24,0,0,1-24-24,24.36,24.36,0,0,1,21.31-24.07,12,12,0,0,0-2.64-23.86A47.63,47.63,0,0,0,65.17,140c-8.19-.29-18-4.92-22.63-23.24-7.41-29.18-8.55-47.35-3.39-54C39.74,62,41.3,60,47.09,60,58.3,60,75.91,69.83,90.9,84.47c15.25,14.9,25.1,31.86,25.1,43.2V180A24,24,0,0,1,92,204Zm121.45-87.25C208.81,135.07,199,139.7,190.82,140a47.54,47.54,0,0,0-21.51-7.92,12,12,0,1,0-2.64,23.86A24.36,24.36,0,0,1,188,180a24,24,0,1,1-48,0V127.67c0-11.34,9.85-28.3,25.1-43.2C180.09,69.83,197.7,60,208.91,60c5.79,0,7.35,2,7.94,2.76C222,69.4,220.87,87.57,213.46,116.75Z",
  mastodon:
    "M184,28H72A44.05,44.05,0,0,0,28,72V192a44.05,44.05,0,0,0,44,44h88a12,12,0,0,0,0-24H72a20,20,0,0,1-20-20v-4H184a44.05,44.05,0,0,0,44-44V72A44.05,44.05,0,0,0,184,28Zm20,116a20,20,0,0,1-20,20H52V72A20,20,0,0,1,72,52H184a20,20,0,0,1,20,20Zm-16-40v32a12,12,0,0,1-24,0V104a12,12,0,0,0-24,0v32a12,12,0,0,1-24,0V104a12,12,0,0,0-24,0v32a12,12,0,0,1-24,0V104a36,36,0,0,1,60-26.8A36,36,0,0,1,188,104Z",
  website:
    "M128,20A108,108,0,1,0,236,128,108.12,108.12,0,0,0,128,20Zm0,187a113.4,113.4,0,0,1-20.39-35h40.82a116.94,116.94,0,0,1-10,20.77A108.61,108.61,0,0,1,128,207Zm-26.49-59a135.42,135.42,0,0,1,0-40h53a135.42,135.42,0,0,1,0,40ZM44,128a83.49,83.49,0,0,1,2.43-20H77.25a160.63,160.63,0,0,0,0,40H46.43A83.49,83.49,0,0,1,44,128Zm84-79a113.4,113.4,0,0,1,20.39,35H107.59a116.94,116.94,0,0,1,10-20.77A108.61,108.61,0,0,1,128,49Zm50.73,59h30.82a83.52,83.52,0,0,1,0,40H178.75a160.63,160.63,0,0,0,0-40Zm20.77-24H173.71a140.82,140.82,0,0,0-15.5-34.36A84.51,84.51,0,0,1,199.52,84ZM97.79,49.64A140.82,140.82,0,0,0,82.29,84H56.48A84.51,84.51,0,0,1,97.79,49.64ZM56.48,172H82.29a140.82,140.82,0,0,0,15.5,34.36A84.51,84.51,0,0,1,56.48,172Zm101.73,34.36A140.82,140.82,0,0,0,173.71,172h25.81A84.51,84.51,0,0,1,158.21,206.36Z",
  whatsapp:
    "M187.3,159.06A36.09,36.09,0,0,1,152,188a84.09,84.09,0,0,1-84-84A36.09,36.09,0,0,1,96.94,68.7,12,12,0,0,1,110,75.1l11.48,23a12,12,0,0,1-.75,12l-8.52,12.78a44.56,44.56,0,0,0,20.91,20.91l12.78-8.52a12,12,0,0,1,12-.75l23,11.48A12,12,0,0,1,187.3,159.06ZM236,128A108,108,0,0,1,78.77,224.15L46.34,235A20,20,0,0,1,21,209.66l10.81-32.43A108,108,0,1,1,236,128Zm-24,0A84,84,0,1,0,55.27,170.06a12,12,0,0,1,1,9.81l-9.93,29.79,29.79-9.93a12.1,12.1,0,0,1,3.8-.62,12,12,0,0,1,6,1.62A84,84,0,0,0,212,128Z",
};
const linkIcon = (kind) => phosphor(LINK_ICONS[kind] || LINK_ICONS.website);

// What a visitor's post says. Third person, because whoever shares it is rarely the owner.
const shareText = (meta, points) => w("share.text", meta.ownerName || "", points, listSize(meta));

const SHARE_TO = [
  { id: "x", name: "X", href: (t, u) => `https://x.com/intent/post?text=${t}&url=${u}` },
  { id: "linkedin", name: "LinkedIn", href: (_t, u) => `https://www.linkedin.com/sharing/share-offsite/?url=${u}` },
  { id: "bluesky", name: "Bluesky", href: (t, u) => `https://bsky.app/intent/compose?text=${t}%20${u}` },
  { id: "whatsapp", name: "WhatsApp", href: (t, u) => `https://wa.me/?text=${t}%20${u}` },
];

function shareMenu(meta, points, origin) {
  const url = `${origin}/`;
  const t = encodeURIComponent(shareText(meta, points));
  const u = encodeURIComponent(url);
  const items = SHARE_TO.map(
    (s) =>
      `<a class="menu-item" href="${esc(s.href(t, u))}" target="_blank" rel="noopener" aria-label="${esc(w("share.on", s.name))}">${linkIcon(s.id)}${s.name.toUpperCase()}</a>`
  ).join("");
  return `<details class="menu share" data-menu><summary class="btn small signal">${w("share.progress")}${CARET_ICON}</summary><div class="menu-list">${items}<input type="hidden" id="share-url" value="${esc(url)}"><button class="menu-item" type="button" data-copy="#share-url" aria-label="${esc(w("share.copyAria"))}">${COPY_ICON}${w("common.copyLink")}</button></div></details>`;
}

const kindName = (kind) => w("links.kinds")[kind] || PROFILE_LINKS[kind].name;

// The page saves links itself: they need no wording, so no AI app is involved.
const linksDialog = (meta) => {
  const current = Object.fromEntries((meta.links || []).map((l) => [l.kind, l.url]));
  const fields = Object.entries(PROFILE_LINKS)
    .map(
      ([kind]) =>
        `<label class="link-field"><span class="link-kind">${linkIcon(kind)}${esc(kindName(kind).toUpperCase())}</span><input class="field" type="text" name="link_${kind}" value="${esc(current[kind] || "")}" placeholder="${esc(w("links.hints")[kind])}" autocomplete="off" autocapitalize="off" spellcheck="false" inputmode="url"></label>`
    )
    .join("");
  return `<dialog class="modal" data-dialog data-links-dialog aria-labelledby="links-title">
<form method="post" action="/owner/action" data-quick-form>
<input type="hidden" name="op" value="set_meta"><input type="hidden" name="setting" value="links">
<h3 id="links-title">${w("links.title")}</h3>
<p class="modal-loop">${w("links.intro", MAX_LINKS)}</p>
<div class="link-fields">${fields}</div>
<label class="modal-all"><input type="checkbox" name="none" value="1"${Array.isArray(meta.links) && !meta.links.length ? " checked" : ""}> <span>${w("links.none")}</span></label>
<p class="notice bad" data-form-error role="alert" hidden></p>
<div class="actions"><button class="btn signal" type="submit">${w("links.save")}</button><button class="btn" type="button" data-dialog-close>${w("common.cancel")}</button></div>
</form>
</dialog>`;
};

const nameDialog = (meta) => `<dialog class="modal" data-dialog data-name-dialog aria-labelledby="name-title">
<form method="post" action="/owner/action" data-quick-form>
<input type="hidden" name="op" value="set_meta"><input type="hidden" name="setting" value="name">
<h3 id="name-title">${w("nameDialog.title")}</h3>
<p class="modal-loop">${w("nameDialog.intro")}</p>
<input class="field" type="text" name="ownerName" value="${esc(meta.ownerName || "")}" maxlength="80" required autocomplete="name" aria-labelledby="name-title">
<p class="notice bad" data-form-error role="alert" hidden></p>
<div class="actions"><button class="btn signal" type="submit">${w("common.save")}</button><button class="btn" type="button" data-dialog-close>${w("common.cancel")}</button></div>
</form>
</dialog>`;

// The owner types the line straight in. Owner text goes live at once, checked like every public text.
const aboutDialog = (meta) => {
  const langs = meta.languages;
  const fields = langs
    .map(
      (lang) =>
        `<label class="about-field">${langs.length > 1 ? `<span class="label">${esc(lang.toUpperCase())}</span>` : ""}<textarea class="field" name="about_${esc(lang)}" rows="3" placeholder="${esc(w("aboutDialog.placeholder"))}">${esc(meta.about?.[lang] || "")}</textarea></label>`
    )
    .join("");
  return `<dialog class="modal" data-dialog data-about-dialog aria-labelledby="about-title">
<form method="post" action="/owner/action" data-quick-form>
<input type="hidden" name="op" value="set_meta"><input type="hidden" name="setting" value="about">
<h3 id="about-title">${w("aboutDialog.title")}</h3>
<p class="modal-loop">${w("aboutDialog.intro", ABOUT_MAX_WORDS, langs.length > 1)}</p>
<div class="about-fields">${fields}</div>
<p class="notice bad" data-form-error role="alert" hidden></p>
<div class="actions"><button class="btn signal" type="submit">${w("common.save")}</button><button class="btn" type="button" data-dialog-close>${w("common.cancel")}</button></div>
</form>
</dialog>`;
};

// Until the owner adds links or says they have none, every visit to the log page asks.
function linksNotice(published) {
  const text = w(published ? "links.askPublished" : "links.askPrivate");
  return `<div class="notice upgrade links-ask"><span>${text}</span><button class="btn signal small" type="button" data-open-dialog="[data-links-dialog]">${w("links.add")}</button></div>`;
}

// Who runs this log, why, and where to follow them: the first thing a visitor reads.
// The owner sees the same header, plus SHARE once published and a links button.
function profileHead(meta, points, { owner, published, origin }) {
  const about = txt(meta.about);
  const links = (meta.links || []).filter((l) => PROFILE_LINKS[l.kind]);
  const share = owner && published;
  if (!meta.ownerName && !about && !links.length && !owner) return "";
  const name = meta.ownerName || (owner ? w("profile.yourName") : "");
  const pencil = (dialog, label) =>
    owner ? ` <button class="pencil" type="button" data-open-dialog="[${dialog}]" aria-label="${label}" title="${label}">${PENCIL_ICON}</button>` : "";
  const follow = links.length
    ? `<div class="profile-follow"><span class="label" id="follow-label">${w("profile.follow", meta.ownerName ? esc(meta.ownerName.split(/\s+/)[0].toUpperCase()) : "")}</span><ul class="profile-links" aria-labelledby="follow-label">${links
        .map((l) => {
          const label = w("profile.followAria", meta.ownerName || "", kindName(l.kind));
          return `<li><a href="${esc(l.url)}" target="_blank" rel="me noopener" aria-label="${esc(label)}" title="${esc(kindName(l.kind))}">${linkIcon(l.kind)}</a></li>`;
        })
        .join("")}</ul>${pencil("data-links-dialog", w("profile.editLinks"))}</div>`
    : "";
  // The pencil wraps with the last word, never alone on its own line.
  // tag: the language code shown after text that isn't written in the page's language yet.
  const withPencil = (text, btn, tag = "") => {
    if (!btn) return esc(text) + tag;
    const at = text.lastIndexOf(" ") + 1;
    return `${esc(text.slice(0, at))}<span class="nowrap">${esc(text.slice(at))}${tag}${btn}</span>`;
  };
  const aboutPencil = pencil("data-about-dialog", w(about ? "profile.editAbout" : "profile.writeAbout"));
  const aboutTag = owner && meta.about ? shown(meta.about).slice(esc(about).length) : "";
  const aboutLine = about
    ? `<p class="profile-about">${withPencil(about, aboutPencil, aboutTag)}</p>`
    : owner
      ? `<p class="profile-about empty">${withPencil(w("profile.aboutEmpty"), aboutPencil)}</p>`
      : "";
  const nameLine = name
    ? `<h1 class="profile-name${meta.ownerName ? "" : " empty"}">${withPencil(name, pencil("data-name-dialog", w(meta.ownerName ? "profile.editName" : "profile.addName")))}</h1>`
    : "";
  const addLinks = owner && !links.length
    ? `<button class="btn small" type="button" data-open-dialog="[data-links-dialog]">${w("profile.addLinks")}</button>`
    : "";
  const actions = follow + addLinks + (share ? shareMenu(meta, points, origin) : "");
  return `<section class="profile">
<div class="profile-id">${nameLine}${aboutLine}</div>
${actions ? `<div class="profile-actions">${actions}</div>` : ""}
</section>${owner ? linksDialog(meta) + aboutDialog(meta) + nameDialog(meta) : ""}`;
}

// The figure leads; everything else is a labelled status row beside it (below it on phones).
// The owner's small grid at the end of the row only shows on wide screens, where it opens the full one (the next section).
// Visitors get the full grid open instead.
function readout(view, meta, owner, headed = false, proposals = 0) {
  const m = view.metrics;
  const approved = view.loops.length;
  const size = listSize(meta);
  const row = (label, value, note = "") =>
    `<div><dt>${label}</dt><dd>${value}${note ? noteButton(note) : ""}</dd></div>`;
  const rows = [
    meta.cycle
      ? row(w("readout.checkIn", esc(meta.cycle)), nextCheckIn(meta.day))
      : row(w("readout.checkIns"), w("readout.notStarted"), w("readout.startsWhenFrozen")),
    row(
      w("readout.yourList"),
      meta.mode === "frozen" ? w("readout.frozen", esc(meta.inventoryVersion || 1), approved) : w("readout.approvedOf", approved, size),
      meta.mode === "frozen" ? w("readout.frozenNote") : ""
    ),
  ];
  if (meta.stillMetric) rows.push(row(w("readout.still", Boolean(meta.ownerName)), `${m.stillPct}%`));
  const mini = owner ? drawGrid(view, meta, { compact: true }) : null;
  const step = progressStep(view);
  const progress = step ? w(`progress.${step.step}`, step.n) : "";
  const review = proposals ? w("readout.review", proposals) : "";
  const note = [progress ? esc(progress) : "", review].filter(Boolean).join(" ");
  return `<section class="readout">
<div class="readout-main"><${headed ? "p" : "h1"} class="figure"><span class="pct" data-assisted-weight="${assistedWeight(m.version || P.version)}">${m.delegatedPoints}</span><span class="cap">${w("readout.cap", size)}</span></${headed ? "p" : "h1"}>${note ? `<p class="figure-note">${note}</p>` : ""}${owner ? `<a class="btn small" href="/?view=public" target="_blank" rel="noopener" aria-label="${esc(w("readout.checkPublicAria"))}">${w("readout.checkPublic")}${NEW_TAB_ICON}</a>` : ""}</div>
<dl class="status">${rows.join("")}</dl>
${mini ? `<div class="mini-wrap"><p class="mini-label">${w("readout.miniLabel")}</p><a class="grid mini"${size < P.limits.loops ? ` data-size="${size}"` : ""} href="#activity" role="button" aria-expanded="false" aria-controls="activity" data-grid-toggle style="grid-template-columns:${mini.columns}" aria-label="${esc(w("readout.miniAria"))}">${mini.html}</a></div>` : ""}
</section>`;
}

const svg = (body, attrs = 'fill="currentColor"') =>
  `<svg viewBox="0 0 24 24" width="18" height="18" ${attrs} aria-hidden="true">${body}</svg>`;

// Brand marks from @lobehub/icons. ChatGPT, Cursor and Grok follow the text color, so they invert with the button on hover.
const APP_ICONS = {
  claude: svg(
    '<path fill="#D97757" d="M4.709 15.955l4.72-2.647.08-.23-.08-.128H9.2l-.79-.048-2.698-.073-2.339-.097-2.266-.122-.571-.121L0 11.784l.055-.352.48-.321.686.06 1.52.103 2.278.158 1.652.097 2.449.255h.389l.055-.157-.134-.098-.103-.097-2.358-1.596-2.552-1.688-1.336-.972-.724-.491-.364-.462-.158-1.008.656-.722.881.06.225.061.893.686 1.908 1.476 2.491 1.833.365.304.145-.103.019-.073-.164-.274-1.355-2.446-1.446-2.49-.644-1.032-.17-.619a2.97 2.97 0 01-.104-.729L6.283.134 6.696 0l.996.134.42.364.62 1.414 1.002 2.229 1.555 3.03.456.898.243.832.091.255h.158V9.01l.128-1.706.237-2.095.23-2.695.08-.76.376-.91.747-.492.584.28.48.685-.067.444-.286 1.851-.559 2.903-.364 1.942h.212l.243-.242.985-1.306 1.652-2.064.73-.82.85-.904.547-.431h1.033l.76 1.129-.34 1.166-1.064 1.347-.881 1.142-1.264 1.7-.79 1.36.073.11.188-.02 2.856-.606 1.543-.28 1.841-.315.833.388.091.395-.328.807-1.969.486-2.309.462-3.439.813-.042.03.049.061 1.549.146.662.036h1.622l3.02.225.79.522.474.638-.079.485-1.215.62-1.64-.389-3.829-.91-1.312-.329h-.182v.11l1.093 1.068 2.006 1.81 2.509 2.33.127.578-.322.455-.34-.049-2.205-1.657-.851-.747-1.926-1.62h-.128v.17l.444.649 2.345 3.521.122 1.08-.17.353-.608.213-.668-.122-1.374-1.925-1.415-2.167-1.143-1.943-.14.08-.674 7.254-.316.37-.729.28-.607-.461-.322-.747.322-1.476.389-1.924.315-1.53.286-1.9.17-.632-.012-.042-.14.018-1.434 1.967-2.18 2.945-1.726 1.845-.414.164-.717-.37.067-.662.401-.589 2.388-3.036 1.44-1.882.93-1.086-.006-.158h-.055L4.132 18.56l-1.13.146-.487-.456.061-.746.231-.243 1.908-1.312-.006.006z"/>',
    ""
  ),
  chatgpt: svg(
    '<path fill-rule="evenodd" d="M9.205 8.658v-2.26c0-.19.072-.333.238-.428l4.543-2.616c.619-.357 1.356-.523 2.117-.523 2.854 0 4.662 2.212 4.662 4.566 0 .167 0 .357-.024.547l-4.71-2.759a.797.797 0 00-.856 0l-5.97 3.473zm10.609 8.8V12.06c0-.333-.143-.57-.429-.737l-5.97-3.473 1.95-1.118a.433.433 0 01.476 0l4.543 2.617c1.309.76 2.189 2.378 2.189 3.948 0 1.808-1.07 3.473-2.76 4.163zM7.802 12.703l-1.95-1.142c-.167-.095-.239-.238-.239-.428V5.899c0-2.545 1.95-4.472 4.591-4.472 1 0 1.927.333 2.712.928L8.23 5.067c-.285.166-.428.404-.428.737v6.898zM12 15.128l-2.795-1.57v-3.33L12 8.658l2.795 1.57v3.33L12 15.128zm1.796 7.23c-1 0-1.927-.332-2.712-.927l4.686-2.712c.285-.166.428-.404.428-.737v-6.898l1.974 1.142c.167.095.238.238.238.428v5.233c0 2.545-1.974 4.472-4.614 4.472zm-5.637-5.303l-4.544-2.617c-1.308-.761-2.188-2.378-2.188-3.948A4.482 4.482 0 014.21 6.327v5.423c0 .333.143.571.428.738l5.947 3.449-1.95 1.118a.432.432 0 01-.476 0zm-.262 3.9c-2.688 0-4.662-2.021-4.662-4.519 0-.19.024-.38.047-.57l4.686 2.71c.286.167.571.167.856 0l5.97-3.448v2.26c0 .19-.07.333-.237.428l-4.543 2.616c-.619.357-1.356.523-2.117.523zm5.899 2.83a5.947 5.947 0 005.827-4.756C22.287 18.339 24 15.84 24 13.296c0-1.665-.713-3.282-1.998-4.448.119-.5.19-.999.19-1.498 0-3.401-2.759-5.947-5.946-5.947-.642 0-1.26.095-1.88.31A5.962 5.962 0 0010.205 0a5.947 5.947 0 00-5.827 4.757C1.713 5.447 0 7.945 0 10.49c0 1.666.713 3.283 1.998 4.448-.119.5-.19 1-.19 1.499 0 3.401 2.759 5.946 5.946 5.946.642 0 1.26-.095 1.88-.309a5.96 5.96 0 004.162 1.713z"/>'
  ),
  cursor: svg(
    '<path fill-rule="evenodd" d="M22.106 5.68L12.5.135a.998.998 0 00-.998 0L1.893 5.68a.84.84 0 00-.419.726v11.186c0 .3.16.577.42.727l9.607 5.547a.999.999 0 00.998 0l9.608-5.547a.84.84 0 00.42-.727V6.407a.84.84 0 00-.42-.726zm-.603 1.176L12.228 22.92c-.063.108-.228.064-.228-.061V12.34a.59.59 0 00-.295-.51l-9.11-5.26c-.107-.062-.063-.228.062-.228h18.55c.264 0 .428.286.296.514z"/>'
  ),
  grok: svg(
    '<path fill-rule="evenodd" d="M9.27 15.29l7.978-5.897c.391-.29.95-.177 1.137.272.98 2.369.542 5.215-1.41 7.169-1.951 1.954-4.667 2.382-7.149 1.406l-2.711 1.257c3.889 2.661 8.611 2.003 11.562-.953 2.341-2.344 3.066-5.539 2.388-8.42l.006.007c-.983-4.232.242-5.924 2.75-9.383.06-.082.12-.164.179-.248l-3.301 3.305v-.01L9.267 15.292M7.623 16.723c-2.792-2.67-2.31-6.801.071-9.184 1.761-1.763 4.647-2.483 7.166-1.425l2.705-1.25a7.808 7.808 0 00-1.829-1A8.975 8.975 0 005.984 5.83c-2.533 2.536-3.33 6.436-1.962 9.764 1.022 2.487-.653 4.246-2.34 6.022-.599.63-1.199 1.259-1.682 1.925l7.62-6.815"/>'
  ),
};

// UI icons from Phosphor (MIT license), bold weight: https://phosphoricons.com
const phosphor = (d) =>
  `<svg viewBox="0 0 256 256" width="18" height="18" fill="currentColor" aria-hidden="true"><path d="${d}"/></svg>`;

const CHECK_CIRCLE_ICON = phosphor(
  "M176.49,95.51a12,12,0,0,1,0,17l-56,56a12,12,0,0,1-17,0l-24-24a12,12,0,1,1,17-17L112,143l47.51-47.52A12,12,0,0,1,176.49,95.51ZM236,128A108,108,0,1,1,128,20,108.12,108.12,0,0,1,236,128Zm-24,0a84,84,0,1,0-84,84A84.09,84.09,0,0,0,212,128Z"
);

const PENCIL_ICON = phosphor(
  "M230.14,70.54,185.46,25.85a20,20,0,0,0-28.29,0L33.86,149.17A19.85,19.85,0,0,0,28,163.31V208a20,20,0,0,0,20,20H92.69a19.86,19.86,0,0,0,14.14-5.86L230.14,98.82a20,20,0,0,0,0-28.28ZM91,204H52V165l84-84,39,39ZM192,103,153,64l18.34-18.34,39,39Z"
);

const NEW_TAB_ICON = phosphor(
  "M228,104a12,12,0,0,1-24,0V69l-59.51,59.51a12,12,0,0,1-17-17L187,52H152a12,12,0,0,1,0-24h64a12,12,0,0,1,12,12Zm-44,24a12,12,0,0,0-12,12v64H52V84h64a12,12,0,0,0,0-24H48A20,20,0,0,0,28,80V208a20,20,0,0,0,20,20H176a20,20,0,0,0,20-20V140A12,12,0,0,0,184,128Z"
);
const CLOSE_ICON = phosphor(
  "M208.49,191.51a12,12,0,0,1-17,17L128,145,64.49,208.49a12,12,0,0,1-17-17L111,128,47.51,64.49a12,12,0,0,1,17-17L128,111l63.51-63.52a12,12,0,0,1,17,17L145,128Z"
);
const HELP_ICON = phosphor(
  "M144,180a16,16,0,1,1-16-16A16,16,0,0,1,144,180Zm92-52A108,108,0,1,1,128,20,108.12,108.12,0,0,1,236,128Zm-24,0a84,84,0,1,0-84,84A84.09,84.09,0,0,0,212,128ZM128,64c-24.26,0-44,17.94-44,40v4a12,12,0,0,0,24,0v-4c0-8.82,9-16,20-16s20,7.18,20,16-9,16-20,16a12,12,0,0,0-12,12v8a12,12,0,0,0,23.73,2.56C158.31,137.88,172,122.37,172,104,172,81.94,152.26,64,128,64Z"
);

const INFO_ICON = phosphor(
  "M108,84a16,16,0,1,1,16,16A16,16,0,0,1,108,84Zm128,44A108,108,0,1,1,128,20,108.12,108.12,0,0,1,236,128Zm-24,0a84,84,0,1,0-84,84A84.09,84.09,0,0,0,212,128Zm-72,36.68V132a20,20,0,0,0-20-20,12,12,0,0,0-4,23.32V164a20,20,0,0,0,20,20,12,12,0,0,0,4-23.32Z"
);

const EXPERIMENTS_ICON = phosphor(
  "M225.15,197.71,164,95.81V44h4a12,12,0,0,0,0-24H88a12,12,0,0,0,0,24h4V95.81L30.85,197.71A20,20,0,0,0,48,228H208a20,20,0,0,0,17.15-30.29ZM140,44V99.14a12,12,0,0,0,1.71,6.17l35.13,58.54c-10.79.86-25.15-1.31-43.42-10.56-14-7.08-27.46-11.33-40.27-12.76l21.14-35.22A12,12,0,0,0,116,99.14V44ZM55.06,204,79,164.19c13-1.11,27.62,2.42,43.62,10.52,19.61,9.92,36.25,13.31,49.85,13.31A75.44,75.44,0,0,0,190.11,186l10.83,18Z"
);
const WAITING_ICON = phosphor(
  "M208,28H48A20,20,0,0,0,28,48V208a20,20,0,0,0,20,20H208a20,20,0,0,0,20-20V48A20,20,0,0,0,208,28Zm-4,24v92H179.31a19.86,19.86,0,0,0-14.14,5.86L147,168H109L90.83,149.86A19.86,19.86,0,0,0,76.69,144H52V52ZM52,204V168H75l18.14,18.14A19.86,19.86,0,0,0,107.31,192h41.38a19.86,19.86,0,0,0,14.14-5.86L181,168h23v36Z"
);
const HISTORY_ICON = phosphor(
  "M140,80v41.21l34.17,20.5a12,12,0,1,1-12.34,20.58l-40-24A12,12,0,0,1,116,128V80a12,12,0,0,1,24,0ZM128,28A99.38,99.38,0,0,0,57.24,57.34c-4.69,4.74-9,9.37-13.24,14V64a12,12,0,0,0-24,0v40a12,12,0,0,0,12,12H72a12,12,0,0,0,0-24H57.77C63,86,68.37,80.22,74.26,74.26a76,76,0,1,1,1.58,109,12,12,0,0,0-16.48,17.46A100,100,0,1,0,128,28Z"
);
const API_ICON = phosphor(
  "M71.68,97.22,34.74,128l36.94,30.78a12,12,0,1,1-15.36,18.44l-48-40a12,12,0,0,1,0-18.44l48-40A12,12,0,0,1,71.68,97.22Zm176,21.56-48-40a12,12,0,1,0-15.36,18.44L221.26,128l-36.94,30.78a12,12,0,1,0,15.36,18.44l48-40a12,12,0,0,0,0-18.44ZM164.1,28.72a12,12,0,0,0-15.38,7.18l-64,176a12,12,0,0,0,7.18,15.37A11.79,11.79,0,0,0,96,228a12,12,0,0,0,11.28-7.9l64-176A12,12,0,0,0,164.1,28.72Z"
);
const CHAT_ICON = phosphor(
  "M236.34,187.09A84,84,0,0,0,172.29,68.9,84,84,0,0,0,19.66,139.09l-6.84,23.26a20,20,0,0,0,24.83,24.83l23.26-6.84a83.94,83.94,0,0,0,22.76,6.74,84.06,84.06,0,0,0,111.42,41.26l23.26,6.84a20,20,0,0,0,24.83-24.83ZM62,155.5a11.88,11.88,0,0,0-3.39.49l-20.72,6.09L44,141.35a12,12,0,0,0-.93-9A60,60,0,1,1,67.7,156.92,12,12,0,0,0,62,155.5Zm150.89,24.8a12,12,0,0,0-.93,9l6.09,20.73L197.36,204a12,12,0,0,0-9.06.93A60,60,0,0,1,111,186.63a83.93,83.93,0,0,0,68.55-91.37,60,60,0,0,1,33.38,85Z"
);
const KEY_ICON = phosphor(
  "M196,76a16,16,0,1,1-16-16A16,16,0,0,1,196,76Zm48,22.74A84.3,84.3,0,0,1,160.11,180H160a83.52,83.52,0,0,1-23.65-3.38l-7.86,7.87A12,12,0,0,1,120,188H108v12a12,12,0,0,1-12,12H84v12a12,12,0,0,1-12,12H40a20,20,0,0,1-20-20V187.31a19.86,19.86,0,0,1,5.86-14.14l53.52-53.52A84,84,0,1,1,244,98.74ZM202.43,53.57A59.48,59.48,0,0,0,158,36c-32,1-58,27.89-58,59.89a59.69,59.69,0,0,0,4.2,22.19,12,12,0,0,1-2.55,13.21L44,189v23H60V200a12,12,0,0,1,12-12H84V176a12,12,0,0,1,12-12h19l9.65-9.65a12,12,0,0,1,13.22-2.55A59.58,59.58,0,0,0,160,156h.08c32,0,58.87-26.07,59.89-58A59.55,59.55,0,0,0,202.43,53.57Z"
);

const sectionTitle = (icon, text) => `<h2 class="title">${icon}<span>${text}</span></h2>`;

// data-menu gives it the prompt menus' closing: a click outside or Escape.
const noteButton = (text, label = w("common.moreAbout")) =>
  `<details class="note" data-menu><summary aria-label="${label}">${INFO_ICON}</summary><div class="note-pop" role="note">${text}</div></details>`;

// A highlighted word in running text that opens its definition. Its container can't be a <p>.
const termNote = (word, text) =>
  `<details class="note term" data-menu><summary>${word}</summary><span class="note-pop" role="note">${text}</span></details>`;

const firstPrompt = (size) => w("start.firstPrompt", size);

// Prefill links each app opens a new chat with. None is a documented API, so COPY stays.
const OPEN_IN = [
  { id: "claude", name: "Claude", href: (q) => `https://claude.ai/new?q=${q}` },
  { id: "chatgpt", name: "ChatGPT", href: (q) => `https://chatgpt.com/?q=${q}` },
  { id: "cursor", name: "Cursor", href: (q) => `https://cursor.com/link/prompt?text=${q}` },
  { id: "grok", name: "Grok", href: (q) => `https://grok.com/?q=${q}` },
];

const CARET_ICON = phosphor(
  "M216.49,104.49l-80,80a12,12,0,0,1-17,0l-80-80a12,12,0,0,1,17-17L128,159l71.51-71.52a12,12,0,0,1,17,17Z"
);
const COPY_ICON = phosphor(
  "M216,28H88A12,12,0,0,0,76,40V76H40A12,12,0,0,0,28,88V216a12,12,0,0,0,12,12H168a12,12,0,0,0,12-12V180h36a12,12,0,0,0,12-12V40A12,12,0,0,0,216,28ZM156,204H52V100H156Zm48-48H180V88a12,12,0,0,0-12-12H100V52H204Z"
);

// One button for every way to use a prompt: each app, then COPY for any other chat.
// Each link carries a {q} template that app.js fills from the prompt box on click, so edits go along.
// The plain href is the fallback without JavaScript.
const promptMenu = (source, prompt, { up = false } = {}) => {
  const apps = OPEN_IN.map(
    (a) =>
      `<a class="menu-item" href="${esc(prompt == null ? "#" : a.href(encodeURIComponent(prompt)))}" data-app-href="${esc(a.href("{q}"))}" target="_blank" rel="noopener" aria-label="${esc(w("common.openIn", a.name))}">${APP_ICONS[a.id]}${a.name.toUpperCase()}</a>`
  ).join("");
  return `<details class="menu${up ? " up" : ""}" data-menu data-prompt-source="${source}"><summary class="btn signal">${w("common.usePrompt")}${CARET_ICON}</summary><div class="menu-list">${apps}<button class="menu-item" type="button" data-copy="${source}" aria-label="${esc(w("common.copyPrompt"))}">${COPY_ICON}${w("common.copy")}</button></div></details>`;
};

// Every prompt is editable before it goes to the agent.
const promptBox = (id, text = "", rows = 6) =>
  `<textarea class="prompt-box" id="${id}" rows="${rows}" spellcheck="false" aria-label="${esc(w("common.promptAria"))}">${esc(text)}</textarea>`;

function emptyState(owner, connected, size) {
  if (!owner) return `<section class="block empty-state"><h2>${w("start.noLoops")}</h2><p>${w("start.beingMade")}</p></section>`;
  if (!connected) {
    return `<section class="block empty-state">
<h2>${w("start.noLoops")}</h2>
<p>${w("start.aiProposes")}</p>
<aside class="help-box"><span class="help-icon">${HELP_ICON}</span><div><p>${w("start.connectToStart")}</p><a class="btn signal" href="/connect">${w("common.connectAi")}</a></div></aside>
</section>`;
  }
  return `<section class="block empty-state">
<h2>${w("start.noLoops")}</h2>
<p>${w("start.startWith")}</p>
<div class="copy">${promptBox("first-prompt", firstPrompt(size), 2)}${promptMenu("#first-prompt", firstPrompt(size))}</div>
</section>`;
}

// free: empty squares by branch, or null on a list of 10, where they belong to no area.
const fillSlotsPrompt = (free, total, size) => {
  const read = w("fill.read");
  const ask = w("fill.ask");
  if (!free) return w("fill.promptList", total, size, read, ask);
  const parts = P.branchOrder.filter((b) => free[b]).map((b) => w("fill.inArea", free[b], branchName(b)));
  const list = parts.length > 1 ? `${parts.slice(0, -1).join(", ")}${w("fill.and")}${parts.at(-1)}` : parts[0];
  return w("fill.promptAreas", total, list, read, ask);
};

const fillSlotsDialog = (free, total, size) => {
  const prompt = fillSlotsPrompt(free, total, size);
  return `<dialog class="modal" data-dialog id="fill-slots-dialog" aria-labelledby="fill-slots-title">
<h3 id="fill-slots-title">${w("fill.title")}</h3>
<p class="modal-loop">${w("fill.intro", total)}</p>
<ol class="modal-list">
${[w(free ? "fill.stepAreas" : "fill.stepHours"), ...w("fill.steps")].map((s) => `<li>${s}</li>`).join("\n")}
</ol>
<details class="prompt-peek"><summary class="link-btn">${w("common.seePrompt")}</summary><p class="modal-loop">${w("fill.peek")}</p><div class="copy block-code">${promptBox("fill-slots-prompt", prompt, 8)}</div></details>
<div class="actions"><button class="btn" type="button" data-dialog-close>${w("common.cancel")}</button>${promptMenu("#fill-slots-prompt", prompt, { up: true })}</div>
</dialog>`;
};

// One dialog for every empty square.
function emptySlotDialog(connected, byArea = true) {
  const steps = w(connected ? "fill.connectedSteps" : "fill.unconnectedSteps", byArea);
  const action = connected
    ? `<button class="btn fix-btn" type="button" data-dialog-close data-open-dialog="#fill-slots-dialog">${HELP_ICON}${w("common.getHelp")}</button><button class="btn signal fix-btn" type="button" data-dialog-close data-open-dialog="#fill-one-dialog">${ROBOT_ICON}${w("fill.fillThis")}</button>`
    : `<a class="btn signal" href="/connect">${w("common.connectAi")}</a>`;
  return `<dialog class="modal" data-dialog data-empty-dialog aria-labelledby="empty-title">
<h3 id="empty-title">${w("fill.emptyTitle")}</h3>
<p class="modal-loop">${w("fill.emptyIntro")}</p>
<p>${w("fill.howTo")}</p>
<ol class="modal-list">${steps.map((s) => `<li>${s}</li>`).join("")}</ol>
<div class="actions"><button class="btn fix-btn" type="button" data-dialog-close>${CLOSE_ICON}${w("common.close")}</button>${action}</div>
</dialog>`;
}

// FILL THIS LOOP: the person names 1 task, and app.js writes it into the prompt with the clicked square's area.
// On a list of 10 the squares have no area, so the prompt names the list instead.
const fillOnePrompt = (size) => (size < P.limits.loops ? w("fill.onePromptList", size) : w("fill.onePromptArea"));
const fillOneDialog = (size) => {
  const areas = Object.fromEntries(P.branchOrder.map((b) => [P.branches[b].key, branchName(b)]));
  return `<dialog class="modal" data-dialog id="fill-one-dialog" data-fill-one data-template="${esc(fillOnePrompt(size))}" data-areas="${esc(JSON.stringify(areas))}" aria-labelledby="fill-one-title">
<h3 id="fill-one-title">${w("fill.oneTitle")}</h3>
<p class="modal-loop">${w("fill.oneIntro")}</p>
<input class="field" type="text" id="fill-one-answer" maxlength="200" placeholder="${esc(w("fill.onePlaceholder"))}" autocomplete="off" aria-labelledby="fill-one-title">
<details class="prompt-peek"><summary class="link-btn">${w("common.seePrompt")}</summary><div class="copy block-code">${promptBox("fill-one-prompt", "", 4)}</div></details>
<div class="actions"><button class="btn" type="button" data-dialog-close>${w("common.cancel")}</button>${promptMenu("#fill-one-prompt", null, { up: true })}</div>
</dialog>`;
};

function gridSection(view, meta, owner, connected, hasProposals) {
  const size = listSize(meta);
  const { html: cells, columns } = drawGrid(view, meta);
  const slots = emptySlots(view.loops, size);
  const free = slots && Object.fromEntries(P.branchOrder.map((b) => [b, slots[b] - view.loops.filter((l) => l.code.startsWith(b + "-")).length]));
  const empty = free ? Object.values(free).reduce((a, n) => a + n, 0) : Math.max(0, size - view.loops.length);
  const counts = { empty, ...view.metrics?.counts };
  const helpEmpty = owner && counts.empty > 0;
  const help = !helpEmpty
    ? ""
    : connected
      ? `<button class="link-btn legend-help" type="button" data-open-dialog="#fill-slots-dialog">${ROBOT_ICON}${w("common.getHelp")}</button>`
      : `<a class="btn small legend-help" href="/connect">${w("common.connectAi")}</a>`;
  const note = (l) => (l === "empty" && helpEmpty ? w("grid.pickHere") : levelNote(l));
  const legend = ["empty", ...LEVELS]
    .map(
      (l) =>
        `<li data-level="${l}"><i class="cell" data-s="${l}"></i><span class="lv">${levelLabel(l)}<small>${esc(note(l))}</small>${l === "empty" ? help : ""}</span><span class="n">${counts[l] || 0}</span></li>`
    )
    .join("");
  const tip = esc(JSON.stringify({ ...gridTip(), empty: w("grid.emptyTip", Boolean(free), owner) }));
  // A list of 10 shows each loop's name on its tile, so it's a list screen readers can read, not a picture.
  const label = esc(w("grid.aria", w("grid.label", view.loops.length, Boolean(free))));
  const grid = free
    ? `<div class="grid" data-grid data-tip="${tip}" style="grid-template-columns:${columns}" role="img" aria-label="${label}">${cells}</div>`
    : `<div class="grid" data-grid data-size="${size}" data-tip="${tip}" style="grid-template-columns:${columns}" role="group" aria-label="${label}">${cells}</div>`;
  return `<section class="block" id="activity"${owner ? "" : " data-open"}>
${grid}
<div class="key">
<div class="key-note">${w("grid.keyNote", termNote(w("grid.loopWord"), w("grid.loopNote")))}</div>
<ul class="legend">${legend}</ul>
</div>
${helpEmpty && connected ? fillSlotsDialog(free, empty, size) : ""}
${helpEmpty ? emptySlotDialog(connected, Boolean(free)) : ""}
${helpEmpty && connected ? fillOneDialog(size) : ""}
</section>${view.loops.length || hasProposals ? "" : emptyState(owner, connected, size)}`;
}

// The question and the bet, or their pending versions while they wait for approval.
const expQuestion = (e) => (txt(e.question) ? shown(e.question) : shown(e.pending?.question));
const expBet = (e) => (txt(e.hypothesis) ? shown(e.hypothesis) : shown(e.pending?.hypothesis));
const levelUpper = (l) => (LEVELS.includes(l) ? levelLabel(l) : String(l).toUpperCase());

function experimentsSection(experiments) {
  if (!experiments.length) return "";
  const sorted = [...experiments].sort((a, b) => Boolean(a.conclusion) - Boolean(b.conclusion) || (a.code < b.code ? 1 : -1));
  const rows = sorted
    .map((e) => {
      const bet = expBet(e);
      let status = w("exp.status")[e.status] || "";
      if (e.status === "concluded") status += ` · ${w("exp.verdict")[e.verdict] || ""}`;
      else if (e.stage) status += ` · ${w("exp.round", e.stage)} · ${levelUpper(e.level)}`;
      return `<li class="exp"><span class="exp-id">${esc(e.code)} · ${esc(w("exp.pick", e.slot))}</span><span class="exp-title">${expQuestion(e)}</span><span class="exp-status" data-status="${esc(e.status)}">${esc(status)}</span>${bet ? `<p class="exp-bet"><span class="label">${w("exp.bet")}</span>${bet}</p>` : ""}</li>`;
    })
    .join("");
  return `<section class="block">${sectionTitle(EXPERIMENTS_ICON, w("exp.title"))}<ul class="exps">${rows}</ul></section>`;
}

const CHECK_ICON = phosphor(
  "M232.49,80.49l-128,128a12,12,0,0,1-17,0l-56-56a12,12,0,1,1,17-17L96,183,215.51,63.51a12,12,0,0,1,17,17Z"
);
const WARNING_ICON = phosphor(
  "M236.8,188.09,149.35,36.22h0a24.76,24.76,0,0,0-42.7,0L19.2,188.09a23.51,23.51,0,0,0,0,23.72A24.35,24.35,0,0,0,40.55,224h174.9a24.35,24.35,0,0,0,21.33-12.19A23.51,23.51,0,0,0,236.8,188.09ZM216,199.85a.42.42,0,0,1-.53.15H40.55a.42.42,0,0,1-.53-.15.31.31,0,0,1,0-.31L127.45,47.67a.58.58,0,0,1,1.1,0L216,199.54A.31.31,0,0,1,216,199.85ZM116,136V104a12,12,0,0,1,24,0v32a12,12,0,0,1-24,0Zm28,40a16,16,0,1,1-16-16A16,16,0,0,1,144,176Z"
);

const ARROW_RIGHT_ICON = phosphor(
  "M224.49,136.49l-72,72a12,12,0,0,1-17-17L187,140H40a12,12,0,0,1,0-24H187L135.51,64.48a12,12,0,0,1,17-17l72,72A12,12,0,0,1,224.49,136.49Z"
);

// One approve button per loop. Without JavaScript each button posts on its own; with it, the
// button opens the confirmation dialog, which can also approve every loop that passes the rules.
// Approved from the dialog, a row stays until the next load, with a link to its loop page.
// fixable(code, rules) returns the FIX prompt for a loop that breaks a rule; null without a connected AI app.
function proposedCard(proposed, broken, published, fixable, connected, size) {
  const eligible = proposed.filter((l) => !broken.has(l.code));
  const rows = proposed
    .map((l) => {
      const name = txt(l.name);
      const bad = broken.has(l.code);
      const replaces = l.replaces?.length ? l.replaces.join(", ") : "";
      const why = esc(w("proposals.whyCant", l.code));
      const button = bad
        ? `<button class="icon-btn warn" type="button" title="${why}" aria-label="${why}" data-rule-break="${esc(JSON.stringify(broken.get(l.code)))}"${fixable ? ` data-fix-prompt="${esc(fixable(l.code, broken.get(l.code)))}"` : ""} data-code="${esc(l.code)}" data-name="${esc(name)}">${WARNING_ICON}</button>`
        : `<form method="post" action="/owner/action" data-approve-one><input type="hidden" name="op" value="approve_loops"><input type="hidden" name="codes" value="${esc(l.code)}"><button class="icon-btn" type="submit" title="${esc(w("proposals.approveCode", l.code))}" aria-label="${esc(w("proposals.approveCode", l.code))}: ${esc(name)}" data-code="${esc(l.code)}" data-name="${esc(name)}" data-replaces="${esc(replaces)}">${CHECK_ICON}</button></form>`;
      const scope = shown(l.scope);
      return `<li class="row approve-row" data-branch="${esc(parseCode(l.code)?.branch || "")}"><span class="code">${esc(l.code)}</span><span><b>${shown(l.name)}</b>${bad ? ` <span class="flag-bad">${w("proposals.breaksFlag")}</span>` : ""}<small>${w("proposals.doneWhen", shown(l.doneWhen))}${scope ? w("proposals.scope", scope) : ""}${replaces ? w("proposals.replaces", esc(replaces)) : ""}${w("proposals.by", esc(l.proposedBy || ""))}</small></span>${button}</li>`;
    })
    .join("");
  const visibility = w(published ? "proposals.visibilityPublic" : "proposals.visibilityPrivate");
  const dialog = `<dialog class="modal" data-approve-dialog data-codes="${esc(JSON.stringify(eligible.map((l) => l.code)))}" aria-labelledby="approve-title">
<form method="post" action="/owner/action">
<input type="hidden" name="op" value="approve_loops"><div data-codes-inputs></div>
<h3 id="approve-title" data-approve-title>${w("proposals.approveThis")}</h3>
<p class="modal-target" data-approve-loop><span class="code" data-approve-code></span><span data-approve-name></span></p>
<p>${w("proposals.approvingAdds")}</p>
<ul class="modal-list">
<li>${w("proposals.countsToward", size)}</li>
<li>${visibility}</li>
<li>${w("proposals.canMeasure")}</li>
<li>${w("proposals.neverReused")}</li>
<li data-approve-replaces hidden></li>
</ul>
<label class="modal-all"><input type="checkbox" data-approve-all> <span data-approve-all-label>${w("proposals.approveAll", eligible.length)}</span></label>
<div class="actions"><button class="btn signal" type="submit" data-approve-submit>${w("proposals.approve")}</button><button class="btn" type="button" data-approve-cancel>${w("common.cancel")}</button></div>
</form>
</dialog>
<dialog class="modal" data-dialog data-rule-dialog aria-labelledby="rule-title">
<h3 id="rule-title"><span data-rule-code></span> ${w("proposals.breaksRule")}</h3>
<p class="modal-target" data-rule-name></p>
<ul class="modal-list" data-rule-list></ul>
<p>${w("proposals.cantApprove")}</p>
<div class="actions"><button class="btn" type="button" data-dialog-close>${w("common.close")}</button>${fixable ? `<button class="btn signal fix-btn" type="button" data-dialog-close data-rule-fix>${ROBOT_ICON}${w("common.fix")}</button>` : ""}</div>
</dialog>`;
  const hint = broken.size && eligible.length < proposed.length ? w("proposals.hintRename") : "";
  const counts = {};
  for (const l of proposed) {
    const b = parseCode(l.code)?.branch;
    counts[b] = (counts[b] || 0) + 1;
  }
  const tabs = P.branchOrder
    .map((b) => `<button type="button" aria-pressed="false" data-branch-tab="${b}"${counts[b] ? "" : " disabled"}>${esc(branchName(b).toUpperCase())}<span class="n">${counts[b] || 0}</span></button>`)
    .join("");
  const add = connected ? `<button class="btn small signal fix-btn" type="button" data-add-loop>${PLUS_ICON}${w("proposals.addNew")}</button>` : "";
  return `<div class="card" id="proposals" data-branch-filter><div class="card-head"><h3>${w("proposals.title", proposed.length)}</h3><div class="card-tools"><div class="tabs" role="group" aria-label="${esc(w("proposals.filter"))}" hidden>${tabs}</div>${add}</div></div><p class="hint">${w("proposals.approveEach")}${hint}</p><ul class="plain">${rows}</ul>${dialog}${connected ? addLoopDialog() : ""}<template data-open-icon>${ARROW_RIGHT_ICON}</template></div>`;
}

const PLUS_ICON = phosphor(
  "M228,128a12,12,0,0,1-12,12H140v76a12,12,0,0,1-24,0V140H40a12,12,0,0,1,0-24h76V40a12,12,0,0,1,24,0v76h76A12,12,0,0,1,228,128Z"
);

// app.js writes the person's answer into the template's {answer}. With no answer the prompt stays addLoop.prompt.
const addLoopDialog = () => {
  const prompt = w("addLoop.prompt");
  return `<dialog class="modal" data-dialog data-add-loop-dialog data-template="${esc(w("addLoop.template"))}" data-default="${esc(prompt)}" aria-labelledby="add-loop-title">
<h3 id="add-loop-title">${w("addLoop.title")}</h3>
<p class="modal-loop" id="add-loop-ask">${w("addLoop.ask")}</p>
<input class="field" type="text" id="add-loop-answer" maxlength="200" placeholder="${esc(w("addLoop.placeholder"))}" autocomplete="off" aria-labelledby="add-loop-ask">
<details class="prompt-peek"><summary class="link-btn">${w("common.seePrompt")}</summary><div class="copy block-code">${promptBox("add-loop-prompt", prompt, 8)}</div></details>
<div class="actions"><button class="btn" type="button" data-dialog-close>${w("common.cancel")}</button>${promptMenu("#add-loop-prompt", prompt, { up: true })}</div>
</dialog>`;
};

const fixPrompt = (target, rules, version) => w("fix.prompt", target, rules, version);

const ROBOT_ICON = phosphor(
  "M72,104a16,16,0,1,1,16,16A16,16,0,0,1,72,104Zm96,16a16,16,0,1,0-16-16A16,16,0,0,0,168,120Zm68-40V192a36,36,0,0,1-36,36H56a36,36,0,0,1-36-36V80A36,36,0,0,1,56,44h60V16a12,12,0,0,1,24,0V44h60A36,36,0,0,1,236,80Zm-24,0a12,12,0,0,0-12-12H56A12,12,0,0,0,44,80V192a12,12,0,0,0,12,12H200a12,12,0,0,0,12-12Zm-12,82a30,30,0,0,1-30,30H86a30,30,0,0,1,0-60h84A30,30,0,0,1,200,162Zm-80-6v12h16V156ZM86,168H96V156H86a6,6,0,0,0,0,12Zm90-6a6,6,0,0,0-6-6H160v12h10A6,6,0,0,0,176,162Z"
);

// One dialog for every FIX button; each button carries its own prompt.
const fixDialog = () => `<dialog class="modal" data-dialog data-fix-dialog aria-labelledby="fix-title">
<h3 id="fix-title">${w("fix.title", "<span data-fix-target></span>")}</h3>
<p class="modal-loop">${w("fix.intro")}</p>
<div class="copy block-code">${promptBox("fix-prompt")}</div>
<div class="actions"><button class="btn" type="button" data-dialog-close>${w("common.cancel")}</button>${promptMenu("#fix-prompt", null, { up: true })}</div>
</dialog>`;

function breaksCard(breaks, connected) {
  const rows = breaks.items
    .map((v) => {
      const rule = ruleWords(v);
      const fix = connected
        ? `<button class="btn signal small fix-btn" type="button" aria-label="${esc(w("fix.aria", v.target))}" data-fix="${esc(fixPrompt(v.target, rule, breaks.version))}" data-target="${esc(v.target)}">${ROBOT_ICON}${w("common.fix")}</button>`
        : "";
      return `<li class="row${connected ? " fix-row" : ""}"><span class="code">${esc(v.target)}</span><span>${esc(rule)}</span>${fix}</li>`;
    })
    .join("");
  const how = w(breaks.adopted ? "fix.howAdopted" : "fix.howAhead");
  const connect = connected ? "" : `<div class="actions"><a class="btn signal" href="/connect">${w("common.connectAi")}</a></div>`;
  return `<div class="card"><h3>${w("fix.breaksTitle", esc(breaks.version), breaks.items.length)}</h3><p>${how}</p><ul class="plain">${rows}</ul>${connect}</div>`;
}

function pendingSection(state, published, connected) {
  const text = pendingItems(state);
  const proposed = state.loops.filter((l) => l.proposed && !l.retired);
  const retirements = state.loops.filter((l) => l.retireProposed && !l.retired);
  const baselines = state.loops.filter((l) => l.pendingBaseline);
  const breaks = pendingRuleBreaks(state);
  // approve_loops refuses the whole batch if one name breaks a rule, so those can't be approved yet.
  const broken = new Map();
  for (const v of validate(state)) {
    if (v.rule !== "name" && v.rule !== "voice") continue;
    if (!broken.has(v.target)) broken.set(v.target, []);
    broken.get(v.target).push(ruleWords(v));
  }
  if (!text.length && !proposed.length && !retirements.length && !baselines.length && !breaks.items.length) return "";
  const parts = [];
  if (breaks.items.length) parts.push(breaksCard(breaks, connected));
  const fixable = connected ? (code, rules) => fixPrompt(code, rules.join(" "), state.meta.protocolVersion) : null;
  if (proposed.length) parts.push(proposedCard(proposed, broken, published, fixable, connected, listSize(state.meta)));
  if (connected && (breaks.items.length || proposed.some((l) => broken.has(l.code)))) parts.push(fixDialog());
  if (text.length) {
    const rows = text
      .map((i) => {
        const fields = Object.keys(i.pending)
          .map((k) => {
            const was = shown(i.ref[k]);
            return `<span class="diff"><small>${esc(w("pending.fields")[k] || k)}</small>${was ? `<s>${was}</s>` : ""}<b>${shown(i.pending[k])}</b></span>`;
          })
          .join("");
        return `<label class="row"><input type="checkbox" name="targets" value="${esc(i.target)}" checked><span class="code">${esc(i.target)}</span><span>${fields}</span></label>`;
      })
      .join("");
    parts.push(
      `<form method="post" action="/owner/action" class="card"><h3>${w("pending.text", text.length)}</h3>${rows}<div class="actions"><button class="btn signal" type="submit" name="op" value="approve_text">${w("pending.publish")}</button><button class="btn" type="submit" name="op" value="reject_text">${w("pending.discard")}</button></div></form>`
    );
  }
  if (retirements.length) {
    const rows = retirements
      .map((l) => `<label class="row"><input type="checkbox" name="retire" value="${esc(l.code)}" checked><span class="code">${esc(l.code)}</span><span>${shown(l.name)}<small>${esc(l.retireProposed.reason)}${w("pending.by", esc(l.retireProposed.by || ""))}</small></span></label>`)
      .join("");
    parts.push(`<form method="post" action="/owner/action" class="card"><input type="hidden" name="op" value="approve_loops"><h3>${w("pending.retirements", retirements.length)}</h3>${rows}<button class="btn" type="submit">${w("pending.retire")}</button></form>`);
  }
  for (const l of baselines) {
    const b = l.pendingBaseline;
    parts.push(
      `<form method="post" action="/owner/action" class="card"><input type="hidden" name="op" value="approve_baseline"><input type="hidden" name="code" value="${esc(l.code)}"><h3>${w("pending.costFor", esc(l.code))}</h3><p>${w("pending.costLine", shown(l.name), esc(b.hoursPerWeek), esc(b.moneyUsd), esc(b.occurrences), esc(w("cost.confidence")[b.confidence] || b.confidence), b.quality ? esc(b.quality) : "")}</p><button class="btn" type="submit">${w("pending.approveCost")}</button></form>`
    );
  }
  return `<section class="block">${sectionTitle(WAITING_ICON, w("pending.title"))}${parts.join("")}</section>`;
}

const HISTORY_BAD = new Set(["undo_event", "reject_text", "record_drop", "revoke_connection", "revoke_api_key"]);
const HISTORY_SHOWN = 8;
const HISTORY_REFS = 6;

function eventsSection(events, loops) {
  if (!events.length) return "";
  const levelOf = new Map(loops.map((l) => [l.code, l.level]));
  const items = events.map((e) => {
    const tool = e.tool.replace(/^override:/, "");
    const targets = String(e.target || "").split(",").filter((t) => t && t !== "meta");
    const refs = targets.slice(0, HISTORY_REFS).map((t) => ({ text: t, href: levelOf.has(t) ? `/loop/${t}` : "" }));
    if (targets.length > HISTORY_REFS) refs.push({ text: w("history.more", targets.length - HISTORY_REFS) });
    return {
      at: e.at,
      s: levelOf.get(targets.find((t) => levelOf.has(t))),
      text: (w("history.labels")[tool] || sentence(tool.replace(/_/g, " "))) + (tool !== e.tool ? w("history.override") : ""),
      kind: HISTORY_BAD.has(tool) ? "bad" : "",
      by: `#${e.id} · ${e.actor}`,
      refs,
    };
  });
  return `<section class="block" id="history">${sectionTitle(HISTORY_ICON, w("history.title"))}${timelineList("history", items, HISTORY_SHOWN)}</section>`;
}

// Same stroke weight as the Phosphor bold icons.
const PULSE_ICON = `<svg viewBox="0 0 256 256" width="18" height="18" fill="none" stroke="currentColor" stroke-width="24" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M24 128h36l28-72 56 144 28-72h60"/></svg>`;

const PULSE_DAYS = 84;
const PULSE_TICK = P.limits.cycleWeeks * 7;
const PULSE_SHOWN = 6;
const PULSE_GROUPS = 60;
const PULSE_BAD = new Set(["record_drop", "notAchieved", "terminated", "failed"]);

// Visitors only: what moved, day by day. Agents fill each bar from the baseline, the person stacks on top,
// so the green share growing over the weeks is the run working.
function activitySection(items, view, meta) {
  if (!items.length) return "";
  const end = Date.parse(`${new Date().toISOString().slice(0, 10)}T00:00:00Z`);
  const perDay = new Map();
  for (const it of items) {
    const c = perDay.get(it.day) || { person: 0, agent: 0 };
    c[it.by === "agent" ? "agent" : "person"]++;
    perDay.set(it.day, c);
  }
  const days = Array.from({ length: PULSE_DAYS }, (_, i) => {
    const day = new Date(end - (PULSE_DAYS - 1 - i) * 86400000).toISOString().slice(0, 10);
    return { day, ...(perDay.get(day) || { person: 0, agent: 0 }) };
  });
  const total = days.reduce((n, d) => n + d.person + d.agent, 0);
  const agents = days.reduce((n, d) => n + d.agent, 0);
  const peak = Math.max(1, ...days.map((d) => d.person + d.agent));
  const pct = (n) => Math.round((n / peak) * 1000) / 10;
  const name = meta.ownerName ? meta.ownerName.toUpperCase() : "";
  const weeks = PULSE_DAYS / 7;

  const bar = (d, i) => {
    const back = PULSE_DAYS - 1 - i;
    const n = d.person + d.agent;
    const mark = back === 0 ? w("pulse.today") : back % PULSE_TICK === 0 ? shortDate(d.day).toUpperCase() : "";
    const cls = back === 0 ? "now" : mark && back % (PULSE_TICK * 2) ? "minor" : "";
    const segs = (d.agent ? `<i class="a" style="height:${pct(d.agent)}%"></i>` : "") + (d.person ? `<i class="p" style="height:${pct(d.person)}%"></i>` : "");
    return `<li style="--i:${i}"${cls ? ` class="${cls}"` : ""}${mark ? ` data-mark="${mark}"` : ""} data-date="${esc(shortDate(d.day).toUpperCase())}" data-n="${esc(w("pulse.changes", n))}"${d.agent ? ` data-ag="${esc(w("pulse.byAgents", d.agent))}"` : ""}>${segs}</li>`;
  };

  const levelOf = new Map(view.loops.map((l) => [l.code, l.level]));
  const firstLoop = new Map(view.experiments.map((e) => [e.code, e.loops[0]]));
  const groups = [];
  for (const it of items) {
    const key = `${it.day}|${it.tool}|${it.result || ""}|${it.by}`;
    const last = groups.at(-1);
    if (last?.key === key) {
      for (const c of it.codes) if (!last.codes.includes(c)) last.codes.push(c);
    } else groups.push({ key, ...it, codes: [...it.codes] });
  }
  // Newest first: a freeze older than the list's growth was at 10.
  let grown = false;
  const rows = groups.slice(0, PULSE_GROUPS).map((g) => {
    if (g.tool === "grow_list") grown = true;
    const labels = w("pulse.labels");
    const label = g.tool === "freeze_inventory" ? labels.freeze_inventory(grown ? 10 : listSize(meta)) : labels[g.tool];
    const refs = g.codes.slice(0, HISTORY_REFS).map((c) => ({ text: c, href: levelOf.has(c) ? `/loop/${c}` : "" }));
    if (g.codes.length > HISTORY_REFS) refs.push({ text: w("history.more", g.codes.length - HISTORY_REFS) });
    return {
      at: g.day,
      s: g.codes.map((c) => levelOf.get(c) || levelOf.get(firstLoop.get(c))).find(Boolean),
      text: typeof label === "string" ? label : label[g.result || ""],
      kind: PULSE_BAD.has(g.tool) || PULSE_BAD.has(g.result) ? "bad" : "",
      by: g.by === "agent" ? w("pulse.byAgent") : g.by === "system" ? w("pulse.onSchedule") : name ? w("pulse.byName", name) : w("pulse.byHand"),
      byKind: g.by === "agent" ? "agent" : "person",
      refs,
    };
  });

  const sum = total ? w("pulse.sum", total, weeks, agents) : w("pulse.none", weeks);
  return `<section class="block pulse" id="pulse">
<div class="pulse-head">${sectionTitle(PULSE_ICON, w("pulse.title"))}<ul class="pulse-key"><li data-by="agent">${w("pulse.agents")}</li><li data-by="person">${esc(name || w("pulse.byHand"))}</li></ul></div>
<p class="pulse-sum">${sum}</p>
<figure class="spark" data-spark role="img" aria-label="${esc(w("pulse.aria", weeks, total, agents))}"><ol class="spark-bars" style="--days:${PULSE_DAYS}">${days.map(bar).join("")}</ol></figure>
${timelineList("pulse", rows, PULSE_SHOWN)}
</section>`;
}

const privateNotice = () =>
  `<form method="post" action="/owner/action" class="notice upgrade" data-confirm="${esc(w("notices.publishConfirm"))}"><input type="hidden" name="op" value="set_meta"><span>${w("notices.private")}</span><button class="btn signal small" type="submit">${w("notices.publish")}</button></form>`;

// Closing it leaves the page exactly as a visitor sees it; a reload brings it back.
const previewNotice = () =>
  `<div class="notice good closable"><span>${w("notices.preview")}</span><button class="notice-close" type="button" data-dismiss aria-label="${esc(w("notices.previewClose"))}">${CLOSE_ICON}</button></div>`;

// Opened from an AI app's link: the owner view without a sign-in, so nothing on it changes the log.
const viewOnlyNotice = () =>
  `<div class="notice upgrade view-only"><span>${w("notices.viewOnly", VIEW_HOURS)}</span><a class="btn signal small" href="/login?next=/">${w("notices.signIn")}</a></div>`;

function waitingLine(state) {
  const n = pendingItems(state).length + state.loops.filter((l) => (l.proposed || l.pendingBaseline || l.retireProposed) && !l.retired).length;
  return n ? notice(w("notices.waiting", n)) : "";
}

export function logPage({ state, lang, owner, viewOnly = false, events = [], publicEvents = [], url, upgrade, configured: isConfigured, hasConnections, published = false, preview = false, share = null, ready = [] }) {
  const meta = state.meta;
  usePage(meta, lang, { tags: owner });
  const view = owner ? derive(state) : publicView(state);
  const acts = owner && !viewOnly;
  const title = w("site.logTitle", meta.ownerName);
  const head = profileHead(meta, view.metrics.delegatedPoints, { owner: acts, published, origin: url?.origin || "" });
  const proposals = acts ? state.loops.filter((l) => l.proposed && !l.retired).length : 0;
  const body = [
    flash(url),
    share ? shareBanner(share) : "",
    preview ? previewNotice() : "",
    viewOnly ? viewOnlyNotice() : "",
    !isConfigured ? setupNotice() : "",
    acts && ready.length ? readyPanel(ready) : "",
    acts ? protocolNotice(meta, upgrade) : "",
    acts && !hasConnections ? notice(w("notices.connectFirst"), "good") : "",
    acts && !published ? privateNotice() : "",
    acts && meta.links == null ? linksNotice(published) : "",
    head,
    readout(view, meta, acts, head.includes('class="profile-name'), proposals),
    gridSection(view, meta, acts, hasConnections, proposals > 0),
    owner ? "" : activitySection(publicActivity(publicEvents, view), view, meta),
    acts ? pendingSection(state, published, hasConnections) : viewOnly ? waitingLine(state) : "",
    experimentsSection(view.experiments),
    owner ? eventsSection(events, state.loops) : "",
  ].join("\n");
  return layout({ title, meta, owner: acts, signedIn: acts || preview, body, current: "/", origin: url?.origin, url, description: txt(meta.about), ...shareOg(share) });
}

// ---------------------------------------------------------------------------
// Loop page

const lvIdx = (l) => LEVELS.indexOf(l);
const sentence = (s) => s.charAt(0).toUpperCase() + s.slice(1);
const upDate = (day) => (day ? shortDate(String(day).slice(0, 10)).toUpperCase() : "");
const byStage = (e) => [...(e.stages || [])].sort((a, b) => a.stage - b.stage || a.try - b.try);
const UPDOWN_ICON = phosphor(
  "M184.49,167.51a12,12,0,0,1,0,17l-48,48a12,12,0,0,1-17,0l-48-48a12,12,0,0,1,17-17L128,207l39.51-39.52A12,12,0,0,1,184.49,167.51Zm-96-79L128,49l39.51,39.52a12,12,0,0,0,17-17l-48-48a12,12,0,0,0-17,0l-48,48a12,12,0,0,0,17,17Z"
);
const lowerFirst = (s) => s.charAt(0).toLowerCase() + s.slice(1);

// The try that still decides something: running, or passed and still proving.
const openTry = (e) => {
  if (e.conclusion) return null;
  const t = byStage(e).at(-1);
  return t && (t.outcome == null || (t.outcome === "achieved" && !t.hold)) ? t : null;
};

function levelStack(loop, exps) {
  const cur = lvIdx(loop.level);
  const ceiling = ceilingOf(loop);
  const top = lvIdx(ceiling);
  const tries = exps.flatMap((e) => byStage(e).map((t) => ({ ...t, exp: e })));
  const reachedOn = (l) => {
    const passed = tries.filter((t) => t.level === l && t.hold?.result === "passed").map((t) => t.hold.at);
    const dropped = (loop.drops || []).filter((d) => d.to === l).map((d) => d.at);
    return [...passed, ...dropped].sort().at(-1);
  };
  const ahead = (l) => {
    const open = exps.map((e) => [e, openTry(e)]).find(([, t]) => t?.level === l);
    if (open) return [w(open[1].outcome == null ? "loop.tryingNow" : "loop.provingNow", open[0].code), "run"];
    const failed = tries.filter((t) => t.level === l && (t.outcome === "notAchieved" || t.outcome === "terminated" || t.hold?.result === "failed")).at(-1);
    if (failed) return [w("loop.didntPass", upDate(failed.hold?.at || failed.closedAt)), "bad"];
    return [w("loop.notTried"), ""];
  };
  const measured = isMeasured(loop);
  const mark = (l) => (l === "still" && measured ? " data-measured" : "");
  const inner = (l, [meta, kind] = ["", ""], extra = "") =>
    `<i class="cell" data-s="${l}"${mark(l)}${extra}></i><span class="lvl-name">${levelLabel(l)}${l === ceiling && l !== "autonomous" ? `<span class="tag">${w("loop.limit")}</span>` : ""}</span><span class="lvl-plain">${esc(sentence(levelNote(l)))}</span><span class="lvl-meta${kind ? " " + kind : ""}">${esc(meta)}`;
  let nowMeta = loop.pendingBaseline ? [w("loop.costWaiting"), "run"] : loop.flag === "measuring" ? [w("loop.measuring"), "run"] : ["", ""];
  const since = reachedOn(loop.level);
  if (!nowMeta[0] && since) nowMeta = [w("loop.since", upDate(since)), ""];
  if (!nowMeta[0] && loop.level === "still" && measured) nowMeta = [w("loop.measured"), ""];
  const flag = loop.flag ? ` data-flag="${esc(loop.flag)}"` : "";
  const rows = [];
  const opens = (l) => `type="button" data-open-dialog="#lvl-dialog-${l}" aria-haspopup="dialog"`;
  for (let i = top; i > cur; i--) rows.push(`<li><button class="lvl-row up" ${opens(LEVELS[i])} style="--k:${i - cur}">${inner(LEVELS[i], ahead(LEVELS[i]))}</span></button></li>`);
  for (let i = cur - 1; i >= 0; i--) {
    const on = reachedOn(LEVELS[i]);
    rows.push(`<li><button class="lvl-row down" ${opens(LEVELS[i])} data-reached style="--k:${cur - i}">${inner(LEVELS[i], [on ? upDate(on) : "", ""])}</span></button></li>`);
  }
  return `<div class="lvl" data-level-stack>
<button class="lvl-row lvl-now" type="button" aria-expanded="false" aria-controls="lvl-others" aria-label="${esc(w("loop.levelAria", lvName(loop.level)))}">${inner(loop.level, nowMeta, flag)}${UPDOWN_ICON}</span></button>
<ol class="lvl-others" id="lvl-others" aria-label="${esc(w("loop.everyLevel"))}" inert>${rows.join("")}</ol>
</div>`;
}

// What has to happen for the loop to reach another level, in plain words. Higher levels come from rounds that pass and prove,
// lower ones from drops. actions: loopActions() ids that move it there, most direct first.
function levelPath(loop, exps, target, version) {
  const cur = lvIdx(loop.level);
  const j = lvIdx(target);
  const name = lvName(target);
  const { failureDays, maxStages, occurrencesToMeasure: n } = P.limits;
  if (j < cur) {
    const steps = [j === cur - 1 ? w("path.dropOne", failureDays, name) : w("path.dropMany", failureDays, cur - j, name)];
    if (target === "still") steps.push(w("path.harm", name));
    return {
      title: w("path.downTitle", name),
      intro: w("path.downIntro", sentence(name), levelNote(target)),
      steps,
      foot: w("path.downFoot"),
      actions: j === cur - 1 ? ["recordDrop"] : target === "still" ? ["stopNow"] : [],
    };
  }
  const next = LEVELS[cur + 1];
  const nextName = lvName(next);
  const climb = LEVELS.slice(cur + 1, j + 1);
  const open = exps.find((e) => !e.conclusion);
  const t = open && byStage(open).at(-1);
  const passed = open && t?.outcome === "achieved" && !t.hold && t.level === next;
  const steps = [];
  if (loop.proposed) steps.push(w("path.approveFirst"));
  if (loop.level === "still" && !isMeasured(loop)) {
    if (!estimateCanStart(version)) steps.push(w(loop.flag === "measuring" ? "path.finishMeasuring" : "path.measure", n));
    else if (!loop.estimate?.hoursPerWeek) steps.push(w("path.estimate"));
  }
  if (open && t?.outcome == null && t?.level === next) steps.push(w("path.tryingNext", open.code, t.stage, nextName, shortDate(t.deadline)));
  else if (passed) steps.push(w("path.passedAt", open.code, nextName));
  else if (open) steps.push(w("path.nextRound", open.code, nextName));
  else steps.push(w("path.picks", nextName));
  if (!passed) steps.push(w("path.passes", nextName));
  steps.push(w("path.keeps", nextName));
  if (climb.length > 1) steps.push(w("path.thenAgain", climb.slice(1).map(lvName).join(w("path.thenJoin")), maxStages));
  const limit = target === ceilingOf(loop) && target !== "autonomous" ? w("path.limit") : "";
  return {
    title: w("path.upTitle", name),
    intro: w("path.upIntro", sentence(name), levelNote(target), limit, lvName(loop.level)),
    steps,
    foot: w("path.upFoot"),
    actions: ["endRound", "recordProving", "nextRound", "draft", "startMeasuring", "recordCost"],
  };
}

// Escapes the text and marks every level name in it with that level's square.
const markLevels = (text) =>
  LEVELS.reduce((s, l) => s.replaceAll(esc(lvName(l)), `<span class="lvl-word"><i class="cell" data-s="${l}"></i>${esc(lvName(l))}</span>`), esc(text));

// A button that opens loopPromptDialog() with one of loopActions().
const askButton = (a, label = a.label.toUpperCase()) =>
  `<button class="btn signal fix-btn" type="button" data-dialog-close data-loop-prompt="${esc(a.prompt)}" data-title="${esc(lowerFirst(a.label))}">${ROBOT_ICON}${esc(label)}</button>`;

// One dialog per level the stack can open. actions: the owner's loopActions(), or null for visitors.
function levelDialogs(loop, exps, version, actions, connected) {
  const cur = lvIdx(loop.level);
  const top = lvIdx(ceilingOf(loop));
  return LEVELS.filter((l, i) => i !== cur && i <= Math.max(top, cur))
    .map((l) => {
      const path = levelPath(loop, exps, l, version);
      const ask = actions && connected && path.actions.map((id) => actions.find((a) => a?.id === id)).find(Boolean);
      let action = "";
      if (ask) action = askButton(ask);
      else if (actions && !connected) action = `<a class="btn signal" href="/connect">${w("common.connectAi")}</a>`;
      return `<dialog class="modal" data-dialog id="lvl-dialog-${l}" aria-labelledby="lvl-dialog-${l}-title">
<h3 id="lvl-dialog-${l}-title">${esc(path.title).replace(esc(lvName(l)), `<span class="lvl-target">${esc(lvName(l))}</span>`)}</h3>
<p class="modal-loop">${markLevels(path.intro)}</p>
<ol class="modal-list">${path.steps.map((s) => `<li>${markLevels(s)}</li>`).join("")}</ol>
<p class="modal-loop">${markLevels(path.foot)}</p>
<div class="actions"><button class="btn fix-btn" type="button" data-dialog-close>${CLOSE_ICON}${w("common.close")}</button>${action}</div>
</dialog>`;
    })
    .join("");
}

function experimentItem(e, today) {
  const bet = expBet(e);
  let status = w("exp.status")[e.status] || "";
  if (e.conclusion) status += ` ${upDate(e.conclusion.at)} · ${w("exp.verdict")[e.conclusion.hypothesis] || ""}`;
  else if (e.stage) status += ` · ${w("exp.round", e.stage)} · ${levelUpper(e.level)}`;
  const stages = byStage(e)
    .map((t) => {
      const end = t.closedAt || t.deadline;
      let out = w("exp.trying");
      if (t.outcome == null && t.start > today) out = w("exp.scheduled");
      if (t.outcome) out = w("exp.outcome")[t.outcome].toUpperCase();
      if (t.outcome === "achieved") out += t.hold ? w(t.hold.result === "passed" ? "exp.proved" : "exp.didntHold") : w("exp.proving");
      const ok = t.outcome == null || (t.outcome === "achieved" && t.hold?.result !== "failed");
      const learned = shown(t.learned);
      return `<li><span class="st">${w("exp.round", t.stage)}${t.try > 1 ? w("exp.tryN", t.try) : ""} · ${levelUpper(t.level)}</span><span>${t.start ? w("exp.dates", shortDate(t.start), shortDate(end)) : ""}${learned ? ` ${learned}` : ""}</span><span class="out ${ok ? "ok" : "no"}">${out}</span></li>`;
    })
    .join("");
  return `<li class="exp"><span class="exp-id">${esc(e.code)} · ${esc(w("exp.pick", e.slot))}</span><span class="exp-title">${expQuestion(e)}</span><span class="exp-status" data-status="${esc(e.status)}">${esc(status)}</span>${bet ? `<p class="exp-bet"><span class="label">${w("exp.bet")}</span>${bet}</p>` : ""}${stages ? `<ol class="stages">${stages}</ol>` : ""}</li>`;
}

function experimentsBox(exps) {
  if (!exps.length) return `<span class="exp-box none">${w("exp.none")}</span>`;
  const ongoing = exps.filter((e) => !e.conclusion).length;
  return `<button class="exp-box" type="button" data-drawer-open aria-haspopup="dialog" aria-controls="exp-drawer"><b>${exps.length}</b>${w("exp.count", exps.length)}${ongoing ? `<span class="dot" aria-hidden="true"></span><span class="run">${w("exp.ongoing", ongoing)}</span>` : ""}${CARET_ICON}</button>`;
}

const experimentsDrawer = (code, exps, today) =>
  exps.length
    ? `<dialog class="drawer" id="exp-drawer" data-dialog aria-labelledby="drawer-title">
<div class="drawer-head"><h2 id="drawer-title">${w("exp.drawerTitle")}</h2><button class="btn small" type="button" data-dialog-close>${w("common.close")}</button></div>
<p class="muted">${w("exp.drawerIntro", esc(code))}</p>
<ul class="exps">${exps.map((e) => experimentItem(e, today)).join("")}</ul>
</dialog>`
    : "";

// The one thing that happens next, worked out from the loop's state.
function nextLine(loop, exps, owner, today, measuringFull, version) {
  const open = exps.find((e) => !e.conclusion);
  const t = open && byStage(open).at(-1);
  if (loop.retired) return "";
  if (loop.proposed) return w("nextLine.approve");
  if (loop.pendingBaseline) return w(owner ? "nextLine.costOwner" : "nextLine.costVisitor");
  if (open && t?.outcome == null && t) {
    if (t.start > today) return w("nextLine.starts", open.code, t.stage, shortDate(t.start));
    return w("nextLine.ends", open.code, t.stage, shortDate(t.deadline), lvName(t.level));
  }
  if (open && t?.outcome === "achieved" && !t.hold)
    return w("nextLine.proving", open.code, lvName(t.level), shortDate(new Date(Date.parse(`${t.closedAt}T00:00:00Z`) + P.limits.holdWeeks * 7 * 86400000).toISOString().slice(0, 10)));
  if (open) return w("nextLine.noRound", open.code);
  if (loop.level === "still" && !isMeasured(loop)) {
    const n = P.limits.occurrencesToMeasure;
    if (loop.flag === "measuring") return w("nextLine.beingMeasured", n);
    if (!estimateCanStart(version)) {
      if (!owner) return w("nextLine.notMeasured", n);
      return measuringFull ? w("nextLine.spotsTaken", P.limits.measuringSlots) : w("nextLine.startMeasuring", n);
    }
    if (!loop.estimate?.hoursPerWeek) return w(owner ? "nextLine.estimateOwner" : "nextLine.estimateVisitor");
  }
  if (lvIdx(loop.level) >= lvIdx(ceilingOf(loop))) return w("nextLine.atLimit", lvName(loop.level));
  const group = triageGroup(loop);
  const start = w("nextLine.start", START_LINK);
  if (group === "automateNow") return owner ? start + w("nextLine.easyOwner") : w("nextLine.easyVisitor");
  if (isHardEligible(loop)) return owner ? start + w("nextLine.hardOwner") : w("nextLine.hardVisitor");
  return owner ? start : w("nextLine.waits");
}

// Stands in nextLine()'s text for the link that opens startExperimentDialog().
const START_LINK = "{start-experiment}";
const startLink = () => `<button class="link-btn" type="button" data-open-dialog="#start-exp-dialog" aria-haspopup="dialog">${w("nextLine.startLink")}</button>`;

function startExperimentDialog(loop, version, actions, connected) {
  const { maxStages, occurrencesToMeasure: n } = P.limits;
  const slots = P.limits.experimentSlots.length;
  const pick = triageGroup(loop) === "automateNow" ? w("startExp.easy") : isHardEligible(loop) ? w("startExp.hard") : "";
  const cost = isMeasured(loop)
    ? w("startExp.costMeasured")
    : estimateCanStart(version)
      ? w("startExp.costEstimate", Boolean(loop.estimate?.hoursPerWeek), n)
      : w("startExp.costMeasure", n);
  const steps = [
    w("startExp.pick", slots, pick),
    cost,
    w("startExp.question"),
    w("startExp.bet"),
    w("startExp.howFar", lvName(LEVELS[lvIdx(loop.level) + 1])),
    w("startExp.plan", maxStages),
  ];
  const ask = connected && actions?.find((a) => a?.id === "draft");
  let action = "";
  if (ask) action = askButton(ask, w("startExp.draft"));
  else if (actions && !connected) action = `<a class="btn signal" href="/connect">${w("common.connectAi")}</a>`;
  return `<dialog class="modal" data-dialog id="start-exp-dialog" aria-labelledby="start-exp-title">
<h3 id="start-exp-title">${w("startExp.title")}</h3>
<p class="modal-loop">${w("startExp.intro")}</p>
<ol class="modal-list">${steps.map((s) => `<li>${markLevels(s)}</li>`).join("")}</ol>
<p class="modal-loop">${w("startExp.foot")}</p>
<div class="actions"><button class="btn fix-btn" type="button" data-dialog-close>${CLOSE_ICON}${w("common.close")}</button>${action}</div>
</dialog>`;
}

function loopTimeline(loop, exps, events) {
  const items = [];
  const add = (at, s, text, kind = "", by = "") => at && items.push({ at: String(at), s, text, kind, by, i: items.length });
  const b = loop.baseline || loop.pendingBaseline;
  if (b?.recordedAt) add(b.recordedAt, "still", w("timeline.costRecorded", b.occurrences, b.hoursPerWeek), "", b.recordedBy || "");
  if (loop.baseline?.approvedAt) add(loop.baseline.approvedAt, "still", w("timeline.costApproved"));
  for (const e of exps) {
    add(e.registeredAt, e.startLevel, w("timeline.written", e.code, w("exp.slot")[e.slot] || e.slot));
    for (const t of byStage(e)) {
      const name = w("timeline.roundName", e.code, t.stage, t.try);
      add(t.start, t.level, w("timeline.started", name, lvName(t.level)), t.outcome == null ? "run" : "");
      if (t.closedAt) add(t.closedAt, t.level, w("timeline.closed", name, w("exp.outcome")[t.outcome]), t.outcome === "achieved" ? "" : "bad");
      if (t.hold)
        add(t.hold.at, t.level, t.hold.result === "passed" ? w("timeline.proved", lvName(t.level)) : w("timeline.didntHold", name), t.hold.result === "passed" ? "" : "bad");
    }
    if (e.conclusion) add(e.conclusion.at, e.conclusion.level || e.startLevel, w("timeline.ended", e.code, w("exp.betWord")[e.conclusion.hypothesis] || ""));
  }
  for (const d of loop.drops || []) add(d.at, d.to, w("timeline.dropped", lvName(d.from), lvName(d.to), w("loop.drop")[d.cause] || ""), "bad");
  if (loop.retiredAt) add(loop.retiredAt, loop.level, w("timeline.retired", loop.retiredReason), "bad");
  const labels = w("loop.events");
  for (const ev of events) if (labels[ev.tool]) add(ev.at, null, labels[ev.tool], "", `#${ev.id} · ${ev.actor}`);
  const day = (it) => it.at.slice(0, 10);
  return items.sort((a, z) => (day(a) === day(z) ? z.i - a.i : day(a) < day(z) ? 1 : -1));
}

// Items: { at, s (level of the cell), text, kind ("run" or "bad"), by, byKind ("agent" or "person"), refs: [{ text, href }] shown after the text }.
const timelineItem = (it) => {
  const day = it.at.slice(0, 10);
  const clock = it.at.length > 10 ? it.at.slice(11, 16) : "";
  const refs = (it.refs || []).map((r) => (r.href ? `<a class="code" href="${esc(r.href)}">${esc(r.text)}</a>` : `<span class="code">${esc(r.text)}</span>`)).join(" ");
  return `<li${it.kind ? ` class="${it.kind}"` : ""}><time datetime="${esc(clock ? it.at : day)}">${esc(day)}${clock ? `<small>${esc(clock)}</small>` : ""}</time><i class="cell" data-s="${it.s || "empty"}"></i><span><b>${esc(it.text)}</b>${refs ? ` ${refs}` : ""}${it.by ? `<span class="by"${it.byKind ? ` data-by="${it.byKind}"` : ""}>${esc(it.by)}</span>` : ""}</span></li>`;
};

function timelineList(id, items, shown) {
  const rest = items.slice(shown);
  const all = esc(w("loop.showAll", items.length));
  const more = rest.length
    ? `<div class="reveal"><div><ol class="timeline">${rest.map(timelineItem).join("")}</ol></div></div>
<p class="tl-foot"><button class="more-btn" type="button" data-expand="${id}" data-more="${all}" data-less="${esc(w("loop.showLess"))}" aria-expanded="false" aria-controls="${id}">${all}</button></p>`
    : "";
  return `<ol class="timeline">${items.slice(0, shown).map(timelineItem).join("")}</ol>${more}`;
}

const TIMELINE_SHOWN = 5;
function timelineSection(items) {
  if (!items.length) return `<section class="block"><h2 class="title">${w("loop.timeline")}</h2><p class="muted">${w("loop.nothingYet")}</p></section>`;
  return `<section class="block" id="timeline"><h2 class="title">${w("loop.timeline")}</h2>${timelineList("timeline", items, TIMELINE_SHOWN)}</section>`;
}

function costSection(loop, owner) {
  const b = loop.baseline;
  const est = loop.estimate;
  const t = loop.triage;
  const hours = b?.hoursPerWeek ?? est?.hoursPerWeek;
  const score = triageScore(t);
  const group = triageGroup(loop);
  const groupWord = group ? w("loop.group")[group] : "";
  const confidence = (c) => w("cost.confidence")[c] || c;
  const summary = [hours != null && w("cost.perWeek", hours), b?.moneyUsd != null && `$${b.moneyUsd}`, score != null && w("cost.score", score, groupWord)].filter(Boolean);
  const evidence = owner && loop.evidence;
  if (!summary.length && !evidence) return "";
  const rows = [];
  const row = (k, v) => rows.push(`<div><dt>${k}</dt><dd>${v}</dd></div>`);
  const howOften = txt(est?.howOften);
  if (hours != null) row(w("cost.hours"), `${esc(hours)}${howOften ? ` · ${esc(howOften)}` : ""}`);
  if (b?.moneyUsd != null) row(w("cost.money"), `$${esc(b.moneyUsd)}`);
  if (b?.occurrences != null) row(w("cost.measured"), esc(w("cost.measuredTimes", b.occurrences, confidence(b.confidence))));
  if (evidence) row(w("cost.evidence"), `${esc(loop.evidence)}<span class="private">${w("cost.private")}</span>`);
  const source = b?.approvedAt ? w("cost.fromApproved", shortDate(b.approvedAt)) : b ? w("cost.fromMeasured") : est ? w("cost.fromEstimate") : "";
  const cost = rows.length
    ? `<div><h2 class="title">${w("cost.title")}</h2><dl class="status">${rows.join("")}</dl>${source ? `<p class="source">${source}</p>` : ""}</div>`
    : "";
  let triage = "";
  if (t) {
    const pips = (v) => Array.from({ length: P.triage.max }, (_, i) => `<i${i < v ? ' class="on"' : ""}></i>`).join("");
    const known = {
      time: hours != null && w("cost.known", w(b?.hoursPerWeek != null ? "cost.measuredWord" : "cost.estimatedWord"), esc(hours)),
      frequency: howOften && w("cost.howOften", esc(howOften)),
    };
    const list = P.triage.criteria
      .map((k) => {
        const word = w("loop.criteria")[k] || k.toUpperCase();
        const about = w("loop.criteriaNote")[k];
        const note = about ? noteButton(`${about} <b>${w("cost.thisLoop", esc(t[k]), P.triage.max)}${known[k] ? ` ${known[k]}` : ""}</b>`, w("cost.whatMeans", word)) : "";
        return `<li${k === "risk" ? ' class="risk"' : ""}><span class="lbl"><span class="k">${word}</span>${note}</span><span class="pips">${pips(t[k])}</span><span class="v">${k === "risk" ? "\u2212" : ""}${esc(t[k])}</span></li>`;
      })
      .join("");
    const { minScore, maxRisk } = P.triage.automateNow;
    const why =
      group === "automateNow"
        ? w("cost.whyAuto", minScore, maxRisk)
        : group === "notYet"
          ? t.risk >= P.triage.notYet.minRisk
            ? w("cost.whyRisk", P.triage.notYet.minRisk)
            : w("cost.whyLimit")
          : w("cost.whyNeeds", minScore, maxRisk);
    const from = t.source ? w("cost.scoredFrom", esc(w("loop.source")[t.source] || t.source)) : "";
    triage = `<div><h2 class="title">${w("cost.scoreTitle")}</h2><ul class="triage">${list}</ul><p class="why">${w("cost.scoreLine", score, groupWord, why)}${from}</p></div>`;
  }
  return `<section class="block"><details class="card disclosure"><summary><span><b>${w("cost.summaryTitle")}</b><small>${esc(summary.join(" · ") || w("cost.evidenceWord"))}</small></span><span class="disclosure-toggle" data-closed="${esc(w("cost.more"))}" data-open="${esc(w("cost.hide"))}"></span></summary><div class="disclosure-body"><div class="two">${cost}${triage}</div></div></details></section>`;
}

// Every owner action is a prompt for the AI app: the page itself never writes. Items: { id, label, prompt }, or null for a separator.
function loopActions(loop, exps, name, areaName, version) {
  const who = `${loop.code}, ${name}`;
  const items = [];
  const add = (id, ...args) => items.push({ id, label: w(`actions.labels.${id}`), prompt: w(`actions.prompts.${id}`, who, ...args) });
  const open = exps.find((e) => !e.conclusion);
  const t = open && byStage(open).at(-1);
  const level = lvIdx(loop.level);
  const measured = isMeasured(loop);
  if (loop.level === "still" && !measured && !loop.pendingBaseline) {
    if (loop.flag !== "measuring") add("startMeasuring");
    add("recordCost", P.limits.occurrencesToMeasure);
  }
  if (open && t?.outcome == null && t) add("endRound", open.code);
  else if (open && t?.outcome === "achieved" && !t.hold) add("recordProving", open.code);
  else if (open) {
    add("nextRound", open.code);
    add("endExperiment", open.code);
  } else if ((measured || estimateCanStart(version)) && level < lvIdx(ceilingOf(loop))) {
    const cost = measured || loop.estimate?.hoursPerWeek ? "" : w("actions.prompts.noEstimate");
    add("draft", lvName(loop.level), lvName(LEVELS[level + 1]), cost);
  }
  if (level >= lvIdx("assisted")) {
    add("recordDrop");
    add("stopNow", lvName("still"));
  }
  if (items.length) items.push(null);
  add("rename");
  add("scope");
  add("estimate");
  add("split");
  add("merge", areaName);
  add("retire");
  return items;
}

function askMenu(actions, connected) {
  if (!connected) return `<a class="btn signal" href="/connect">${w("common.connectAi")}</a>`;
  const items = actions
    .map((a) =>
      a
        ? `<button class="menu-item" type="button" data-loop-prompt="${esc(a.prompt)}" data-title="${esc(lowerFirst(a.label))}">${esc(a.label.toUpperCase())}</button>`
        : `<span class="menu-sep" role="separator"></span>`
    )
    .join("");
  return `<details class="menu ask" data-menu><summary class="btn signal"><span class="btn-stack">${w("loop.nextActions")}<small>${w("loop.askAgent")}</small></span>${CARET_ICON}</summary><div class="menu-list">${items}</div></details>`;
}

const loopPromptDialog = (code, name) => `<dialog class="modal" data-dialog data-loop-prompt-dialog aria-labelledby="loop-prompt-title">
<h3 id="loop-prompt-title">${w("loop.askTo")} <span data-prompt-title></span></h3>
<p class="modal-loop">${w("loop.promptIntro", esc(code), esc(name))}</p>
<div class="copy block-code">${promptBox("loop-prompt")}</div>
<div class="actions"><button class="btn" type="button" data-dialog-close>${w("common.cancel")}</button>${promptMenu("#loop-prompt", null, { up: true })}</div>
</dialog>`;

// Null when nobody may see a loop with this code: the route answers 404.
export function loopPage({ state, lang, owner, viewOnly = false, code, events = [], connected = false, url, share = null }) {
  const p = parseCode(code);
  if (!p) return null;
  const meta = state.meta;
  usePage(meta, lang, { tags: owner });
  const view = owner ? derive(state) : publicView(state);
  let loop = view.loops.find((l) => l.code === code);
  if (!loop && owner) {
    const raw = state.loops.find((l) => l.code === code);
    if (raw) loop = { ...raw, ...p, flag: null };
  }
  if (!loop) return null;
  const today = new Date().toISOString().slice(0, 10);
  const areaName = areaLabel(p.areaCode);
  const name = loop.private ? w("loop.private") : txt(loop.name);
  const done = loop.private ? "" : shown(loop.doneWhen);
  const scope = loop.private ? "" : shown(loop.scope);
  const exps = view.experiments
    .filter((e) => e.loops.includes(code))
    .sort((a, z) => (a.registeredAt === z.registeredAt ? (a.code < z.code ? 1 : -1) : a.registeredAt < z.registeredAt ? 1 : -1));

  const area = view.loops.filter((l) => l.code.startsWith(p.areaCode + "-")).map((l) => ({ code: l.code, n: parseCode(l.code).n }));
  const prev = area.filter((l) => l.n < p.n).sort((a, z) => z.n - a.n)[0];
  const next = area.filter((l) => l.n > p.n).sort((a, z) => a.n - z.n)[0];
  const step = (l, rel, word) => (l ? `<a href="/loop/${esc(l.code)}" rel="${rel}">${word} · ${esc(l.code)}</a>` : `<span aria-disabled="true">${word}</span>`);
  const crumbs = `<nav class="crumbs" aria-label="${esc(w("loop.crumbs"))}"><ol><li><a href="/">${w("loop.log")}</a></li><li>${esc(branchName(p.branch).toUpperCase())}</li><li>${esc(areaName.toUpperCase())}</li><li aria-current="page">${esc(code)}</li></ol><span class="stepper">${step(prev, "prev", w("loop.prev"))}${step(next, "next", w("loop.next"))}</span></nav>`;

  const actionable = owner && !viewOnly && !loop.retired && !loop.proposed;
  const actions = actionable ? loopActions(loop, exps, name, areaName, logVersion(meta)) : null;
  const head = `<section class="loop-head"><div><h1>${loop.private ? esc(name) : shown(loop.name)}</h1>${done ? `<p class="done"><span class="label">${w("loop.doneWhen")}</span>${done}</p>` : ""}${scope ? `<p class="scope"><span class="label">${w("loop.scope")}</span>${scope}</p>` : ""}${loop.private ? `<p class="done">${w("loop.privateNote")}</p>` : ""}</div>${actionable ? `<div class="head-side">${askMenu(actions, connected)}</div>` : ""}</section>`;

  const notices = [];
  if (loop.retired) notices.push(notice(w("loop.retired", esc(upDate(loop.retiredAt)), loop.retiredReason ? esc(loop.retiredReason) : ""), "bad"));
  if (loop.proposed) notices.push(notice(w("loop.proposed")));
  if (owner && loop.pending && !loop.retired) notices.push(notice(w("loop.pendingText")));

  const measuringFull = view.loops.filter((l) => l.flag === "measuring").length >= P.limits.measuringSlots;
  const next_ = nextLine(loop, exps, owner, today, measuringFull, logVersion(meta));
  const status = `<section class="status-block"><div class="status-row">${levelStack(loop, exps)}${experimentsBox(exps)}</div>${next_ ? `<p class="next-line"><span class="label">${w("loop.nextLabel")}</span>${esc(next_).replace(START_LINK, startLink())}</p>` : ""}</section>`;

  const body = `<div class="loop-page">
${flash(url)}${share ? shareBanner(share) : ""}${viewOnly ? viewOnlyNotice() : ""}${notices.join("")}
${crumbs}
${head}
${status}
${timelineSection(loopTimeline(loop, exps, owner ? events : []))}
${costSection(loop, owner)}
</div>
${experimentsDrawer(code, exps, today)}
${levelDialogs(loop, exps, logVersion(meta), actions, connected)}
${next_.includes(START_LINK) ? startExperimentDialog(loop, logVersion(meta), actions, connected) : ""}
${actionable && connected ? loopPromptDialog(code, name) : ""}`;
  const title = w("site.pageTitle", `${code} ${name}`, meta.ownerName);
  return layout({ title, meta, owner: owner && !viewOnly, body, origin: url?.origin, url, ...shareOg(share) });
}

// ---------------------------------------------------------------------------
// Experiment page: public once the log is published, like a loop's page. Private fields never reach it.

// Null when nobody may see an experiment with this code: the route answers 404.
export function expPage({ state, lang, owner, viewOnly = false, code, url, share = null }) {
  const meta = state.meta;
  usePage(meta, lang, { tags: owner });
  const view = owner ? derive(state) : publicView(state);
  const e = view.experiments.find((x) => x.code === code);
  if (!e) return null;
  const today = new Date().toISOString().slice(0, 10);
  const q = txt(e.question) || txt(e.pending?.question);
  const bet = expBet(e);
  const loopName = (c) => {
    const l = view.loops.find((x) => x.code === c);
    return l?.private ? esc(w("loop.private")) : shown(l?.name);
  };
  const loops = e.loops.map((c) => `<li class="row"><a class="code" href="/loop/${esc(c)}">${esc(c)}</a><span>${loopName(c)}</span></li>`).join("");
  const verdict = e.conclusion
    ? `<p class="exp-verdict"><span class="label">${w("exp.ended", esc(upDate(e.conclusion.at)))}</span>${esc(w("exp.betWord")[e.conclusion.hypothesis] || "")}</p>`
    : "";
  const odds = e.odds != null ? `<p class="exp-odds"><span class="label">${w("exp.odds")}</span>${esc(w("exp.oddsText", e.odds))}</p>` : "";
  const crumbs = `<nav class="crumbs" aria-label="${esc(w("loop.crumbs"))}"><ol><li><a href="/">${w("loop.log")}</a></li><li>${w("exp.crumb")}</li><li aria-current="page">${esc(code)}</li></ol></nav>`;
  const body = `<div class="loop-page exp-page">
${flash(url)}${share ? shareBanner(share) : ""}${viewOnly ? viewOnlyNotice() : ""}
${crumbs}
<section class="loop-head"><div><p class="exp-id">${esc(code)} · ${esc(w("exp.pick", e.slot))}</p><h1>${expQuestion(e)}</h1>${bet ? `<p class="done"><span class="label">${w("exp.bet")}</span>${bet}</p>` : ""}${odds}${verdict}</div></section>
<section class="block"><h2 class="title">${w("exp.loops")}</h2><ul class="plain">${loops}</ul></section>
<section class="block"><h2 class="title">${w("exp.rounds")}</h2><ul class="exps">${experimentItem(e, today)}</ul></section>
</div>`;
  const title = w("site.pageTitle", `${code} ${q}`, meta.ownerName);
  return layout({ title, meta, owner: owner && !viewOnly, body, origin: url?.origin, url, ...shareOg(share) });
}

// ---------------------------------------------------------------------------
// Share cards. share: { card, lang, languages, headline, image, urls, images, post, running, owner } from the worker.

const START_URL = "https://onhundred.com";
const shareOg = (share) => (share ? { ogImage: share.image, ogTitle: share.headline, ogDescription: w(share.running ? "share.ogRunning" : "share.ogStart") } : {});

const postImagesTools = (share) => {
  if (share.post === "ready")
    return `<p class="share-downloads"><span class="label">${w("share.toPost")}</span>${share.images.map((i) => `<a class="btn small" href="${esc(i.url)}" download>${esc(i.label)}</a>`).join("")}</p>`;
  if (share.post === "queued") return `<p class="muted">${w("share.imagesComing")}</p>`;
  if (!share.owner) return "";
  return `<form method="post" action="/owner/action" class="share-post"><input type="hidden" name="op" value="card_images"><input type="hidden" name="id" value="${esc(share.card.id)}"><input type="hidden" name="next" value="${esc(share.next || "/")}"><button class="btn small" type="submit">${w("share.getImages")}</button></form>`;
};

const copyLinks = (share) =>
  Object.entries(share.urls)
    .map(([lang, u]) => {
      const id = `card-url-${share.card.id}-${lang}`;
      return `<div class="copy"><span class="copy-field"><span class="copy-label">${w("share.link")}${Object.keys(share.urls).length > 1 ? ` · ${esc(lang.toUpperCase())}` : ""}</span><code id="${esc(id)}">${esc(u)}</code></span><button class="btn" type="button" data-copy="#${esc(id)}" data-card-copied="${esc(share.card.id)}">${w("common.copy")}</button></div>`;
    })
    .join("");

const shareCta = (share) => w(share.running ? "share.guess" : "share.start");

// The banner a visitor sees on the page a card links to. The owner also gets the card's tools.
function shareBanner(share) {
  const tools = share.owner ? `<div class="share-tools">${copyLinks(share)}${postImagesTools(share)}</div>` : "";
  return `<aside class="share-banner" aria-label="${esc(w("share.banner"))}"><p class="share-headline">${esc(share.headline)}</p><a class="btn signal small" href="${START_URL}" rel="noopener">${shareCta(share)}</a>${tools}</aside>`;
}

// The owner's log page: cards with a link nobody copied yet, from the last 2 weeks.
function readyPanel(shares) {
  const items = shares
    .map(
      (s) =>
        `<li class="share-ready-item"><img src="${esc(s.imagePath)}" alt="" width="300" height="158" loading="lazy"><div><p class="share-headline">${esc(s.headline)}</p>${copyLinks(s)}${postImagesTools(s)}</div></li>`
    )
    .join("");
  return `<section class="block share-ready" aria-labelledby="share-ready-title"><h2 class="title" id="share-ready-title"><mark>${w("share.ready")}</mark></h2><p class="muted">${w("share.readyNote")}</p><ul class="plain">${items}</ul></section>`;
}

// The standalone card page: for links from a private log. It never links to the rest of the log.
export function cardPage({ meta, lang, share, origin }) {
  usePage(meta, lang || share.lang, { tags: share.owner });
  const lines = cardLines(share.card.facts);
  const body = `<section class="block share-page">
<img class="share-image" src="${esc(share.imagePath)}" alt="${esc(share.headline)}" width="1200" height="630">
<h1>${esc(share.headline)}</h1>
<ul class="plain share-facts">${lines.map((l) => `<li>${esc(l)}</li>`).join("")}</ul>
<p><a class="btn signal" href="${START_URL}" rel="noopener">${shareCta(share)}</a></p>
${share.owner ? `<div class="share-tools">${copyLinks(share)}${postImagesTools(share)}</div>` : postImagesTools(share)}
</section>`;
  return layout({ title: share.headline, meta, signedIn: share.owner, body, origin, ...shareOg(share) });
}

// The plain facts a card shows under its headline, in the page's language.
function cardLines(f) {
  const out = [];
  if (f.loop) out.push(`${f.loop.code} · ${txt(f.loop.name)} · ${f.loop.levelName?.[LANG] || lvName(f.loop.level)}`);
  if (f.experiment) {
    const x = f.experiment;
    out.push(`${x.code} · ${txt(x.question)}`);
    if (x.hypothesis) out.push(w("share.bet", txt(x.hypothesis)));
    if (x.odds != null) out.push(w("share.odds", x.odds));
  }
  const hours = f.loop?.hours || f.experiment?.loops?.find((l) => l.hours)?.hours;
  if (hours) out.push(w("share.hours", hours.perWeek, w("share.source")[hours.source] || hours.source));
  out.push(w("share.handedOff", f.handedOff, f.points, f.total));
  return out;
}

export { cardRenderPage } from "./card-render.mjs";

export function privatePage({ meta, lang, origin, configured: isConfigured, hasConnections, preview = false }) {
  usePage(meta, lang);
  const body = `${preview ? previewNotice() : ""}${!isConfigured ? setupNotice() : ""}
<section class="block hero-private">
<h1>${w("privatePage.title")}</h1>
<p>${w("privatePage.text")}</p>
${mcpUrlBox(origin)}
<p><a class="btn signal" href="/login">${w("notices.signIn")}</a></p>
${!hasConnections ? `<p class="muted">${w("privatePage.firstTime")}</p>` : ""}
</section>`;
  return layout({ title: w("site.logTitle"), meta, signedIn: preview, body, origin });
}

const setupNotice = () => notice(w("notices.setup"), "bad");

// ---------------------------------------------------------------------------
// Onboarding

const mcpUrlBox = (origin) =>
  `<div class="copy"><span class="copy-field"><span class="copy-label">${w("connect.mcpServer")}</span><code id="mcp-url">${esc(origin)}/mcp</code></span><button class="btn" type="button" data-copy="#mcp-url">${w("common.copy")}</button></div>`;

const codeBlock = (id, text) => `<div class="copy block-code"><pre id="${id}">${esc(text)}</pre><button class="btn" type="button" data-copy="#${id}">${w("common.copy")}</button></div>`;

export function connectPage({ meta, lang, origin }) {
  usePage(meta, lang);
  const url = `${origin}/mcp`;
  const steps = (items) => `<ol class="steps">${items.map((s) => `<li>${s}</li>`).join("")}</ol>`;
  const claudeInstall = `https://claude.ai/customize/connectors?modal=add-custom-connector&connectorName=Onhundred&connectorUrl=${encodeURIComponent(url)}`;
  const xai = `curl https://api.x.ai/v1/responses \\
  -H "Authorization: Bearer $XAI_API_KEY" \\
  -H "Content-Type: application/json" \\
  -d '{
    "model": "grok-4",
    "input": ${JSON.stringify(w("connect.xaiInput"))},
    "tools": [{
      "type": "mcp",
      "server_label": "onhundred",
      "server_url": "${url}",
      "authorization": "YOUR_ONHUNDRED_API_KEY"
    }]
  }'`;
  const openai = `"tools": [{
  "type": "mcp",
  "server_label": "onhundred",
  "server_url": "${url}",
  "authorization": "YOUR_ONHUNDRED_API_KEY"
}]`;
  const anthropic = `"mcp_servers": [{
  "type": "url",
  "name": "onhundred",
  "url": "${url}",
  "authorization_token": "YOUR_ONHUNDRED_API_KEY"
}]`;
  const body = `<section class="block">
<h1>${w("connect.title")}</h1>
<p>${w("connect.intro")}</p>
${mcpUrlBox(origin)}
</section>
<section class="block cards">
<article class="card"><h3>Claude</h3>${steps(w("connect.claudeSteps"))}<div class="card-action"><p class="muted">${w("connect.claudeNote")}</p><a class="btn signal" href="${esc(claudeInstall)}" target="_blank" rel="noopener">${w("connect.claudeAdd")}</a></div></article>
<article class="card"><h3>ChatGPT</h3>${steps(w("connect.chatgptSteps"))}<div class="card-action"><p class="muted">${w("connect.chatgptNote")}</p><a class="btn signal" href="https://chatgpt.com/plugins" target="_blank" rel="noopener" data-copy="#mcp-url">${w("connect.chatgptAdd")}</a></div></article>
<article class="card"><h3>Grok</h3>${steps(w("connect.grokSteps"))}<div class="card-action"><p class="muted">${w("connect.grokNote")}</p><a class="btn signal" href="https://grok.com/connectors" target="_blank" rel="noopener" data-copy="#mcp-url">${w("connect.grokAdd")}</a></div></article>
</section>
<section class="block">
${sectionTitle(API_ICON, w("connect.apiTitle"))}
<details class="card disclosure">
<summary><span><b>${w("connect.apiSummary")}</b><small>${w("connect.apiSummaryNote")}</small></span><span class="disclosure-toggle" data-closed="${esc(w("cost.more"))}" data-open="${esc(w("cost.hide"))}"></span></summary>
<div class="disclosure-body">
<p><a class="btn" href="/connections#new-key">${w("connect.createKey")}</a></p>
<h3>xAI Grok API</h3>
${codeBlock("xai", xai)}
<h3>OpenAI Responses API</h3>
${codeBlock("openai", openai)}
<h3>Anthropic Messages API (MCP connector)</h3>
${codeBlock("anthropic", anthropic)}
<p class="muted">${w("connect.apiNote")}</p>
</div>
</details>
</section>
<section class="block">
${sectionTitle(CHAT_ICON, w("connect.talkTitle"))}
<ul class="starters">${PROMPTS.map((p) => `<li><b>${esc(w(`prompts.${p.name}.title`))}</b><small>${esc(w(`prompts.${p.name}.description`))}</small></li>`).join("")}</ul>
<p class="muted">${w("connect.talkNote")}</p>
</section>`;
  return layout({ title: w("site.appTitle", w("connect.title")), meta, owner: true, body, current: "/connections", origin });
}

// ---------------------------------------------------------------------------
// Connections

export function connectionsPage({ meta, lang, agents, url, newKey }) {
  usePage(meta, lang);
  const rows = agents
    .map((a) => {
      const status = a.revoked_at ? w("connections.revoked", esc(a.revoked_at.slice(0, 10))) : w("connections.active");
      const revoke = a.revoked_at
        ? ""
        : `<form method="post" action="/owner/action"><input type="hidden" name="op" value="revoke"><input type="hidden" name="id" value="${esc(a.id)}"><button class="btn small" type="submit">${w("connections.revoke")}</button></form>`;
      return `<tr><td><b>${esc(a.name)}</b></td><td>${w(a.kind === "key" ? "connections.apiKey" : "connections.signIn")}</td><td>${esc(w("connections.access")[a.access] || a.access)}</td><td>${esc(a.created_at.slice(0, 10))}</td><td>${status}</td><td>${revoke}</td></tr>`;
    })
    .join("");
  const keyBox = newKey
    ? `<section class="block">${notice(w("connections.copyKey"), "good")}<div class="copy"><code id="new-key-value">${esc(newKey.key)}</code><button class="btn" type="button" data-copy="#new-key-value">${w("common.copy")}</button></div></section>`
    : "";
  const head = w("connections.columns").map((c) => `<th>${c}</th>`).join("");
  const body = `${flash(url)}${keyBox}
<section class="block">
<div class="page-head"><h1>${w("connections.title")}</h1><a class="btn signal" href="/connect">${w("common.connectAi")}</a></div>
<p>${w("connections.intro")}</p>
${agents.length ? `<table class="table"><thead><tr>${head}<th></th></tr></thead><tbody>${rows}</tbody></table>` : `<p class="empty">${w("connections.none")}</p>`}
</section>
<section class="block" id="new-key">
${sectionTitle(KEY_ICON, w("connections.newKey"))}
<form method="post" action="/owner/action" class="card form">
<input type="hidden" name="op" value="create_key">
<label>${w("connections.name")} <input class="field" name="name" required maxlength="40" placeholder="grok-bot"></label>
<label>${w("connections.accessLabel")} <select class="field" name="access"><option value="agent">${w("connections.agentOption")}</option><option value="owner">${w("connections.ownerOption")}</option></select></label>
<button class="btn signal" type="submit">${w("connections.create")}</button>
</form>
</section>`;
  return layout({ title: w("site.appTitle", w("connections.title")), meta, owner: true, body, current: "/connections", url });
}

// ---------------------------------------------------------------------------
// Sign-in and consent

export function loginPage({ meta, lang, next = "/", error = "", configured: isConfigured }) {
  usePage(meta, lang);
  const body = `<section class="block narrow">
<h1>${w("login.title")}</h1>
${!isConfigured ? setupNotice() : ""}
${error ? notice(esc(error), "bad") : ""}
<form method="post" action="/login" class="card form">
<input type="hidden" name="next" value="${esc(next)}">
<label>${w("login.password")} <input class="field" type="password" name="password" autocomplete="current-password" required autofocus></label>
<button class="btn signal" type="submit">${w("login.submit")}</button>
</form>
</section>`;
  return layout({ title: w("site.appTitle", w("login.title")), meta, body });
}

export function consentPage({ meta, lang, details, handle }) {
  usePage(meta, lang);
  const where = details.redirectIsLoopback ? w("consent.loopback", esc(details.redirectHost)) : esc(details.redirectHost);
  const body = `<section class="block narrow">
<h1>${esc(w("consent.title", details.clientName))}</h1>
<form method="post" action="/authorize" class="card form">
<input type="hidden" name="handle" value="${esc(handle)}">
<p>${w("consent.wants", `<b>${esc(details.clientName)}</b>`, details.clientDomain ? `<b>${esc(details.clientDomain)}</b>` : "")}</p>
<p>${w("consent.will")}</p>
<p class="muted">${w("consent.tokens", where)}</p>
<p class="muted">${w("consent.scopes", details.scope.map(esc).join(", ") || "mcp")}</p>
<div class="actions"><button class="btn signal" type="submit" name="decision" value="approve">${w("consent.allow")}</button><button class="btn" type="submit" name="decision" value="deny">${w("consent.deny")}</button></div>
</form>
</section>`;
  return layout({ title: w("site.appTitle", w("consent.pageTitle")), meta, body });
}

export function messagePage({ meta, lang, title, text, status = 400 }) {
  usePage(meta, lang);
  return html(layout({ title, meta, body: `<section class="block narrow"><h1>${esc(title)}</h1><p>${esc(text)}</p><p><a href="/">${w("common.backToLog")}</a></p></section>` }), { status });
}
