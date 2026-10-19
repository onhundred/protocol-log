// MCP over Streamable HTTP, stateless, JSON responses. One endpoint: POST /mcp.
// Claude, ChatGPT, Cursor, Claude Code and the xAI, OpenAI and Anthropic APIs all speak this.
import {
  ABOUT_MAX_WORDS,
  CHALLENGE_LEVELS,
  MAX_LINKS,
  NUDGE_ANSWERS,
  NUDGE_LIMITS,
  ODDS,
  PAUSE_WEEKS,
  PROFILE_LINKS,
  QUESTION_KINDS,
  QUESTION_NOTICES,
  cardFacts,
  cardHeadline,
  checkInDue,
  checkInWindow,
  compareVersions,
  derive,
  estimateCanStart,
  formatPoints,
  gridChange,
  isHardEligible,
  isMeasured,
  isPaused,
  levelName,
  logVersion,
  nudges,
  parseCode,
  pendingRuleBreaks,
  pickText,
  profileMissing,
  protocol as P,
  publicView,
  sortTries,
  triageGroup,
  validate,
} from "../lib/protocol.mjs";
import { createApiKey, listAgents, revokeAgent, viewPass } from "./auth.mjs";
import { cardSummary, cardUrls, readyCards, remakeCard, requestPostImages, takeDown } from "./cards.mjs";
import * as docs from "./docs.mjs";
import { pendingItems } from "./ops.mjs";
import { getCard, getEvents, isPublished, lastShown, listCards, logEvent, noticeGiven, nudgeActivity, readState, recordNudge, recordShown } from "./store.mjs";
import { TAKEN_DOWN_NOTE, writer } from "./writer.mjs";

export const SERVER_VERSION = "1.2.0";
const PROTOCOL_VERSIONS = ["2026-07-28", "2025-11-25", "2025-06-18", "2025-03-26", "2024-11-05"];

// ---------------------------------------------------------------------------
// Schemas

const str = (description) => ({ type: "string", description });
const int = (description) => ({ type: "integer", description });
const bool = (description) => ({ type: "boolean", description });
const textObj = (description) => ({
  type: "object",
  description: `${description} One entry per language of the log, like {"en": "...", "es": "..."}.`,
  additionalProperties: { type: "string" },
});
const obj = (properties, required = []) => ({ type: "object", properties, required, additionalProperties: false });
const triageSchema = obj(
  {
    time: int("Hours per week it takes, scored 1 to 5."),
    frequency: int("How often it repeats, 1 to 5."),
    rules: int("How clear the way to do it is, 1 to 5."),
    digital: int("How much of its data already lives in systems, 1 to 5."),
    risk: int("What an agent's mistake would cost, 1 to 5. Subtracts."),
  },
  ["time", "frequency", "rules", "digital", "risk"]
);
const estimateSchema = obj({ howOften: str("daily, weekly, monthly, quarterly or yearly."), hoursPerWeek: { type: "number", description: "Estimated hours per week." } });
const loopSpec = obj(
  {
    area: str("BRANCH-AREA, like R-PAR or C-SAL (protocol section 2.4)."),
    name: textObj("A verb and an object, 8 words or fewer, no names of people. Name what the loop produces, not the decision behind it."),
    doneWhen: textObj("The result outside your head, in 1 line."),
    scope: textObj("Optional. What counts as this loop and what doesn't, in 1 to 3 sentences. Ask whether a neighbor loop could be confused with it; if not, leave it out. Never restate doneWhen or list steps."),
    estimate: estimateSchema,
    triage: triageSchema,
    evidence: str("Required from agents: where this loop showed up, like a calendar block, an email thread or what the person told you. Never published."),
    over500: bool("P-FIN only: decisions above $500. Caps the loop at delegated."),
  },
  ["area", "name", "doneWhen", "evidence"]
);
const newLoopSpec = obj(
  {
    name: loopSpec.properties.name,
    doneWhen: loopSpec.properties.doneWhen,
    scope: loopSpec.properties.scope,
    estimate: estimateSchema,
    triage: triageSchema,
    evidence: loopSpec.properties.evidence,
  },
  ["name", "doneWhen", "evidence"]
);
const levels = { type: "string", enum: P.levels };

const READ = { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false };
const WRITE = { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false };
const DESTRUCTIVE = { readOnlyHint: false, destructiveHint: true, idempotentHint: false, openWorldHint: false };

// ---------------------------------------------------------------------------
// Tools. kind: "read" runs here; "write" goes through the WRITER; "owner" needs owner access.

// Writes whose result waits for the owner on the log page.
const WAITS_FOR_OWNER = new Set(["propose_loops", "split_loop", "merge_loops", "retire_loop", "record_baseline"]);

// The links an agent ends its reply with. Owner connections get a view pass: the owner view, no sign-in,
// nothing on it changes the log. Agent-access connections get plain links.
async function linksFor(call, op, r) {
  const { origin, agentId, access } = call.props;
  if (!origin) return null;
  const issued = access === "owner" && agentId ? await viewPass(call.env, agentId) : null;
  const moved = (r?.grid?.delta?.moved || []).map((m) => m.code);
  const q = moved.length ? `moved=${moved.join(",")}` : "";
  const graph = issued ? `${origin}/v/${issued.pass}${q ? `?${q}` : ""}` : `${origin}/${q ? `?${q}` : ""}#activity`;
  const code = typeof r?.target === "string" && parseCode(r.target) ? r.target : null;
  const loop = code ? (issued ? `${origin}/v/${issued.pass}?to=/loop/${code}` : `${origin}/loop/${code}`) : null;
  const approve = WAITS_FOR_OWNER.has(op) || r?.result?.pending === true ? `${origin}/login?next=/` : null;
  const open = approve || (moved.length ? graph : loop || graph);
  const card = r?.moment?.card?.url || r?.cardsReady?.[0]?.url || null;
  return {
    open,
    graph,
    ...(loop ? { loop } : {}),
    ...(approve ? { approve } : {}),
    ...(card ? { card } : {}),
    ...(issued ? { expiresAt: new Date(issued.exp).toISOString() } : {}),
  };
}

const cardOpts = (call, state) => ({ origin: call.props.origin || "", published: isPublished(state.meta, call.env), languages: state.meta.languages });
const daysAgo = (n, now = Date.now()) => new Date(now - n * 86400000).toISOString();
const PERIOD_DAYS = P.limits.cycleWeeks * 7;

// At most 1 nudge per get_state, on owner connections only, inside the budget nudges() and the guarded insert enforce.
async function deliverNudge(call, state) {
  const db = call.env.DB;
  const now = new Date().toISOString();
  const [first] = nudges(state, await nudgeActivity(db, daysAgo(3 * PERIOD_DAYS)), now);
  if (!first) return {};
  const coolSince = new Date(Date.parse(now) - NUDGE_LIMITS.coolHours * 3600000).toISOString();
  if (!(await recordShown(db, first, { at: now, actor: call.props.name, coolSince }))) return {};
  const out = { nudge: first };
  if (first.type === "question" && !(await noticeGiven(db, first.kind))) {
    await recordNudge(db, { nudge_id: first.id, kind: first.kind, about: first.about, event: "noticed", at: now, actor: call.props.name });
    out.questionNotice = QUESTION_NOTICES[first.kind];
  }
  return out;
}

const writeWithLinks = async (call, op, args, opts) => {
  const r = await call.write(op, args, opts);
  return { ...r, links: await linksFor(call, op, r) };
};

const writeTool = (name, title, description, inputSchema, { owner = false, annotations = WRITE } = {}) => ({
  name,
  title,
  description,
  inputSchema,
  annotations: { title, ...annotations },
  owner,
  run: (args, call) => writeWithLinks(call, name, args),
});

// The public header: what's set and what to ask the person for. links: [] means they have none to show.
const profileStatus = (meta) => {
  const missing = profileMissing(meta);
  return {
    ownerName: meta.ownerName || null,
    about: meta.about || null,
    links: meta.links ?? null,
    missing,
    ...(missing.includes("links") ? { ask: "Ask the person which social accounts to show, then call set_meta with links. [] if they have none." } : {}),
  };
};

const TOOLS = [
  // Read
  {
    name: "get_state",
    title: "Get the log's state",
    description:
      "Start here. Returns the settings, the check-in period (meta.cycle), both metrics, level counts, open experiments, what waits for approval and any rule the log currently breaks. On owner connections it may also return 1 nudge (a challenge or a question) with its facts and outs, a questionNotice, cardsReady, checkInDue and pausedUntil.",
    inputSchema: obj({}),
    annotations: { title: "Get the log's state", ...READ, idempotentHint: false },
    run: async (_args, call) => {
      const state = await call.state();
      const d = derive(state);
      const violations = validate(state);
      const today = new Date().toISOString().slice(0, 10);
      const opts = cardOpts(call, state);
      return {
        ...(call.owner ? await deliverNudge(call, state) : {}),
        cardsReady: (await readyCards(call.env.DB)).map((c) => cardSummary(c, opts)),
        checkInDue: checkInDue(state.meta, today) != null,
        pausedUntil: isPaused(state.meta, today) ? state.meta.pausedUntil : null,
        owner: state.meta.ownerName || null,
        settings: state.meta,
        protocolVersion: {
          log: state.meta.protocolVersion,
          template: P.version,
          upgradeAvailable: compareVersions(state.meta.protocolVersion, P.version) < 0 && !state.meta.protocolUpgrade,
          scheduled: state.meta.protocolUpgrade || null,
          lastChange: state.meta.protocolChange || null,
        },
        loops: { active: d.loops.length, proposed: state.loops.filter((l) => l.proposed && !l.retired).length, levels: d.metrics.counts },
        metrics: {
          delegated: formatPoints(d.metrics.delegatedPoints),
          delegatedPoints: d.metrics.delegatedPoints,
          stillPct: d.metrics.stillPct,
          branches: d.metrics.branches,
        },
        openExperiments: d.experiments.filter((e) => !e.conclusion).map((e) => ({ code: e.code, slot: e.slot, status: e.status, stage: e.stage, level: e.level })),
        pending: pendingItems(state).length + state.loops.filter((l) => (l.proposed || l.pendingBaseline || l.retireProposed) && !l.retired).length,
        violations: violations.map((v) => v.message),
        profile: profileStatus(state.meta),
        connection: { name: call.props.name, access: call.props.access },
        grid: { now: gridChange(state, state).now },
        links: await linksFor(call, "get_state", null),
      };
    },
  },
  {
    name: "list_loops",
    title: "List loops",
    description: "Lists loops with level, measured mark, flag, last outcome and score group. Filter by branch, area, level or flag.",
    inputSchema: obj({
      branch: { type: "string", enum: ["C", "P", "R"] },
      area: str("BRANCH-AREA, like P-HOM."),
      level: levels,
      flag: { type: "string", enum: ["measuring", "experimenting", "holding", "idle"] },
      includeProposed: bool("Include loops waiting for approval."),
      includeRetired: bool("Include retired loops."),
    }),
    annotations: { title: "List loops", ...READ },
    run: async (a, call) => {
      const state = await call.state();
      const d = derive(state);
      const lang = state.meta.languages[0];
      const rows = d.loops.map((l) => ({ code: l.code, name: l.name?.[lang], level: l.level, flag: l.flag || "idle", outcome: l.outcome, score: l.score, group: l.group }));
      if (a.includeProposed)
        rows.push(...state.loops.filter((l) => l.proposed && !l.retired).map((l) => ({ code: l.code, name: l.name?.[lang], level: l.level, proposed: true })));
      if (a.includeRetired) rows.push(...state.loops.filter((l) => l.retired).map((l) => ({ code: l.code, name: l.name?.[lang], retired: true })));
      return rows.filter(
        (r) =>
          (!a.branch || r.code.startsWith(a.branch + "-")) &&
          (!a.area || r.code.startsWith(a.area.toUpperCase() + "-")) &&
          (!a.level || r.level === a.level) &&
          (!a.flag || r.flag === a.flag)
      );
    },
  },
  {
    name: "get_loop",
    title: "Get a loop",
    description: "Returns every field of 1 loop, including private ones (evidence, pending text, the measured cost waiting for approval, drops) and the experiments that touched it.",
    inputSchema: obj({ code: str("Loop code, like R-PAR-01.") }, ["code"]),
    annotations: { title: "Get a loop", ...READ },
    run: async ({ code }, call) => {
      const state = await call.state();
      const loop = state.loops.find((l) => l.code === code);
      if (!loop) throw new Error(`${code}: no loop has this code.`);
      const d = derive(state).loops.find((l) => l.code === code);
      return {
        ...loop,
        ...(d ? { flag: d.flag, outcome: d.outcome, score: d.score, group: d.group, ceiling: d.ceiling, measured: d.measured } : {}),
        experiments: state.experiments.filter((e) => e.loops.includes(code)).map((e) => e.code),
      };
    },
  },
  {
    name: "list_experiments",
    title: "List experiments",
    description: "Lists experiments with pick (slot), question, status and round (stage).",
    inputSchema: obj({ open: bool("Only experiments that haven't ended.") }),
    annotations: { title: "List experiments", ...READ },
    run: async ({ open }, call) => {
      const state = await call.state();
      const lang = state.meta.languages[0];
      return derive(state)
        .experiments.filter((e) => !open || !e.conclusion)
        .map((e) => ({ code: e.code, slot: e.slot, question: (e.question || e.pending?.question)?.[lang], loops: e.loops, status: e.status, stage: e.stage, level: e.level, verdict: e.verdict }));
    },
  },
  {
    name: "get_experiment",
    title: "Get an experiment",
    description: "Returns the full experiment card with every round (stage try), proving result (hold) and how it ended (conclusion).",
    inputSchema: obj({ code: str("Experiment code, like EXP-01.") }, ["code"]),
    annotations: { title: "Get an experiment", ...READ },
    run: async ({ code }, call) => {
      const e = derive(await call.state()).experiments.find((x) => x.code === code);
      if (!e) throw new Error(`${code}: no experiment has this code.`);
      return e;
    },
  },
  {
    name: "get_triage",
    title: "Get triage",
    description: "Groups active loops into Automate now, Later and Not yet (protocol section 5.2), highest score first.",
    inputSchema: obj({}),
    annotations: { title: "Get triage", ...READ },
    run: async (_a, call) => {
      const state = await call.state();
      const lang = state.meta.languages[0];
      const groups = { automateNow: [], later: [], notYet: [], unscored: [] };
      for (const l of derive(state).loops)
        groups[l.group || "unscored"].push({ code: l.code, name: l.name?.[lang], level: l.level, score: l.score, source: l.triage?.source });
      for (const g of Object.values(groups)) g.sort((a, b) => (b.score ?? -99) - (a.score ?? -99) || (a.code < b.code ? -1 : 1));
      return groups;
    },
  },
  {
    name: "suggest_slots",
    title: "Suggest slots",
    description: "Picks the loops the protocol puts in each open pick (slot). An experiment needs an estimated or measured cost; before v1.4 only measured loops could start. Easy: highest score in Automate now. Hard: highest Time with Clear rules or Digital data of 2 or less. Fun: the 3 candidates with the best story score, for the owner to choose from.",
    inputSchema: obj({}),
    annotations: { title: "Suggest slots", ...READ },
    run: async (_a, call) => {
      const state = await call.state();
      const d = derive(state);
      const lang = state.meta.languages[0];
      const busy = new Set(d.experiments.filter((e) => !e.conclusion).flatMap((e) => e.loops));
      const taken = new Set(d.experiments.filter((e) => !e.conclusion).map((e) => e.slot));
      const early = !estimateCanStart(logVersion(state.meta));
      const costed = (l) => isMeasured(l) || (!early && l.estimate?.hoursPerWeek != null);
      const idle = d.loops.filter((l) => !l.flag && !busy.has(l.code) && costed(l) && l.triage);
      const byCode = (a, b) => (a.code < b.code ? -1 : 1);
      const row = (l) => (l ? { code: l.code, name: l.name?.[lang], level: l.level, score: l.score, time: l.triage.time } : null);
      const easy = idle.filter((l) => triageGroup(l) === "automateNow").sort((a, b) => b.score - a.score || byCode(a, b))[0];
      const hard = idle.filter(isHardEligible).sort((a, b) => b.triage.time - a.triage.time || byCode(a, b))[0];
      // A good story: it takes real time, the way to do it is fuzzy, and a mistake would show.
      const story = (l) => l.triage.time + (5 - l.triage.rules) + (l.triage.risk >= 3 ? 1 : 0);
      const fun = idle
        .filter((l) => triageGroup(l) !== "notYet")
        .sort((a, b) => story(b) - story(a) || byCode(a, b))
        .slice(0, 3)
        .map((l) => ({ ...row(l), story: story(l) }));
      return {
        easy: taken.has("easy") ? "taken" : row(easy) || "no eligible loop; the pick stays empty and that is recorded",
        hard: taken.has("hard") ? "taken" : row(hard) || "no eligible loop; the pick stays empty and that is recorded",
        fun: taken.has("fun")
          ? "taken"
          : { candidates: fun, note: "The owner picks and records the reason. story ranks the loops that make the best story: more hours, fuzzier rules, a mistake that would show." },
      };
    },
  },
  {
    name: "list_pending",
    title: "List what waits for approval",
    description: "Everything waiting for the owner: proposed loops, retirements, measured costs (baselines), and text agents wrote (names, doneWhen, scope, questions, bets, lessons) next to the live version. breaksNewRules lists what a new protocol version flags: rename those first.",
    inputSchema: obj({}),
    annotations: { title: "List what waits for approval", ...READ },
    run: async (_a, call) => {
      const state = await call.state();
      const breaks = pendingRuleBreaks(state);
      return {
        breaksNewRules: { version: breaks.version, adopted: breaks.adopted, items: breaks.items.map((v) => v.message) },
        text: pendingItems(state).map((i) => ({ target: i.target, kind: i.kind, live: Object.fromEntries(Object.keys(i.pending).map((k) => [k, i.ref[k] ?? null])), pending: i.pending })),
        proposedLoops: state.loops
          .filter((l) => l.proposed && !l.retired)
          .map((l) => ({ code: l.code, name: l.name, doneWhen: l.doneWhen, scope: l.scope, replaces: l.replaces, proposedBy: l.proposedBy })),
        retirements: state.loops.filter((l) => l.retireProposed && !l.retired).map((l) => ({ code: l.code, ...l.retireProposed })),
        baselines: state.loops.filter((l) => l.pendingBaseline).map((l) => ({ code: l.code, ...l.pendingBaseline })),
        profile: profileStatus(state.meta),
      };
    },
  },
  {
    name: "check_rules",
    title: "Check the rules",
    description: "Runs every protocol check on the current log and lists what it breaks. Writes may never add to this list.",
    inputSchema: obj({}),
    annotations: { title: "Check the rules", ...READ },
    run: async (_a, call) => validate(await call.state()).map((v) => v.message),
  },
  {
    name: "get_events",
    title: "Get the history",
    description: "The append-only history of every write: who, what and when. Pass id for one event with its before and after values.",
    inputSchema: obj({ limit: int("How many, newest first. Default 20."), target: str("Only events about this code."), id: int("One event, in full.") }),
    annotations: { title: "Get the history", ...READ },
    run: async (a, call) => getEvents(call.env.DB, a),
  },

  // Agent writes
  writeTool("propose_loops", "Propose loops", "Proposes new loops. Codes are assigned for you. Proposals stay hidden until the owner approves them. Read onhundred://docs/loops first: every loop passes the six tests.", obj({ loops: { type: "array", items: loopSpec } }, ["loops"])),
  writeTool(
    "rename_loop",
    "Rename a loop",
    "Changes a loop's name, doneWhen or scope. On an approved loop the new text waits as pending until the owner approves it.",
    obj({ code: str("Loop code."), name: loopSpec.properties.name, doneWhen: loopSpec.properties.doneWhen, scope: loopSpec.properties.scope }, ["code"])
  ),
  writeTool("update_loop", "Update a loop's estimate", "Updates the estimated cost, scores (triage), evidence, over500 or visibility (0 to 9, higher shows first on the grid). Levels never change here.", obj({ code: str("Loop code."), estimate: estimateSchema, triage: triageSchema, evidence: loopSpec.properties.evidence, over500: loopSpec.properties.over500, visibility: int("0 to 9.") }, ["code"])),
  writeTool("split_loop", "Split a loop", "Proposes 2 or more loops in the same area to replace 1. The old loop retires when the owner approves. keepBaseline copies the measured cost to them when it still applies.", obj({ code: str("Loop to split."), into: { type: "array", items: newLoopSpec }, keepBaseline: bool("The old measured cost still applies.") }, ["code", "into"])),
  writeTool("merge_loops", "Merge loops", "Proposes 1 loop to replace 2 or more in the same area. The old loops retire when the owner approves.", obj({ codes: { type: "array", items: { type: "string" } }, into: newLoopSpec }, ["codes", "into"])),
  writeTool("retire_loop", "Retire a loop", "Proposes retiring a loop, with the reason. Codes are never reused.", obj({ code: str("Loop code."), reason: str("Why it leaves the list.") }, ["code", "reason"])),
  writeTool("set_measuring", "Start or stop measuring", "Flags an unmeasured Still yours loop as Measuring (5 at most) or removes the flag. Measuring is optional: it proves time saved.", obj({ code: str("Loop code."), measuring: bool("true to start, false to stop.") }, ["code", "measuring"])),
  writeTool("record_baseline", "Record the measured cost", "Records what an unmeasured Still yours loop costs today, after watching it. It waits for the owner's approve_baseline, which marks the loop measured. The level stays. Fewer than 3 occurrences is recorded as low confidence.", obj({ code: str("Loop code."), occurrences: int("Times observed."), hoursPerWeek: { type: "number" }, moneyUsd: { type: "number" }, quality: str("A measure later stages compare against, where it applies.") }, ["code", "occurrences", "hoursPerWeek"])),
  writeTool("register_stage_try", "Write down a round", "Writes down the next round (stage try) of an experiment before it starts. Round, try and level are worked out for you. From v1.4 the first round needs a cost for every loop: measured, or estimated with update_loop. Never changed once it starts: to change the approach, end it as terminated (stopped) and write down a new try.", obj({ experiment: str("EXP-NN."), start: str("YYYY-MM-DD. Default today."), deadline: str("YYYY-MM-DD."), approach: str("What the agent will do, with which tools."), why: str("Why it should work, and what earlier stages taught."), successTests: str("The evals that decide it, with numeric thresholds."), stopEarly: str("The condition that ends it at once."), cost: str("Tools and estimated AI cost."), risks: str("What could go wrong and how it would be detected.") }, ["experiment", "deadline", "approach", "successTests"])),
  writeTool("close_stage_try", "End a round", "Ends the running round: achieved (passed), notAchieved (didn't pass) or terminated (stopped, with the reason). Passed starts 3 weeks of proving.", obj({ experiment: str("EXP-NN."), outcome: { type: "string", enum: P.outcomes }, closedAt: str("YYYY-MM-DD. Default today."), reason: str("Required when terminated."), actualCost: str("What it really cost."), notes: str("Private notes. Never published.") }, ["experiment", "outcome"])),
  writeTool("record_hold", "Record the proving", "Records whether a passed round kept passing for 3 weeks of proving. Passed moves the loops up 1 level. This and record_drop are the only ways a level changes.", obj({ experiment: str("EXP-NN."), result: { type: "string", enum: P.holds }, at: str("YYYY-MM-DD. Default today.") }, ["experiment", "result"])),
  writeTool("record_drop", "Record a drop", "Moves a loop down: 1 level after 5 failing days, straight to still (Still yours) after harm or lost consent.", obj({ code: str("Loop code."), cause: { type: "string", enum: Object.keys(P.drops) }, at: str("YYYY-MM-DD. Default today."), note: str("What happened. Private.") }, ["code", "cause"])),
  writeTool("add_learned", "Add a lesson", "Adds the public, anonymized lesson of an ended round. It waits for the owner's approval. Only real lessons: never invent one.", obj({ experiment: str("EXP-NN."), stage: int("Round number. Default: the last ended round."), try: int("Default 1."), learned: textObj("What was learned, in 1 to 3 sentences.") }, ["experiment", "learned"])),

  // Owner
  writeTool("approve_loops", "Approve loops", "Owner only. Approves proposed loops into the list and applies retirements. Confirm with the person first.", obj({ codes: { type: "array", items: { type: "string" } }, retire: { type: "array", items: { type: "string" } } }), { owner: true, annotations: DESTRUCTIVE }),
  writeTool("approve_text", "Publish pending text", "Owner only. Publishes text agents wrote (targets from list_pending, or all). Show the person the exact text and confirm before calling.", obj({ targets: { type: "array", items: { type: "string" } }, all: bool("Approve everything pending.") }), { owner: true, annotations: DESTRUCTIVE }),
  writeTool("reject_text", "Discard pending text", "Owner only. Discards pending text. The live version stays.", obj({ targets: { type: "array", items: { type: "string" } } }, ["targets"]), { owner: true }),
  writeTool("approve_baseline", "Approve the measured cost", "Owner only. Approves a recorded measured cost (baseline). The loop is marked measured; its level stays.", obj({ code: str("Loop code.") }, ["code"]), { owner: true }),
  writeTool("set_published", "Publish a partner loop", "Owner only. R-PAR loops stay private until the partner approves publishing them.", obj({ code: str("R-PAR loop code."), published: bool("true once the partner agreed.") }, ["code", "published"]), { owner: true, annotations: DESTRUCTIVE }),
  writeTool("freeze_inventory", "Freeze the list", "Owner only. Needs exactly 100 approved loops. From then on the 100 rule always applies. Confirm with the person first.", obj({}), { owner: true, annotations: DESTRUCTIVE }),
  writeTool("register_experiment", "Write down an experiment", `Owner only. Writes down the card before the first round: pick (slot), question, bet (If, then, because), odds, loops and goal. Ask the person for the odds: the honest chance, from ${ODDS.min} to ${ODDS.max}, that the bet holds. They're public, so friends can guess how it ends. The question and bet wait for approve_text.`, obj({ slot: { type: "string", enum: P.limits.experimentSlots }, funReason: str("Required for the fun pick."), question: textObj("1 sentence anyone understands."), hypothesis: textObj("The bet: If ..., then ..., because ...."), odds: { type: "integer", minimum: ODDS.min, maximum: ODDS.max, description: `The person's honest chance the bet holds, ${ODDS.min} to ${ODDS.max}.` }, loops: { type: "array", items: { type: "string" } }, goal: levels, peopleInvolved: str("Who, and proof of consent. Never published.") }, ["slot", "question", "hypothesis", "odds", "loops", "goal"]), { owner: true }),
  writeTool("conclude_experiment", "End an experiment", "Owner only. Records the bet as confirmed (right), refuted (wrong) or unclear (not clear), and the final level. A wrong bet is a result, not a failure.", obj({ experiment: str("EXP-NN."), hypothesis: { type: "string", enum: P.conclusions }, level: levels }, ["experiment", "hypothesis"]), { owner: true }),
  writeTool("set_meta", "Change settings", `Owner only. ownerName, about, links, languages, stillMetric, publish, companyFigures, cycleOneStart (the check-in number and day follow from it), cycle, day, grid, challenge (${CHALLENGE_LEVELS.join(", ")}: how hard you push the person), questions ({ ${QUESTION_KINDS.join(", ")} }, each true or false: when the person says to stop a kind of question, turn off that kind only), cards (true or false: share cards after big moments), pausedUntil (YYYY-MM-DD or null). about is why the person runs the protocol, ${ABOUT_MAX_WORDS} words or fewer, in every language of the log, following onhundred://docs/voice: show the person the exact text before you call. links is up to ${MAX_LINKS} profile links, [{ kind, url }], kind one of ${Object.keys(PROFILE_LINKS).join(", ")}, url a full https link. links: [] means the person has none, so nobody asks again. Both show on the public page; null removes them.`, { type: "object", additionalProperties: true }, { owner: true }),
  writeTool("adopt_protocol", "Adopt the new protocol version", "Owner only. Moves the log to the protocol version in this code (get_state shows both). Before check-ins start it applies now; otherwise after the next check-in. Returns what breaks the new rules: rename those after. Confirm with the person first.", obj({}), { owner: true, annotations: DESTRUCTIVE }),
  {
    name: "undo_event",
    title: "Undo an event",
    description: "Owner only. Restores the values from before an event, as a new event. Nothing is erased from the history. A share card made by that event is taken down.",
    inputSchema: obj({ id: int("Event id from get_events.") }, ["id"]),
    annotations: { title: "Undo an event", ...DESTRUCTIVE },
    owner: true,
    run: (args, call) => writeWithLinks(call, "undo_event", args),
  },
  {
    name: "override",
    title: "Override the checks",
    description: "Owner only, for emergencies. Runs 1 write past the protocol checks and records it as an override. Confirm with the person first.",
    inputSchema: obj({ op: str("The write tool to run."), args: { type: "object", additionalProperties: true }, reason: str("Why the checks are skipped.") }, ["op", "args", "reason"]),
    annotations: { title: "Override the checks", ...DESTRUCTIVE },
    owner: true,
    run: ({ op, args, reason }, call) => {
      if (!reason) throw new Error("reason is required.");
      return writeWithLinks(call, op, args, { override: true, reason });
    },
  },
  {
    name: "manage_connections",
    title: "Manage connections",
    description:
      "Owner only. list: API keys and signed-in apps, with access and status. create: an API key for an API agent (xAI Grok, OpenAI, Anthropic, a bot), shown once; access is agent unless you pass owner. revoke: stops a key or app at once.",
    inputSchema: obj(
      {
        action: { type: "string", enum: ["list", "create", "revoke"] },
        name: str("create: who uses it, like grok-bot."),
        access: { type: "string", enum: ["owner", "agent"], description: "create: owner or agent (limited). Default agent." },
        id: str("revoke: the id from list."),
      },
      ["action"]
    ),
    annotations: { title: "Manage connections", ...DESTRUCTIVE },
    owner: true,
    run: async ({ action, name, access = "agent", id }, call) => {
      const at = new Date().toISOString();
      if (action === "list") return { connections: await listAgents(call.env.DB) };
      if (action === "create") {
        if (!name) throw new Error("name is required: who uses the key, like grok-bot.");
        const k = await createApiKey(call.env.DB, { name, access });
        await logEvent(call.env.DB, { at, actor: call.props.name, tool: "create_api_key", target: k.id });
        return { ...k, note: "Store this key now. It is shown once." };
      }
      if (action === "revoke") {
        if (!id || !(await revokeAgent(call.env.DB, id))) throw new Error(`${id}: no active connection has this id.`);
        await logEvent(call.env.DB, { at, actor: call.props.name, tool: "revoke_api_key", target: id });
        return { revoked: id };
      }
      throw new Error("action is list, create or revoke.");
    },
  },

  // Nudges, check-ins and share cards
  {
    name: "respond_nudge",
    title: "Record the answer to a nudge",
    description: `Owner only. Records how the person answered the nudge from get_state: took (they're doing it), not_now, pause (no challenges or questions for ${PAUSE_WEEKS.join(" or ")} weeks; pass weeks) or stop (turns off challenges, or that kind of question). Call it once per nudge, right after the person answers.`,
    inputSchema: obj(
      {
        id: str("The nudge's id from get_state."),
        answer: { type: "string", enum: NUDGE_ANSWERS },
        weeks: { type: "integer", enum: PAUSE_WEEKS, description: "pause only: 2 or 4." },
      },
      ["id", "answer"]
    ),
    annotations: { title: "Record the answer to a nudge", ...WRITE },
    owner: true,
    run: async ({ id, answer, weeks }, call) => {
      if (!NUDGE_ANSWERS.includes(answer)) throw new Error(`answer is ${NUDGE_ANSWERS.join(", ")}.`);
      if (answer === "pause" && !PAUSE_WEEKS.includes(Number(weeks))) throw new Error(`weeks is ${PAUSE_WEEKS.join(" or ")}: ask the person how long to pause.`);
      const shown = await lastShown(call.env.DB, id);
      if (!shown) throw new Error(`${id}: no nudge with this id was shown. Use the id of the nudge from get_state.`);
      const now = new Date();
      await recordNudge(call.env.DB, { nudge_id: id, kind: shown.kind, about: shown.about, event: "answered", answer, at: now.toISOString(), actor: call.props.name });
      const question = QUESTION_KINDS.includes(shown.kind);
      if (answer === "pause") {
        const until = new Date(now.getTime() + Number(weeks) * 7 * 86400000).toISOString().slice(0, 10);
        await call.write("set_meta", { pausedUntil: until });
        return { answered: answer, pausedUntil: until, say: `No challenges or questions until ${until}. Results still get their cards.` };
      }
      if (answer === "stop") {
        await call.write("set_meta", question ? { questions: { [shown.kind]: false } } : { challenge: "off" });
        return question
          ? { answered: answer, questions: { [shown.kind]: false }, say: `Tell the person in 1 line that this kind of question is off, and that 1 sentence turns it back on.` }
          : { answered: answer, challenge: "off", say: "Tell the person in 1 line that challenges are off, and that 1 sentence turns them back on." };
      }
      return { answered: answer };
    },
  },
  {
    name: "get_check_in",
    title: "Get the check-in summary",
    description:
      "What changed in the last 2 weeks: rounds ended, provings, levels moved, hours, and what's left. Inside the check-in window (day 13 of a period to day 3 of the next) on an owner connection, the first call marks the check-in and returns its moment and card.",
    inputSchema: obj({}),
    annotations: { title: "Get the check-in summary", ...WRITE },
    run: async (_a, call) => {
      const state = await call.state();
      const today = new Date().toISOString().slice(0, 10);
      const summary = checkInSummary(state, today);
      const due = checkInDue(state.meta, today);
      if (!call.owner || due == null) return { ...summary, checkIn: { due: false, window: checkInWindow(state.meta), paused: isPaused(state.meta, today) } };
      const r = await writeWithLinks(call, "mark_check_in", {});
      return { ...summary, checkIn: { due: true, marked: due }, ...(r.moment ? { moment: r.moment } : {}), links: r.links };
    },
  },
  {
    name: "manage_card",
    title: "Manage share cards",
    description:
      "Share cards are made by the log after big moments; nobody writes on them. list: recent cards with links, views and postImages. remake (owner): rebuilds a card from today's approved text with 1 of its prewritten headlines; without headline it returns the choices; same link, 3 a day at most. take_down (owner): removes the card and its images. post_images (owner): makes square and story images to post.",
    inputSchema: obj(
      {
        action: { type: "string", enum: ["list", "remake", "take_down", "post_images"] },
        id: str("The card's id, from a write's moment.card, cardsReady or list."),
        headline: int("remake: the number of the headline to use, from the choices."),
        limit: int("list: how many, newest first. Default 10."),
      },
      ["action"]
    ),
    annotations: { title: "Manage share cards", ...DESTRUCTIVE },
    run: async ({ action, id, headline, limit = 10 }, call) => {
      const state = await call.state();
      const opts = cardOpts(call, state);
      const lang = state.meta.languages[0];
      const show = (c) => ({ ...cardSummary(c, opts), headline: cardHeadline(c.facts, c.headline, lang) });
      if (action === "list") return { cards: (await listCards(call.env.DB, { limit })).map(show) };
      if (!["remake", "take_down", "post_images"].includes(action)) throw new Error("action is list, remake, take_down or post_images.");
      if (!call.owner) throw new Error("only the owner can do this. Connect with owner access or ask the owner.");
      const card = await getCard(call.env.DB, id);
      if (!card) throw new Error(`${id}: no card has this id.`);
      const now = new Date().toISOString();
      if (action === "take_down") {
        await takeDown(call.env, card, now);
        return { takenDown: card.id, note: TAKEN_DOWN_NOTE };
      }
      if (card.revoked_at) throw new Error(`${card.id} was taken down.`);
      if (action === "post_images") {
        if (card.waiting) throw new Error(`${card.id} waits for ${card.waiting.join(" and ")} to be approved.`);
        const next = await requestPostImages(call.env, card, opts.languages, now);
        const queued = await writer(call.env).queueShots(opts.origin);
        return { card: show(next), ...(queued ? {} : { note: "Card images are off on this log, so shared links use the default preview." }) };
      }
      const choices = (P.cards.headlines[card.moment] || []).map((_, i) => ({ headline: i, text: Object.fromEntries(opts.languages.map((l) => [l, cardHeadline(card.facts, i, l)])) }));
      if (headline == null) return { card: show(card), choices, note: "Show the person the choices and call again with the number they pick." };
      if (!Number.isInteger(headline) || !choices[headline]) throw new Error(`headline is ${choices.map((c) => c.headline).join(", ")}: one of the prewritten headlines for this card.`);
      const next = await remakeCard(call.env, card, state, headline, now);
      await writer(call.env).queueShots(opts.origin);
      return { card: show(next), note: "Same link. New images are on the way; previews already sent stay as they were." };
    },
  },
  {
    name: "get_video_brief",
    title: "Get a video brief",
    description:
      "For a person who wants to film a moment: what happened, the numbers (each labeled measured or estimated), where they are in the story, what's off limits, the card links and a style note. Pass a card id or an experiment code. It never returns a script.",
    inputSchema: obj({ card: str("A card id."), experiment: str("An experiment code, like EXP-03.") }),
    annotations: { title: "Get a video brief", ...READ },
    run: async ({ card: cardIdArg, experiment }, call) => {
      const state = await call.state();
      const opts = cardOpts(call, state);
      let facts;
      let card = null;
      if (cardIdArg) {
        card = await getCard(call.env.DB, cardIdArg);
        if (!card || card.revoked_at) throw new Error(`${cardIdArg}: no card with this id is up.`);
        if (card.waiting) throw new Error(`${card.id} waits for ${card.waiting.join(" and ")} to be approved.`);
        facts = card.facts;
      } else if (experiment) {
        const r = briefFacts(state, experiment);
        if (r.none) throw new Error(`${experiment}: no brief, because the ${r.none}.`);
        if (r.waiting) throw new Error(`${experiment} waits for ${r.waiting.join(" and ")} to be approved.`);
        facts = r.facts;
      } else throw new Error("pass card or experiment.");
      return videoBrief(state, facts, card, opts);
    },
  },
];

// The last 2 weeks, from the log alone.
function checkInSummary(state, today) {
  const since = new Date(Date.parse(`${today}T00:00:00Z`) - PERIOD_DAYS * 86400000).toISOString().slice(0, 10);
  const lang = state.meta.languages[0];
  const d = derive(state);
  const roundsEnded = [];
  const provings = [];
  const moved = [];
  for (const e of state.experiments)
    for (const t of sortTries(e.stages)) {
      if (t.closedAt >= since) roundsEnded.push({ experiment: e.code, round: t.stage, try: t.try, outcome: t.outcome });
      if (t.hold?.at >= since) {
        provings.push({ experiment: e.code, round: t.stage, result: t.hold.result });
        if (t.hold.result === "passed") for (const c of e.loops) moved.push({ code: c, to: t.level, by: e.code });
      }
    }
  for (const l of state.loops) for (const drop of l.drops || []) if (drop.at >= since) moved.push({ code: l.code, from: drop.from, to: drop.to, cause: drop.cause });
  const handed = d.loops.filter((l) => l.level !== "still");
  const hours = (pick) => Math.round(handed.filter(pick).reduce((s, l) => s + (isMeasured(l) ? l.baseline.hoursPerWeek : l.estimate?.hoursPerWeek || 0), 0) * 10) / 10;
  const open = d.experiments.filter((e) => !e.conclusion);
  return {
    period: { cycle: state.meta.cycle, day: state.meta.day, since },
    roundsEnded,
    provings,
    levelsMoved: moved.map((m) => ({ ...m, toName: levelName(m.to, lang) })),
    hoursPerWeekHandedOff: { measured: hours(isMeasured), estimated: hours((l) => !isMeasured(l)) },
    left: {
      openExperiments: open.map((e) => ({ code: e.code, slot: e.slot, status: e.status, round: e.stage })),
      pastDeadline: open.filter((e) => {
        const t = sortTries(e.stages).at(-1);
        return t && t.outcome == null && t.deadline < today;
      }).map((e) => e.code),
      emptyPicks: P.limits.experimentSlots.filter((s) => !open.some((e) => e.slot === s)),
      waitingForApproval: pendingItems(state).length,
    },
    say: "Sum it up in 3 short lines: what changed, what failed, what's left.",
  };
}

function briefFacts(state, code) {
  const e = state.experiments.find((x) => x.code === code);
  if (!e) return { none: "experiment doesn't exist" };
  const moment = e.conclusion?.hypothesis === "refuted" ? "wrongBet" : "roundMissed";
  const r = cardFacts(state, moment, code);
  return r.facts ? { facts: { ...r.facts, moment: null, kind: null } } : r;
}

function videoBrief(state, facts, card, opts) {
  const view = publicView(state);
  const wrongBets = view.experiments.filter((e) => e.conclusion?.hypothesis === "refuted").map((e) => e.code);
  const lang = state.meta.languages[0];
  const loops = facts.loop ? [facts.loop] : facts.experiment?.loops || [];
  return {
    happened: {
      moment: facts.moment,
      ...(card ? { headline: cardHeadline(facts, card.headline, lang) } : {}),
      ...(facts.experiment ? { experiment: { code: facts.experiment.code, question: pickText(facts.experiment.question, lang), bet: pickText(facts.experiment.hypothesis, lang), odds: facts.experiment.odds ?? null, round: facts.experiment.round, verdict: facts.experiment.verdict ?? null } } : {}),
    },
    numbers: [
      { what: "loops handed off (Do it, I approve or higher)", value: facts.handedOff, source: "log" },
      { what: "delegation points", value: facts.points, of: facts.total, source: "log" },
      ...loops.filter((l) => l.hours).map((l) => ({ what: `${l.code} hours a week`, value: l.hours.perWeek, source: l.hours.source })),
    ],
    story: { handedOff: `loop ${facts.handedOff} of 10`, checkIn: facts.cycle, wrongBets },
    offLimits: [
      "other people's names and faces, unless they said yes",
      "children's lives",
      "anyone's health",
      "a partner who hasn't agreed to publish",
      "anything not in these facts",
    ],
    ...(card
      ? {
          card: cardSummary(card, opts),
          links: cardUrls(opts.origin, card, opts),
          postImages: `Call manage_card with action post_images and id ${card.id} for square and story images.`,
        }
      : {}),
    style: "Deadpan field log: the method is calm and exact, the person is candid. Say what happened, plainly, with the real numbers and their labels. No hype, no guilt. Give the person 2 or 3 ideas; they say it in their own words.",
  };
}

// ---------------------------------------------------------------------------
// Resources and prompts

const RESOURCES = [
  { uri: "onhundred://docs/protocol", name: "protocol", title: `Onhundred Protocol v${P.version}`, description: "The newest rules. get_state says which version this log runs.", mimeType: "text/markdown", text: () => docs.protocol },
  { uri: "onhundred://docs/loops", name: "loops", title: "Loops: how to write them and which to pick", description: "Read before proposing or renaming a loop.", mimeType: "text/markdown", text: () => docs.loops },
  { uri: "onhundred://docs/voice", name: "voice", title: "Voice: how Onhundred writes", description: "Read before writing any public text.", mimeType: "text/markdown", text: () => docs.voice },
  { uri: "onhundred://docs/playbook", name: "playbook", title: "Playbook: when and how to challenge, ask and congratulate", description: "Read before you challenge, ask a question, congratulate or share a card.", mimeType: "text/markdown", text: () => docs.playbook },
  { uri: "onhundred://protocol.json", name: "protocol.json", title: "Protocol parameters", description: "Areas, level limits (ceilings), score thresholds (triage) and limits, as the code enforces them.", mimeType: "application/json", text: () => JSON.stringify(P, null, 2) },
];

const PROMPTS = [
  {
    name: "build_inventory",
    title: "Help me build my 100 loops",
    description: "Find, name and propose the loops of your life and work.",
    text: "Help me build my 100 loops. Read onhundred://docs/loops, onhundred://docs/voice and onhundred://docs/playbook first, then call get_state. Ask me what you can read (calendar, email, documents) and work through one branch at a time: Relationships, Personal, Company. When a part of my life has no loops, ask me 1 gap question from the playbook. For every loop check the six tests, decide whether it needs a scope, write down where it showed up (evidence), then propose it with propose_loops, in every language of the log. Show me each batch before you send it. Approving is my call.",
  },
  {
    name: "fill_slots",
    title: "Which loops should I pick for my 3 experiments?",
    description: "Pick the easy, hard and fun loops and draft their experiments.",
    text: `Call suggest_slots and get_triage. For each open pick, explain the choice in 1 sentence. For the fun pick, start with the loops with the best story score. Draft a question and a bet (If, then, because) for each, following onhundred://docs/voice. Ask me the odds for each bet: the honest chance, from ${ODDS.min} to ${ODDS.max}, that it holds. Wait for my answer before register_experiment.`,
  },
  {
    name: "cycle_review",
    title: "Run my check-in",
    description: "Sum up the last 2 weeks, end rounds past their deadline, record proving and share the check-in card.",
    text: "Run my check-in. Call get_check_in first and list_experiments with open set to true. For each running round past its deadline, ask me whether it passed and end it. For each round proving for 3 weeks, ask me whether it kept passing and record it. Then list what changed in the last 2 weeks, what failed and what's left, in 3 short lines. End with the check-in card link if there is one, following onhundred://docs/playbook.",
  },
  {
    name: "plan_video",
    title: "Help me film this moment",
    description: "Turn a share card or an experiment into 2 or 3 video ideas and a caption.",
    text: "Help me plan a short video about my latest moment. Call manage_card with action list, pick the newest card that's ready (or ask me which experiment), then call get_video_brief. Ask me 2 or 3 questions first: where I'll film, how much I want to show, and who else is in the picture. Then give me 2 or 3 ideas with rough steps, and 1 caption. Use only the brief's facts, keep its off-limits list, and never write me a script.",
  },
];

function instructions(meta) {
  const langs = (meta.languages || ["en"]).join(", ");
  return [
    `Onhundred Protocol log${meta.ownerName ? ` for ${meta.ownerName}` : ""}. Mode: ${meta.mode}. It runs protocol v${meta.protocolVersion}.`,
    "Read onhundred://docs/loops before you propose or rename a loop, and onhundred://docs/voice before you write any public text.",
    `Write names, doneWhen, scope, questions, bets and lessons in every language of the log: ${langs}.`,
    "Text you write waits as pending until the owner approves it with approve_text. Show the person the exact text before that call.",
    "Levels never change by hand: only record_hold and record_drop move them.",
    "Talk to people in plain words. Level keys: still is Still yours, assisted is Help me, delegated is Do it, I approve, autonomous is Do it alone. A loop is measured once its baseline (measured cost) is approved. A stage is a round, a hold is proving, a slot is a pick, the ceiling is the limit, and each cycle ends at a check-in.",
    "Every write is checked against the protocol. A rejected write returns the rule it broke: fix it and try again.",
    "After writes succeed, end your reply with 1 link, once per reply, not once per call. If links.approve is present, it wins. Otherwise, when the write returned a moment, reply in its kind (congratulate, honest or challenge) using its facts, and end with links.card in the language you're speaking (moment.card.urls). The first time you share a card whose postImages is available, add 1 line: \"Want a square or story version to post?\" Otherwise, end with links.open. If grid.delta is present, say what moved in 1 sentence, using grid.now for the totals. Links with a pass expire after 24 hours, so share a fresh one instead of reusing an old one.",
    ...nudgeLines(meta),
    ...profileAsk(meta),
  ].filter(Boolean).join(" ");
}

// Left out when the person turned every challenge and question off, or paused them.
function nudgeLines(meta) {
  const today = new Date().toISOString().slice(0, 10);
  const anyQuestion = QUESTION_KINDS.some((k) => meta.questions?.[k] !== false);
  if (isPaused(meta, today) || ((meta.challenge ?? "normal") === "off" && !anyQuestion)) return [];
  return [
    "Read onhundred://docs/playbook before you challenge, ask a question or congratulate.",
    "Challenge or ask only with the nudge from get_state. Quote its facts, offer one of its outs, and record the answer with respond_nudge.",
    "When get_state has a questionNotice, say it in one line.",
    "If the person says they're busy or overwhelmed, offer a pause of 2 or 4 weeks.",
  ];
}

// Until the owner adds links or says they have none, every new conversation asks once. links: [] means none.
function profileAsk(meta) {
  const missing = profileMissing(meta);
  const out = [];
  if (missing.includes("links"))
    out.push(
      `The owner hasn't added their social accounts, so visitors can't follow them from the public page. Early in this conversation, ask once which accounts to show (${Object.values(PROFILE_LINKS).map((k) => k.name).join(", ")}) and save them with set_meta links. If they have none, save links as []. If they say not now, don't ask again in this conversation.`
    );
  if (missing.includes("about") && missing.includes("links"))
    out.push("In the same question, offer to write their 1 line on why they run the protocol (set_meta about).");
  return out;
}

// ---------------------------------------------------------------------------
// JSON-RPC

const rpcResult = (id, result) => ({ jsonrpc: "2.0", id, result });
const rpcError = (id, code, message) => ({ jsonrpc: "2.0", id, error: { code, message } });

export async function handleMcp(request, env, props) {
  if (request.method !== "POST")
    return new Response(JSON.stringify(rpcError(null, -32000, "Use POST. This server answers with JSON and keeps no sessions.")), {
      status: 405,
      headers: { Allow: "POST", "Content-Type": "application/json" },
    });
  let body;
  try {
    body = await request.json();
  } catch {
    return Response.json(rpcError(null, -32700, "Parse error"), { status: 400 });
  }
  const batch = Array.isArray(body);
  const messages = batch ? body : [body];
  const call = makeCall(env, props);
  const out = [];
  for (const msg of messages) {
    if (!msg || typeof msg !== "object" || msg.jsonrpc !== "2.0") {
      out.push(rpcError(msg?.id ?? null, -32600, "Invalid request"));
      continue;
    }
    if (!msg.method || msg.id === undefined) continue; // notifications and client responses
    out.push(await dispatch(msg, call));
  }
  if (!out.length) return new Response(null, { status: 202 });
  return Response.json(batch ? out : out[0]);
}

function makeCall(env, props) {
  let cached;
  return {
    env,
    props,
    owner: props.access === "owner",
    state: async () => (cached ??= await readState(env)),
    write: async (op, args, { override = false, reason } = {}) => {
      const r = await writer(env).write({ op, args, actor: props.name, access: props.access, override, reason, origin: props.origin });
      cached = undefined;
      if (!r.ok) {
        const e = new Error(r.error);
        e.violations = r.violations;
        throw e;
      }
      return r;
    },
  };
}

const visibleTools = (call) => TOOLS.filter((t) => !t.owner || call.owner);

async function dispatch(msg, call) {
  const { id, method, params = {} } = msg;
  try {
    switch (method) {
      case "initialize": {
        const asked = params.protocolVersion;
        const meta = (await call.state()).meta;
        return rpcResult(id, {
          protocolVersion: PROTOCOL_VERSIONS.includes(asked) ? asked : PROTOCOL_VERSIONS[0],
          capabilities: { tools: { listChanged: false }, resources: { listChanged: false }, prompts: { listChanged: false } },
          serverInfo: { name: "onhundred-protocol", title: "Onhundred Protocol log", version: SERVER_VERSION },
          instructions: instructions(meta),
        });
      }
      case "ping":
        return rpcResult(id, {});
      case "logging/setLevel":
        return rpcResult(id, {});
      case "tools/list":
        return rpcResult(id, {
          tools: visibleTools(call).map(({ name, title, description, inputSchema, annotations }) => ({ name, title, description, inputSchema, annotations })),
        });
      case "tools/call": {
        const tool = TOOLS.find((t) => t.name === params.name);
        if (!tool) return rpcError(id, -32602, `Unknown tool: ${params.name}`);
        if (tool.owner && !call.owner) return toolError(id, "Only the owner can do this. Connect with owner access or ask the owner.");
        try {
          const result = await tool.run(params.arguments || {}, call);
          const structured = result && typeof result === "object" && !Array.isArray(result) ? result : { items: result };
          return rpcResult(id, { content: [{ type: "text", text: JSON.stringify(result, null, 2) }], structuredContent: structured });
        } catch (err) {
          return toolError(id, err.message);
        }
      }
      case "resources/list":
        return rpcResult(id, { resources: RESOURCES.map(({ text, ...r }) => r) });
      case "resources/templates/list":
        return rpcResult(id, { resourceTemplates: [] });
      case "resources/read": {
        const r = RESOURCES.find((x) => x.uri === params.uri);
        if (!r) return rpcError(id, -32002, `Resource not found: ${params.uri}`);
        return rpcResult(id, { contents: [{ uri: r.uri, mimeType: r.mimeType, text: r.text() }] });
      }
      case "prompts/list":
        return rpcResult(id, { prompts: PROMPTS.map(({ name, title, description }) => ({ name, title, description, arguments: [] })) });
      case "prompts/get": {
        const p = PROMPTS.find((x) => x.name === params.name);
        if (!p) return rpcError(id, -32602, `Unknown prompt: ${params.name}`);
        return rpcResult(id, { description: p.description, messages: [{ role: "user", content: { type: "text", text: p.text } }] });
      }
      default:
        return rpcError(id, -32601, `Method not found: ${method}`);
    }
  } catch (err) {
    return rpcError(id, -32603, err.message);
  }
}

const toolError = (id, message) => rpcResult(id, { content: [{ type: "text", text: message }], isError: true });

export const toolNames = () => TOOLS.map((t) => t.name);
export { PROMPTS };
