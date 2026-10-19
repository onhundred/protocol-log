// Every write the log accepts, as pure functions over a cloned state.
// The WRITER Durable Object runs them one at a time, validates the result and saves the diff.
import {
  CHALLENGE_LEVELS,
  LEVELS,
  ODDS,
  QUESTION_KINDS,
  areaExists,
  checkInDue,
  compareVersions,
  estimateCanStart,
  isActive,
  isMeasured,
  isOpen,
  levelName,
  logVersion,
  nameIssues,
  newRuleBreaks,
  normalizeLink,
  parseCode,
  protocol as P,
  scopeIssues,
  versionChange,
  voiceIssues,
} from "../lib/protocol.mjs";

export class ToolError extends Error {}
const fail = (message) => {
  throw new ToolError(message);
};
const lv = (level) => LEVELS.indexOf(level);
const day = (ctx) => ctx.now.slice(0, 10);
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

const findLoop = (state, code) => state.loops.find((l) => l.code === code) || fail(`${code}: no loop has this code.`);
const findExp = (state, code) =>
  state.experiments.find((e) => e.code === code) || fail(`${code}: no experiment has this code.`);
const sortTries = (exp) => exp.stages.sort((a, b) => a.stage - b.stage || a.try - b.try);
const lastTry = (exp) => sortTries(exp).at(-1) || null;

function text(value, field, { required = true } = {}) {
  if (value == null) {
    if (required) fail(`${field} is required, with one entry per language, like {"en": "..."}.`);
    return undefined;
  }
  if (typeof value === "string") return { en: value };
  if (typeof value !== "object" || Array.isArray(value)) fail(`${field} is an object with one entry per language.`);
  const out = {};
  for (const [lang, s] of Object.entries(value)) {
    if (!/^[a-z]{2}$/.test(lang)) fail(`${field}: "${lang}" is not a 2-letter language code.`);
    if (typeof s !== "string" || !s.trim()) fail(`${field} (${lang}) is empty.`);
    out[lang] = s.trim();
  }
  return out;
}

function date(value, field, fallback) {
  const d = value ?? fallback;
  if (!DATE_RE.test(d || "")) fail(`${field} is a date written YYYY-MM-DD.`);
  return d;
}

function triage(value, measured) {
  if (value == null) return undefined;
  const out = {};
  for (const k of P.triage.criteria) {
    const v = value[k];
    if (!Number.isInteger(v) || v < P.triage.min || v > P.triage.max)
      fail(`triage.${k} is a whole number from ${P.triage.min} to ${P.triage.max}.`);
    out[k] = v;
  }
  out.source = measured ? "baseline" : "estimate";
  return out;
}

// What a loop costs today, copied onto the experiment card before round 1 so nobody adjusts it after the results.
function costToday(loop) {
  if (loop.baseline) {
    const { hoursPerWeek, moneyUsd, occurrences, confidence } = loop.baseline;
    return { source: "measured", hoursPerWeek, ...(moneyUsd != null ? { moneyUsd } : {}), occurrences, confidence };
  }
  if (loop.estimate?.hoursPerWeek != null) return { source: "estimated", ...loop.estimate };
  return null;
}

function estimate(value) {
  if (value == null) return undefined;
  const out = {};
  if (value.howOften != null) out.howOften = String(value.howOften);
  if (value.hoursPerWeek != null) {
    const h = Number(value.hoursPerWeek);
    if (!Number.isFinite(h) || h < 0) fail("estimate.hoursPerWeek is a number of hours, 0 or more.");
    out.hoursPerWeek = h;
  }
  return out;
}

function nextLoopCode(state, areaCode) {
  const max = state.loops
    .map((l) => parseCode(l.code))
    .filter((p) => p && p.areaCode === areaCode)
    .reduce((m, p) => Math.max(m, p.n), 0);
  return `${areaCode}-${String(max + 1).padStart(2, "0")}`;
}

function nextExpCode(state) {
  const max = state.experiments.reduce((m, e) => Math.max(m, Number(e.code.slice(4)) || 0), 0);
  return `EXP-${String(max + 1).padStart(2, "0")}`;
}

const touch = (loop, ctx) => {
  if (ctx.cycle != null) loop.changedCycle = ctx.cycle;
};

// Text an AI connection writes waits for the owner. The owner's own page writes it live.
function setText(target, fields, ctx) {
  for (const [k, v] of Object.entries(fields)) {
    if (v === undefined) continue;
    if (!ctx.directText) refuseTone(k, v);
    if (ctx.directText || target.proposed) target[k] = v;
    else target.pending = { ...(target.pending || {}), [k]: v };
  }
}

// An agent's text is checked the moment it's written, so the agent hears which rule it broke and rewrites it.
function refuseTone(field, value) {
  if (!value || typeof value !== "object") return;
  const issues = Object.entries(value).flatMap(([lang, s]) => voiceIssues(s, lang).map((i) => `${field} (${lang}) ${i}`));
  if (issues.length) fail(`${issues.join(" ")} Rewrite it following onhundred://docs/voice.`);
}

function newLoop(state, spec, ctx, extra = {}) {
  const areaCode = String(spec.area || "").toUpperCase();
  if (!/^[CPR]-[A-Z]{3}$/.test(areaCode)) fail(`area is written PART-AREA, like R-PAR or C-SAL.`);
  if (!areaExists(areaCode, state.meta)) fail(`${areaCode} is not an area in protocol section 2.4.`);
  const code = nextLoopCode(state, areaCode);
  const scope = text(spec.scope, "scope", { required: false });
  const name = text(spec.name, "name");
  const doneWhen = text(spec.doneWhen, "doneWhen");
  if (!ctx.directText) {
    if (!String(spec.evidence || "").trim())
      fail("evidence is required: say where this loop showed up, like a calendar block, an email thread or what the person told you. It stays private.");
    refuseTone("name", name);
    refuseTone("doneWhen", doneWhen);
    refuseTone("scope", scope);
  }
  const loop = {
    code,
    level: "still",
    proposed: true,
    name,
    doneWhen,
    ...(scope ? { scope } : {}),
    ...(spec.estimate ? { estimate: estimate(spec.estimate) } : {}),
    ...(spec.triage ? { triage: triage(spec.triage, false) } : {}),
    ...(spec.evidence ? { evidence: String(spec.evidence) } : {}),
    ...(spec.over500 ? { over500: true } : {}),
    ...(P.consentRequired.includes(areaCode) ? { published: false } : {}),
    proposedBy: ctx.actor,
    proposedAt: ctx.now,
    ...extra,
  };
  state.loops.push(loop);
  return loop;
}

const owner = (ctx) => {
  if (ctx.access !== "owner") fail("only the owner can do this. Connect with owner access or ask the owner.");
};

// Inside the check-in window, the first summary, round end or proving on an owner connection marks the check-in.
// Limited connections and a paused log never mark one.
function markCheckIn(state, ctx, by) {
  if (ctx.access !== "owner") return null;
  const n = checkInDue(state.meta, ctx.now);
  if (n == null) return null;
  state.meta.checkIns = [...(state.meta.checkIns || []), { cycle: n, at: ctx.now, by }];
  return n;
}

// Approving swaps a broken pending text for a broken live one, which the violation count can't see.
function refuseBrokenText(state, target, fields) {
  const version = logVersion(state.meta);
  const issues = [];
  for (const [field, value] of Object.entries(fields)) {
    if (!value || typeof value !== "object") continue;
    for (const [lang, s] of Object.entries(value)) {
      if (typeof s !== "string") continue;
      const found = [
        ...(field === "name" ? nameIssues(s, lang, version) : []),
        ...(field === "scope" ? scopeIssues(s) : []),
        ...voiceIssues(s, lang),
      ];
      for (const i of found) issues.push(`${field} (${lang}) ${i}`);
    }
  }
  if (issues.length) fail(`${target} can't be approved: ${issues.join(" ")} Rename it through your AI app first.`);
}

// ---------------------------------------------------------------------------

export const ops = {
  // Inventory
  propose_loops(state, { loops }, ctx) {
    if (!Array.isArray(loops) || !loops.length) fail("loops is a list of 1 or more proposed loops.");
    if (loops.length > P.limits.loops) fail(`propose ${P.limits.loops} loops at most per call.`);
    const codes = loops.map((spec) => newLoop(state, spec, ctx).code);
    return { target: codes.join(","), result: { proposed: codes, note: "Proposed loops wait for the owner's approve_loops." } };
  },

  rename_loop(state, { code, name, doneWhen, scope }, ctx) {
    const loop = findLoop(state, code);
    if (loop.retired) fail(`${code} is retired. Retired loops keep their history and can't change.`);
    if (name == null && doneWhen == null && scope == null) fail("send name, doneWhen, scope or a mix.");
    setText(
      loop,
      {
        name: text(name, "name", { required: false }),
        doneWhen: text(doneWhen, "doneWhen", { required: false }),
        scope: text(scope, "scope", { required: false }),
      },
      ctx
    );
    return { target: code, result: { code, pending: !loop.proposed && !ctx.directText } };
  },

  update_loop(state, { code, estimate: est, triage: tri, evidence, over500, visibility }, ctx) {
    const loop = findLoop(state, code);
    if (loop.retired) fail(`${code} is retired.`);
    if (est !== undefined) loop.estimate = { ...(loop.estimate || {}), ...estimate(est) };
    if (tri !== undefined) loop.triage = triage(tri, isMeasured(loop));
    if (evidence !== undefined) loop.evidence = String(evidence);
    if (over500 !== undefined) loop.over500 = Boolean(over500);
    if (visibility !== undefined) {
      const v = Number(visibility);
      if (!Number.isInteger(v) || v < 0 || v > 9) fail("visibility is a whole number from 0 to 9. Higher shows first.");
      loop.visibility = v;
    }
    return { target: code, result: { code } };
  },

  split_loop(state, { code, into, keepBaseline = false }, ctx) {
    const loop = findLoop(state, code);
    if (!isActive(loop)) fail(`${code} is not an active loop.`);
    if (!Array.isArray(into) || into.length < 2) fail("into lists 2 or more new loops.");
    const area = parseCode(code).areaCode;
    const extra = { replaces: [code] };
    if (keepBaseline && loop.baseline) extra.baseline = { ...loop.baseline };
    const codes = into.map((spec) => newLoop(state, { ...spec, area }, ctx, extra).code);
    return { target: [code, ...codes].join(","), result: { proposed: codes, note: `${code} retires when the owner approves the new loops.` } };
  },

  merge_loops(state, { codes, into }, ctx) {
    if (!Array.isArray(codes) || codes.length < 2) fail("codes lists 2 or more loops to merge.");
    const loops = codes.map((c) => findLoop(state, c));
    if (loops.some((l) => !isActive(l))) fail("only active loops can merge.");
    const areas = new Set(codes.map((c) => parseCode(c).areaCode));
    if (areas.size > 1) fail("merged loops share 1 area. A loop belongs to a single area.");
    const loop = newLoop(state, { ...into, area: [...areas][0] }, ctx, { replaces: codes });
    return { target: [...codes, loop.code].join(","), result: { proposed: [loop.code], note: "The old loops retire when the owner approves the new one." } };
  },

  retire_loop(state, { code, reason }, ctx) {
    const loop = findLoop(state, code);
    if (loop.retired) fail(`${code} is already retired.`);
    if (!reason) fail("reason is required. Every retirement says why.");
    if (loop.proposed) {
      Object.assign(loop, { retired: true, retiredAt: ctx.now, retiredReason: String(reason) });
      return { target: code, result: { code, withdrawn: true } };
    }
    if (ctx.access === "owner" && ctx.directText) {
      Object.assign(loop, { retired: true, retiredAt: ctx.now, retiredReason: String(reason) });
      return { target: code, result: { code, retired: true } };
    }
    loop.retireProposed = { reason: String(reason), by: ctx.actor, at: ctx.now };
    return { target: code, result: { code, note: "The retirement waits for the owner's approve_loops." } };
  },

  set_measuring(state, { code, measuring }, ctx) {
    const loop = findLoop(state, code);
    if (measuring && isMeasured(loop)) fail(`${code} is already measured.`);
    if (measuring && loop.level !== "still")
      fail(`${code} is at ${levelName(loop.level)}. Once an agent does a loop, you can't measure doing it by hand anymore.`);
    loop.measuring = Boolean(measuring);
    if (!loop.measuring) delete loop.measuring;
    touch(loop, ctx);
    return { target: code, result: { code, measuring: Boolean(measuring) } };
  },

  record_baseline(state, { code, occurrences, hoursPerWeek, moneyUsd = 0, quality }, ctx) {
    const loop = findLoop(state, code);
    if (!isActive(loop)) fail(`${code} is not an active loop.`);
    if (isMeasured(loop)) fail(`${code} is already measured. What it costs today is recorded once.`);
    if (loop.level !== "still")
      fail(`${code} is at ${levelName(loop.level)}. Once an agent does a loop, you can't measure doing it by hand anymore.`);
    const n = Number(occurrences);
    if (!Number.isInteger(n) || n < 0) fail("occurrences is the number of times you watched the loop happen.");
    const h = Number(hoursPerWeek);
    if (!Number.isFinite(h) || h < 0) fail("hoursPerWeek is a number of hours, 0 or more.");
    loop.pendingBaseline = {
      occurrences: n,
      confidence: n >= P.limits.occurrencesToMeasure ? "normal" : "low",
      hoursPerWeek: h,
      moneyUsd: Number(moneyUsd) || 0,
      ...(quality ? { quality: String(quality) } : {}),
      recordedAt: ctx.now,
      recordedBy: ctx.actor,
    };
    return { target: code, result: { code, note: "The measured cost waits for the owner's approve_baseline." } };
  },

  // Stages
  register_stage_try(state, args, ctx) {
    const exp = findExp(state, args.experiment);
    if (!isOpen(exp)) fail(`${exp.code} has ended. Register a new experiment instead.`);
    const last = lastTry(exp);
    let stage = 1;
    let attempt = 1;
    if (last) {
      if (last.outcome == null) fail(`${exp.code} round ${last.stage} try ${last.try} is still running. End it first.`);
      if (last.outcome === "achieved" && !last.hold) fail(`${exp.code} is proving. Record whether it held before the next round.`);
      if (last.outcome === "achieved" && last.hold.result === "passed") stage = last.stage + 1;
      else {
        stage = last.stage;
        attempt = last.try + 1;
      }
    }
    if (stage > P.limits.maxStages) fail(`${exp.code} already used its ${P.limits.maxStages} rounds. End it.`);
    const level = LEVELS[lv(exp.startLevel) + stage];
    if (!args.approach || !args.successTests || !args.deadline)
      fail("approach, successTests and deadline are required. A round is fully written down before it starts.");
    if (!last) {
      const loops = exp.loops.map((c) => findLoop(state, c));
      const missing = loops.filter((l) => !costToday(l)).map((l) => l.code);
      if (missing.length && estimateCanStart(logVersion(state.meta)))
        fail(`${missing.join(", ")} ${missing.length === 1 ? "has" : "have"} no cost today. Write down the estimated hours a week with update_loop before round 1.`);
      if (!exp.costToday) exp.costToday = Object.fromEntries(loops.filter(costToday).map((l) => [l.code, costToday(l)]));
    }
    const t = {
      stage,
      try: attempt,
      level,
      start: date(args.start, "start", day(ctx)),
      deadline: date(args.deadline, "deadline"),
      approach: String(args.approach),
      ...(args.why ? { why: String(args.why) } : {}),
      successTests: String(args.successTests),
      ...(args.stopEarly ? { stopEarly: String(args.stopEarly) } : {}),
      ...(args.cost ? { cost: String(args.cost) } : {}),
      ...(args.risks ? { risks: String(args.risks) } : {}),
      registeredAt: ctx.now,
      registeredBy: ctx.actor,
    };
    exp.stages.push(t);
    for (const c of exp.loops) touch(findLoop(state, c), ctx);
    const period = P.limits.cycleWeeks * 7;
    const days = (Date.parse(t.deadline) - Date.parse(t.start)) / 86400000;
    const warnings =
      stage === 1 && days > period
        ? [`Round 1 runs ${days} days, longer than 1 check-in period (${period} days). A short first round gives a result sooner. Ask the person whether a shorter round works.`]
        : [];
    return { target: exp.code, result: { experiment: exp.code, stage, try: attempt, level, ...(warnings.length ? { warnings } : {}) } };
  },

  close_stage_try(state, { experiment, outcome, closedAt, reason, actualCost, notes }, ctx) {
    const exp = findExp(state, experiment);
    const t = lastTry(exp);
    if (!t || t.outcome != null) fail(`${experiment} has no running round to end.`);
    if (!P.outcomes.includes(outcome)) fail(`outcome is ${P.outcomes.join(", ")}.`);
    if (outcome === "terminated" && !reason) fail("a stopped round records the reason it stopped.");
    Object.assign(t, { outcome, closedAt: date(closedAt, "closedAt", day(ctx)) });
    if (reason) t.reason = String(reason);
    if (actualCost) t.actualCost = String(actualCost);
    if (notes) t.notes = String(notes);
    for (const c of exp.loops) touch(findLoop(state, c), ctx);
    const checkIn = markCheckIn(state, ctx, "close_stage_try");
    return { target: exp.code, result: { experiment, stage: t.stage, try: t.try, outcome, ...(checkIn != null ? { checkIn } : {}) } };
  },

  record_hold(state, { experiment, result, at }, ctx) {
    const exp = findExp(state, experiment);
    const t = lastTry(exp);
    if (!t || t.outcome !== "achieved" || t.hold) fail(`${experiment} is not proving.`);
    if (!P.holds.includes(result)) fail(`result is ${P.holds.join(" or ")}.`);
    t.hold = { result, at: date(at, "at", day(ctx)) };
    const moved = [];
    for (const c of exp.loops) {
      const loop = findLoop(state, c);
      if (result === "passed" && lv(t.level) > lv(loop.level)) {
        loop.level = t.level;
        moved.push(c);
      }
      touch(loop, ctx);
    }
    const checkIn = markCheckIn(state, ctx, "record_hold");
    return { target: exp.code, result: { experiment, hold: result, moved, level: t.level, ...(checkIn != null ? { checkIn } : {}) } };
  },

  // get_check_in calls this inside the check-in window. Round ends and provings mark it on their own.
  mark_check_in(state, _args, ctx) {
    owner(ctx);
    const n = markCheckIn(state, ctx, "get_check_in");
    if (n == null) fail("no check-in is due. The window runs from day 13 of a period to day 3 of the next, once per period, and never while paused.");
    return { target: "meta", result: { checkIn: n } };
  },

  record_drop(state, { code, cause, at, note }, ctx) {
    const loop = findLoop(state, code);
    if (!(cause in P.drops)) fail(`cause is ${Object.keys(P.drops).join(", ")}.`);
    if (lv(loop.level) <= lv("still"))
      fail(`${code} is ${levelName("still").toLowerCase()}. Only loops at ${levelName("assisted")} or above can drop.`);
    const to = P.drops[cause] === "oneLevel" ? LEVELS[lv(loop.level) - 1] : P.drops[cause];
    loop.drops = [...(loop.drops || []), { at: date(at, "at", day(ctx)), cause, from: loop.level, to, ...(note ? { note: String(note) } : {}) }];
    loop.level = to;
    touch(loop, ctx);
    const open = state.experiments.find((e) => isOpen(e) && e.loops.includes(code));
    const hint = to === "still" && open ? ` ${open.code} should end: its loop dropped back to ${levelName("still").toLowerCase()}.` : "";
    return { target: code, result: { code, from: loop.drops.at(-1).from, to, note: `Dropped.${hint}`.trim() } };
  },

  add_learned(state, { experiment, stage, try: attempt, learned }, ctx) {
    const exp = findExp(state, experiment);
    const tries = sortTries(exp);
    const t =
      stage != null ? tries.find((x) => x.stage === Number(stage) && x.try === Number(attempt ?? 1)) : tries.findLast((x) => x.outcome != null);
    if (!t) fail(`${experiment} has no ended round to add a lesson to.`);
    setText(t, { learned: text(learned, "learned") }, ctx);
    return { target: exp.code, result: { experiment, stage: t.stage, try: t.try, pending: !ctx.directText } };
  },

  // Owner: inventory and approvals
  approve_loops(state, { codes = [], retire = [] }, ctx) {
    owner(ctx);
    const approved = [];
    const retired = [];
    for (const code of codes) {
      const loop = findLoop(state, code);
      if (!loop.proposed || loop.retired) fail(`${code} is not a proposed loop.`);
      refuseBrokenText(state, code, { name: loop.name, doneWhen: loop.doneWhen, scope: loop.scope });
      delete loop.proposed;
      loop.approvedAt = ctx.now;
      approved.push(code);
      for (const old of loop.replaces || []) {
        const o = findLoop(state, old);
        if (!o.retired) Object.assign(o, { retired: true, retiredAt: ctx.now, retiredReason: `replaced by ${code}` });
        retired.push(old);
      }
    }
    for (const code of retire) {
      const loop = findLoop(state, code);
      if (loop.retired) continue;
      Object.assign(loop, { retired: true, retiredAt: ctx.now, retiredReason: loop.retireProposed?.reason || "retired by the owner" });
      delete loop.retireProposed;
      retired.push(code);
    }
    if (!approved.length && !retired.length) fail("send codes to approve, retire, or both.");
    return { target: [...approved, ...retired].join(","), result: { approved, retired: [...new Set(retired)] } };
  },

  approve_text(state, { targets, all = false }, ctx) {
    owner(ctx);
    const items = pendingItems(state);
    const chosen = all ? items : items.filter((i) => (targets || []).includes(i.target));
    if (!chosen.length) fail("nothing pending matches. Call list_pending to see what waits.");
    for (const i of chosen) refuseBrokenText(state, i.target, i.pending);
    for (const i of chosen) {
      Object.assign(i.ref, i.ref.pending);
      delete i.ref.pending;
    }
    return { target: chosen.map((i) => i.target).join(","), result: { published: chosen.map((i) => i.target) } };
  },

  reject_text(state, { targets }, ctx) {
    owner(ctx);
    const chosen = pendingItems(state).filter((i) => (targets || []).includes(i.target));
    if (!chosen.length) fail("nothing pending matches. Call list_pending to see what waits.");
    for (const i of chosen) delete i.ref.pending;
    return { target: chosen.map((i) => i.target).join(","), result: { discarded: chosen.map((i) => i.target) } };
  },

  approve_baseline(state, { code }, ctx) {
    owner(ctx);
    const loop = findLoop(state, code);
    if (!loop.pendingBaseline) fail(`${code} has no measured cost waiting.`);
    const { recordedBy, ...baseline } = loop.pendingBaseline;
    loop.baseline = { ...baseline, approvedAt: day(ctx) };
    delete loop.pendingBaseline;
    delete loop.measuring;
    if (loop.triage) loop.triage.source = "baseline";
    touch(loop, ctx);
    return { target: code, result: { code, level: loop.level, measured: true } };
  },

  set_published(state, { code, published }, ctx) {
    owner(ctx);
    const loop = findLoop(state, code);
    if (!P.consentRequired.includes(parseCode(code).areaCode)) fail(`${code} is public by default. Only ${P.consentRequired.join(", ")} loops wait for consent.`);
    loop.published = Boolean(published);
    return { target: code, result: { code, published: loop.published } };
  },

  freeze_inventory(state, _args, ctx) {
    owner(ctx);
    if (state.meta.mode === "frozen") fail("your list is already frozen.");
    const n = state.loops.filter(isActive).length;
    if (n !== P.limits.loops) fail(`${n} approved loops. Freezing needs exactly ${P.limits.loops}, so the list can't only grow.`);
    Object.assign(state.meta, { mode: "frozen", inventoryVersion: 1, frozenAt: ctx.now });
    return { target: "inventory", result: { mode: "frozen", inventoryVersion: 1 } };
  },

  // Owner: experiments
  register_experiment(state, args, ctx) {
    owner(ctx);
    const odds = Number(args.odds);
    if (args.odds == null || !Number.isInteger(odds) || odds < ODDS.min || odds > ODDS.max)
      fail(`odds is required: ask the person what chance, from ${ODDS.min} to ${ODDS.max}, they give the bet. Under ${ODDS.min} or over ${ODDS.max} isn't a real bet.`);
    if (!Array.isArray(args.loops) || !args.loops.length) fail("loops lists the loops this experiment moves.");
    const loops = args.loops.map((c) => findLoop(state, c));
    const levels = new Set(loops.map((l) => l.level));
    if (levels.size > 1) fail("the loops in one experiment start at the same level.");
    if (!LEVELS.includes(args.goal)) fail(`goal is a level: ${LEVELS.slice(1).join(", ")}.`);
    const exp = {
      code: nextExpCode(state),
      slot: args.slot,
      odds,
      ...(args.funReason ? { funReason: String(args.funReason) } : {}),
      loops: args.loops,
      startLevel: [...levels][0],
      goal: args.goal,
      registeredAt: day(ctx),
      ...(args.peopleInvolved ? { peopleInvolved: String(args.peopleInvolved) } : {}),
      stages: [],
    };
    setText(exp, { question: text(args.question, "question"), hypothesis: text(args.hypothesis, "hypothesis") }, ctx);
    state.experiments.push(exp);
    return { target: exp.code, result: { experiment: exp.code, startLevel: exp.startLevel, pending: !ctx.directText } };
  },

  conclude_experiment(state, { experiment, hypothesis, level }, ctx) {
    owner(ctx);
    const exp = findExp(state, experiment);
    if (!isOpen(exp)) fail(`${experiment} has already ended.`);
    const t = lastTry(exp);
    if (t && t.outcome == null) fail(`${experiment} round ${t.stage} is still running. End it first.`);
    if (!P.conclusions.includes(hypothesis)) fail(`hypothesis is ${P.conclusions.join(", ")}.`);
    const reached = exp.loops.map((c) => findLoop(state, c).level).sort((a, b) => lv(a) - lv(b))[0];
    exp.conclusion = { at: day(ctx), level: level || reached, hypothesis };
    return { target: exp.code, result: { experiment, conclusion: exp.conclusion } };
  },

  set_meta(state, args, ctx) {
    owner(ctx);
    const allowed = {
      ownerName: (v) => {
        const name = String(v ?? "").trim().slice(0, 80);
        if (!name) fail("ownerName can't be empty: it's the name visitors see above your numbers.");
        return name;
      },
      about: (v) => {
        if (typeof v !== "object" || Array.isArray(v)) fail('about is text in every language of the log, like { "en": "..." }.');
        return Object.fromEntries(Object.entries(v).map(([lang, s]) => [lang, String(s).trim()]));
      },
      links: (v) => {
        if (!Array.isArray(v)) fail('links is a list like [{ "kind": "x", "url": "https://x.com/you" }].');
        return v.map((l) => {
          const kind = String(l?.kind || "").toLowerCase();
          return { kind, url: normalizeLink(kind, l?.url) };
        });
      },
      languages: (v) => {
        if (!Array.isArray(v) || !v.length || v.some((l) => !/^[a-z]{2}$/.test(l))) fail('languages is a list like ["en"] or ["en", "es"].');
        return v;
      },
      stillMetric: Boolean,
      publish: Boolean,
      companyFigures: Boolean,
      cycleOneStart: (v) => date(v, "cycleOneStart"),
      cycle: (v) => Math.max(0, Number.parseInt(v, 10) || 0),
      day: (v) => Math.max(0, Number.parseInt(v, 10) || 0),
      stage: (v) => {
        if (!["map", "delegate", "review"].includes(v)) fail("stage is map, delegate or review.");
        return v;
      },
      grid: (v) => {
        if (typeof v !== "object" || !v) fail("grid is { cols: {R, P, C}, seeds: {R, P, C} }.");
        return v;
      },
      challenge: (v) => {
        if (!CHALLENGE_LEVELS.includes(v)) fail(`challenge is ${CHALLENGE_LEVELS.join(", ")}.`);
        return v;
      },
      questions: (v) => {
        if (typeof v !== "object" || !v || Array.isArray(v)) fail(`questions is { ${QUESTION_KINDS.map((k) => `${k}: true or false`).join(", ")} }.`);
        const out = { ...(state.meta.questions || {}) };
        for (const [k, on] of Object.entries(v)) {
          if (!QUESTION_KINDS.includes(k)) fail(`questions.${k} is not a kind of question. Kinds: ${QUESTION_KINDS.join(", ")}.`);
          if (typeof on !== "boolean") fail(`questions.${k} is true or false.`);
          out[k] = on;
        }
        return out;
      },
      cards: Boolean,
      pausedUntil: (v) => date(v, "pausedUntil"),
    };
    const changed = [];
    const clearable = new Set(["about", "links", "pausedUntil"]);
    for (const [k, v] of Object.entries(args)) {
      if (!(k in allowed)) fail(`${k} is not a setting. Settings: ${Object.keys(allowed).join(", ")}.`);
      if (v == null && clearable.has(k)) delete state.meta[k];
      else state.meta[k] = allowed[k](v);
      changed.push(k);
    }
    if (!changed.length) fail("send at least 1 setting.");
    return { target: "meta", result: { changed } };
  },

  // Owner: protocol version (section 15.2). Never blocked by what the new rules flag;
  // the result lists it so the owner renames it one item at a time.
  adopt_protocol(state, _args, ctx) {
    owner(ctx);
    const from = logVersion(state.meta);
    const to = P.version;
    if (compareVersions(from, to) >= 0) fail(`the log already runs v${from}, the newest version in this code.`);
    const scheduled = state.meta.protocolUpgrade;
    if (scheduled?.version === to) fail(`v${to} is already adopted. It takes effect after check-in ${scheduled.fromCycle - 1}.`);
    const breaksNewRules = newRuleBreaks(state, from, to).map((v) => v.message);
    const cycle = Number(state.meta.cycle) || 0;
    if (state.meta.mode === "frozen" && cycle >= 1) {
      state.meta.protocolUpgrade = { version: to, fromCycle: cycle + 1, adoptedAt: ctx.now };
      return {
        target: "meta",
        result: { from, to, takesEffect: `after check-in ${cycle}`, fromCycle: cycle + 1, breaksNewRules },
      };
    }
    const change = versionChange(state, to, { at: ctx.now, cycle });
    state.meta.protocolVersion = to;
    state.meta.protocolChange = change;
    delete state.meta.protocolUpgrade;
    return { target: "meta", result: { from, to, takesEffect: "now", protocolChange: change, breaksNewRules } };
  },
};

// Ops that change the rules themselves: what the new rules flag is listed, not refused.
export const RULE_CHANGE_OPS = new Set(["adopt_protocol"]);

export const OWNER_OPS = new Set([
  "approve_loops",
  "approve_text",
  "reject_text",
  "approve_baseline",
  "set_published",
  "freeze_inventory",
  "register_experiment",
  "conclude_experiment",
  "set_meta",
  "adopt_protocol",
  "mark_check_in",
]);

export function pendingItems(state) {
  const items = [];
  for (const l of state.loops) if (l.pending && !l.retired) items.push({ target: l.code, kind: "loop", ref: l, pending: l.pending });
  for (const e of state.experiments) {
    if (e.pending) items.push({ target: e.code, kind: "experiment", ref: e, pending: e.pending });
    for (const t of e.stages || [])
      if (t.pending) items.push({ target: `${e.code}#${t.stage}.${t.try}`, kind: "stage", ref: t, pending: t.pending });
  }
  return items;
}

// ---------------------------------------------------------------------------
// Diff and restore, used for events and undo_event.

function entities(state) {
  const m = new Map();
  for (const l of state.loops) m.set("loop:" + l.code, l);
  for (const e of state.experiments) m.set("exp:" + e.code, e);
  for (const [k, v] of Object.entries(state.meta)) m.set("meta:" + k, v);
  return m;
}

export function diffState(a, b) {
  const ea = entities(a);
  const eb = entities(b);
  const before = {};
  const after = {};
  for (const key of new Set([...ea.keys(), ...eb.keys()])) {
    const x = ea.has(key) ? JSON.stringify(ea.get(key)) : null;
    const y = eb.has(key) ? JSON.stringify(eb.get(key)) : null;
    if (x === y) continue;
    before[key] = x == null ? null : JSON.parse(x);
    after[key] = y == null ? null : JSON.parse(y);
  }
  return { before, after };
}

export function restore(state, snapshot) {
  for (const [key, value] of Object.entries(snapshot)) {
    const [kind, id] = [key.slice(0, key.indexOf(":")), key.slice(key.indexOf(":") + 1)];
    if (kind === "meta") {
      if (value === null) delete state.meta[id];
      else state.meta[id] = value;
      continue;
    }
    const list = kind === "loop" ? state.loops : state.experiments;
    const i = list.findIndex((x) => x.code === id);
    if (value === null) {
      if (i >= 0) list.splice(i, 1);
    } else if (i >= 0) list[i] = value;
    else list.push(value);
  }
}

export const clone = (state) => structuredClone(state);
