import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";
import { compareViolations, pendingRuleBreaks, validate } from "../lib/protocol.mjs";
import { RULE_CHANGE_OPS, ToolError, clone, diffState, ops, pendingItems, restore } from "../src/ops.mjs";
import { effectiveMeta, upgradeDiff } from "../src/store.mjs";

const empty = (protocolVersion = "1.5") => ({ meta: { mode: "building", protocolVersion, languages: ["en"] }, loops: [], experiments: [] });
const agent = { actor: "claude", access: "owner", now: "2026-10-12T12:00:00.000Z", cycle: 0 };
const page = { ...agent, actor: "owner", directText: true };

// Same contract as the WRITER: apply on a clone, reject if the write adds violations.
// A rule change is measured against the new rules on both sides.
let lastResult;
function write(state, op, args, ctx = agent) {
  const next = clone(state);
  const out = ops[op](next, args, ctx);
  const cmp = compareViolations(validate(RULE_CHANGE_OPS.has(op) ? { ...state, meta: next.meta } : state), validate(next));
  if (!cmp.ok) throw new ToolError(cmp.added.map((v) => v.message).join(" "));
  lastResult = out.result;
  return next;
}

const seed = async () => {
  const read = async (f) => JSON.parse(await readFile(new URL(`../seed/${f}`, import.meta.url), "utf8"));
  return { meta: await read("log.json"), loops: await read("loops.json"), experiments: await read("experiments.json") };
};

const spec = (name, area = "P-HOM") => ({ area, name: { en: name }, doneWhen: { en: "The result is visible outside my head" }, evidence: "A monthly calendar block" });

test("proposed loops get the next code and stay out of the inventory", () => {
  let s = write(empty(), "propose_loops", { loops: [spec("Pay the rent"), spec("Clean the kitchen")] });
  assert.deepEqual(s.loops.map((l) => l.code), ["P-HOM-01", "P-HOM-02"]);
  assert.ok(s.loops.every((l) => l.proposed));
  s = write(s, "approve_loops", { codes: ["P-HOM-01"] }, page);
  assert.equal(s.loops[0].proposed, undefined);
});

test("a bad loop name is rejected", () => {
  assert.throws(() => write(empty(), "propose_loops", { loops: [spec("Remember to pay the rent")] }), ToolError);
});

test('"Decide ..." is rejected on a v1.1 log and accepted on a v1.0 log', () => {
  assert.throws(() => write(empty("1.1"), "propose_loops", { loops: [spec("Decide what's for dinner")] }), /failing verb \(decide\)/);
  const s = write(empty("1.0"), "propose_loops", { loops: [spec("Decide what's for dinner")] });
  assert.equal(s.loops.length, 1);
});

test("adopt_protocol applies at once before check-ins start, records the change and lists what breaks", async () => {
  let s = await seed();
  Object.assign(s.meta, { protocolVersion: "1.0", mode: "building", cycle: 0 });
  delete s.meta.cycleOneStart;
  s.loops[0].name.en = "Decide where we eat out";
  s = write(s, "adopt_protocol", {}, { ...page, cycle: 0 });
  assert.equal(s.meta.protocolVersion, "1.6");
  assert.deepEqual(s.meta.protocolChange, { from: "1.0", to: "1.6", at: "2026-10-12", cycle: 0, until: "2026-10-26", delegatedBefore: 7, delegatedAfter: 8.5 });
  assert.equal(lastResult.takesEffect, "now");
  assert.equal(lastResult.breaksNewRules.length, 1);
  assert.match(lastResult.breaksNewRules[0], new RegExp(`^${s.loops[0].code}: name \\(en\\) starts with a failing verb \\(decide\\)`));
  assert.equal(pendingRuleBreaks(s).items.length, 1);
  assert.throws(() => write(s, "adopt_protocol", {}, page), /already runs v1.6/);
});

test("adopt_protocol waits for the next check-in once they have started", async () => {
  let s = await seed();
  s.meta.protocolVersion = "1.0";
  s = write(s, "adopt_protocol", {}, { ...page, cycle: 16 });
  assert.equal(s.meta.protocolVersion, "1.0");
  assert.deepEqual(s.meta.protocolUpgrade, { version: "1.6", fromCycle: 17, adoptedAt: page.now });
  assert.equal(lastResult.takesEffect, "after check-in 16");
  assert.throws(() => write(s, "adopt_protocol", {}, page), /takes effect after check-in 16/);
});

test("a scheduled upgrade applies once its cycle starts, and the writer can save it", () => {
  const raw = { mode: "frozen", protocolVersion: "1.0", cycleOneStart: "2026-01-05", protocolUpgrade: { version: "1.1", fromCycle: 3, adoptedAt: "2026-01-20T00:00:00Z" } };
  const loops = [{ code: "P-HOM-01", level: "assisted" }, { code: "P-HOM-02", level: "delegated" }];
  const before = effectiveMeta(raw, {}, "2026-02-01", loops);
  assert.equal(before.cycle, 2);
  assert.equal(before.protocolVersion, "1.0");
  assert.equal(upgradeDiff(raw, before), null);
  const after = effectiveMeta(raw, {}, "2026-02-02", loops);
  assert.equal(after.cycle, 3);
  assert.equal(after.protocolVersion, "1.1");
  assert.equal(after.protocolUpgrade, undefined);
  assert.deepEqual(after.protocolChange, { from: "1.0", to: "1.1", at: "2026-02-02", cycle: 3, until: "2026-02-16", delegatedBefore: 1, delegatedAfter: 1.5 });
  const diff = upgradeDiff(raw, after);
  assert.equal(diff.after["meta:protocolVersion"], "1.1");
  assert.equal(diff.after["meta:protocolUpgrade"], null);
});

test("pending text that breaks the log's rules can't be approved", () => {
  let s = write(empty("1.0"), "propose_loops", { loops: [spec("Pay the rent")] });
  s = write(s, "approve_loops", { codes: ["P-HOM-01"] }, page);
  s = write(s, "rename_loop", { code: "P-HOM-01", name: { en: "Decide the rent day" } });
  s = write(s, "adopt_protocol", {}, page);
  assert.equal(lastResult.breaksNewRules.length, 1);
  assert.throws(() => write(s, "approve_text", { targets: ["P-HOM-01"] }, page), /can't be approved/);
  s = write(s, "reject_text", { targets: ["P-HOM-01"] }, page);
  assert.equal(pendingRuleBreaks(s).items.length, 0);
});

test("unknown areas are rejected", () => {
  assert.throws(() => write(empty(), "propose_loops", { loops: [spec("Pay the rent", "P-XYZ")] }), /not an area/);
});

test("agent text on an approved loop waits for approve_text", () => {
  let s = write(empty(), "propose_loops", { loops: [spec("Pay the rent")] });
  s = write(s, "approve_loops", { codes: ["P-HOM-01"] }, page);
  s = write(s, "rename_loop", { code: "P-HOM-01", name: { en: "Pay rent and utilities" } });
  assert.equal(s.loops[0].name.en, "Pay the rent");
  assert.equal(pendingItems(s).length, 1);
  s = write(s, "approve_text", { targets: ["P-HOM-01"] }, page);
  assert.equal(s.loops[0].name.en, "Pay rent and utilities");
  assert.equal(pendingItems(s).length, 0);
});

test("propose_loops keeps an optional scope, and rename_loop parks a new one as pending", () => {
  const withScope = {
    ...spec("Plan and book our date night", "R-PAR"),
    scope: { en: "Covers Friday nights out. Birthday gifts are another loop." },
  };
  let s = write(empty(), "propose_loops", { loops: [withScope] });
  assert.equal(s.loops[0].scope.en, "Covers Friday nights out. Birthday gifts are another loop.");
  s = write(s, "approve_loops", { codes: ["R-PAR-01"] }, page);
  s = write(s, "rename_loop", { code: "R-PAR-01", scope: { en: "Nights out and anniversary plans. Kid weekends stay elsewhere." } });
  assert.equal(s.loops[0].scope.en, "Covers Friday nights out. Birthday gifts are another loop.");
  assert.equal(s.loops[0].pending.scope.en, "Nights out and anniversary plans. Kid weekends stay elsewhere.");
  s = write(s, "approve_text", { targets: ["R-PAR-01"] }, page);
  assert.equal(s.loops[0].scope.en, "Nights out and anniversary plans. Kid weekends stay elsewhere.");
  assert.equal(s.loops[0].pending, undefined);
});

test("owner-only writes refuse agent access", () => {
  const s = write(empty(), "propose_loops", { loops: [spec("Pay the rent")] });
  assert.throws(() => write(s, "approve_loops", { codes: ["P-HOM-01"] }, { ...agent, access: "agent" }), /only the owner/);
});

test("freeze_inventory needs exactly 100 approved loops", () => {
  assert.throws(() => write(empty(), "freeze_inventory", {}, page), /Freezing needs exactly 100/);
});

test("levels only move through holds", () => {
  let s = write(empty(), "propose_loops", { loops: [spec("Pay the rent")] });
  s = write(s, "approve_loops", { codes: ["P-HOM-01"] }, page);
  s = write(s, "record_baseline", { code: "P-HOM-01", occurrences: 3, hoursPerWeek: 1 });
  s = write(s, "approve_baseline", { code: "P-HOM-01" }, page);
  assert.equal(s.loops[0].level, "still");
  assert.ok(s.loops[0].baseline.approvedAt);
  s.loops[0].triage = { time: 4, frequency: 4, rules: 4, digital: 4, risk: 1, source: "baseline" };
  s = write(s, "register_experiment", { slot: "easy", question: { en: "Can an agent pay the rent?" }, hypothesis: { en: "If it has the bank login, then it pays on time, because the amount never changes." }, odds: 60, loops: ["P-HOM-01"], goal: "assisted" }, page);
  s = write(s, "register_stage_try", { experiment: "EXP-01", start: "2026-09-01", deadline: "2026-09-10", approach: "Draft the payment", successTests: "3 of 3 on time" });
  s = write(s, "close_stage_try", { experiment: "EXP-01", outcome: "achieved", closedAt: "2026-09-10" });
  assert.equal(s.loops[0].level, "still");
  s = write(s, "record_hold", { experiment: "EXP-01", result: "passed", at: "2026-10-01" });
  assert.equal(s.loops[0].level, "assisted");
});

const easyCard = {
  slot: "easy",
  question: { en: "Can an agent pay the rent?" },
  hypothesis: { en: "If it has the bank login, then it pays on time, because the amount never changes." },
  odds: 60,
  loops: ["P-HOM-01"],
  goal: "assisted",
};
const round1 = { experiment: "EXP-01", start: "2026-09-01", deadline: "2026-09-10", approach: "Draft the payment", successTests: "3 of 3 on time" };
const scored = (version) => {
  let s = write(empty(version), "propose_loops", { loops: [spec("Pay the rent")] });
  s = write(s, "approve_loops", { codes: ["P-HOM-01"] }, page);
  s.loops[0].triage = { time: 4, frequency: 4, rules: 4, digital: 4, risk: 1, source: "estimate" };
  return s;
};

test("from v1.4 an estimate is enough: the first round needs a cost, not a measurement", () => {
  let s = write(scored("1.5"), "register_experiment", easyCard, page);
  assert.throws(() => write(s, "register_stage_try", round1), /estimated hours a week/);
  s = write(s, "update_loop", { code: "P-HOM-01", estimate: { howOften: "monthly", hoursPerWeek: 0.5 } });
  s = write(s, "register_stage_try", round1);
  assert.equal(s.experiments[0].stages[0].level, "assisted");
  assert.equal(s.experiments[0].costToday["P-HOM-01"].source, "estimated");
});

test("before v1.4 only measured loops can be picked", () => {
  assert.throws(() => write(scored("1.3"), "register_experiment", easyCard, page), /measured/);
});

test("measuring is only for loops that aren't measured yet, and approving the cost keeps the level", () => {
  let s = scored("1.5");
  s = write(s, "set_measuring", { code: "P-HOM-01", measuring: true });
  s = write(s, "record_baseline", { code: "P-HOM-01", occurrences: 3, hoursPerWeek: 1 });
  s = write(s, "approve_baseline", { code: "P-HOM-01" }, page);
  assert.equal(s.loops[0].level, "still");
  assert.throws(() => write(s, "record_baseline", { code: "P-HOM-01", occurrences: 3, hoursPerWeek: 1 }), /already measured/);
  assert.throws(() => write(s, "set_measuring", { code: "P-HOM-01", measuring: true }), /already measured/);
});

test("text an agent writes with guilt or hype is refused when it's saved, not only at approval", () => {
  let s = write(empty(), "propose_loops", { loops: [spec("Pay the rent")] });
  s = write(s, "approve_loops", { codes: ["P-HOM-01"] }, page);
  assert.throws(() => write(s, "rename_loop", { code: "P-HOM-01", doneWhen: { en: "Rent is paid and we're crushing it" } }), /hype/);
  assert.throws(() => write(s, "rename_loop", { code: "P-HOM-01", scope: { en: "You still haven't paid it twice this year." } }), /guilts the reader/);
  assert.throws(() => write(empty(), "propose_loops", { loops: [{ ...spec("Pay the rent"), doneWhen: { en: "Paid on time, no excuses" } }] }), /guilts the reader/);
  s = write(s, "rename_loop", { code: "P-HOM-01", doneWhen: { en: "The rent shows as paid in the bank" } });
  assert.equal(pendingItems(s).length, 1);
});

test("odds are required on a new experiment, from 20 to 80, with an error that explains itself", () => {
  const plain = /odds is required: ask the person what chance, from 20 to 80, they give the bet/;
  const { odds, ...noOdds } = easyCard;
  assert.equal(odds, 60);
  assert.throws(() => write(scored("1.5"), "register_experiment", noOdds, page), plain);
  assert.throws(() => write(scored("1.5"), "register_experiment", { ...easyCard, odds: 10 }, page), plain);
  assert.throws(() => write(scored("1.5"), "register_experiment", { ...easyCard, odds: 85 }, page), plain);
  assert.throws(() => write(scored("1.5"), "register_experiment", { ...easyCard, odds: 50.5 }, page), plain);
  const s = write(scored("1.5"), "register_experiment", { ...easyCard, odds: 20 }, page);
  assert.equal(s.experiments[0].odds, 20);
});

test("agents must say where a loop showed up; the owner doesn't", () => {
  const { evidence, ...bare } = spec("Pay the rent");
  assert.ok(evidence);
  assert.throws(() => write(empty(), "propose_loops", { loops: [bare] }), /evidence is required/);
  const s = write(empty(), "propose_loops", { loops: [bare] }, page);
  assert.equal(s.loops.length, 1);
  let t = write(empty(), "propose_loops", { loops: [spec("Pay the rent")] });
  t = write(t, "approve_loops", { codes: ["P-HOM-01"] }, page);
  assert.throws(() => write(t, "split_loop", { code: "P-HOM-01", into: [{ name: { en: "Pay the rent" }, doneWhen: { en: "Rent paid" } }, { name: { en: "Pay the water bill" }, doneWhen: { en: "Water paid" } }] }), /evidence is required/);
});

test("a first round longer than 1 check-in period comes back with a warning, not an error", () => {
  let s = write(scored("1.5"), "register_experiment", easyCard, page);
  s = write(s, "update_loop", { code: "P-HOM-01", estimate: { howOften: "monthly", hoursPerWeek: 0.5 } });
  write(s, "register_stage_try", { ...round1, deadline: "2026-10-01" });
  assert.equal(lastResult.warnings.length, 1);
  assert.match(lastResult.warnings[0], /Round 1 runs 30 days/);
  write(s, "register_stage_try", round1);
  assert.equal(lastResult.warnings, undefined);
});

test("set_meta takes the challenge level, question kinds, cards and a pause; agents can't change them", () => {
  let s = write(empty(), "set_meta", { challenge: "bold", questions: { romantic: false }, cards: false, pausedUntil: "2026-11-01" }, page);
  assert.equal(s.meta.challenge, "bold");
  assert.equal(s.meta.questions.romantic, false);
  assert.equal(s.meta.cards, false);
  assert.equal(s.meta.pausedUntil, "2026-11-01");
  s = write(s, "set_meta", { pausedUntil: null }, page);
  assert.equal(s.meta.pausedUntil, undefined);
  assert.throws(() => write(s, "set_meta", { challenge: "loud" }, page), /challenge is off, gentle, normal, bold/);
  assert.throws(() => write(s, "set_meta", { questions: { kids: true } }, page), /not a kind of question/);
  assert.throws(() => write(s, "set_meta", { challenge: "off" }, { ...agent, access: "agent" }), /only the owner/);
});

test("the check-in is marked once per period inside its window, by the owner, never while paused", () => {
  const inWindow = { ...empty(), meta: { ...empty().meta, mode: "frozen", cycle: 2, day: 13 } };
  let s = write(inWindow, "mark_check_in", {}, page);
  assert.deepEqual(s.meta.checkIns, [{ cycle: 2, at: page.now, by: "get_check_in" }]);
  assert.throws(() => write(s, "mark_check_in", {}, page), /no check-in is due/);
  assert.throws(() => write({ ...inWindow, meta: { ...inWindow.meta, day: 8 } }, "mark_check_in", {}, page), /no check-in is due/);
  assert.throws(() => write({ ...inWindow, meta: { ...inWindow.meta, pausedUntil: "2026-10-20" } }, "mark_check_in", {}, page), /no check-in is due/);
  assert.throws(() => write(inWindow, "mark_check_in", {}, { ...agent, access: "agent" }), /only the owner/);
});

test("diff and restore round-trip, which is what undo_event uses", () => {
  const a = write(empty(), "propose_loops", { loops: [spec("Pay the rent")] });
  const b = write(a, "rename_loop", { code: "P-HOM-01", name: { en: "Pay rent and utilities" } });
  const diff = diffState(a, b);
  const undone = clone(b);
  restore(undone, diff.before);
  assert.deepEqual(undone, a);
});
