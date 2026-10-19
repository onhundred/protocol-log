// Onhundred Protocol rules, shared by the onhundred.com build and every app install.
// Pure functions over a plain state object: { meta, loops, experiments }.
import P from "../protocol.json" with { type: "json" };

export const protocol = P;
export const LEVELS = P.levels;
const DAY = 86400000;
const lv = (level) => LEVELS.indexOf(level);
const OPEN_OUTCOMES = new Set([null, undefined]);
const FAILED = new Set(["notAchieved", "terminated", "dropped"]);

export const esc = (s) =>
  String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

const CODE_RE = /^([CPR])-([A-Z]{3})-(\d{2,})$/;
const EXP_RE = /^EXP-(\d{2,})$/;

export function parseCode(code) {
  const m = CODE_RE.exec(code || "");
  if (!m) return null;
  return { branch: m[1], area: m[2], n: Number(m[3]), areaCode: `${m[1]}-${m[2]}` };
}

export function areaExists(areaCode, meta = {}) {
  const [branch, area] = areaCode.split("-");
  return Boolean(P.branches[branch]?.areas[area]) || (meta.extraAreas || []).includes(areaCode);
}

export function ceilingOf(loop) {
  const p = parseCode(loop.code);
  if (!p) return "autonomous";
  let ceiling = P.ceilings[p.areaCode] || "autonomous";
  if (loop.over500 && P.financialCeiling.areas.includes(p.areaCode) && lv(P.financialCeiling.level) < lv(ceiling))
    ceiling = P.financialCeiling.level;
  return ceiling;
}

export function triageScore(t) {
  if (!t) return null;
  return t.time + t.frequency + t.rules + t.digital - t.risk;
}

export function triageGroup(loop) {
  const t = loop.triage;
  if (!t) return null;
  const score = triageScore(t);
  if (t.risk >= P.triage.notYet.minRisk || lv(loop.level) >= lv(ceilingOf(loop))) return "notYet";
  if (score >= P.triage.automateNow.minScore && t.risk <= P.triage.automateNow.maxRisk) return "automateNow";
  return "later";
}

export const isHardEligible = (loop) =>
  Boolean(loop.triage) &&
  (loop.triage.rules <= P.triage.hardMaxRulesOrDigital || loop.triage.digital <= P.triage.hardMaxRulesOrDigital) &&
  triageGroup(loop) !== "notYet";

// Seeded shuffle, so cell placement is stable between builds.
export function shuffle(arr, seed) {
  let x = seed;
  for (let i = arr.length - 1; i > 0; i--) {
    x = (x * 9301 + 49297) % 233280;
    const j = Math.floor((x / 233280) * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}

// Protocol versions compare numerically, part by part: 1.10 is newer than 1.9.
export function compareVersions(a, b) {
  const pa = String(a).split(".").map(Number);
  const pb = String(b).split(".").map(Number);
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    const d = (pa[i] || 0) - (pb[i] || 0);
    if (d) return Math.sign(d);
  }
  return 0;
}

// The rules a log runs are the ones of the version it adopted, not the newest in the code.
export const logVersion = (meta) => meta?.protocolVersion || P.version;

// A versioned parameter ({ "1.0": x, "1.1": y }) resolves to the newest entry at or below the version.
function byVersion(map, version) {
  const key = Object.keys(map)
    .filter((k) => compareVersions(k, version) <= 0)
    .sort(compareVersions)
    .at(-1);
  return map[key ?? Object.keys(map).sort(compareVersions)[0]];
}

export const assistedWeight = (version) => byVersion(P.metrics.assistedWeight, version);

// From v1.4 an estimated cost is enough to start an experiment; before, the loop had to be measured.
export const estimateCanStart = (version) => compareVersions(version, P.rules.estimateCanStart) >= 0;

export const levelName = (level, lang = "en") => P.levelNames[level]?.[lang] ?? P.levelNames[level]?.en ?? level;

// Measured is a mark, not a level: the loop's cost was watched 3 times and approved.
export const isMeasured = (loop) => Boolean(loop.baseline);

// Logs written before v1.2 store 2 levels below assisted, unmapped and mapped. Both are still yours now,
// and a mapped loop keeps its approved baseline, which is the measured mark.
const LEGACY_LEVELS = { unmapped: "still", mapped: "still" };
const upLevel = (l) => LEGACY_LEVELS[l] || l;

export function upgradeLevels(state) {
  return {
    ...state,
    loops: (state.loops || []).map((l) => ({
      ...l,
      ...(l.level ? { level: upLevel(l.level) } : {}),
      ...(l.drops ? { drops: l.drops.map((d) => ({ ...d, from: upLevel(d.from), to: upLevel(d.to) })) } : {}),
    })),
    experiments: (state.experiments || []).map((e) => ({
      ...e,
      ...(e.startLevel ? { startLevel: upLevel(e.startLevel) } : {}),
      ...(e.conclusion?.level ? { conclusion: { ...e.conclusion, level: upLevel(e.conclusion.level) } } : {}),
    })),
  };
}

export const isActive = (loop) => !loop.retired && !loop.proposed;
export const isOpen = (exp) => !exp.conclusion;

export const sortTries = (stages) => [...(stages || [])].sort((a, b) => a.stage - b.stage || a.try - b.try);
const lastTry = (exp) => sortTries(exp.stages).at(-1) || null;

// ---------------------------------------------------------------------------
// Voice and naming

const WORD = (w) => new RegExp(`(^|[^\\p{L}\\p{N}-])${w.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}(?=$|[^\\p{L}\\p{N}-])`, "iu");
const NEVER = P.voice.neverUse.map((w) => [w, WORD(w)]);
const RETIRED = P.voice.retired.map((w) => [w, WORD(w)]);
const ALLOWED_BEFORE = P.voice.retiredAllowedAfter.map((w) => w.toLowerCase());
const GUILT = (P.voice.guilt || []).map((w) => [w, WORD(w)]);
const HYPE = (P.voice.hype || []).map((w) => [w, WORD(w)]);

export function voiceIssues(text, lang) {
  const issues = [];
  if (typeof text !== "string") return issues;
  if (text.includes("\u2014")) issues.push("has an em-dash. Use a period, a comma or a colon.");
  if (/[!¡]/.test(text)) issues.push("has an exclamation mark. The log states facts.");
  for (const [w, re] of NEVER) if (re.test(text)) issues.push(`uses "${w}", which VOICE.md never uses.`);
  const plainQuotes = text.replace(/\u2019/g, "'");
  for (const [w, re] of GUILT) if (re.test(plainQuotes)) issues.push(`uses "${w}", which guilts the reader. State the fact and offer a next step.`);
  for (const [w, re] of HYPE) if (re.test(plainQuotes)) issues.push(`uses "${w}", which is hype. Say what happened, plainly.`);
  if (lang === "en") {
    for (const [w, re] of RETIRED) {
      const m = re.exec(text);
      if (!m) continue;
      const before = text.slice(0, m.index + m[1].length).trim().split(/\s+/).at(-1)?.toLowerCase();
      if (ALLOWED_BEFORE.includes(before)) continue;
      issues.push(`uses "${w}", a retired word. Say loop or experiment instead.`);
    }
  }
  return issues;
}

export const failingVerbs = (version = P.version) =>
  P.naming.failingVerbs.filter((v) => !P.naming.since?.[v] || compareVersions(P.naming.since[v], version) <= 0);

export function nameIssues(name, lang, version = P.version) {
  const issues = [];
  const words = name.trim().split(/\s+/).filter(Boolean);
  if (words.length > P.naming.maxWords)
    issues.push(`has ${words.length} words. A loop name has ${P.naming.maxWords} or fewer, so it fits on the grid.`);
  if (lang === "en") {
    const lower = name.trim().toLowerCase();
    const verb = failingVerbs(version).find((v) => lower === v || lower.startsWith(v + " "));
    if (verb) issues.push(`starts with a failing verb (${verb}). Name the result instead: book, send, pay, publish.`);
  }
  return issues;
}

// Scope is optional public text. Cap is a template constant, not a protocol version rule.
export const SCOPE_MAX_WORDS = 60;

export function scopeIssues(scope) {
  const issues = [];
  if (typeof scope !== "string") return issues;
  const words = scope.trim().split(/\s+/).filter(Boolean);
  if (words.length > SCOPE_MAX_WORDS)
    issues.push(`has ${words.length} words. A loop scope has ${SCOPE_MAX_WORDS} or fewer.`);
  return issues;
}

// The public header: 1 short line on why the person runs the protocol, and a few profile links.
// Template constants, not protocol rules. A kind with hosts only links to that site; null hosts take any https address.
export const ABOUT_MAX_WORDS = 40;
export const MAX_LINKS = 5;
export const PROFILE_LINKS = {
  x: { name: "X", hosts: ["x.com", "twitter.com"] },
  linkedin: { name: "LinkedIn", hosts: ["linkedin.com"] },
  github: { name: "GitHub", hosts: ["github.com"] },
  instagram: { name: "Instagram", hosts: ["instagram.com"] },
  youtube: { name: "YouTube", hosts: ["youtube.com", "youtu.be"] },
  tiktok: { name: "TikTok", hosts: ["tiktok.com"] },
  threads: { name: "Threads", hosts: ["threads.net", "threads.com"] },
  bluesky: { name: "Bluesky", hosts: ["bsky.app"] },
  mastodon: { name: "Mastodon", hosts: null },
  website: { name: "Website", hosts: null },
};

// A handle or an address, as people type them, turned into 1 https link per profile.
// "sam", "@sam", "x.com/sam", "twitter.com/@sam/" and "http://www.x.com/sam?s=21" are all https://x.com/sam.
// "@sam@hachyderm.io" on Mastodon is https://hachyderm.io/@sam. Feeding a result back in returns it unchanged.
// Other schemes (javascript:, mailto:) and addresses on the wrong site are left for linkIssues to explain.
const PROFILE_HOST = {
  x: "x.com",
  linkedin: "www.linkedin.com",
  github: "github.com",
  instagram: "www.instagram.com",
  youtube: "www.youtube.com",
  tiktok: "www.tiktok.com",
  threads: "www.threads.com",
  bluesky: "bsky.app",
};
// Profile paths that start with @, and the YouTube paths that don't.
const AT_PATH = new Set(["youtube", "tiktok", "threads"]);
const YOUTUBE_PATHS = new Set(["c", "channel", "user", "watch", "playlist", "shorts", "live"]);
const LINKEDIN_PATHS = new Set(["in", "company", "school", "pub"]);

const stripAt = (s) => s.replace(/^@+/, "");
const withAt = (s) => `@${stripAt(s)}`;

function profilePath(kind, segs) {
  if (!segs.length) return segs;
  const [first, ...rest] = segs;
  if (kind === "bluesky") {
    const handle = first === "profile" ? rest[0] : first;
    return handle ? ["profile", bskyHandle(handle), ...(first === "profile" ? rest.slice(1) : [])] : segs;
  }
  if (kind === "linkedin") return LINKEDIN_PATHS.has(first) ? [first, ...rest.map(stripAt)] : ["in", stripAt(first), ...rest];
  if (AT_PATH.has(kind)) return kind === "youtube" && YOUTUBE_PATHS.has(first) ? segs : [withAt(first), ...rest];
  return [stripAt(first), ...rest];
}

const bskyHandle = (h) => {
  const handle = stripAt(h).toLowerCase();
  return handle.includes(".") ? handle : `${handle}.bsky.social`;
};

export function normalizeLink(kind, raw) {
  const s = String(raw ?? "").trim().replace(/^<(.*)>$/, "$1");
  if (!s) return "";
  if (/^[a-z][a-z0-9+.-]*:/i.test(s) && !/^https?:\/\//i.test(s)) return s;
  if (kind === "mastodon") {
    const m = s.match(/^@?([\w.]+)@([\w.-]+\.[a-z]{2,})$/i);
    if (m) return `https://${m[2].toLowerCase()}/@${m[1]}`;
  }
  const bare = s.replace(/^https?:\/\//i, "");
  const firstPart = bare.split(/[/?#]/)[0];
  const known = PROFILE_LINKS[kind]?.hosts;
  const onKnownHost = known?.some((h) => firstPart.toLowerCase().replace(/^(www|m|mobile)\./, "") === h);
  const isAddress = bare !== s || !known || onKnownHost || (bare.includes("/") && firstPart.includes(".") && kind !== "bluesky");

  // A handle, or a path without the site: "sam", "@sam", "in/sam", "sam.bsky.social".
  if (!isAddress) {
    const segs = bare.replace(/\s+/g, "").split(/[?#]/)[0].split("/").filter(Boolean);
    if (!segs.length) return s;
    return `https://${PROFILE_HOST[kind]}/${profilePath(kind, segs).join("/")}`;
  }

  let url;
  try {
    url = new URL(`https://${bare.replace(/^\/+/, "")}`);
  } catch {
    return s;
  }
  if (!url.hostname.includes(".")) return s;
  const host = url.hostname.replace(/^(www|m|mobile)\./, "");
  const segs = url.pathname.split("/").filter(Boolean);

  if (!known) {
    if (kind === "mastodon") return `https://${url.hostname}${segs.length ? `/${segs.length === 1 ? withAt(segs[0]) : segs.join("/")}` : ""}`;
    return url.pathname === "/" && !url.search && !url.hash ? url.origin : url.href;
  }
  // The wrong site, or a short video link: kept, minus the scheme mix-up, for linkIssues to judge.
  if (!onKnownHost || host === "youtu.be") return url.href;
  // Share links add tracking (?s=21, ?igsh=...): a profile link doesn't need it. Videos keep theirs.
  const keepQuery = kind === "youtube" && ["watch", "playlist"].includes(segs[0]);
  const path = profilePath(kind, segs);
  return `https://${PROFILE_HOST[kind]}${path.length ? `/${path.join("/")}` : ""}${keepQuery ? url.search : ""}`;
}

// What the public header still lacks. links: [] means the person said they have none, so it isn't missing.
export function profileMissing(meta) {
  const missing = [];
  if (!meta.ownerName) missing.push("ownerName");
  if (!Object.values(meta.about || {}).some((s) => String(s).trim())) missing.push("about");
  if (meta.links == null) missing.push("links");
  return missing;
}

export function linkIssues(links) {
  if (links == null) return [];
  if (!Array.isArray(links)) return ["is a list of { kind, url }."];
  const issues = [];
  if (links.length > MAX_LINKS) issues.push(`has ${links.length} links. The header shows ${MAX_LINKS} at most.`);
  const seen = new Set();
  for (const l of links) {
    const kind = PROFILE_LINKS[l?.kind];
    if (!kind) {
      issues.push(`"${l?.kind}" is not a link kind. Use ${Object.keys(PROFILE_LINKS).join(", ")}.`);
      continue;
    }
    if (seen.has(l.kind)) issues.push(`has 2 ${kind.name} links. Keep 1.`);
    seen.add(l.kind);
    let url;
    try {
      url = new URL(l.url);
    } catch {
      issues.push(`${kind.name}: "${l.url}" is not a web address.`);
      continue;
    }
    if (url.protocol !== "https:") issues.push(`${kind.name}: the address starts with https://.`);
    const host = url.hostname.toLowerCase();
    if (kind.hosts && !kind.hosts.some((h) => host === h || host.endsWith("." + h)))
      issues.push(`${kind.name}: the address is on ${host}, not ${kind.hosts.join(" or ")}.`);
  }
  return issues;
}

// ---------------------------------------------------------------------------
// Validation: returns every rule the state breaks. An empty list means valid.

export function validate(state) {
  const out = [];
  const add = (target, rule, message) => out.push({ target, rule, message: `${target}: ${message}` });
  const meta = state.meta || {};
  const langs = meta.languages?.length ? meta.languages : ["en"];
  const version = logVersion(meta);
  const loops = state.loops || [];
  const exps = state.experiments || [];

  const text = (target, field, value, { name = false, scope = false, required = true } = {}) => {
    if (value == null) {
      if (required) add(target, "text", `${field} is missing. Every public text needs each of the log's languages.`);
      return;
    }
    for (const lang of langs) {
      const s = value[lang];
      if (typeof s !== "string" || !s.trim()) {
        add(target, "text", `${field} is missing in ${lang}. Every public text needs each of the log's languages.`);
        continue;
      }
      if (name) for (const i of nameIssues(s, lang, version)) add(target, "name", `${field} (${lang}) ${i}`);
      if (scope) for (const i of scopeIssues(s)) add(target, "scope", `${field} (${lang}) ${i}`);
      for (const i of voiceIssues(s, lang)) add(target, "voice", `${field} (${lang}) ${i}`);
    }
  };
  const pendingText = (target, pending, names) => {
    if (!pending) return;
    for (const field of names) if (pending[field]) text(target, `pending ${field}`, pending[field], { name: field === "name", scope: field === "scope" });
  };

  // Loops
  const seen = new Set();
  const byCode = new Map();
  const held = heldLevels(exps);
  let active = 0;
  let measuring = 0;
  for (const loop of loops) {
    const c = loop.code || "?";
    const p = parseCode(loop.code);
    if (!p) {
      add(c, "code", "codes use PART-AREA-NN, like R-PAR-01.");
      continue;
    }
    if (seen.has(c)) add(c, "code", "this code is used twice. A code belongs to one loop forever.");
    seen.add(c);
    byCode.set(c, loop);
    if (!areaExists(p.areaCode, meta)) add(c, "area", `${p.areaCode} is not an area in protocol section 2.4.`);
    if (loop.retired) continue;
    if (!LEVELS.includes(loop.level)) {
      add(c, "level", `"${loop.level}" is not a level. Use ${LEVELS.join(", ")} (${LEVELS.map((l) => levelName(l)).join("; ")}).`);
      continue;
    }
    text(c, "name", loop.name, { name: true });
    text(c, "doneWhen", loop.doneWhen);
    text(c, "scope", loop.scope, { scope: true, required: false });
    pendingText(c, loop.pending, ["name", "doneWhen", "scope"]);
    if (loop.triage) {
      for (const k of P.triage.criteria) {
        const v = loop.triage[k];
        if (!Number.isInteger(v) || v < P.triage.min || v > P.triage.max)
          add(c, "triage", `the ${k} rating must be a whole number from ${P.triage.min} to ${P.triage.max}.`);
      }
    }
    if (loop.proposed) {
      if (loop.level !== "still") add(c, "level", `a proposed loop starts at ${levelName("still")}.`);
      continue;
    }
    active++;
    const ceiling = ceilingOf(loop);
    const at = levelName(loop.level);
    if (lv(loop.level) > lv(ceiling))
      add(c, "ceiling", `${at} is above the ${levelName(ceiling)} limit for ${p.areaCode}${loop.over500 ? " (decisions over $500)" : ""}.`);
    if (lv(loop.level) > lv("still") && !isMeasured(loop) && !estimateCanStart(version))
      add(c, "baseline", `the loop is at ${at} but its cost was never measured. Before v${P.rules.estimateCanStart}, a loop is measured before it moves up.`);
    if (lv(loop.level) > lv("still") && lv(held.get(c) || "still") < lv(loop.level))
      add(c, "level", `the loop is at ${at} without a round at that level that passed and proved it for ${P.limits.holdWeeks} weeks. Levels move only after proving.`);
    if (loop.measuring) {
      if (loop.level !== "still" || isMeasured(loop))
        add(c, "measuring", `only a loop that is ${levelName("still").toLowerCase()} and not yet measured can be measuring.`);
      else measuring++;
    }
  }
  const max = P.limits.loops;
  if (meta.mode === "frozen" && active !== max)
    add("list", "count", `${active} active loops. A frozen list has exactly ${max}, so a new loop needs a merge or a retirement.`);
  if (meta.mode !== "frozen" && active > max)
    add("list", "count", `${active} active loops. Your list holds ${max} at most.`);
  if (measuring > P.limits.measuringSlots)
    add("list", "measuring", `${measuring} loops are measuring. The limit is ${P.limits.measuringSlots}.`);

  // Public header
  text("about", "about", meta.about, { required: false });
  for (const lang of langs) {
    const words = String(meta.about?.[lang] || "").trim().split(/\s+/).filter(Boolean).length;
    if (words > ABOUT_MAX_WORDS) add("about", "about", `about (${lang}) has ${words} words. Keep it to ${ABOUT_MAX_WORDS} or fewer.`);
  }
  for (const i of linkIssues(meta.links)) add("links", "links", i);

  // Experiments
  const expSeen = new Set();
  const openSlots = new Map();
  const openLoops = new Map();
  let open = 0;
  for (const exp of exps) {
    const c = exp.code || "?";
    if (!EXP_RE.test(c)) add(c, "code", "experiment codes use EXP-NN, like EXP-01.");
    if (expSeen.has(c)) add(c, "code", "this code is used twice.");
    expSeen.add(c);
    if (!P.limits.experimentSlots.includes(exp.slot)) add(c, "slot", `the pick must be ${P.limits.experimentSlots.join(", ")}.`);
    if (exp.slot === "fun" && !(exp.funReason || "").trim()) add(c, "slot", "a fun pick records why you chose it.");
    if (exp.funReason) for (const i of voiceIssues(exp.funReason, langs[0])) add(c, "voice", `funReason ${i}`);
    if (exp.question || !exp.pending?.question) text(c, "question", exp.question);
    if (exp.hypothesis || !exp.pending?.hypothesis) text(c, "hypothesis", exp.hypothesis);
    pendingText(c, exp.pending, ["question", "hypothesis"]);
    if (!LEVELS.includes(exp.startLevel) || !LEVELS.includes(exp.goal) || lv(exp.goal) <= lv(exp.startLevel))
      add(c, "goal", "the target level must be above the starting level.");
    if (!exp.loops?.length) add(c, "loops", "an experiment moves at least 1 loop.");
    for (const code of exp.loops || []) {
      const loop = byCode.get(code);
      if (!loop || loop.proposed) {
        add(c, "loops", `${code} is not an approved loop.`);
        continue;
      }
      if (lv(exp.goal) > lv(ceilingOf(loop)))
        add(c, "ceiling", `the target level ${levelName(exp.goal)} is above ${code}'s ${levelName(ceilingOf(loop))} limit.`);
      if (isOpen(exp) && loop.retired) add(c, "loops", `${code} is retired, so the experiment must conclude.`);
    }
    stageIssues(exp, add, langs, text);

    if (isOpen(exp)) {
      open++;
      if (openSlots.has(exp.slot)) add(c, "slot", `the ${exp.slot} pick is already held by ${openSlots.get(exp.slot)}.`);
      openSlots.set(exp.slot, c);
      for (const code of exp.loops || []) {
        if (openLoops.has(code)) add(c, "loops", `${code} is already in ${openLoops.get(code)}. A loop runs in one experiment at a time.`);
        openLoops.set(code, c);
      }
      if (!exp.stages?.length) eligibilityIssues(exp, byCode, add, version);
    } else {
      const ct = exp.conclusion;
      if (!P.conclusions.includes(ct.hypothesis)) add(c, "conclusion", `the bet is ${P.conclusions.join(", ")}.`);
      if (!LEVELS.includes(ct.level)) add(c, "conclusion", "the end of an experiment records the final level reached.");
      const last = lastTry(exp);
      if (last && OPEN_OUTCOMES.has(last.outcome)) add(c, "conclusion", "end the running round before ending the experiment.");
    }
  }
  if (open > P.limits.experimentSlots.length)
    add("experiments", "slots", `${open} experiments are open. The limit is ${P.limits.experimentSlots.length}, one per pick.`);
  return out;
}

function stageIssues(exp, add, langs, text) {
  const c = exp.code;
  const tries = sortTries(exp.stages);
  const stages = new Set(tries.map((t) => t.stage));
  if (stages.size > P.limits.maxStages) add(c, "stages", `an experiment has ${P.limits.maxStages} rounds at most.`);
  let prev = null;
  tries.forEach((t, i) => {
    const label = `round ${t.stage} try ${t.try}`;
    const want = LEVELS[lv(exp.startLevel) + t.stage];
    if (t.level !== want)
      add(c, "stages", `${label} aims for ${levelName(t.level)}, but round ${t.stage} aims for ${levelName(want)}. A round climbs one level.`);
    if (want && lv(want) > lv(exp.goal)) add(c, "stages", `${label} goes past the target level (${levelName(exp.goal)}).`);
    if (!prev) {
      if (t.stage !== 1 || t.try !== 1) add(c, "stages", "the first round is round 1, try 1.");
    } else if (t.stage === prev.stage) {
      if (t.try !== prev.try + 1) add(c, "stages", `${label} skips a try number.`);
      const retry = prev.outcome === "notAchieved" || prev.outcome === "terminated" || prev.hold?.result === "failed";
      if (!retry) add(c, "stages", `${label} starts before try ${prev.try} ended without passing.`);
    } else {
      if (t.stage !== prev.stage + 1 || t.try !== 1) add(c, "stages", `${label} is out of order.`);
      if (!(prev.outcome === "achieved" && prev.hold?.result === "passed"))
        add(c, "stages", `${label} starts before round ${prev.stage} proved its level.`);
    }
    if (t.start && t.deadline && t.deadline < t.start) add(c, "stages", `${label} ends before it starts.`);
    const isLast = i === tries.length - 1;
    if (OPEN_OUTCOMES.has(t.outcome)) {
      if (!isLast) add(c, "stages", `${label} is still open, but a later try exists.`);
    } else {
      if (!P.outcomes.includes(t.outcome)) add(c, "stages", `${label} must end as ${P.outcomes.join(", ")}.`);
      if (!t.closedAt) add(c, "stages", `${label} has an ending without a date.`);
    }
    if (t.hold) {
      if (t.outcome !== "achieved") add(c, "stages", `${label} has a proving result, but it didn't pass.`);
      if (!P.holds.includes(t.hold.result)) add(c, "stages", `${label} proving must be ${P.holds.join(" or ")}.`);
      if (t.hold.result === "passed" && t.closedAt && t.hold.at &&
          (Date.parse(t.hold.at) - Date.parse(t.closedAt)) / DAY < P.limits.holdWeeks * 7)
        add(c, "stages", `${label} finished proving in under ${P.limits.holdWeeks} weeks.`);
    }
    if (t.learned) text(c, `${label} learned`, t.learned);
    if (t.pending?.learned) text(c, `${label} pending learned`, t.pending.learned);
    prev = t;
  });
}

function eligibilityIssues(exp, byCode, add, version) {
  for (const code of exp.loops || []) {
    const loop = byCode.get(code);
    if (!loop || loop.retired || loop.proposed) continue;
    if (!isMeasured(loop) && !estimateCanStart(version)) {
      add(exp.code, "eligibility", `${code} isn't measured. Before v${P.rules.estimateCanStart}, only measured loops can fill a pick.`);
      continue;
    }
    const group = triageGroup(loop);
    if (exp.slot === "easy" && group !== "automateNow")
      add(exp.code, "eligibility", `${code} is not in the Automate now group, so it can't fill the easy pick.`);
    if (exp.slot === "hard" && !isHardEligible(loop))
      add(exp.code, "eligibility", `${code} needs Clear rules or Digital data of 2 or less, outside Not yet, to fill the hard pick.`);
    if (exp.slot === "fun" && group === "notYet")
      add(exp.code, "eligibility", `${code} is in the Not yet group, so it can't fill the fun pick.`);
  }
}

// A write may not add violations. A log that is already broken can be repaired one step at a time.
export function compareViolations(before, after) {
  const key = (v) => v.message;
  const known = new Set(before.map(key));
  return {
    ok: after.length <= before.length,
    added: after.filter((v) => !known.has(key(v))),
    before: before.length,
    after: after.length,
  };
}

function heldLevels(exps) {
  const held = new Map();
  for (const exp of exps)
    for (const t of exp.stages || [])
      if (t.outcome === "achieved" && t.hold?.result === "passed")
        for (const code of exp.loops || [])
          if (lv(t.level) > lv(held.get(code) || "still")) held.set(code, t.level);
  return held;
}

// ---------------------------------------------------------------------------
// Derived values

export function experimentStatus(exp) {
  if (exp.conclusion) return { status: "concluded", verdict: exp.conclusion.hypothesis };
  const t = lastTry(exp);
  if (!t) return { status: "registered" };
  const at = { stage: t.stage, try: t.try, level: t.level };
  if (OPEN_OUTCOMES.has(t.outcome)) return { status: "running", ...at };
  if (t.outcome === "achieved") {
    if (!t.hold) return { status: "holding", ...at };
    if (t.hold.result === "passed") return { status: "reached", ...at };
    return { status: "notAchieved", ...at };
  }
  return { status: t.outcome, ...at };
}

export function derive(state) {
  const meta = state.meta || {};
  const exps = state.experiments || [];
  const latest = new Map();
  const flags = new Map();
  for (const exp of exps) {
    const tries = sortTries(exp.stages);
    const last = tries.at(-1);
    if (isOpen(exp) && last) {
      const flag = OPEN_OUTCOMES.has(last.outcome) ? "experimenting" : last.outcome === "achieved" && !last.hold ? "holding" : null;
      if (flag) for (const code of exp.loops) flags.set(code, flag);
    }
    for (const t of tries)
      for (const code of exp.loops) {
        const prev = latest.get(code);
        if (!prev || (t.start || "") >= (prev.start || "")) latest.set(code, t);
      }
  }

  const loops = (state.loops || []).filter(isActive).map((loop) => {
    const t = latest.get(loop.code);
    let outcome = t ? (t.hold?.result === "failed" ? "notAchieved" : t.outcome || null) : null;
    const drop = (loop.drops || []).at(-1);
    if (drop && (!t || !t.closedAt || drop.at >= t.closedAt)) outcome = "dropped";
    const flag = loop.measuring && !isMeasured(loop) ? "measuring" : flags.get(loop.code) || null;
    return {
      ...loop,
      ...parseCode(loop.code),
      measured: isMeasured(loop),
      flag,
      outcome: flag === "experimenting" ? null : outcome,
      failed: flag !== "experimenting" && FAILED.has(outcome),
      score: triageScore(loop.triage),
      group: triageGroup(loop),
      ceiling: ceilingOf(loop),
      changed: meta.cycle != null && loop.changedCycle === meta.cycle,
    };
  });

  const experiments = exps.map((exp) => ({ ...exp, ...experimentStatus(exp) }));
  return { meta, loops, experiments, metrics: metrics(loops, logVersion(meta)) };
}

// onhundred.com's "still him" figure always counts assisted as half, whatever the log's version.
const HANDED_HALF = { assisted: 0.5, delegated: 1, autonomous: 1 };
const tenths = (n) => Math.round(n * 10) / 10;

function share(loops, weight, denominator) {
  const counts = Object.fromEntries(LEVELS.map((l) => [l, 0]));
  for (const l of loops) counts[l.level]++;
  const d = denominator || 1;
  const handed = loops.reduce((s, l) => s + (HANDED_HALF[l.level] || 0), 0);
  return {
    total: loops.length,
    counts,
    points: counts.delegated + counts.autonomous + weight * counts.assisted,
    stillPct: tenths(100 - (handed / d) * 100),
  };
}

// Delegated (protocol section 11): points out of 100, never rounded to whole loops.
// Each branch reports its points out of its own loop count.
export function metrics(loops, version = P.version) {
  const weight = assistedWeight(version);
  const d = Math.max(loops.length, P.limits.loops);
  const { points, ...all } = share(loops, weight, d);
  const branches = {};
  for (const b of P.branchOrder) {
    const list = loops.filter((l) => l.code.startsWith(b + "-"));
    const { points: bp, ...rest } = share(list, weight, list.length);
    branches[b] = { ...rest, delegatedPoints: tenths(bp) };
  }
  return { ...all, delegatedPoints: tenths((points * 100) / d), version, branches };
}

// "23.5 of 100": half points stay visible.
export const formatPoints = (points, total = 100) => `${points} of ${total}`;

// Under a Handed off of 0: the furthest any loop has got, so the 0 still shows what's moving.
// Help me only lands here on logs before v1.1, where it counts 0.
export function progressNote({ loops, metrics: m }) {
  if (m.delegatedPoints > 0 || !loops.length) return null;
  const count = (test) => loops.filter(test).length;
  const of = (n) => `${n} ${n === 1 ? "loop" : "loops"}`;
  const none = "No experiment started yet.";
  const steps = [
    [count((l) => l.level === "assisted"), (n) => `${of(n)} at help me, which counts 0 before v1.1.`],
    [count((l) => l.flag === "holding"), (n) => `${of(n)} passed a round. Proving ${n === 1 ? "it" : "them"} for ${P.limits.holdWeeks} weeks.`],
    [count((l) => l.flag === "experimenting"), (n) => `Trying ${of(n)} with an agent.`],
    [count((l) => l.measured), (n) => `${of(n)} measured. ${none}`],
    [count((l) => l.flag === "measuring"), (n) => `Measuring ${of(n)}. ${none}`],
  ];
  const hit = steps.find(([n]) => n > 0);
  return hit ? hit[1](hit[0]) : none;
}

// What a write did to the grid: where it stands now, and which squares moved (null when none did).
// A loop that joins the grid (approved) has from: null; one that leaves it (retired) has to: null.
export function gridChange(before, after) {
  const a = derive(before);
  const b = derive(after);
  const now = { delegated: b.metrics.delegatedPoints, stillPct: b.metrics.stillPct, levels: b.metrics.counts };
  const was = new Map(a.loops.map((l) => [l.code, l.level]));
  const is = new Map(b.loops.map((l) => [l.code, l.level]));
  const moved = [];
  for (const [code, to] of is) if (was.get(code) !== to) moved.push({ code, from: was.get(code) ?? null, to });
  for (const [code, from] of was) if (!is.has(code)) moved.push({ code, from, to: null });
  if (!moved.length) return { now, delta: null };
  moved.sort((x, y) => (x.code < y.code ? -1 : 1));
  const levels = {};
  for (const l of LEVELS) {
    const n = b.metrics.counts[l] - a.metrics.counts[l];
    if (n) levels[l] = n;
  }
  const delegated = { before: a.metrics.delegatedPoints, after: b.metrics.delegatedPoints };
  const step = (m) =>
    m.from == null
      ? `${m.code} joined the grid at ${levelName(m.to)}.`
      : m.to == null
        ? `${m.code} left the grid.`
        : `${m.code} moved from ${levelName(m.from)} to ${levelName(m.to)}.`;
  const head =
    delegated.before === delegated.after
      ? `Handed off stays at ${formatPoints(delegated.after, P.limits.loops)}.`
      : `Handed off went from ${delegated.before} to ${formatPoints(delegated.after, P.limits.loops)}.`;
  const shown = moved.slice(0, 5).map(step);
  if (moved.length > 5) shown.push(`${moved.length - 5} more loops changed.`);
  return { now, delta: { delegated, levels, moved, summary: [head, ...shown].join(" ") } };
}

// ---------------------------------------------------------------------------
// Protocol version changes (section 15.2)

const atVersion = (state, version) => ({ ...state, meta: { ...(state.meta || {}), protocolVersion: version } });

// What a log breaks under `to` that it didn't break under `from`: loops and pending text to rename.
export function newRuleBreaks(state, from, to) {
  const old = new Set(validate(atVersion(state, from)).map((v) => v.message));
  return validate(atVersion(state, to))
    .filter((v) => !old.has(v.message))
    .map(({ target, rule, message }) => ({ target, rule, message }));
}

// The record of an adoption: same loops, measured under both versions.
// until: the note about it shows for 1 cycle after `at`.
export function versionChange(state, to, { at, cycle = 0 }) {
  const from = logVersion(state.meta);
  const loops = (state.loops || []).filter(isActive);
  const day = at.slice(0, 10);
  return {
    from,
    to,
    at: day,
    cycle,
    until: new Date(Date.parse(day) + P.limits.cycleWeeks * 7 * DAY).toISOString().slice(0, 10),
    delegatedBefore: metrics(loops, from).delegatedPoints,
    delegatedAfter: metrics(loops, to).delegatedPoints,
  };
}

export const changeIsCurrent = (change, today) => Boolean(change && today >= change.at && today < change.until);

// The version whose new rules the owner should clean up for, and what breaks them:
// a scheduled or available upgrade (ahead of time), else the last adoption.
export function pendingRuleBreaks(state) {
  const meta = state.meta || {};
  const current = logVersion(meta);
  const ahead = meta.protocolUpgrade?.version || (compareVersions(current, P.version) < 0 ? P.version : null);
  if (ahead) return { version: ahead, adopted: Boolean(meta.protocolUpgrade), items: newRuleBreaks(state, current, ahead) };
  if (meta.protocolChange?.to === current) return { version: current, adopted: true, items: newRuleBreaks(state, meta.protocolChange.from, current) };
  return { version: current, adopted: true, items: [] };
}

// ---------------------------------------------------------------------------
// Public view: an allowlist. Any field not copied here stays private.

const pick = (obj, keys) => {
  const out = {};
  for (const k of keys) if (obj?.[k] !== undefined && obj[k] !== null) out[k] = obj[k];
  return out;
};

export function isPrivateLoop(loop) {
  const p = parseCode(loop.code);
  return Boolean(p && P.consentRequired.includes(p.areaCode) && !loop.published);
}

export function publicView(state, { generatedAt = null } = {}) {
  const d = derive(state);
  const meta = d.meta;
  const hidden = new Set(d.loops.filter(isPrivateLoop).map((l) => l.code));
  const loops = d.loops.map((l) => {
    const priv = hidden.has(l.code);
    const out = pick(l, ["code", "level", "flag", "outcome", "visibility"]);
    if (l.measured) out.measured = true;
    if (l.failed) out.failed = true;
    if (l.changed) out.changed = true;
    if (priv) {
      out.private = true;
      return out;
    }
    Object.assign(out, pick(l, ["name", "doneWhen", "scope"]));
    if (l.triage) out.triage = pick(l.triage, [...P.triage.criteria, "source"]);
    if (l.estimate && !(l.branch === "C" && !meta.companyFigures)) out.estimate = pick(l.estimate, ["howOften", "hoursPerWeek"]);
    if (l.baseline) out.baseline = pick(l.baseline, ["occurrences", "confidence"]);
    return out;
  });
  const experiments = d.experiments
    .filter((e) => e.question && !e.loops.some((c) => hidden.has(c)))
    .map((e) => ({
      ...pick(e, ["code", "slot", "funReason", "question", "hypothesis", "odds", "loops", "startLevel", "goal", "registeredAt", "status", "stage", "try", "level"]),
      ...(e.conclusion ? { conclusion: pick(e.conclusion, ["at", "level", "hypothesis"]) } : {}),
      stages: sortTries(e.stages).map((t) => ({
        ...pick(t, ["stage", "try", "level", "start", "deadline", "approach", "why", "successTests", "outcome", "closedAt", "learned"]),
        ...(t.hold ? { hold: pick(t.hold, ["result", "at"]) } : {}),
      })),
    }));
  return {
    protocolVersion: meta.protocolVersion || P.version,
    attribution: P.attribution,
    sample: Boolean(meta.sample),
    ...(generatedAt ? { generatedAt } : {}),
    meta: pick(meta, ["ownerName", "about", "links", "languages", "mode", "inventoryVersion", "cycle", "day", "stage", "stillMetric", "grid"]),
    ...(meta.protocolChange
      ? { protocolChange: pick(meta.protocolChange, ["from", "to", "at", "cycle", "until", "delegatedBefore", "delegatedAfter"]) }
      : {}),
    metrics: d.metrics,
    loops,
    experiments,
  };
}

// Public activity: the history events whose result the public view already shows, also an allowlist.
// Each item keeps the day (no clock), what happened, which visible codes it touched and whether a person or an agent did it.
// Event ids, actor names, overrides, reasons and free text stay private.
export const PUBLIC_TOOLS = [
  "approve_loops",
  "approve_baseline",
  "approve_text",
  "freeze_inventory",
  "register_experiment",
  "register_stage_try",
  "close_stage_try",
  "record_hold",
  "record_drop",
  "conclude_experiment",
  "adopt_protocol",
];
const LOG_WIDE = new Set(["freeze_inventory", "adopt_protocol"]);
const RESULTS = { close_stage_try: P.outcomes, record_hold: P.holds, conclude_experiment: P.conclusions };

// events: newest first, { id, at, actor, tool, target, result? }, plus undo_event rows carrying `undid`.
export function publicActivity(events, view) {
  const loops = new Set(view.loops.filter((l) => !l.private).map((l) => l.code));
  const exps = new Set(view.experiments.map((e) => e.code));
  const undone = new Set(events.filter((e) => e.tool === "undo_event" && e.undid != null).map((e) => Number(e.undid)));
  const out = [];
  for (const e of events) {
    const tool = String(e.tool || "").replace(/^override:/, "");
    if (!PUBLIC_TOOLS.includes(tool) || undone.has(Number(e.id))) continue;
    const targets = [...new Set(String(e.target || "").split(",").map((t) => t.split("#")[0]))];
    const codes = targets.filter((t) => loops.has(t) || exps.has(t));
    if (!codes.length && !LOG_WIDE.has(tool)) continue;
    const item = { day: String(e.at).slice(0, 10), tool, codes, by: e.actor === "owner" ? "owner" : e.actor === "system" ? "system" : "agent" };
    if (RESULTS[tool]?.includes(e.result)) item.result = e.result;
    out.push(item);
  }
  return out;
}

// Shape check for a fetched public view (the marketing site build refuses anything else).
export function checkPublic(view) {
  const issues = [];
  if (!view || typeof view !== "object") return ["the response is not a JSON object."];
  if (!Array.isArray(view.loops)) issues.push("loops is missing.");
  if (!Array.isArray(view.experiments)) issues.push("experiments is missing.");
  if (!view.meta || !Array.isArray(view.meta.languages)) issues.push("meta.languages is missing.");
  if (issues.length) return issues;
  for (const l of view.loops) {
    if (!parseCode(l.code)) issues.push(`${l.code}: bad code.`);
    if (!LEVELS.includes(l.level)) issues.push(`${l.code}: bad level.`);
  }
  if (view.meta.mode === "frozen" && view.loops.length !== P.limits.loops)
    issues.push(`${view.loops.length} loops in a frozen inventory. Expected ${P.limits.loops}.`);
  for (const e of view.experiments) if (!EXP_RE.test(e.code || "")) issues.push(`${e.code}: bad experiment code.`);
  return issues;
}

// ---------------------------------------------------------------------------
// Grid rendering, shared by the site and the app page.

export const pickText = (value, lang) =>
  value == null ? "" : typeof value === "string" ? value : value[lang] ?? Object.values(value)[0] ?? "";

// view: publicView() output (or a derived owner view with the same loop fields).
// opts.metric: "still" (data-pct) or "delegated" (data-points of data-total), the figure each area button carries.
// opts.labels: { areas: { relationships: "RELATIONSHIPS", ... }, captions?: {...}, private: "Private loop" }
// opts.slots: { R: 33, ... } pads each branch with empty squares up to that count.
// opts.compact: a 3-letter area name (REL, PER, COM) instead of the area buttons.
export function renderGrid(view, { lang = "en", metric = "still", labels, slots = {}, compact = false }) {
  const grid = view.meta?.grid || {};
  const cols = grid.cols || {};
  const seeds = grid.seeds || {};
  const branches = view.metrics?.branches || metrics(view.loops, view.protocolVersion).branches;
  let col = 1;
  const columns = [];
  const html = P.branchOrder
    .map((b) => {
      const key = P.branches[b].key;
      const n = cols[b] || 4;
      const list = view.loops.filter((l) => l.code.startsWith(b + "-")).sort((a, z) => (a.code < z.code ? -1 : 1));
      shuffle(list, seeds[b] || 1).sort((a, z) => (z.visibility || 0) - (a.visibility || 0));
      const cells = list
        .map((l) => {
          const name = l.private ? labels.private : pickText(l.name, lang);
          let attrs = ` data-s="${l.level}" data-loop="${esc(l.code)}"`;
          if (l.measured) attrs += " data-measured";
          if (name) attrs += ` data-name="${esc(name)}"`;
          if (l.flag) attrs += ` data-flag="${l.flag}"`;
          if (l.outcome) attrs += ` data-o="${l.outcome}"`;
          if (l.failed) attrs += " data-failed";
          if (l.changed) attrs += " data-changed";
          return `<i class="cell"${attrs}></i>`;
        })
        .join("") + `<i class="cell" data-s="empty"></i>`.repeat(Math.max(0, (slots[b] || 0) - list.length));
      const span = `${col} / span ${n}`;
      col += n + 1;
      columns.push(`repeat(${n}, minmax(0, 1fr))`);
      const figure =
        metric === "delegated"
          ? `data-points="${branches[b].delegatedPoints}" data-total="${branches[b].total}"`
          : `data-pct="${branches[b].stillPct}"`;
      const caption = labels.captions?.[key];
      if (compact)
        return `<div class="area" data-area="${key}" style="--span:${span}"><span class="area-letter">${key.slice(0, 3).toUpperCase()}</span><div class="cells" style="--cols:${n}" aria-hidden="true">${cells}</div></div>`;
      return (
        `<div class="area" data-area="${key}" style="--span:${span}">` +
        `<button class="area-label" type="button" aria-pressed="false" data-area-btn="${key}" ${figure}` +
        (caption ? ` data-caption="${esc(caption)}"` : "") +
        `>${esc(labels.areas[key])}</button>` +
        `<div class="cells" style="--cols:${n}" aria-hidden="true">${cells}</div>` +
        `</div>`
      );
    })
    .join("\n");
  return { html, columns: columns.join(" var(--group-gap) ") };
}

// ---------------------------------------------------------------------------
// Nudges: when the agent challenges or asks, decided from the log alone. The agent only picks the words.

export const CHALLENGE_LEVELS = ["off", "gentle", "normal", "bold"];
export const QUESTION_KINDS = ["gaps", "personal", "romantic"];
export const NUDGE_ANSWERS = ["took", "not_now", "pause", "stop"];
export const PAUSE_WEEKS = [2, 4];
// The honest chance a bet holds, out of 100. Under 20 or over 80 isn't a real bet.
export const ODDS = { min: 20, max: 80 };
// Hours between showings, showings per check-in period, hours before a silence counts as not now,
// weeks without change before a pick counts as stuck, and the odds that make a bet too safe.
export const NUDGE_LIMITS = { coolHours: 24, perPeriod: 3, answerHours: 24, stuckWeeks: 4, safeOdds: 70 };
const PERIOD_DAYS = P.limits.cycleWeeks * 7;
const HOUR = 3600000;
// Never asked about, whatever the settings say: children's lives and health.
const NEVER_ASKED = new Set(["R-KID", "P-HLT"]);

const dayOf = (at) => String(at).slice(0, 10);
const addDays = (day, n) => new Date(Date.parse(`${dayOf(day)}T00:00:00Z`) + n * DAY).toISOString().slice(0, 10);
const daysFrom = (a, b) => Math.floor((Date.parse(`${dayOf(b)}T00:00:00Z`) - Date.parse(`${dayOf(a)}T00:00:00Z`)) / DAY);

export const isPaused = (meta, today) => Boolean(meta?.pausedUntil && meta.pausedUntil >= dayOf(today));

// The check-in that ends period N is open from day 13 of N to day 3 of N + 1. Returns N, or null outside it.
export function checkInWindow(meta) {
  const cycle = Number(meta?.cycle) || 0;
  const day = Number(meta?.day) || 0;
  if (cycle < 1 || day < 1) return null;
  if (day >= PERIOD_DAYS - 1) return cycle;
  if (day <= 3 && cycle >= 2) return cycle - 1;
  return null;
}

// The period whose check-in is open and not marked yet; null when none is due or the log is paused.
export function checkInDue(meta, today) {
  const n = checkInWindow(meta);
  if (n == null || isPaused(meta, today)) return null;
  return (meta.checkIns || []).some((c) => c.cycle === n) ? null : n;
}

function periodStart(meta, today) {
  const cycle = Number(meta.cycle) || 0;
  if (meta.cycleOneStart && cycle >= 1) return addDays(meta.cycleOneStart, (cycle - 1) * PERIOD_DAYS);
  return addDays(today, 1 - PERIOD_DAYS);
}

const AREA_ASKS = {
  "R-PAR": "Do you have a partner? We could plan a weekly dinner, booked and reminded for you.",
  "R-FAM": "Who in your family do you mean to call more often?",
  "R-FRN": "Which friends do you keep meaning to see?",
  "R-NET": "Who in your work life do you owe a reply or an intro?",
  "P-FIN": "Which bills or money chores do you dread each month?",
  "P-HOM": "What do you dread every Sunday night?",
  "P-INC": "Do you have income outside your main job, like rent or side work?",
  "P-ADM": "Which forms, renewals or paperwork keep coming back?",
};
const BRANCH_ASKS = {
  R: "Do you have a partner? I see nothing on your relationships yet. We could plan a weekly dinner, booked and reminded for you.",
  P: "What chores at home or with money take your evenings?",
  C: "Are you working? There's usually a lot to hand off.",
};
const PERSONAL_ASKS = {
  "P-HOM": "What's one thing your family complains you never do?",
  "P-FIN": "What would you do with 2 free hours a week?",
  "P-INC": "What side project never gets your time?",
  "P-ADM": "What paperwork do you put off until it's late?",
};
const ROMANTIC_ASK = "Want to spice things up? A weekly dinner with real aftercare: the agent books it and reminds you, you show up.";
const PLAYBOOK = "onhundred://docs/playbook";

function outsFor(type) {
  const what = type === "question" ? "these questions" : "these challenges";
  return [
    { answer: "took", say: "Let's do it" },
    { answer: "not_now", say: "Not now" },
    { answer: "pause", say: `Pause ${what} for 2 or 4 weeks` },
    { answer: "stop", say: `Stop ${what}` },
  ];
}

// Every nudge the log supports today, best first. nudges() then applies the person's settings and the budget.
function nudgeCandidates(state, now) {
  const meta = state.meta || {};
  const today = dayOf(now);
  const d = derive(state);
  const listed = (state.loops || []).filter((l) => !l.retired);
  const countIn = (prefix) => listed.filter((l) => l.code.startsWith(prefix + "-")).length;
  const frozen = meta.mode === "frozen";
  const out = { challenge: [], progress: [], gaps: [], personal: [], romantic: [] };
  const add = (group, type, kind, about, why, facts, move, ask) =>
    out[group].push({ id: `${kind}:${about}`, type, kind, about, why, facts, move, outs: outsFor(type), ...(ask ? { ask } : {}) });

  // Gap questions: a part of life, or an area, with no loops yet.
  for (const b of P.branchOrder) {
    const branch = P.branches[b];
    if (!countIn(b)) {
      add("gaps", "question", "gaps", b, `${branch.name} has 0 loops.`, { part: branch.name, loops: 0 }, "Ask 1 question about this part of life, then propose loops from the answer.", { example: BRANCH_ASKS[b], read: PLAYBOOK });
      continue;
    }
    for (const [area, name] of Object.entries(branch.areas)) {
      const code = `${b}-${area}`;
      if (NEVER_ASKED.has(code) || countIn(code)) continue;
      add("gaps", "question", "gaps", code, `${code} (${name}) has 0 loops.`, { area: code, name, loops: 0 }, "Ask 1 question about this area, then propose loops from the answer.", { example: AREA_ASKS[code] || `What keeps coming back in ${name.toLowerCase()}?`, read: PLAYBOOK });
    }
  }

  // Curious-friend questions: the personal area with the fewest loops.
  const personal = Object.keys(PERSONAL_ASKS).sort((a, z) => countIn(a) - countIn(z) || (a < z ? -1 : 1))[0];
  add("personal", "question", "personal", personal, `${personal} (${P.branches.P.areas[personal.slice(2)]}) has ${countIn(personal)} loops.`, { area: personal, loops: countIn(personal) }, "Ask 1 personal question, then suggest 1 loop from the answer.", { example: PERSONAL_ASKS[personal], read: PLAYBOOK });

  // Romantic ideas: partner loops that haven't moved.
  const partner = d.loops.filter((l) => l.code.startsWith("R-PAR-"));
  const partnerBusy = d.experiments.some((e) => !e.conclusion && e.loops.some((c) => c.startsWith("R-PAR-")));
  if (!partner.some((l) => lv(l.level) > lv("still")) && !partnerBusy)
    add("romantic", "question", "romantic", "R-PAR", `R-PAR has ${countIn("R-PAR")} loops and none has moved.`, { area: "R-PAR", loops: countIn("R-PAR"), moved: false }, "Suggest 1 partner loop. It stays private until your partner agrees.", { example: ROMANTIC_ASK, read: PLAYBOOK });

  if (!frozen) {
    const n = listed.length;
    const target = n < 10 ? 10 : P.limits.loops;
    if (n < P.limits.loops)
      add("progress", "progress", "listSize", "list", `${n} loops, ${target - n} more to reach ${target}.`, { loops: n, target }, "Offer to find the next loops together.");
    const noCost = d.loops.filter((l) => !l.measured && l.estimate?.hoursPerWeek == null);
    if (noCost.length)
      add("progress", "progress", "noEstimate", "costs", `${noCost.length} loops have no cost estimate.`, { loops: noCost.length, codes: noCost.slice(0, 5).map((l) => l.code) }, "Offer to estimate the hours a week, 1 loop at a time.");
    return out;
  }

  const level = CHALLENGE_LEVELS.indexOf(meta.challenge ?? "normal");
  const openExps = d.experiments.filter((e) => !e.conclusion);
  const tries = (e) => sortTries(e.stages);
  const lastMove = (e) =>
    [e.registeredAt, ...tries(e).flatMap((t) => [t.start, t.closedAt, t.hold?.at])].filter(Boolean).map(dayOf).sort().at(-1) || today;
  if (level >= 1) {
    for (const e of openExps) {
      const t = tries(e).at(-1);
      if (t && t.outcome == null && t.deadline && t.deadline < today) {
        add("challenge", "challenge", "pastDeadline", e.code, `${e.code} round ${t.stage} ended on ${t.deadline} and has no result yet.`, { experiment: e.code, round: t.stage, deadline: t.deadline }, "Ask whether it passed, then end the round.");
        continue;
      }
      const weeks = Math.floor(daysFrom(lastMove(e), today) / 7);
      if (weeks >= NUDGE_LIMITS.stuckWeeks)
        add("challenge", "challenge", "stuckPick", e.code, `${e.code} hasn't moved in ${weeks} weeks.`, { experiment: e.code, slot: e.slot, weeks }, "Offer a new try with a different approach, or end it.");
    }
    const taken = new Set(openExps.map((e) => e.slot));
    for (const slot of P.limits.experimentSlots)
      if (!taken.has(slot)) add("challenge", "challenge", "emptyPick", slot, `The ${slot} pick is empty.`, { slot }, "Call suggest_slots and offer 1 loop for it.");
  }
  if (level >= 2) {
    const busy = new Set(openExps.flatMap((e) => e.loops));
    for (const e of d.experiments)
      for (const t of tries(e)) {
        if (t.hold?.result !== "passed" || daysFrom(t.hold.at, today) > NUDGE_LIMITS.stuckWeeks * 7) continue;
        for (const code of e.loops) {
          const l = d.loops.find((x) => x.code === code);
          if (!l || busy.has(code) || lv(l.level) >= lv(ceilingOf(l))) continue;
          add("challenge", "challenge", "aimHigher", code, `${code} proved ${levelName(l.level)}. It can aim 1 level higher.`, { loop: code, level: l.level, ceiling: ceilingOf(l) }, "Offer an experiment that aims 1 level higher.");
        }
      }
    const green = d.loops.filter((l) => lv(l.level) > lv("still")).length;
    if (green >= 3 && !openExps.some((e) => e.slot === "hard"))
      add("challenge", "challenge", "noHardPick", "hard", `${green} loops have moved up and no hard pick is running.`, { moved: green }, "Offer a hard pick: call suggest_slots.");
  }
  if (level >= 3) {
    for (const e of openExps)
      if (e.odds >= NUDGE_LIMITS.safeOdds)
        add("challenge", "challenge", "safeBet", e.code, `${e.code} has odds of ${e.odds} in 100. That bet is safe.`, { experiment: e.code, odds: e.odds }, "Offer a bolder goal or a harder loop next time.");
    const lastFun = d.experiments.filter((e) => e.slot === "fun").map((e) => e.conclusion?.at || today).sort().at(-1);
    const emptyFor = lastFun ? daysFrom(lastFun, today) : (Number(meta.cycle) || 0) * PERIOD_DAYS;
    if (!openExps.some((e) => e.slot === "fun") && emptyFor >= 2 * PERIOD_DAYS)
      add("challenge", "challenge", "funEmpty", "fun", "The fun pick has been empty for 2 check-ins.", { slot: "fun", days: emptyFor }, "Offer 1 fun loop that makes a good story.");
  }
  return out;
}

// The nudges get_state may hand out now, best first, after the settings, the pause and the budget.
// activity: nudge_activity rows ({ nudge_id, kind, about, event, answer, at }) from the last weeks.
// The budget counts showings, not answers: an agent that never records the answer can't cause nagging.
export function nudges(state, activity = [], now = new Date().toISOString()) {
  const meta = state.meta || {};
  const today = dayOf(now);
  if (isPaused(meta, today)) return [];
  const rows = [...activity].sort((a, z) => (a.at < z.at ? -1 : a.at > z.at ? 1 : 0));
  const shown = rows.filter((r) => r.event === "shown");
  const last = shown.at(-1);
  if (last && Date.parse(now) - Date.parse(last.at) < NUDGE_LIMITS.coolHours * HOUR) return [];
  const start = periodStart(meta, today);
  if (shown.filter((r) => dayOf(r.at) >= start).length >= NUDGE_LIMITS.perPeriod) return [];

  const answerOf = (s) => {
    const a = rows.find((r) => r.event === "answered" && r.nudge_id === s.nudge_id && r.at >= s.at);
    if (a) return a.answer;
    return Date.parse(now) - Date.parse(s.at) >= NUDGE_LIMITS.answerHours * HOUR ? "not_now" : null;
  };
  const recent = new Set(shown.filter((s) => daysFrom(s.at, today) < PERIOD_DAYS).map((s) => s.nudge_id));
  const silenced = new Set();
  for (const kind of new Set(shown.map((s) => s.kind))) {
    const two = shown.filter((s) => s.kind === kind).slice(-2);
    if (two.length === 2 && two.every((s) => answerOf(s) === "not_now") && daysFrom(two[1].at, today) < PERIOD_DAYS) silenced.add(kind);
  }

  const c = nudgeCandidates(state, now);
  const q = { ...Object.fromEntries(QUESTION_KINDS.map((k) => [k, true])), ...(meta.questions || {}) };
  const challenges = (meta.challenge ?? "normal") === "off" ? [] : [...c.challenge, ...c.progress];
  // Questions never interrupt a check-in.
  const questions = checkInDue(meta, today) != null ? [] : QUESTION_KINDS.flatMap((k) => (q[k] ? c[k] : []));
  const ranked = meta.mode === "frozen" ? [...challenges, ...questions] : [...questions.filter((n) => n.kind === "gaps"), ...challenges, ...questions.filter((n) => n.kind !== "gaps")];
  return ranked.filter((n) => !recent.has(n.id) && !silenced.has(n.kind));
}

// What get_state says the first time each kind of question is shown, so the person knows 1 sentence turns it off.
export const QUESTION_NOTICES = {
  gaps: "If you'd rather I don't ask about the empty parts of your list, just say so.",
  personal: "If you'd rather I don't ask personal questions, just say so.",
  romantic: "If you'd rather I don't suggest romantic ideas, just say so.",
};

// ---------------------------------------------------------------------------
// Moments: what a write did that's worth a message and a share card.

export const MOMENT_ORDER = ["tenOfTen", "firstAlone", "listDone", "firstGreen", "itHeld", "wrongBet", "roundMissed", "betPlaced", "checkIn"];
export const MOMENT_KIND = {
  tenOfTen: "congratulate",
  firstAlone: "congratulate",
  listDone: "congratulate",
  firstGreen: "congratulate",
  itHeld: "congratulate",
  wrongBet: "honest",
  roundMissed: "honest",
  betPlaced: "challenge",
  checkIn: "challenge",
};
// Which page a moment's shared link opens: the loop's, the experiment's or the log's home page.
export const MOMENT_PAGE = {
  tenOfTen: "home",
  firstAlone: "loop",
  listDone: "home",
  firstGreen: "loop",
  itHeld: "loop",
  wrongBet: "exp",
  roundMissed: "exp",
  betPlaced: "exp",
  checkIn: "home",
};
const HANDED_OFF_GOAL = 10;
const CARD_TILES = 10;

// before and after are full states; op and result are the write and what it returned. Best moment first.
export function moments(before, after, op, result = {}) {
  const a = derive(before);
  const b = derive(after);
  const name = String(op || "").replace(/^override:/, "");
  const levelIn = (d) => new Map(d.loops.map((l) => [l.code, l.level]));
  const was = levelIn(a);
  const newly = (test) => b.loops.filter((l) => test(l.level) && !test(was.get(l.code) || "still")).map((l) => l.code).sort();
  const count = (d, test) => d.loops.filter((l) => test(l.level)).length;
  const above = (l) => lv(l) > lv("still");
  const handed = (l) => lv(l) >= lv("delegated");
  const alone = (l) => l === "autonomous";
  const expLoops = (code) => (after.experiments || []).find((e) => e.code === code)?.loops || [];
  const found = [];
  const add = (moment, target) => found.push({ moment, kind: MOMENT_KIND[moment], page: MOMENT_PAGE[moment], target: target ?? null });

  if (before.meta?.mode !== "frozen" && after.meta?.mode === "frozen") add("listDone");
  if (!count(a, above) && count(b, above)) add("firstGreen", newly(above)[0]);
  if (name === "record_hold" && result?.hold === "passed") add("itHeld", result.moved?.[0] || expLoops(result.experiment)[0]);
  if (!count(a, alone) && count(b, alone)) add("firstAlone", newly(alone)[0]);
  if (count(a, handed) < HANDED_OFF_GOAL && count(b, handed) >= HANDED_OFF_GOAL) add("tenOfTen");
  if (name === "conclude_experiment" && result?.conclusion?.hypothesis === "refuted") add("wrongBet", result.experiment);
  if ((name === "close_stage_try" && result?.outcome === "notAchieved") || (name === "record_hold" && result?.hold === "failed"))
    add("roundMissed", result.experiment);
  if (name === "register_stage_try" && result?.stage === 1 && result?.try === 1) add("betPlaced", result.experiment);
  if ((after.meta?.checkIns || []).length > (before.meta?.checkIns || []).length) add("checkIn");
  return found.sort((x, z) => MOMENT_ORDER.indexOf(x.moment) - MOMENT_ORDER.indexOf(z.moment));
}

const inLangs = (langs, fn) => Object.fromEntries(langs.map((lang) => [lang, fn(lang)]));

// The 10 loops a card shows: the latest public activity first, then the highest level, then the most hours.
// The moment's own loops always make it in. Shown in the order their first round started, so positions stay put.
function cardTiles(view, keep) {
  const first = new Map();
  const last = new Map();
  for (const e of view.experiments)
    for (const t of e.stages)
      for (const c of e.loops) {
        const dates = [t.start, t.closedAt, t.hold?.at].filter(Boolean);
        if (!dates.length) continue;
        if (!first.has(c) || t.start < first.get(c)) first.set(c, t.start);
        const end = dates.sort().at(-1);
        if ((last.get(c) || "") < end) last.set(c, end);
      }
  const hours = (l) => l.estimate?.hoursPerWeek ?? -1;
  const cmp = (x, y) => (x < y ? -1 : x > y ? 1 : 0);
  const named = view.loops.filter((l) => !l.private && l.name);
  const ranked = [...named].sort(
    (a, b) =>
      keep.includes(b.code) - keep.includes(a.code) ||
      cmp(last.get(b.code) || "", last.get(a.code) || "") ||
      lv(b.level) - lv(a.level) ||
      hours(b) - hours(a) ||
      cmp(a.code, b.code)
  );
  return ranked
    .slice(0, CARD_TILES)
    .sort((a, b) => cmp(first.get(a.code) || "~", first.get(b.code) || "~") || hours(b) - hours(a) || cmp(a.code, b.code))
    .map((l) => ({ code: l.code, name: l.name, level: l.level, ...(l.estimate?.hoursPerWeek != null ? { hours: l.estimate.hoursPerWeek } : {}) }));
}

// What a card may show, taken only from publicView(). { facts }, or { waiting: [...] } while its key text
// waits for approval, or { none } when a private partner loop is involved.
export function cardFacts(state, moment, target) {
  const meta = state.meta || {};
  const langs = meta.languages?.length ? meta.languages : ["en"];
  const view = publicView(state);
  const handed = (l) => lv(l.level) >= lv("delegated");
  const page = MOMENT_PAGE[moment];
  const expOf = page === "exp" ? view.experiments.find((x) => x.code === target) : null;
  const tiles = cardTiles(view, page === "loop" ? [target] : expOf?.loops || []);
  const hoursBack = tiles.filter((t) => handed(t) && t.hours != null).reduce((sum, t) => sum + t.hours, 0);
  const base = {
    moment,
    kind: MOMENT_KIND[moment],
    languages: langs,
    ownerName: meta.ownerName || null,
    points: view.metrics.delegatedPoints,
    total: P.limits.loops,
    loops: view.loops.length,
    handedOff: view.loops.filter(handed).length,
    levels: view.metrics.counts,
    cycle: Number(meta.cycle) || 0,
    tiles,
    done: tiles.filter(handed).length,
    ...(hoursBack > 0 ? { hoursBack: { perWeek: Math.round(hoursBack * 10) / 10, source: "estimated" } } : {}),
  };
  const raw = (code) => (state.loops || []).find((l) => l.code === code);
  const PARTNER = { none: "partner hasn't agreed to publish" };
  const loopFacts = (l) => ({
    code: l.code,
    name: l.name,
    level: l.level,
    levelName: inLangs(langs, (lang) => levelName(l.level, lang)),
    measured: Boolean(l.measured),
    ...(tiles.some((t) => t.code === l.code) ? { position: tiles.findIndex((t) => t.code === l.code) + 1 } : {}),
    ...(l.estimate?.hoursPerWeek != null ? { hours: { perWeek: l.estimate.hoursPerWeek, source: "estimated" } } : {}),
  });
  if (page === "loop") {
    const r = raw(target);
    if (!r) return { none: "the loop doesn't exist" };
    if (isPrivateLoop(r)) return PARTNER;
    const l = view.loops.find((x) => x.code === target);
    if (!l) return { none: "the loop isn't on the list" };
    return { facts: { ...base, loop: loopFacts(l) } };
  }
  if (page === "exp") {
    const e = (state.experiments || []).find((x) => x.code === target);
    if (!e) return { none: "the experiment doesn't exist" };
    if (e.loops.some((c) => raw(c) && isPrivateLoop(raw(c)))) return PARTNER;
    const waiting = [...(e.question ? [] : [`${e.code} question`]), ...(e.hypothesis ? [] : [`${e.code} bet`])];
    if (waiting.length) return { waiting };
    const v = expOf;
    if (!v) return { none: "the experiment isn't public" };
    const last = v.stages.at(-1);
    const lesson = [...v.stages].reverse().find((t) => t.learned)?.learned;
    const days = last?.start && last?.deadline ? Math.round((Date.parse(last.deadline) - Date.parse(last.start)) / DAY) : null;
    return {
      facts: {
        ...base,
        experiment: {
          code: v.code,
          slot: v.slot,
          question: v.question,
          hypothesis: v.hypothesis,
          ...(v.odds != null ? { odds: v.odds } : {}),
          status: v.status,
          ...(v.conclusion ? { verdict: v.conclusion.hypothesis } : {}),
          round: last?.stage ?? null,
          ...(last ? { start: last.start, deadline: last.deadline, days, approach: last.approach, ...(last.outcome ? { outcome: last.outcome } : {}) } : {}),
          ...(lesson ? { lesson } : {}),
          running: !v.conclusion,
          loops: v.loops.map((c) => view.loops.find((l) => l.code === c)).filter(Boolean).map(loopFacts),
        },
      },
    };
  }
  return { facts: base };
}

// A prewritten headline (protocol.json cards.headlines) filled with the card's own facts. Nothing else is ever written on a card.
// *Starred* parts are the accent on the card image; parts are [{ text, accent }].
export function cardHeadlineParts(facts, index = 0, lang = "en") {
  const list = P.cards.headlines[facts.moment] || [];
  const h = list[index] || list[0];
  if (!h) return [];
  const loop = facts.loop || facts.experiment?.loops?.[0];
  const values = {
    total: facts.total,
    points: facts.points,
    handed: facts.handedOff,
    cycle: facts.cycle,
    count: facts.tiles?.length || HANDED_OFF_GOAL,
    done: facts.done ?? 0,
    days: facts.experiment?.days ?? "",
    name: pickText(loop?.name, lang),
    level: loop?.levelName?.[lang] || levelName(loop?.level, lang),
    code: facts.experiment?.code || loop?.code || "",
    question: pickText(facts.experiment?.question, lang),
    round: facts.experiment?.round ?? "",
  };
  return (h[lang] || h.en)
    .split("*")
    .map((part, i) => ({ text: part.replace(/\{(\w+)\}/g, (_, k) => String(values[k] ?? "")), accent: i % 2 === 1 }))
    .filter((p) => p.text);
}

export const cardHeadline = (facts, index = 0, lang = "en") =>
  cardHeadlineParts(facts, index, lang)
    .map((p) => p.text)
    .join("");
