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
  isHardEligible,
  isMeasured,
  levelName,
  logVersion,
  parseCode,
  pendingRuleBreaks,
  pickText,
  progressNote,
  protocol as P,
  publicActivity,
  publicView,
  renderGrid,
  triageGroup,
  triageScore,
  validate,
} from "../lib/protocol.mjs";
import { VIEW_HOURS } from "./auth.mjs";
import { pendingItems } from "./ops.mjs";
import { PROMPTS } from "./mcp.mjs";

const LEVEL_NAME = { empty: "EMPTY", ...Object.fromEntries(LEVELS.map((l) => [l, levelName(l).toUpperCase()])) };
const LEVEL_NOTES = {
  empty: "no loop here yet",
  still: "you decide and act. Filled squares are measured",
  assisted: "the agent advises, you act",
  delegated: "the agent acts, you approve",
  autonomous: "the agent acts, you review",
};
const AREAS = { relationships: "RELATIONSHIPS", personal: "PERSONAL", company: "COMPANY" };
const STATUS = {
  registered: "NOT STARTED",
  running: "TRYING",
  holding: "PROVING",
  reached: "LEVEL REACHED",
  notAchieved: "DIDN'T PASS",
  terminated: "STOPPED",
  concluded: "ENDED",
};
const VERDICT = { confirmed: "BET RIGHT", refuted: "BET WRONG", unclear: "NOT CLEAR" };
const TIP = {
  levels: LEVEL_NAME,
  measured: "MEASURED",
  flags: { measuring: "MEASURING", experimenting: "TRYING", holding: "PROVING" },
  outcomes: { achieved: "Last round passed", notAchieved: "Last round didn't pass", terminated: "Last round stopped", dropped: "Dropped a level" },
  open: "TAP AGAIN TO OPEN",
};

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

// signedIn without owner: the owner previewing the visitor's page. The body is the visitor's; the nav still knows who's here.
// ogImage, ogTitle and ogDescription replace the link preview: a shared card swaps in its own image and headline.
function layout({ title, ownerName, version = P.version, owner = false, signedIn = owner, body, current = "", origin = "", description: about = "", ogImage = "", ogTitle = "", ogDescription = "" }) {
  const link = (href, label) => `<a href="${href}"${current === href ? ' aria-current="page"' : ""}>${label}</a>`;
  const description = about || `${ownerName ? `${ownerName}'s log` : "A log"} that follows the ${CREDIT.text}.`;
  const image = ogImage || `${origin}/og.png`;
  const signOut = `<form method="post" action="/logout"><button type="submit" class="linkish">SIGN OUT</button></form>`;
  const nav = owner
    ? `<nav class="nav">${link("/", "LOG")}${link("/connections", "CONNECTIONS")}<a href="/export" data-export-open>EXPORT</a>${signOut}</nav>`
    : signedIn
      ? `<nav class="nav"><a href="/">BACK TO YOUR LOG</a>${signOut}</nav>`
      : `<nav class="nav"><a href="/login">SIGN IN</a></nav>`;
  return `<!doctype html>
<html lang="en" class="dark">
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
<body>
<header class="top">
<a class="brand" href="/"><img src="/wordmark.svg" alt="Onhundred" width="68" height="9"><span>PROTOCOL v${esc(version)}${ownerName ? ` · ${esc(ownerName.toUpperCase())}` : ""}</span></a>
${nav}
</header>
<main>
${body}
</main>
${owner ? exportDialog() : ""}
<footer class="foot"><a class="foot-mark" href="${esc(CREDIT.url)}" rel="noopener" aria-label="Onhundred"><img src="/on100.svg" alt="" width="32" height="32"></a><span>Follows the <a href="${esc(CREDIT.url)}" rel="noopener">${esc(CREDIT.text)}</a> and <a href="https://4geeks.com" rel="noopener">4Geeks.com</a>. v${esc(P.version)}.${owner ? " Your data lives in your Cloudflare account." : ""}</span></footer>
</body>
</html>`;
}

// The EXPORT link downloads directly without JavaScript; with it, this dialog explains the file first.
const exportDialog = () => `<dialog class="modal" data-export-dialog aria-labelledby="export-title">
<form method="get" action="/export">
<h3 id="export-title">Download your log?</h3>
<p class="modal-loop">You get 1 JSON file, onhundred-log-${new Date().toISOString().slice(0, 10)}.json, with a copy of your whole log as it is right now.</p>
<p>It contains:</p>
<ul class="modal-list">
<li>Your settings and the protocol version your log runs.</li>
<li>Every loop, including proposed and retired ones.</li>
<li>Every experiment, with all its stages and tries.</li>
<li>The full history: every change, who made it, when, and what it changed.</li>
</ul>
<p>It includes private fields that never appear on your public page, like evidence, people involved and notes. Store it somewhere safe.</p>
<p class="muted">It leaves out your password, API keys and connections. Downloading changes nothing in your log. A backup is also saved to your Cloudflare account every night.</p>
<div class="actions"><button class="btn signal" type="submit">DOWNLOAD JSON</button><button class="btn" type="button" data-export-cancel>CANCEL</button></div>
</form>
</dialog>`;

const notice = (text, kind = "") => `<p class="notice${kind ? " " + kind : ""}">${text}</p>`;

// Saves confirm in a toast that leaves on its own; errors stay in the page until the person acts on them.
const toast = (text) =>
  `<div class="toast" role="status" aria-live="polite" data-toast>${CHECK_CIRCLE_ICON}<span>${text}</span><button class="notice-close" type="button" data-dismiss aria-label="Close">${CLOSE_ICON}</button></div>`;

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
    .map(([v, t]) => `v${v}: ${t.en}`)
    .join("; ");

function protocolNotice(meta, upgrade) {
  const u = meta.protocolUpgrade;
  if (u)
    return notice(
      `You adopted protocol v${esc(u.version)}. It takes effect after check-in ${esc(u.fromCycle - 1)}. Until then the log runs v${esc(meta.protocolVersion)}.`
    );
  if (!upgrade) return "";
  const running = meta.mode === "frozen" && meta.cycle >= 1;
  const when = running ? `takes effect after check-in ${meta.cycle}` : "takes effect now, since check-ins haven't started";
  const what = changesSince(meta.protocolVersion);
  return `<form method="post" action="/owner/action" class="notice upgrade"><input type="hidden" name="op" value="adopt_protocol"><span>Protocol v${esc(P.version)} is in this code and your log runs v${esc(meta.protocolVersion)}${what ? ` (${esc(what)})` : ""}. Adopting it ${when}.</span><button class="btn signal small" type="submit">ADOPT v${esc(P.version)}</button></form>`;
}

const shortDate = (day) => new Date(`${day}T00:00:00Z`).toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "UTC" });

// Until the next check-in after an adoption: what changed, and the handed-off figure under both versions with the same loops.
export function changeNote(change) {
  const what = Object.entries(P.changes || {})
    .filter(([v]) => compareVersions(v, change.from) > 0 && compareVersions(v, change.to) <= 0)
    .map(([, t]) => t.en)
    .join("; ");
  const head = `Adopted ${shortDate(change.at)}${what ? `: ${what}` : ""}.`;
  if (change.delegatedBefore === change.delegatedAfter) return head;
  return `${head} Handed off went from ${change.delegatedBefore} to ${change.delegatedAfter} with no change in loops.`;
}

// Empty squares pad each branch toward its share of the 100, so the grid always shows what's left to fill.
// A branch past its share takes squares from the others: the total never exceeds 100.
const per = Math.floor(P.limits.loops / P.branchOrder.length);
const SHARES = Object.fromEntries(
  P.branchOrder.map((b, i) => [b, i === P.branchOrder.length - 1 ? P.limits.loops - per * i : per])
);
function emptySlots(loops) {
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
      lang: meta.languages[0],
      metric: "delegated",
      labels: { areas: AREAS, private: "Private loop" },
      slots: emptySlots(view.loops),
      ...opts,
    }
  );

// The check-in closes the last day of each 2-week period.
function nextCheckIn(day) {
  const left = P.limits.cycleWeeks * 7 - (Number(day) || 1);
  if (left <= 0) return "Today";
  return left === 1 ? "Tomorrow" : `In ${left} days`;
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
function shareText(meta, points) {
  const who = meta.ownerName || "";
  if (points > 0)
    return who
      ? `${who} has handed off ${points} of ${P.limits.loops} loops of life and work to AI agents. Every result is in the log.`
      : `${points} of ${P.limits.loops} loops of life and work handed off to AI agents so far. Every result is in the log.`;
  return who
    ? `${who} is handing off ${P.limits.loops} loops of life and work to AI agents, one at a time. Every result is in the log.`
    : `${P.limits.loops} loops of life and work, handed off to AI agents one at a time. Every result is in the log.`;
}

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
      `<a class="menu-item" href="${esc(s.href(t, u))}" target="_blank" rel="noopener" aria-label="Share on ${s.name} (opens in a new tab)">${linkIcon(s.id)}${s.name.toUpperCase()}</a>`
  ).join("");
  return `<details class="menu share" data-menu><summary class="btn small signal">SHARE${CARET_ICON}</summary><div class="menu-list">${items}<input type="hidden" id="share-url" value="${esc(url)}"><button class="menu-item" type="button" data-copy="#share-url" aria-label="Copy the link to this log">${COPY_ICON}COPY LINK</button></div></details>`;
}

const profilePrompt = (meta) =>
  `Use Onhundred to write the header of my public log. Read onhundred://docs/voice, then call get_state.${meta.ownerName ? "" : " Ask me the name to show and set ownerName."} Ask me why I run the protocol, and write it in 1 or 2 sentences, ${ABOUT_MAX_WORDS} words or fewer, in every language of the log. Ask me for up to ${MAX_LINKS} profile links: ${Object.values(PROFILE_LINKS).map((k) => k.name).join(", ")}. Show me the exact text and links before you call set_meta with about and links.`;

const profileDialog = (meta) => `<dialog class="modal" data-dialog data-profile-dialog aria-labelledby="profile-title">
<h3 id="profile-title">Edit your header with AI</h3>
<p class="modal-loop">Your name, 1 line on why you run the protocol and your links show above your numbers on the public page. Edit the prompt if you like, then open it in your AI app.</p>
<div class="copy block-code">${promptBox("profile-prompt", profilePrompt(meta), 7)}</div>
<div class="actions"><button class="btn" type="button" data-dialog-close>CANCEL</button>${promptMenu("#profile-prompt", profilePrompt(meta), { up: true })}</div>
</dialog>`;

const LINK_HINTS = {
  x: "@handle or x.com/handle",
  linkedin: "linkedin.com/in/handle",
  github: "@handle",
  instagram: "@handle",
  youtube: "@channel",
  tiktok: "@handle",
  threads: "@handle",
  bluesky: "handle.bsky.social",
  mastodon: "@you@instance.social",
  website: "yoursite.com",
};

// The page saves links itself: they need no wording, so no AI app is involved.
const linksDialog = (meta) => {
  const current = Object.fromEntries((meta.links || []).map((l) => [l.kind, l.url]));
  const fields = Object.entries(PROFILE_LINKS)
    .map(
      ([kind, k]) =>
        `<label class="link-field"><span class="link-kind">${linkIcon(kind)}${esc(k.name.toUpperCase())}</span><input class="field" type="text" name="link_${kind}" value="${esc(current[kind] || "")}" placeholder="${esc(LINK_HINTS[kind])}" autocomplete="off" autocapitalize="off" spellcheck="false" inputmode="url"></label>`
    )
    .join("");
  return `<dialog class="modal" data-dialog data-links-dialog aria-labelledby="links-title">
<form method="post" action="/owner/action" data-quick-form>
<input type="hidden" name="op" value="set_meta"><input type="hidden" name="setting" value="links">
<h3 id="links-title">Your social accounts</h3>
<p class="modal-loop">They show as FOLLOW buttons above your numbers on the public page. Paste a link or type a handle, up to ${MAX_LINKS}.</p>
<div class="link-fields">${fields}</div>
<label class="modal-all"><input type="checkbox" name="none" value="1"${Array.isArray(meta.links) && !meta.links.length ? " checked" : ""}> <span>I don't use social media. Stop asking.</span></label>
<p class="notice bad" data-form-error role="alert" hidden></p>
<div class="actions"><button class="btn signal" type="submit">SAVE LINKS</button><button class="btn" type="button" data-dialog-close>CANCEL</button></div>
</form>
</dialog>`;
};

const nameDialog = (meta) => `<dialog class="modal" data-dialog data-name-dialog aria-labelledby="name-title">
<form method="post" action="/owner/action" data-quick-form>
<input type="hidden" name="op" value="set_meta"><input type="hidden" name="setting" value="name">
<h3 id="name-title">Your name</h3>
<p class="modal-loop">It shows in large type above your numbers on the public page.</p>
<input class="field" type="text" name="ownerName" value="${esc(meta.ownerName || "")}" maxlength="80" required autocomplete="name" aria-labelledby="name-title">
<p class="notice bad" data-form-error role="alert" hidden></p>
<div class="actions"><button class="btn signal" type="submit">SAVE</button><button class="btn" type="button" data-dialog-close>CANCEL</button></div>
</form>
</dialog>`;

// The owner types the line straight in. Owner text goes live at once, checked like every public text.
const aboutDialog = (meta) => {
  const langs = meta.languages;
  const fields = langs
    .map(
      (lang) =>
        `<label class="about-field">${langs.length > 1 ? `<span class="label">${esc(lang.toUpperCase())}</span>` : ""}<textarea class="field" name="about_${esc(lang)}" rows="3" placeholder="I run the protocol to…">${esc(meta.about?.[lang] || "")}</textarea></label>`
    )
    .join("");
  return `<dialog class="modal" data-dialog data-about-dialog aria-labelledby="about-title">
<form method="post" action="/owner/action" data-quick-form>
<input type="hidden" name="op" value="set_meta"><input type="hidden" name="setting" value="about">
<h3 id="about-title">Why you run the protocol</h3>
<p class="modal-loop">1 or 2 sentences under your name on the public page, ${ABOUT_MAX_WORDS} words or fewer${langs.length > 1 ? ", in every language of the log" : ""}. Leave it empty to remove it.</p>
<div class="about-fields">${fields}</div>
<p class="notice bad" data-form-error role="alert" hidden></p>
<div class="actions"><button class="btn signal" type="submit">SAVE</button><button class="btn" type="button" data-dialog-close>CANCEL</button></div>
</form>
</dialog>`;
};

// Until the owner adds links or says they have none, every visit to the log page asks.
function linksNotice(published) {
  const text = published
    ? "Visitors can't follow you yet. Add your social accounts so they show above your numbers."
    : "Add your social accounts. Visitors see them above your numbers once you publish.";
  return `<div class="notice upgrade links-ask"><span>${text}</span><button class="btn signal small" type="button" data-open-dialog="[data-links-dialog]">ADD YOUR LINKS</button></div>`;
}

// Who runs this log, why, and where to follow them: the first thing a visitor reads.
// The owner sees the same header, plus SHARE once published, a links button, and an AI button for the rest.
function profileHead(meta, points, { owner, connected, published, origin }) {
  const lang = meta.languages[0];
  const about = pickText(meta.about, lang);
  const links = (meta.links || []).filter((l) => PROFILE_LINKS[l.kind]);
  const edit = owner && connected;
  const share = owner && published;
  if (!meta.ownerName && !about && !links.length && !owner) return "";
  const name = meta.ownerName || (owner ? "Your name" : "");
  const follow = links.length
    ? `<div class="profile-follow"><span class="label" id="follow-label">FOLLOW${meta.ownerName ? ` ${esc(meta.ownerName.split(/\s+/)[0].toUpperCase())}` : ""}</span><ul class="profile-links" aria-labelledby="follow-label">${links
        .map((l) => {
          const label = `${meta.ownerName ? `${meta.ownerName} on ` : ""}${PROFILE_LINKS[l.kind].name} (opens in a new tab)`;
          return `<li><a href="${esc(l.url)}" target="_blank" rel="me noopener" aria-label="${esc(label)}" title="${esc(PROFILE_LINKS[l.kind].name)}">${linkIcon(l.kind)}</a></li>`;
        })
        .join("")}</ul></div>`
    : "";
  const textMissing = !meta.ownerName || !about;
  const pencil = (dialog, label) =>
    owner ? ` <button class="pencil" type="button" data-open-dialog="[${dialog}]" aria-label="${label}" title="${label}">${PENCIL_ICON}</button>` : "";
  // The pencil wraps with the last word, never alone on its own line.
  const withPencil = (text, btn) => {
    if (!btn) return esc(text);
    const at = text.lastIndexOf(" ") + 1;
    return `${esc(text.slice(0, at))}<span class="nowrap">${esc(text.slice(at))}${btn}</span>`;
  };
  const aboutPencil = pencil("data-about-dialog", about ? "Edit why you run the protocol" : "Write why you run the protocol");
  const aboutLine = about
    ? `<p class="profile-about">${withPencil(about, aboutPencil)}</p>`
    : owner
      ? `<p class="profile-about empty">${withPencil("Add 1 line on why you run the protocol, so visitors know what this log is for.", aboutPencil)}</p>`
      : "";
  const nameLine = name
    ? `<h1 class="profile-name${meta.ownerName ? "" : " empty"}">${withPencil(name, pencil("data-name-dialog", meta.ownerName ? "Edit your name" : "Add your name"))}</h1>`
    : "";
  const linksBtn = owner
    ? `<button class="btn small" type="button" data-open-dialog="[data-links-dialog]">${links.length ? "EDIT LINKS" : "ADD LINKS"}</button>`
    : "";
  const editBtn = edit
    ? `<button class="btn small" type="button" data-open-dialog="[data-profile-dialog]">${textMissing ? "ADD WITH AI" : "EDIT WITH AI"}</button>`
    : "";
  const actions = follow + (share ? shareMenu(meta, points, origin) : "") + linksBtn + editBtn;
  return `<section class="profile">
<div class="profile-id">${nameLine}${aboutLine}</div>
${actions ? `<div class="profile-actions">${actions}</div>` : ""}
</section>${edit ? profileDialog(meta) : ""}${owner ? linksDialog(meta) + aboutDialog(meta) + nameDialog(meta) : ""}`;
}

// The figure leads; everything else is a labelled status row beside it (below it on phones).
// The owner's small grid at the end of the row only shows on wide screens, where it opens the full one (the next section).
// Visitors get the full grid open instead.
function readout(view, meta, owner, headed = false) {
  const m = view.metrics;
  const approved = view.loops.length;
  const row = (label, value, note = "") =>
    `<div><dt>${label}</dt><dd>${value}${note ? noteButton(note) : ""}</dd></div>`;
  const rows = [
    meta.cycle
      ? row(`CHECK-IN ${esc(meta.cycle)}`, nextCheckIn(meta.day))
      : row("CHECK-INS", "Not started", "They start when your list is frozen."),
    row(
      "YOUR LIST",
      meta.mode === "frozen" ? `v${esc(meta.inventoryVersion || 1)} · ${approved} loops` : `${approved} of ${P.limits.loops} approved`,
      meta.mode === "frozen" ? "Frozen: a new loop needs a merge or a retirement." : ""
    ),
  ];
  if (meta.stillMetric) rows.push(row(`STILL ${meta.ownerName ? "THEM" : "YOU"}`, `${m.stillPct}%`));
  const change = meta.protocolChange;
  const current = changeIsCurrent(change, new Date().toISOString().slice(0, 10));
  rows.push(row("PROTOCOL", `v${esc(meta.protocolVersion)}`, current ? esc(changeNote(change)) : ""));
  const mini = owner ? drawGrid(view, meta, { compact: true }) : null;
  const progress = progressNote(view);
  return `<section class="readout">
<div class="readout-main"><${headed ? "p" : "h1"} class="figure"><span class="pct" data-assisted-weight="${assistedWeight(m.version || P.version)}">${m.delegatedPoints}</span><span class="cap">OF ${P.limits.loops}<br>HANDED OFF</span></${headed ? "p" : "h1"}>${progress ? `<p class="figure-note">${esc(progress)}</p>` : ""}${owner ? `<a class="btn small" href="/?view=public" target="_blank" rel="noopener" aria-label="Check your public dashboard (opens in a new tab)">CHECK YOUR PUBLIC DASHBOARD${NEW_TAB_ICON}</a>` : ""}</div>
<dl class="status">${rows.join("")}</dl>
${mini ? `<a class="grid mini" href="#activity" role="button" aria-expanded="false" aria-controls="activity" data-grid-toggle style="grid-template-columns:${mini.columns}" aria-label="Show the full delegation grid">${mini.html}</a>` : ""}
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
const noteButton = (text, label = "More about this") =>
  `<details class="note" data-menu><summary aria-label="${label}">${INFO_ICON}</summary><div class="note-pop" role="note">${text}</div></details>`;

const FIRST_PROMPT = "Use Onhundred to help me build my 100 loops.";

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
      `<a class="menu-item" href="${esc(prompt == null ? "#" : a.href(encodeURIComponent(prompt)))}" data-app-href="${esc(a.href("{q}"))}" target="_blank" rel="noopener" aria-label="Open the prompt in ${a.name}">${APP_ICONS[a.id]}${a.name.toUpperCase()}</a>`
  ).join("");
  return `<details class="menu${up ? " up" : ""}" data-menu data-prompt-source="${source}"><summary class="btn signal">USE PROMPT${CARET_ICON}</summary><div class="menu-list">${apps}<button class="menu-item" type="button" data-copy="${source}" aria-label="Copy the prompt">${COPY_ICON}COPY</button></div></details>`;
};

// Every prompt is editable before it goes to the agent.
const promptBox = (id, text = "", rows = 6) =>
  `<textarea class="prompt-box" id="${id}" rows="${rows}" spellcheck="false" aria-label="Prompt. Edit it before you send it.">${esc(text)}</textarea>`;

function emptyState(owner, connected) {
  if (!owner) return `<section class="block empty-state"><h2>No loops yet</h2><p>The list is still being made.</p></section>`;
  if (!connected) {
    return `<section class="block empty-state">
<h2>No loops yet</h2>
<p>Your AI app proposes them and you approve each one here.</p>
<aside class="help-box"><span class="help-icon">${HELP_ICON}</span><div><p>Connect an AI app to your log to start.</p><a class="btn signal" href="/connect">CONNECT YOUR AI</a></div></aside>
</section>`;
  }
  return `<section class="block empty-state">
<h2>No loops yet</h2>
<p>Your AI app proposes them and you approve each one here. Start with this prompt, and edit it first if you like:</p>
<div class="copy">${promptBox("first-prompt", FIRST_PROMPT, 2)}${promptMenu("#first-prompt", FIRST_PROMPT)}</div>
</section>`;
}

function gridSection(view, meta, owner, connected, hasProposals) {
  const { html: cells, columns } = drawGrid(view, meta);
  const slots = Object.values(emptySlots(view.loops)).reduce((a, n) => a + n, 0);
  const counts = { empty: slots - view.loops.length, ...view.metrics?.counts };
  const legend = ["empty", ...LEVELS]
    .map(
      (l) =>
        `<li data-level="${l}"><i class="cell" data-s="${l}"></i><span class="lv">${LEVEL_NAME[l]}<small>${esc(LEVEL_NOTES[l])}</small></span><span class="n">${counts[l] || 0}</span></li>`
    )
    .join("");
  const grid = view.loops.length
    ? `<div class="grid" data-grid data-tip="${esc(JSON.stringify(TIP))}" style="grid-template-columns:${columns}" role="img" aria-label="Delegation grid: each square is 1 loop">${cells}</div>`
    : `<div class="grid" data-grid style="grid-template-columns:${columns}" role="img" aria-label="Delegation grid: no loops yet">${cells}</div>`;
  return `<section class="block" id="activity"${owner ? "" : " data-open"}>
${grid}
<ul class="legend">${legend}</ul>
</section>${view.loops.length || hasProposals ? "" : emptyState(owner, connected)}`;
}

function experimentsSection(experiments, lang) {
  if (!experiments.length) return "";
  const sorted = [...experiments].sort((a, b) => Boolean(a.conclusion) - Boolean(b.conclusion) || (a.code < b.code ? 1 : -1));
  const rows = sorted
    .map((e) => {
      const q = pickText(e.question, lang) || pickText(e.pending?.question, lang);
      const bet = pickText(e.hypothesis, lang) || pickText(e.pending?.hypothesis, lang);
      let status = STATUS[e.status] || "";
      if (e.status === "concluded") status += ` · ${VERDICT[e.verdict] || ""}`;
      else if (e.stage) status += ` · ROUND ${e.stage} · ${LEVEL_NAME[e.level] || String(e.level).toUpperCase()}`;
      return `<li class="exp"><span class="exp-id">${esc(e.code)} · ${esc(e.slot.toUpperCase())} PICK</span><span class="exp-title">${esc(q)}</span><span class="exp-status" data-status="${esc(e.status)}">${esc(status)}</span>${bet ? `<p class="exp-bet"><span class="label">BET</span>${esc(bet)}</p>` : ""}</li>`;
    })
    .join("");
  return `<section class="block">${sectionTitle(EXPERIMENTS_ICON, "EXPERIMENTS")}<ul class="exps">${rows}</ul></section>`;
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
function proposedCard(proposed, broken, lang, published, fixable, connected) {
  const eligible = proposed.filter((l) => !broken.has(l.code));
  const rows = proposed
    .map((l) => {
      const name = pickText(l.name, lang);
      const bad = broken.has(l.code);
      const replaces = l.replaces?.length ? l.replaces.join(", ") : "";
      const button = bad
        ? `<button class="icon-btn warn" type="button" title="Why ${esc(l.code)} can't be approved yet" aria-label="Why ${esc(l.code)} can't be approved yet" data-rule-break="${esc(JSON.stringify(broken.get(l.code)))}"${fixable ? ` data-fix-prompt="${esc(fixable(l.code, broken.get(l.code)))}"` : ""} data-code="${esc(l.code)}" data-name="${esc(name)}">${WARNING_ICON}</button>`
        : `<form method="post" action="/owner/action" data-approve-one><input type="hidden" name="op" value="approve_loops"><input type="hidden" name="codes" value="${esc(l.code)}"><button class="icon-btn" type="submit" title="Approve ${esc(l.code)}" aria-label="Approve ${esc(l.code)}: ${esc(name)}" data-code="${esc(l.code)}" data-name="${esc(name)}" data-replaces="${esc(replaces)}">${CHECK_ICON}</button></form>`;
      const scope = pickText(l.scope, lang);
      return `<li class="row approve-row" data-branch="${esc(parseCode(l.code)?.branch || "")}"><span class="code">${esc(l.code)}</span><span><b>${esc(name)}</b>${bad ? ` <span class="flag-bad">BREAKS A RULE · RENAME FIRST</span>` : ""}<small>Done when: ${esc(pickText(l.doneWhen, lang))}${scope ? ` · Scope: ${esc(scope)}` : ""}${replaces ? ` · replaces ${esc(replaces)}` : ""} · by ${esc(l.proposedBy || "")}</small></span>${button}</li>`;
    })
    .join("");
  const visibility = published
    ? "Its name, \u201cdone when\u201d and scope become public: anyone can read them on your log page and in /public.json."
    : "Its name, \u201cdone when\u201d and scope become part of your log. Your log is private now; if you publish it, anyone can read them.";
  const dialog = `<dialog class="modal" data-approve-dialog data-codes="${esc(JSON.stringify(eligible.map((l) => l.code)))}" aria-labelledby="approve-title">
<form method="post" action="/owner/action">
<input type="hidden" name="op" value="approve_loops"><div data-codes-inputs></div>
<h3 id="approve-title" data-approve-title>Approve this loop?</h3>
<p class="modal-target" data-approve-loop><span class="code" data-approve-code></span><span data-approve-name></span></p>
<p>Approving adds a loop to your list for good:</p>
<ul class="modal-list">
<li>It counts toward your ${P.limits.loops} loops.</li>
<li>${visibility}</li>
<li>Your agents can measure it, and it can be picked for an experiment.</li>
<li>Its code is never reused. To take it out later you retire it, and the history keeps both steps.</li>
<li data-approve-replaces hidden></li>
</ul>
<label class="modal-all"><input type="checkbox" data-approve-all> <span data-approve-all-label>Approve all ${eligible.length} proposed loops that pass the rules</span></label>
<div class="actions"><button class="btn signal" type="submit" data-approve-submit>APPROVE</button><button class="btn" type="button" data-approve-cancel>CANCEL</button></div>
</form>
</dialog>
<dialog class="modal" data-dialog data-rule-dialog aria-labelledby="rule-title">
<h3 id="rule-title"><span data-rule-code></span> breaks a rule</h3>
<p class="modal-target" data-rule-name></p>
<ul class="modal-list" data-rule-list></ul>
<p>It can't be approved with this text. Rename it with your AI app, then approve the new name here.</p>
<div class="actions"><button class="btn" type="button" data-dialog-close>CLOSE</button>${fixable ? `<button class="btn signal fix-btn" type="button" data-dialog-close data-rule-fix>${ROBOT_ICON}FIX</button>` : ""}</div>
</dialog>`;
  const hint = broken.size && eligible.length < proposed.length ? " Loops that break a rule need a new name first." : "";
  const counts = {};
  for (const l of proposed) {
    const b = parseCode(l.code)?.branch;
    counts[b] = (counts[b] || 0) + 1;
  }
  const tabs = P.branchOrder
    .map((b) => `<button type="button" aria-pressed="false" data-branch-tab="${b}"${counts[b] ? "" : " disabled"}>${esc(P.branches[b].name.toUpperCase())}<span class="n">${counts[b] || 0}</span></button>`)
    .join("");
  const add = connected ? `<button class="btn small signal fix-btn" type="button" data-add-loop>${PLUS_ICON}ADD NEW LOOP</button>` : "";
  return `<div class="card" data-branch-filter><div class="card-head"><h3>Proposed loops (${proposed.length})</h3><div class="card-tools"><div class="tabs" role="group" aria-label="Filter by branch" hidden>${tabs}</div>${add}</div></div><p class="hint">Approve each loop with its button.${hint}</p><ul class="plain">${rows}</ul>${dialog}${connected ? addLoopDialog() : ""}<template data-open-icon>${ARROW_RIGHT_ICON}</template></div>`;
}

const PLUS_ICON = phosphor(
  "M228,128a12,12,0,0,1-12,12H140v76a12,12,0,0,1-24,0V140H40a12,12,0,0,1,0-24h76V40a12,12,0,0,1,24,0v76h76A12,12,0,0,1,228,128Z"
);

const ADD_LOOP_PROMPT =
  "Use Onhundred to help me add new loops to my log. Read onhundred://docs/loops and onhundred://docs/voice, then call list_loops so you don't propose a loop I already have. Ask me which activities I want to add, or what you can read (calendar, email, documents) to find them. Check each loop against the six tests and decide whether it needs a scope. Show me the batch before you call propose_loops, in every language of the log.";

const addLoopDialog = () => `<dialog class="modal" data-dialog data-add-loop-dialog aria-labelledby="add-loop-title">
<h3 id="add-loop-title">Add a new loop with AI</h3>
<p class="modal-loop">This is the prompt your agent gets. Edit it first: name the activities you have in mind, or leave it and your agent will ask.</p>
<div class="copy block-code">${promptBox("add-loop-prompt", ADD_LOOP_PROMPT, 8)}</div>
<div class="actions"><button class="btn" type="button" data-dialog-close>CANCEL</button>${promptMenu("#add-loop-prompt", ADD_LOOP_PROMPT, { up: true })}</div>
</dialog>`;

const fixPrompt = (target, rules, version) =>
  `Use Onhundred to fix ${target} in my log. It breaks the protocol v${version} rules: ${rules} Rewrite it in every language of the log, then tell me what changed.`;

const ROBOT_ICON = phosphor(
  "M72,104a16,16,0,1,1,16,16A16,16,0,0,1,72,104Zm96,16a16,16,0,1,0-16-16A16,16,0,0,0,168,120Zm68-40V192a36,36,0,0,1-36,36H56a36,36,0,0,1-36-36V80A36,36,0,0,1,56,44h60V16a12,12,0,0,1,24,0V44h60A36,36,0,0,1,236,80Zm-24,0a12,12,0,0,0-12-12H56A12,12,0,0,0,44,80V192a12,12,0,0,0,12,12H200a12,12,0,0,0,12-12Zm-12,82a30,30,0,0,1-30,30H86a30,30,0,0,1,0-60h84A30,30,0,0,1,200,162Zm-80-6v12h16V156ZM86,168H96V156H86a6,6,0,0,0,0,12Zm90-6a6,6,0,0,0-6-6H160v12h10A6,6,0,0,0,176,162Z"
);

// One dialog for every FIX button; each button carries its own prompt.
const fixDialog = () => `<dialog class="modal" data-dialog data-fix-dialog aria-labelledby="fix-title">
<h3 id="fix-title">Fix <span data-fix-target></span> with AI</h3>
<p class="modal-loop">Edit the prompt if you like, then open it in your AI app, or copy it into any chat connected to your log.</p>
<div class="copy block-code">${promptBox("fix-prompt")}</div>
<div class="actions"><button class="btn" type="button" data-dialog-close>CANCEL</button>${promptMenu("#fix-prompt", null, { up: true })}</div>
</dialog>`;

function breaksCard(breaks, connected) {
  const rows = breaks.items
    .map((v) => {
      const fix = connected
        ? `<button class="btn signal small fix-btn" type="button" aria-label="Fix ${esc(v.target)} with AI" data-fix="${esc(fixPrompt(v.target, v.message.slice(v.target.length + 2), breaks.version))}" data-target="${esc(v.target)}">${ROBOT_ICON}FIX</button>`
        : "";
      return `<li class="row${connected ? " fix-row" : ""}"><span class="code">${esc(v.target)}</span><span>${esc(v.message.slice(v.target.length + 2))}</span>${fix}</li>`;
    })
    .join("");
  const how = breaks.adopted
    ? "Fix each one with your AI app, then approve the new names here. A text that breaks a rule can't be approved."
    : "Adopting isn't blocked by these. Fix them with your AI app, before or after you adopt.";
  const connect = connected ? "" : `<div class="actions"><a class="btn signal" href="/connect">CONNECT YOUR AI</a></div>`;
  return `<div class="card"><h3>Breaks v${esc(breaks.version)} rules (${breaks.items.length})</h3><p>${how}</p><ul class="plain">${rows}</ul>${connect}</div>`;
}

function pendingSection(state, published, connected) {
  const lang = state.meta.languages[0];
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
    broken.get(v.target).push(v.message.slice(v.target.length + 2));
  }
  if (!text.length && !proposed.length && !retirements.length && !baselines.length && !breaks.items.length) return "";
  const parts = [];
  if (breaks.items.length) parts.push(breaksCard(breaks, connected));
  const fixable = connected ? (code, rules) => fixPrompt(code, rules.join(" "), state.meta.protocolVersion) : null;
  if (proposed.length) parts.push(proposedCard(proposed, broken, lang, published, fixable, connected));
  if (connected && (breaks.items.length || proposed.some((l) => broken.has(l.code)))) parts.push(fixDialog());
  if (text.length) {
    const rows = text
      .map((i) => {
        const fields = Object.keys(i.pending)
          .map((k) => {
            const was = pickText(i.ref[k], lang);
            return `<span class="diff"><small>${esc(k)}</small>${was ? `<s>${esc(was)}</s>` : ""}<b>${esc(pickText(i.pending[k], lang))}</b></span>`;
          })
          .join("");
        return `<label class="row"><input type="checkbox" name="targets" value="${esc(i.target)}" checked><span class="code">${esc(i.target)}</span><span>${fields}</span></label>`;
      })
      .join("");
    parts.push(
      `<form method="post" action="/owner/action" class="card"><h3>Text waiting to go public (${text.length})</h3>${rows}<div class="actions"><button class="btn signal" type="submit" name="op" value="approve_text">PUBLISH SELECTED</button><button class="btn" type="submit" name="op" value="reject_text">DISCARD SELECTED</button></div></form>`
    );
  }
  if (retirements.length) {
    const rows = retirements
      .map((l) => `<label class="row"><input type="checkbox" name="retire" value="${esc(l.code)}" checked><span class="code">${esc(l.code)}</span><span>${esc(pickText(l.name, lang))}<small>${esc(l.retireProposed.reason)} · by ${esc(l.retireProposed.by || "")}</small></span></label>`)
      .join("");
    parts.push(`<form method="post" action="/owner/action" class="card"><input type="hidden" name="op" value="approve_loops"><h3>Retirements (${retirements.length})</h3>${rows}<button class="btn" type="submit">RETIRE SELECTED</button></form>`);
  }
  for (const l of baselines) {
    const b = l.pendingBaseline;
    parts.push(
      `<form method="post" action="/owner/action" class="card"><input type="hidden" name="op" value="approve_baseline"><input type="hidden" name="code" value="${esc(l.code)}"><h3>Measured cost for ${esc(l.code)}</h3><p>${esc(pickText(l.name, lang))}: ${esc(b.hoursPerWeek)} h a week, $${esc(b.moneyUsd)}, watched ${esc(b.occurrences)} times (${esc(b.confidence)} confidence)${b.quality ? `, ${esc(b.quality)}` : ""}.</p><button class="btn" type="submit">APPROVE COST</button></form>`
    );
  }
  return `<section class="block">${sectionTitle(WAITING_ICON, "<mark>WAITING</mark> FOR YOU")}${parts.join("")}</section>`;
}

const HISTORY_LABELS = {
  propose_loops: "Loops proposed",
  rename_loop: "New name, done-when or scope proposed",
  update_loop: "Estimate or score updated",
  split_loop: "Split proposed",
  merge_loops: "Merge proposed",
  retire_loop: "Retirement proposed",
  set_measuring: "Measuring turned on or off",
  record_baseline: "Measured cost recorded",
  register_stage_try: "Round written down",
  close_stage_try: "Round ended",
  record_hold: "Proving recorded",
  record_drop: "Level dropped",
  add_learned: "Lesson proposed",
  approve_loops: "Loops approved",
  approve_text: "Text published",
  reject_text: "Proposed text discarded",
  approve_baseline: "Measured cost approved",
  set_published: "Partner publishing changed",
  freeze_inventory: "List frozen",
  register_experiment: "Experiment written down",
  conclude_experiment: "Experiment ended",
  set_meta: "Settings changed",
  adopt_protocol: "Protocol version adopted",
  undo_event: "A change was undone",
  mark_check_in: "Check-in marked",
  card_created: "Share card made",
  connect: "AI app connected",
  revoke_connection: "AI app disconnected",
  revoke_api_key: "API key revoked",
};
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
    if (targets.length > HISTORY_REFS) refs.push({ text: `+${targets.length - HISTORY_REFS} MORE` });
    return {
      at: e.at,
      s: levelOf.get(targets.find((t) => levelOf.has(t))),
      text: (HISTORY_LABELS[tool] || sentence(tool.replace(/_/g, " "))) + (tool !== e.tool ? " (override)" : ""),
      kind: HISTORY_BAD.has(tool) ? "bad" : "",
      by: `#${e.id} · ${e.actor}`,
      refs,
    };
  });
  return `<section class="block" id="history">${sectionTitle(HISTORY_ICON, "HISTORY")}${timelineList("history", items, HISTORY_SHOWN)}</section>`;
}

// Same stroke weight as the Phosphor bold icons.
const PULSE_ICON = `<svg viewBox="0 0 256 256" width="18" height="18" fill="none" stroke="currentColor" stroke-width="24" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M24 128h36l28-72 56 144 28-72h60"/></svg>`;

const PULSE_DAYS = 84;
const PULSE_TICK = P.limits.cycleWeeks * 7;
const PULSE_SHOWN = 6;
const PULSE_GROUPS = 60;
const PULSE_LABELS = {
  approve_loops: "Added to the list",
  approve_baseline: "Cost measured",
  approve_text: "New text published",
  freeze_inventory: `List frozen at ${P.limits.loops} loops`,
  register_experiment: "Experiment written down",
  register_stage_try: "Round started",
  close_stage_try: { achieved: "Round passed", notAchieved: "Round didn't pass", terminated: "Round stopped", "": "Round ended" },
  record_hold: { passed: `Held for ${P.limits.holdWeeks} weeks: moved up`, failed: `Didn't hold for ${P.limits.holdWeeks} weeks`, "": "Proving ended" },
  record_drop: "Dropped a level",
  conclude_experiment: { confirmed: "Experiment ended: bet right", refuted: "Experiment ended: bet wrong", unclear: "Experiment ended: not clear", "": "Experiment ended" },
  adopt_protocol: "New protocol version adopted",
};
const PULSE_BAD = new Set(["record_drop", "notAchieved", "terminated", "failed"]);
const plural = (n, one, many) => `${n} ${n === 1 ? one : many}`;

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
    const mark = back === 0 ? "TODAY" : back % PULSE_TICK === 0 ? shortDate(d.day).toUpperCase() : "";
    const cls = back === 0 ? "now" : mark && back % (PULSE_TICK * 2) ? "minor" : "";
    const segs = (d.agent ? `<i class="a" style="height:${pct(d.agent)}%"></i>` : "") + (d.person ? `<i class="p" style="height:${pct(d.person)}%"></i>` : "");
    return `<li style="--i:${i}"${cls ? ` class="${cls}"` : ""}${mark ? ` data-mark="${mark}"` : ""} data-date="${esc(shortDate(d.day).toUpperCase())}" data-n="${n ? plural(n, "change", "changes") : "No changes"}"${d.agent ? ` data-ag="${plural(d.agent, "by an agent", "by agents")}"` : ""}>${segs}</li>`;
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
  const rows = groups.slice(0, PULSE_GROUPS).map((g) => {
    const label = PULSE_LABELS[g.tool];
    const refs = g.codes.slice(0, HISTORY_REFS).map((c) => ({ text: c, href: levelOf.has(c) ? `/loop/${c}` : "" }));
    if (g.codes.length > HISTORY_REFS) refs.push({ text: `+${g.codes.length - HISTORY_REFS} MORE` });
    return {
      at: g.day,
      s: g.codes.map((c) => levelOf.get(c) || levelOf.get(firstLoop.get(c))).find(Boolean),
      text: typeof label === "string" ? label : label[g.result || ""],
      kind: PULSE_BAD.has(g.tool) || PULSE_BAD.has(g.result) ? "bad" : "",
      by: g.by === "agent" ? "BY AN AGENT" : g.by === "system" ? "ON SCHEDULE" : name ? `BY ${name}` : "BY HAND",
      byKind: g.by === "agent" ? "agent" : "person",
      refs,
    };
  });

  const sum = total
    ? `<b>${total}</b> ${total === 1 ? "change" : "changes"} in the last ${weeks} weeks. Agents made <b class="ag">${agents}</b>.`
    : `No changes in the last ${weeks} weeks.`;
  return `<section class="block pulse" id="pulse">
<div class="pulse-head">${sectionTitle(PULSE_ICON, "ACTIVITY")}<ul class="pulse-key"><li data-by="agent">AGENTS</li><li data-by="person">${esc(name || "BY HAND")}</li></ul></div>
<p class="pulse-sum">${sum}</p>
<figure class="spark" data-spark role="img" aria-label="Changes per day for the last ${weeks} weeks: ${total} in all, ${agents} by agents."><ol class="spark-bars" style="--days:${PULSE_DAYS}">${days.map(bar).join("")}</ol></figure>
${timelineList("pulse", rows, PULSE_SHOWN)}
</section>`;
}

const PUBLISH_CONFIRM =
  "Publish your log? Anyone with the link sees your grid and experiments. Evidence, notes and partner loops stay private.";

const privateNotice = () =>
  `<form method="post" action="/owner/action" class="notice upgrade" data-confirm="${esc(PUBLISH_CONFIRM)}"><input type="hidden" name="op" value="set_meta"><span>Your progress is private. You can publish it here.</span><button class="btn signal small" type="submit">PUBLISH</button></form>`;

// Closing it leaves the page exactly as a visitor sees it; a reload brings it back.
const previewNotice = () =>
  `<div class="notice good closable"><span>This is what visitors see. <a href="/">Back to your log</a>.</span><button class="notice-close" type="button" data-dismiss aria-label="Close this note to see the page as visitors do">${CLOSE_ICON}</button></div>`;

// Opened from an AI app's link: the owner view without a sign-in, so nothing on it changes the log.
const viewOnlyNotice = () =>
  `<div class="notice upgrade view-only"><span><b>VIEW ONLY.</b> Your AI app's link shows your log for ${VIEW_HOURS} hours. Sign in to approve or change anything.</span><a class="btn signal small" href="/login?next=/">SIGN IN</a></div>`;

function waitingLine(state) {
  const n = pendingItems(state).length + state.loops.filter((l) => (l.proposed || l.pendingBaseline || l.retireProposed) && !l.retired).length;
  return n ? notice(`${n} ${n === 1 ? "item waits" : "items wait"} for you. <a href="/login?next=/">Sign in</a> to approve ${n === 1 ? "it" : "them"}.`) : "";
}

export function logPage({ state, owner, viewOnly = false, events = [], publicEvents = [], url, upgrade, configured: isConfigured, hasConnections, published = false, preview = false, share = null, ready = [] }) {
  const meta = state.meta;
  const lang = meta.languages[0];
  const view = owner ? derive(state) : publicView(state);
  const acts = owner && !viewOnly;
  const title = meta.ownerName ? `${meta.ownerName}: Onhundred Protocol log` : "Onhundred Protocol log";
  const head = profileHead(meta, view.metrics.delegatedPoints, { owner: acts, connected: hasConnections, published, origin: url?.origin || "" });
  const body = [
    flash(url),
    share ? shareBanner(share) : "",
    preview ? previewNotice() : "",
    viewOnly ? viewOnlyNotice() : "",
    !isConfigured ? setupNotice() : "",
    acts && ready.length ? readyPanel(ready) : "",
    acts ? protocolNotice(meta, upgrade) : "",
    acts && !hasConnections ? notice(`Next: <a href="/connect">connect your first AI app</a>.`, "good") : "",
    acts && !published ? privateNotice() : "",
    acts && meta.links == null ? linksNotice(published) : "",
    head,
    readout(view, meta, acts, head.includes('class="profile-name')),
    gridSection(view, meta, acts, hasConnections, acts && state.loops.some((l) => l.proposed && !l.retired)),
    owner ? "" : activitySection(publicActivity(publicEvents, view), view, meta),
    acts ? pendingSection(state, published, hasConnections) : viewOnly ? waitingLine(state) : "",
    experimentsSection(view.experiments, lang),
    owner ? eventsSection(events, state.loops) : "",
  ].join("\n");
  const about = pickText(meta.about, lang);
  return layout({ title, ownerName: meta.ownerName, owner: acts, signedIn: acts || preview, body, current: "/", origin: url?.origin, description: about, ...shareOg(share) });
}

// ---------------------------------------------------------------------------
// Loop page

const lvIdx = (l) => LEVELS.indexOf(l);
const sentence = (s) => s.charAt(0).toUpperCase() + s.slice(1);
const upDate = (day) => (day ? shortDate(String(day).slice(0, 10)).toUpperCase() : "");
const byStage = (e) => [...(e.stages || [])].sort((a, b) => a.stage - b.stage || a.try - b.try);
const GROUP_WORD = { automateNow: "Automate now", later: "Later", notYet: "Not yet" };
const CRITERIA_WORD = { time: "TIME", frequency: "FREQUENCY", rules: "CLEAR RULES", digital: "DIGITAL DATA", risk: "RISK" };
const CRITERIA_NOTE = {
  time: "How many hours a week this loop takes. 1 is very little, 5 is a lot. More time means more to win back, so it adds to the score.",
  frequency: "How often this loop repeats. 1 is rarely, 5 is all the time. A loop that repeats often pays back the setup sooner, so it adds to the score.",
  rules: "How well defined the way it's done is. 1 is a judgment call every time, 5 is steps anyone could follow. Clear steps are easier to hand off, so it adds to the score.",
  digital: "Whether the information it needs already lives in apps, files or email. 1 is mostly in your head or on paper, 5 is all in systems. An agent only works with what it can read, so it adds to the score.",
  risk: `What happens if the agent gets it wrong. 1 is an easy fix, 5 is real harm or lost money. Risk subtracts from the score, and ${P.triage.notYet.minRisk} or more puts the loop in Not yet.`,
};
const OUTCOME_WORD = { achieved: "passed", notAchieved: "didn't pass", terminated: "stopped" };
const BET_WORD = { confirmed: "bet right", refuted: "bet wrong", unclear: "not clear" };
const SOURCE_WORD = { baseline: "measured cost", estimate: "estimate" };
const DROP_WORD = { failingDays: `after ${P.limits.failureDays} failing days`, harm: "after harm", consentLost: "after consent was withdrawn" };
const UPDOWN_ICON = phosphor(
  "M184.49,167.51a12,12,0,0,1,0,17l-48,48a12,12,0,0,1-17,0l-48-48a12,12,0,0,1,17-17L128,207l39.51-39.52A12,12,0,0,1,184.49,167.51Zm-96-79L128,49l39.51,39.52a12,12,0,0,0,17-17l-48-48a12,12,0,0,0-17,0l-48,48a12,12,0,0,0,17,17Z"
);

// History events that change a loop without leaving a dated trace in its own data.
const EVENT_LABELS = {
  propose_loops: "Proposed",
  approve_loops: "Approved by the owner",
  rename_loop: "New name, done-when or scope proposed",
  approve_text: "New text published",
  reject_text: "Proposed text discarded",
  update_loop: "Estimate or score updated",
  set_measuring: "Measuring turned on or off",
  split_loop: "Split proposed",
  merge_loops: "Merge proposed",
  retire_loop: "Retirement proposed",
  set_published: "Partner publishing changed",
  undo_event: "A change was undone",
};

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
    if (open) return [`${open[0].code} ${open[1].outcome == null ? "TRYING NOW" : "PROVING"}`, "run"];
    const failed = tries.filter((t) => t.level === l && (t.outcome === "notAchieved" || t.outcome === "terminated" || t.hold?.result === "failed")).at(-1);
    if (failed) return [`DIDN'T PASS ${upDate(failed.hold?.at || failed.closedAt)}`, "bad"];
    return ["NOT TRIED YET", ""];
  };
  const measured = isMeasured(loop);
  const mark = (l) => (l === "still" && measured ? " data-measured" : "");
  const inner = (l, [meta, kind] = ["", ""], extra = "") =>
    `<i class="cell" data-s="${l}"${mark(l)}${extra}></i><span class="lvl-name">${LEVEL_NAME[l]}${l === ceiling && l !== "autonomous" ? `<span class="tag">LIMIT</span>` : ""}</span><span class="lvl-plain">${esc(sentence(LEVEL_NOTES[l]))}</span><span class="lvl-meta${kind ? " " + kind : ""}">${esc(meta)}`;
  let nowMeta = loop.pendingBaseline ? ["COST WAITING", "run"] : loop.flag === "measuring" ? ["MEASURING", "run"] : ["", ""];
  const since = reachedOn(loop.level);
  if (!nowMeta[0] && since) nowMeta = [`SINCE ${upDate(since)}`, ""];
  if (!nowMeta[0] && loop.level === "still" && measured) nowMeta = ["MEASURED", ""];
  const flag = loop.flag ? ` data-flag="${esc(loop.flag)}"` : "";
  const rows = [];
  for (let i = top; i > cur; i--) rows.push(`<li class="lvl-row up" style="--k:${i - cur}">${inner(LEVELS[i], ahead(LEVELS[i]))}</span></li>`);
  for (let i = cur - 1; i >= 0; i--) {
    const on = reachedOn(LEVELS[i]);
    rows.push(`<li class="lvl-row down" data-reached style="--k:${cur - i}">${inner(LEVELS[i], [on ? upDate(on) : "", ""])}</span></li>`);
  }
  return `<div class="lvl" data-level-stack>
<button class="lvl-row lvl-now" type="button" aria-expanded="false" aria-controls="lvl-others" aria-label="Level: ${esc(levelName(loop.level))}. Show every level">${inner(loop.level, nowMeta, flag)}${UPDOWN_ICON}</span></button>
<ol class="lvl-others" id="lvl-others" aria-label="Every level up to the limit">${rows.join("")}</ol>
</div>`;
}

function experimentItem(e, lang, today) {
  const q = pickText(e.question, lang) || pickText(e.pending?.question, lang);
  const bet = pickText(e.hypothesis, lang) || pickText(e.pending?.hypothesis, lang);
  let status = STATUS[e.status] || "";
  if (e.conclusion) status += ` ${upDate(e.conclusion.at)} · ${VERDICT[e.conclusion.hypothesis] || ""}`;
  else if (e.stage) status += ` · ROUND ${e.stage} · ${LEVEL_NAME[e.level] || String(e.level).toUpperCase()}`;
  const stages = byStage(e)
    .map((t) => {
      const end = t.closedAt || t.deadline;
      let out = "TRYING";
      if (t.outcome == null && t.start > today) out = "SCHEDULED";
      if (t.outcome) out = OUTCOME_WORD[t.outcome].toUpperCase();
      if (t.outcome === "achieved") out += t.hold ? (t.hold.result === "passed" ? " · PROVED" : " · DIDN'T HOLD") : " · PROVING";
      const ok = t.outcome == null || (t.outcome === "achieved" && t.hold?.result !== "failed");
      const learned = pickText(t.learned, lang);
      return `<li><span class="st">ROUND ${t.stage}${t.try > 1 ? ` · TRY ${t.try}` : ""} · ${LEVEL_NAME[t.level] || t.level.toUpperCase()}</span><span>${t.start ? `${shortDate(t.start)} to ${shortDate(end)}.` : ""}${learned ? ` ${esc(learned)}` : ""}</span><span class="out ${ok ? "ok" : "no"}">${out}</span></li>`;
    })
    .join("");
  return `<li class="exp"><span class="exp-id">${esc(e.code)} · ${esc(String(e.slot).toUpperCase())} PICK</span><span class="exp-title">${esc(q)}</span><span class="exp-status" data-status="${esc(e.status)}">${esc(status)}</span>${bet ? `<p class="exp-bet"><span class="label">BET</span>${esc(bet)}</p>` : ""}${stages ? `<ol class="stages">${stages}</ol>` : ""}</li>`;
}

function experimentsBox(exps) {
  if (!exps.length) return `<span class="exp-box none">NO EXPERIMENTS YET</span>`;
  const ongoing = exps.filter((e) => !e.conclusion).length;
  return `<button class="exp-box" type="button" data-drawer-open aria-haspopup="dialog" aria-controls="exp-drawer"><b>${exps.length}</b>${exps.length === 1 ? "EXPERIMENT" : "EXPERIMENTS"}${ongoing ? `<span class="dot" aria-hidden="true"></span><span class="run">${ongoing} ONGOING</span>` : ""}${CARET_ICON}</button>`;
}

const experimentsDrawer = (code, exps, lang, today) =>
  exps.length
    ? `<dialog class="drawer" id="exp-drawer" data-dialog aria-labelledby="drawer-title">
<div class="drawer-head"><h2 id="drawer-title">Experiments</h2><button class="btn small" type="button" data-dialog-close>CLOSE</button></div>
<p class="muted">Every experiment that includes ${esc(code)}, newest first.</p>
<ul class="exps">${exps.map((e) => experimentItem(e, lang, today)).join("")}</ul>
</dialog>`
    : "";

// The one thing that happens next, worked out from the loop's state.
function nextLine(loop, exps, owner, today, measuringFull, version) {
  const open = exps.find((e) => !e.conclusion);
  const t = open && byStage(open).at(-1);
  if (loop.retired) return "";
  if (loop.proposed) return "Approve it on the log page to add it to your list.";
  if (loop.pendingBaseline) return owner ? "A measured cost is waiting for your approval on the log page." : "A measured cost is waiting for approval.";
  if (open && t?.outcome == null && t) {
    if (t.start > today) return `${open.code} round ${t.stage} starts ${shortDate(t.start)}.`;
    return `${open.code} round ${t.stage} ends ${shortDate(t.deadline)}. If it passes, ${P.limits.holdWeeks} weeks of proving decide ${levelName(t.level)}.`;
  }
  if (open && t?.outcome === "achieved" && !t.hold)
    return `${open.code} is proving ${levelName(t.level)}. Proving ends ${shortDate(new Date(Date.parse(`${t.closedAt}T00:00:00Z`) + P.limits.holdWeeks * 7 * 86400000).toISOString().slice(0, 10))}.`;
  if (open) return `${open.code} has no running round. The next round or the end of the experiment comes next.`;
  if (loop.level === "still" && !isMeasured(loop)) {
    const n = P.limits.occurrencesToMeasure;
    if (loop.flag === "measuring") return `Being measured now. After it happens ${n} times, its real cost is the starting point for time saved.`;
    if (!estimateCanStart(version)) {
      if (!owner) return `Nobody has measured this loop yet. Before an experiment, it has to happen ${n} times so its real cost is known.`;
      return measuringFull
        ? `All ${P.limits.measuringSlots} measuring spots are taken. Start measuring this loop when one opens.`
        : `Start measuring it. After it happens ${n} times, its real cost is known and experiments can start.`;
    }
    if (!loop.estimate?.hoursPerWeek)
      return owner
        ? "Write down its estimated cost so it can be picked for an experiment. Measure it if you want proof of time saved."
        : "It needs an estimated cost before an experiment can pick it.";
  }
  if (lvIdx(loop.level) >= lvIdx(ceilingOf(loop))) return `It's at its limit, ${levelName(loop.level)}. No experiment takes it higher.`;
  const group = triageGroup(loop);
  if (group === "automateNow") return "In Automate now: it can be the easy pick in the next experiment.";
  if (isHardEligible(loop)) return "It can be the hard pick in the next experiment.";
  return "No experiment yet. It waits to be picked.";
}

function loopTimeline(loop, exps, events) {
  const items = [];
  const add = (at, s, text, kind = "", by = "") => at && items.push({ at: String(at), s, text, kind, by, i: items.length });
  const b = loop.baseline || loop.pendingBaseline;
  if (b?.recordedAt)
    add(b.recordedAt, "still", `Measured cost recorded: watched ${b.occurrences} times${b.hoursPerWeek != null ? `, ${b.hoursPerWeek} h a week` : ""}`, "", b.recordedBy || "");
  if (loop.baseline?.approvedAt) add(loop.baseline.approvedAt, "still", "Measured cost approved: the loop is measured");
  for (const e of exps) {
    add(e.registeredAt, e.startLevel, `${e.code} written down as the ${e.slot} pick`);
    for (const t of byStage(e)) {
      const name = `${e.code} round ${t.stage}${t.try > 1 ? ` try ${t.try}` : ""}`;
      add(t.start, t.level, `${name} started: aims for ${levelName(t.level)}`, t.outcome == null ? "run" : "");
      if (t.closedAt) add(t.closedAt, t.level, `${name} ${OUTCOME_WORD[t.outcome]}`, t.outcome === "achieved" ? "" : "bad");
      if (t.hold)
        add(t.hold.at, t.level, t.hold.result === "passed" ? `Proved: reached ${levelName(t.level)}` : `${name} didn't hold`, t.hold.result === "passed" ? "" : "bad");
    }
    if (e.conclusion) add(e.conclusion.at, e.conclusion.level || e.startLevel, `Ended ${e.code}: ${BET_WORD[e.conclusion.hypothesis] || ""}`);
  }
  for (const d of loop.drops || [])
    add(d.at, d.to, `Dropped from ${levelName(d.from)} to ${levelName(d.to)} ${DROP_WORD[d.cause] || ""}`.trim(), "bad");
  if (loop.retiredAt) add(loop.retiredAt, loop.level, `Retired${loop.retiredReason ? `: ${loop.retiredReason}` : ""}`, "bad");
  for (const ev of events) if (EVENT_LABELS[ev.tool]) add(ev.at, null, EVENT_LABELS[ev.tool], "", `#${ev.id} · ${ev.actor}`);
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
  const more = rest.length
    ? `<div class="reveal"><div><ol class="timeline">${rest.map(timelineItem).join("")}</ol></div></div>
<p class="tl-foot"><button class="more-btn" type="button" data-expand="${id}" data-more="SHOW ALL ${items.length}" data-less="SHOW LESS" aria-expanded="false" aria-controls="${id}">SHOW ALL ${items.length}</button></p>`
    : "";
  return `<ol class="timeline">${items.slice(0, shown).map(timelineItem).join("")}</ol>${more}`;
}

const TIMELINE_SHOWN = 5;
function timelineSection(items) {
  if (!items.length) return `<section class="block"><h2 class="title">TIMELINE</h2><p class="muted">Nothing has happened to this loop yet.</p></section>`;
  return `<section class="block" id="timeline"><h2 class="title">TIMELINE</h2>${timelineList("timeline", items, TIMELINE_SHOWN)}</section>`;
}

function costSection(loop, owner) {
  const b = loop.baseline;
  const est = loop.estimate;
  const t = loop.triage;
  const hours = b?.hoursPerWeek ?? est?.hoursPerWeek;
  const score = triageScore(t);
  const group = triageGroup(loop);
  const summary = [
    hours != null && `${hours} h a week`,
    b?.moneyUsd != null && `$${b.moneyUsd}`,
    score != null && `score ${score}${group ? `, ${GROUP_WORD[group]}` : ""}`,
  ].filter(Boolean);
  const evidence = owner && loop.evidence;
  if (!summary.length && !evidence) return "";
  const rows = [];
  const row = (k, v) => rows.push(`<div><dt>${k}</dt><dd>${v}</dd></div>`);
  if (hours != null) row("HOURS A WEEK", `${esc(hours)}${est?.howOften ? ` · ${esc(est.howOften)}` : ""}`);
  if (b?.moneyUsd != null) row("MONEY", `$${esc(b.moneyUsd)}`);
  if (b?.occurrences != null) row("MEASURED", `${esc(b.occurrences)} times, ${esc(b.confidence)} confidence`);
  if (evidence) row("EVIDENCE", `${esc(loop.evidence)}<span class="private">PRIVATE</span>`);
  const source = b?.approvedAt
    ? `From the measured cost approved ${shortDate(b.approvedAt)}.`
    : b
      ? "From the measured cost."
      : est
        ? "From the estimate. A measured cost replaces it."
        : "";
  const cost = rows.length
    ? `<div><h2 class="title">COST</h2><dl class="status">${rows.join("")}</dl>${source ? `<p class="source">${source}</p>` : ""}</div>`
    : "";
  let triage = "";
  if (t) {
    const pips = (v) => Array.from({ length: P.triage.max }, (_, i) => `<i${i < v ? ' class="on"' : ""}></i>`).join("");
    const measured = b?.hoursPerWeek != null ? "Measured" : "Estimated";
    const known = {
      time: hours != null && `${measured}: ${esc(hours)} h a week.`,
      frequency: est?.howOften && `Estimated: ${esc(est.howOften)}.`,
    };
    const list = P.triage.criteria
      .map((k) => {
        const word = CRITERIA_WORD[k] || k.toUpperCase();
        const note = CRITERIA_NOTE[k]
          ? noteButton(
              `${CRITERIA_NOTE[k]} <b>This loop: ${esc(t[k])} of ${P.triage.max}.${known[k] ? ` ${known[k]}` : ""}</b>`,
              `What ${word.toLowerCase()} means`
            )
          : "";
        return `<li${k === "risk" ? ' class="risk"' : ""}><span class="lbl"><span class="k">${word}</span>${note}</span><span class="pips">${pips(t[k])}</span><span class="v">${k === "risk" ? "\u2212" : ""}${esc(t[k])}</span></li>`;
      })
      .join("");
    const { minScore, maxRisk } = P.triage.automateNow;
    const why =
      group === "automateNow"
        ? `Score ${minScore} or more and risk ${maxRisk} or less put it in Automate now.`
        : group === "notYet"
          ? t.risk >= P.triage.notYet.minRisk
            ? `Risk ${P.triage.notYet.minRisk} or more puts it in Not yet.`
            : "It's at its limit, so it's in Not yet."
          : `Automate now needs a score of ${minScore} or more and risk ${maxRisk} or less.`;
    triage = `<div><h2 class="title">SCORE</h2><ul class="triage">${list}</ul><p class="why">Score ${score}, ${GROUP_WORD[group]}. ${why}${t.source ? ` Scored from the ${esc(SOURCE_WORD[t.source] || t.source)}.` : ""}</p></div>`;
  }
  return `<section class="block"><details class="card disclosure"><summary><span><b>Cost and score</b><small>${esc(summary.join(" · ") || "Evidence")}</small></span><span class="disclosure-toggle" data-closed="MORE DETAILS" data-open="HIDE DETAILS"></span></summary><div class="disclosure-body"><div class="two">${cost}${triage}</div></div></details></section>`;
}

// Every owner action is a prompt for the AI app: the page itself never writes.
function loopActions(loop, exps, name, areaName, version) {
  const who = `${loop.code}, ${name}`;
  const items = [];
  const add = (label, prompt) => items.push([label, `Use Onhundred to ${prompt}`]);
  const open = exps.find((e) => !e.conclusion);
  const t = open && byStage(open).at(-1);
  const level = lvIdx(loop.level);
  const measured = isMeasured(loop);
  if (loop.level === "still" && !measured && !loop.pendingBaseline) {
    if (loop.flag !== "measuring") add("Start measuring", `start measuring ${who}. Call set_measuring, then tell me what you'll watch and how you'll count each time it happens.`);
    add("Record the measured cost", `record what ${who} costs today. It needs to be watched at least ${P.limits.occurrencesToMeasure} times. Ask me the hours a week and what it costs, then call record_baseline.`);
  }
  if (open && t?.outcome == null && t)
    add("End the running round", `end the running round of ${open.code} for ${who}. Ask me whether it passed, didn't pass or was stopped, and what it really cost, then call close_stage_try.`);
  else if (open && t?.outcome === "achieved" && !t.hold)
    add("Record the proving", `record whether ${open.code} held for ${who} over ${P.limits.holdWeeks} weeks of proving. Ask me whether it kept passing, then call record_hold.`);
  else if (open) {
    add("Start the next round", `write the next round of ${open.code} for ${who}. Call get_experiment first. Write the approach, the goals and the deadline, show them to me, then call register_stage_try.`);
    add("End the experiment", `end ${open.code} for ${who}. Call get_experiment, tell me whether the bet was right, wrong or not clear, and wait for my answer before conclude_experiment.`);
  } else if ((measured || estimateCanStart(version)) && level < lvIdx(ceilingOf(loop))) {
    const cost = measured || loop.estimate?.hoursPerWeek ? "" : " It has no estimated cost yet: ask me for one and call update_loop first.";
    add(
      "Draft an experiment",
      `draft an experiment for ${who}. It's at ${levelName(loop.level)}. Call get_loop and suggest_slots first, and aim for ${levelName(LEVELS[level + 1])}.${cost} Write the question and the bet (If, then, because) following onhundred://docs/voice. Show me both before you call register_experiment.`
    );
  }
  if (level >= lvIdx("assisted")) {
    add("Record a drop", `record a drop for ${who}. Ask me what failed and for how many days, then call record_drop with the cause and a private note.`);
    add("Stop it now", `stop ${who}, now. Someone was harmed or withdrew consent. Call record_drop so it goes straight back to ${levelName("still")}, then ask me what happened for the private note.`);
  }
  if (items.length) items.push(null);
  add("Rename", `rename ${who}. Read onhundred://docs/loops and onhundred://docs/voice, propose 3 names in every language of the log, and wait for my pick before rename_loop.`);
  add(
    "Write the scope",
    `write the scope for ${who}. Read onhundred://docs/loops and onhundred://docs/voice. Ask whether a neighbor loop could be confused with it. If yes, propose a scope in every language of the log (what counts, what doesn't, fixed constraints). If not, explain why none is needed. Wait for my pick before rename_loop.`
  );
  add("Update the estimate", `update the estimate and score of ${who}. Ask me what changed, then call update_loop.`);
  add("Split", `split ${who}, into smaller loops. Read onhundred://docs/loops, propose the new loops, and ask me whether the measured cost still applies before split_loop.`);
  add("Merge", `merge ${who}, with another ${areaName} loop. Show me the candidates and the merged name before merge_loops.`);
  add("Retire", `retire ${who}. Ask me why, then call retire_loop with that reason.`);
  return items;
}

function askMenu(loop, exps, name, areaName, connected, version) {
  if (!connected) return `<a class="btn signal" href="/connect">CONNECT YOUR AI</a>`;
  const items = loopActions(loop, exps, name, areaName, version)
    .map((it) =>
      it
        ? `<button class="menu-item" type="button" data-loop-prompt="${esc(it[1])}" data-title="${esc(it[0][0].toLowerCase() + it[0].slice(1))}">${esc(it[0].toUpperCase())}</button>`
        : `<span class="menu-sep" role="separator"></span>`
    )
    .join("");
  return `<details class="menu ask" data-menu><summary class="btn signal"><span class="btn-stack">NEXT ACTIONS<small>Ask your agent</small></span>${CARET_ICON}</summary><div class="menu-list">${items}</div></details>`;
}

const loopPromptDialog = (code, name) => `<dialog class="modal" data-dialog data-loop-prompt-dialog aria-labelledby="loop-prompt-title">
<h3 id="loop-prompt-title">Ask your agent to <span data-prompt-title></span></h3>
<p class="modal-loop">${esc(code)} · ${esc(name)}. Edit the prompt if you like, then open it in your AI app, or copy it into any chat connected to your log.</p>
<div class="copy block-code">${promptBox("loop-prompt")}</div>
<div class="actions"><button class="btn" type="button" data-dialog-close>CANCEL</button>${promptMenu("#loop-prompt", null, { up: true })}</div>
</dialog>`;

// Null when nobody may see a loop with this code: the route answers 404.
export function loopPage({ state, owner, viewOnly = false, code, events = [], connected = false, url, share = null }) {
  const p = parseCode(code);
  if (!p) return null;
  const meta = state.meta;
  const lang = meta.languages[0];
  const view = owner ? derive(state) : publicView(state);
  let loop = view.loops.find((l) => l.code === code);
  if (!loop && owner) {
    const raw = state.loops.find((l) => l.code === code);
    if (raw) loop = { ...raw, ...p, flag: null };
  }
  if (!loop) return null;
  const today = new Date().toISOString().slice(0, 10);
  const branch = P.branches[p.branch];
  const areaName = branch?.areas[p.area] || p.area;
  const name = loop.private ? "Private loop" : pickText(loop.name, lang);
  const done = loop.private ? "" : pickText(loop.doneWhen, lang);
  const scope = loop.private ? "" : pickText(loop.scope, lang);
  const exps = view.experiments
    .filter((e) => e.loops.includes(code))
    .sort((a, z) => (a.registeredAt === z.registeredAt ? (a.code < z.code ? 1 : -1) : a.registeredAt < z.registeredAt ? 1 : -1));

  const area = view.loops.filter((l) => l.code.startsWith(p.areaCode + "-")).map((l) => ({ code: l.code, n: parseCode(l.code).n }));
  const prev = area.filter((l) => l.n < p.n).sort((a, z) => z.n - a.n)[0];
  const next = area.filter((l) => l.n > p.n).sort((a, z) => a.n - z.n)[0];
  const step = (l, word) => (l ? `<a href="/loop/${esc(l.code)}" rel="${word.toLowerCase()}">${word} · ${esc(l.code)}</a>` : `<span aria-disabled="true">${word}</span>`);
  const crumbs = `<nav class="crumbs" aria-label="Breadcrumb"><ol><li><a href="/">LOG</a></li><li>${esc((branch?.name || p.branch).toUpperCase())}</li><li>${esc(areaName.toUpperCase())}</li><li aria-current="page">${esc(code)}</li></ol><span class="stepper">${step(prev, "PREV")}${step(next, "NEXT")}</span></nav>`;

  const actionable = owner && !viewOnly && !loop.retired && !loop.proposed;
  const head = `<section class="loop-head"><div><h1>${esc(name)}</h1>${done ? `<p class="done"><span class="label">DONE WHEN</span>${esc(done)}</p>` : ""}${scope ? `<p class="scope"><span class="label">SCOPE</span>${esc(scope)}</p>` : ""}${loop.private ? `<p class="done">This loop stays private until the person in it agrees to publish it.</p>` : ""}</div>${actionable ? `<div class="head-side">${askMenu(loop, exps, name, areaName, connected, logVersion(meta))}</div>` : ""}</section>`;

  const notices = [];
  if (loop.retired) notices.push(notice(`Retired ${esc(upDate(loop.retiredAt))}${loop.retiredReason ? `: ${esc(loop.retiredReason)}` : ""}. Only you can see this page, and the code is never reused.`, "bad"));
  if (loop.proposed) notices.push(notice(`Proposed and waiting for your approval on the <a href="/">log page</a>. Only you can see it until then.`));
  if (owner && loop.pending && !loop.retired) notices.push(notice(`New text is waiting for your approval on the <a href="/">log page</a>.`));

  const measuringFull = view.loops.filter((l) => l.flag === "measuring").length >= P.limits.measuringSlots;
  const next_ = nextLine(loop, exps, owner, today, measuringFull, logVersion(meta));
  const status = `<section class="status-block"><div class="status-row">${levelStack(loop, exps)}${experimentsBox(exps)}</div>${next_ ? `<p class="next-line"><span class="label">NEXT</span>${esc(next_)}</p>` : ""}</section>`;

  const body = `<div class="loop-page">
${flash(url)}${share ? shareBanner(share) : ""}${viewOnly ? viewOnlyNotice() : ""}${notices.join("")}
${crumbs}
${head}
${status}
${timelineSection(loopTimeline(loop, exps, owner ? events : []))}
${costSection(loop, owner)}
</div>
${experimentsDrawer(code, exps, lang, today)}
${actionable && connected ? loopPromptDialog(code, name) : ""}`;
  const title = `${code} ${name} · ${meta.ownerName ? `${meta.ownerName}: ` : ""}Onhundred Protocol log`;
  return layout({ title, ownerName: meta.ownerName, owner: owner && !viewOnly, body, origin: url?.origin, ...shareOg(share) });
}

// ---------------------------------------------------------------------------
// Experiment page: public once the log is published, like a loop's page. Private fields never reach it.

// Null when nobody may see an experiment with this code: the route answers 404.
export function expPage({ state, owner, viewOnly = false, code, url, share = null }) {
  const meta = state.meta;
  const lang = meta.languages[0];
  const view = owner ? derive(state) : publicView(state);
  const e = view.experiments.find((x) => x.code === code);
  if (!e) return null;
  const today = new Date().toISOString().slice(0, 10);
  const q = pickText(e.question, lang) || pickText(e.pending?.question, lang);
  const bet = pickText(e.hypothesis, lang) || pickText(e.pending?.hypothesis, lang);
  const loopName = (c) => {
    const l = view.loops.find((x) => x.code === c);
    return l?.private ? "Private loop" : pickText(l?.name, lang);
  };
  const loops = e.loops
    .map((c) => `<li class="row"><a class="code" href="/loop/${esc(c)}">${esc(c)}</a><span>${esc(loopName(c))}</span></li>`)
    .join("");
  const verdict = e.conclusion ? `<p class="exp-verdict"><span class="label">ENDED ${esc(upDate(e.conclusion.at))}</span>${esc(BET_WORD[e.conclusion.hypothesis] || "")}</p>` : "";
  const odds = e.odds != null ? `<p class="exp-odds"><span class="label">ODDS</span>${esc(e.odds)} in 100 that the bet holds</p>` : "";
  const crumbs = `<nav class="crumbs" aria-label="Breadcrumb"><ol><li><a href="/">LOG</a></li><li>EXPERIMENTS</li><li aria-current="page">${esc(code)}</li></ol></nav>`;
  const body = `<div class="loop-page exp-page">
${flash(url)}${share ? shareBanner(share) : ""}${viewOnly ? viewOnlyNotice() : ""}
${crumbs}
<section class="loop-head"><div><p class="exp-id">${esc(code)} · ${esc(String(e.slot).toUpperCase())} PICK</p><h1>${esc(q)}</h1>${bet ? `<p class="done"><span class="label">BET</span>${esc(bet)}</p>` : ""}${odds}${verdict}</div></section>
<section class="block"><h2 class="title">LOOPS</h2><ul class="plain">${loops}</ul></section>
<section class="block"><h2 class="title">ROUNDS</h2><ul class="exps">${experimentItem(e, lang, today)}</ul></section>
</div>`;
  const title = `${code} ${q} · ${meta.ownerName ? `${meta.ownerName}: ` : ""}Onhundred Protocol log`;
  return layout({ title, ownerName: meta.ownerName, owner: owner && !viewOnly, body, origin: url?.origin, ...shareOg(share) });
}

// ---------------------------------------------------------------------------
// Share cards. share: { card, lang, languages, headline, image, urls, images, post, running, owner } from the worker.

const START_URL = "https://onhundred.com";
const shareOg = (share) => (share ? { ogImage: share.image, ogTitle: share.headline, ogDescription: share.running ? "Guess how it ends." : "Start your 10." } : {});

const postImagesTools = (share) => {
  if (share.post === "ready")
    return `<p class="share-downloads"><span class="label">TO POST</span>${share.images.map((i) => `<a class="btn small" href="${esc(i.url)}" download>${esc(i.label)}</a>`).join("")}</p>`;
  if (share.post === "queued") return `<p class="muted">Images to post are on the way. Reload in a minute.</p>`;
  if (!share.owner) return "";
  return `<form method="post" action="/owner/action" class="share-post"><input type="hidden" name="op" value="card_images"><input type="hidden" name="id" value="${esc(share.card.id)}"><input type="hidden" name="next" value="${esc(share.next || "/")}"><button class="btn small" type="submit">GET IMAGES TO POST (SQUARE AND STORY)</button></form>`;
};

const copyLinks = (share) =>
  Object.entries(share.urls)
    .map(([lang, u]) => {
      const id = `card-url-${share.card.id}-${lang}`;
      return `<div class="copy"><span class="copy-field"><span class="copy-label">LINK${Object.keys(share.urls).length > 1 ? ` · ${esc(lang.toUpperCase())}` : ""}</span><code id="${esc(id)}">${esc(u)}</code></span><button class="btn" type="button" data-copy="#${esc(id)}" data-card-copied="${esc(share.card.id)}">COPY</button></div>`;
    })
    .join("");

// The banner a visitor sees on the page a card links to. The owner also gets the card's tools.
function shareBanner(share) {
  const cta = share.running ? "GUESS HOW IT ENDS" : "START YOUR 10";
  const tools = share.owner ? `<div class="share-tools">${copyLinks(share)}${postImagesTools(share)}</div>` : "";
  return `<aside class="share-banner" aria-label="Shared card"><p class="share-headline">${esc(share.headline)}</p><a class="btn signal small" href="${START_URL}" rel="noopener">${cta}</a>${tools}</aside>`;
}

// The owner's log page: cards with a link nobody copied yet, from the last 2 weeks.
function readyPanel(shares) {
  const items = shares
    .map(
      (s) =>
        `<li class="share-ready-item"><img src="${esc(s.imagePath)}" alt="" width="300" height="158" loading="lazy"><div><p class="share-headline">${esc(s.headline)}</p>${copyLinks(s)}${postImagesTools(s)}</div></li>`
    )
    .join("");
  return `<section class="block share-ready" aria-labelledby="share-ready-title"><h2 class="title" id="share-ready-title"><mark>YOUR CARD IS READY</mark></h2><p class="muted">Copy a link to share it. The preview shows the card. Only what your public page shows is on it.</p><ul class="plain">${items}</ul></section>`;
}

// The standalone card page: for links from a private log. It never links to the rest of the log.
export function cardPage({ meta, share, origin }) {
  const f = share.card.facts;
  const lines = cardLines(f, share.lang);
  const body = `<section class="block share-page">
<img class="share-image" src="${esc(share.imagePath)}" alt="${esc(share.headline)}" width="1200" height="630">
<h1>${esc(share.headline)}</h1>
<ul class="plain share-facts">${lines.map((l) => `<li>${esc(l)}</li>`).join("")}</ul>
<p><a class="btn signal" href="${START_URL}" rel="noopener">${share.running ? "GUESS HOW IT ENDS" : "START YOUR 10"}</a></p>
${share.owner ? `<div class="share-tools">${copyLinks(share)}${postImagesTools(share)}</div>` : postImagesTools(share)}
</section>`;
  return layout({ title: share.headline, ownerName: meta.ownerName, signedIn: share.owner, body, origin, ...shareOg(share) });
}

// The plain facts a card shows under its headline, in 1 language.
function cardLines(f, lang) {
  const out = [];
  if (f.loop) out.push(`${f.loop.code} · ${pickText(f.loop.name, lang)} · ${f.loop.levelName?.[lang] || levelName(f.loop.level, lang)}`);
  if (f.experiment) {
    const x = f.experiment;
    out.push(`${x.code} · ${pickText(x.question, lang)}`);
    if (x.hypothesis) out.push(`Bet: ${pickText(x.hypothesis, lang)}`);
    if (x.odds != null) out.push(`Odds: ${x.odds} in 100`);
  }
  const hours = f.loop?.hours || f.experiment?.loops?.find((l) => l.hours)?.hours;
  if (hours) out.push(`${hours.perWeek} h a week (${hours.source})`);
  out.push(`${f.handedOff} loops handed off · ${f.points} of ${f.total} points`);
  return out;
}

export { cardRenderPage } from "./card-render.mjs";

export function privatePage({ meta, origin, configured: isConfigured, hasConnections, preview = false }) {
  const body = `${preview ? previewNotice() : ""}${!isConfigured ? setupNotice() : ""}
<section class="block hero-private">
<h1>This log is private.</h1>
<p>Only its owner can see it. Agents connect at the MCP address below.</p>
${mcpUrlBox(origin)}
<p><a class="btn signal" href="/login">SIGN IN</a></p>
${!hasConnections ? `<p class="muted">First time here? Sign in with the owner password you chose when you deployed, then connect your first AI app.</p>` : ""}
</section>`;
  return layout({ title: "Onhundred Protocol log", ownerName: meta.ownerName, signedIn: preview, body, origin });
}

function setupNotice() {
  return notice(
    "Sign-in is off: OWNER_PASSWORD or COOKIE_ENCRYPTION_KEY is missing. Add both as secrets in your Worker's settings (Settings, Variables and Secrets). COOKIE_ENCRYPTION_KEY needs 32 characters or more: <code>openssl rand -hex 32</code>.",
    "bad"
  );
}

// ---------------------------------------------------------------------------
// Onboarding

const mcpUrlBox = (origin) =>
  `<div class="copy"><span class="copy-field"><span class="copy-label">MCP SERVER</span><code id="mcp-url">${esc(origin)}/mcp</code></span><button class="btn" type="button" data-copy="#mcp-url">COPY</button></div>`;

const codeBlock = (id, text) => `<div class="copy block-code"><pre id="${id}">${esc(text)}</pre><button class="btn" type="button" data-copy="#${id}">COPY</button></div>`;

export function connectPage({ meta, origin }) {
  const url = `${origin}/mcp`;
  const steps = (items) => `<ol class="steps">${items.map((s) => `<li>${s}</li>`).join("")}</ol>`;
  const claudeInstall = `https://claude.ai/customize/connectors?modal=add-custom-connector&connectorName=Onhundred&connectorUrl=${encodeURIComponent(url)}`;
  const xai = `curl https://api.x.ai/v1/responses \\
  -H "Authorization: Bearer $XAI_API_KEY" \\
  -H "Content-Type: application/json" \\
  -d '{
    "model": "grok-4",
    "input": "Call get_state and tell me where my log stands.",
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
<h1>Connect your AI Agent</h1>
<p>It takes 2 minutes to connect and get your AI agent to help you automate your life. You control what is public, and your agent will always ask for your permission.</p>
${mcpUrlBox(origin)}
</section>
<section class="block cards">
<article class="card"><h3>Claude</h3>${steps([
    "In claude.ai or the desktop app, open Customize, then Connectors.",
    "Choose Add custom connector. Name it Onhundred and paste the address above.",
    "Click Connect, sign in with your owner password and allow access.",
  ])}<div class="card-action"><p class="muted">Opens claude.ai with the name and address filled in. Check them and click Add.</p><a class="btn signal" href="${esc(claudeInstall)}" target="_blank" rel="noopener">ADD TO CLAUDE</a></div></article>
<article class="card"><h3>ChatGPT</h3>${steps([
    "Open Settings, then Apps. Custom apps depend on your plan; on some plans you turn on Developer mode first.",
    "Create an app, paste the address above and choose OAuth.",
    "Sign in with your owner password and allow access.",
  ])}<div class="card-action"><p class="muted">Copies the address and opens ChatGPT. ChatGPT can't fill in the form, so paste it when you create the app.</p><a class="btn signal" href="https://chatgpt.com/plugins" target="_blank" rel="noopener" data-copy="#mcp-url">ADD TO CHATGPT</a></div></article>
<article class="card"><h3>Grok</h3>${steps([
    "In grok.com, open Connectors and choose New Connector, then Custom.",
    "Paste the address above.",
    "Sign in with your owner password and allow access.",
  ])}<div class="card-action"><p class="muted">Copies the address and opens Grok connectors. On Grok Business, a team admin adds the connector in console.x.ai first.</p><a class="btn signal" href="https://grok.com/connectors" target="_blank" rel="noopener" data-copy="#mcp-url">ADD TO GROK</a></div></article>
</section>
<section class="block">
${sectionTitle(API_ICON, "API ALTERNATIVE IF YOU CAN'T CONNECT THROUGH THE MCP SERVER")}
<details class="card disclosure">
<summary><span><b>Connect an agent with an API key</b><small>Agents that call an API send an API key instead of signing in.</small></span><span class="disclosure-toggle" data-closed="MORE DETAILS" data-open="HIDE DETAILS"></span></summary>
<div class="disclosure-body">
<p><a class="btn" href="/connections#new-key">CREATE API KEY</a></p>
<h3>xAI Grok API</h3>
${codeBlock("xai", xai)}
<h3>OpenAI Responses API</h3>
${codeBlock("openai", openai)}
<h3>Anthropic Messages API (MCP connector)</h3>
${codeBlock("anthropic", anthropic)}
<p class="muted">The MCP connector fields change between API versions. Check each provider's docs for the current names and beta headers.</p>
</div>
</details>
</section>
<section class="block">
${sectionTitle(CHAT_ICON, "START TALKING AND GETTING HELP FROM OUR AGENT")}
<ul class="starters">${PROMPTS.map((p) => `<li><b>${esc(p.title)}</b><small>${esc(p.description)}</small></li>`).join("")}</ul>
<p class="muted">Apps that support MCP prompts list these as shortcuts. In the others, type the request.</p>
</section>`;
  return layout({ title: "Connect your AI Agent · Onhundred Protocol", ownerName: meta.ownerName, owner: true, body, current: "/connections", origin });
}

// ---------------------------------------------------------------------------
// Connections

export function connectionsPage({ meta, agents, url, newKey }) {
  const rows = agents
    .map((a) => {
      const status = a.revoked_at ? `revoked ${esc(a.revoked_at.slice(0, 10))}` : "active";
      const revoke = a.revoked_at
        ? ""
        : `<form method="post" action="/owner/action"><input type="hidden" name="op" value="revoke"><input type="hidden" name="id" value="${esc(a.id)}"><button class="btn small" type="submit">REVOKE</button></form>`;
      return `<tr><td><b>${esc(a.name)}</b></td><td>${a.kind === "key" ? "API key" : "Sign-in"}</td><td>${esc(a.access)}</td><td>${esc(a.created_at.slice(0, 10))}</td><td>${status}</td><td>${revoke}</td></tr>`;
    })
    .join("");
  const keyBox = newKey
    ? `<section class="block">${notice("Copy this key now. It is shown once and stored only as a hash.", "good")}<div class="copy"><code id="new-key-value">${esc(newKey.key)}</code><button class="btn" type="button" data-copy="#new-key-value">COPY</button></div></section>`
    : "";
  const body = `${flash(url)}${keyBox}
<section class="block">
<div class="page-head"><h1>Connections</h1><a class="btn signal" href="/connect">CONNECT YOUR AI</a></div>
<p>Every app and key is a named agent. Its name appears in the history next to each change it makes.</p>
${agents.length ? `<table class="table"><thead><tr><th>Name</th><th>Type</th><th>Access</th><th>Created</th><th>Status</th><th></th></tr></thead><tbody>${rows}</tbody></table>` : `<p class="empty">No connections yet. <a href="/connect">Connect your first AI app.</a></p>`}
</section>
<section class="block" id="new-key">
${sectionTitle(KEY_ICON, "NEW API KEY")}
<form method="post" action="/owner/action" class="card form">
<input type="hidden" name="op" value="create_key">
<label>Name <input class="field" name="name" required maxlength="40" placeholder="grok-bot"></label>
<label>Access <select class="field" name="access"><option value="agent">agent: proposes and logs, can't approve</option><option value="owner">owner: can also approve</option></select></label>
<button class="btn signal" type="submit">CREATE KEY</button>
</form>
</section>`;
  return layout({ title: "Connections · Onhundred Protocol", ownerName: meta.ownerName, owner: true, body, current: "/connections" });
}

// ---------------------------------------------------------------------------
// Sign-in and consent

export function loginPage({ meta, next = "/", error = "", configured: isConfigured }) {
  const body = `<section class="block narrow">
<h1>Sign in</h1>
${!isConfigured ? setupNotice() : ""}
${error ? notice(esc(error), "bad") : ""}
<form method="post" action="/login" class="card form">
<input type="hidden" name="next" value="${esc(next)}">
<label>Owner password <input class="field" type="password" name="password" autocomplete="current-password" required autofocus></label>
<button class="btn signal" type="submit">SIGN IN</button>
</form>
</section>`;
  return layout({ title: "Sign in · Onhundred Protocol", ownerName: meta.ownerName, body });
}

export function consentPage({ meta, details, handle }) {
  const where = details.redirectIsLoopback
    ? `${esc(details.redirectHost)}, an app on this computer. Any local app can claim this name: allow it only if you just started the connection.`
    : esc(details.redirectHost);
  const body = `<section class="block narrow">
<h1>Allow ${esc(details.clientName)}?</h1>
<form method="post" action="/authorize" class="card form">
<input type="hidden" name="handle" value="${esc(handle)}">
<p><b>${esc(details.clientName)}</b>${details.clientDomain ? ` from <b>${esc(details.clientDomain)}</b>` : ""} wants owner access to your log.</p>
<p>It will read every loop and experiment, record changes and approve them. Text it writes still waits for your OK before it goes public.</p>
<p class="muted">Tokens go to: ${where}</p>
<p class="muted">Scopes: ${details.scope.map(esc).join(", ") || "mcp"}</p>
<div class="actions"><button class="btn signal" type="submit" name="decision" value="approve">ALLOW</button><button class="btn" type="submit" name="decision" value="deny">DENY</button></div>
</form>
</section>`;
  return layout({ title: "Allow access · Onhundred Protocol", ownerName: meta.ownerName, body });
}

export function messagePage({ meta, title, text, status = 400 }) {
  return html(layout({ title, ownerName: meta?.ownerName, body: `<section class="block narrow"><h1>${esc(title)}</h1><p>${esc(text)}</p><p><a href="/">Back to the log</a></p></section>` }), { status });
}
