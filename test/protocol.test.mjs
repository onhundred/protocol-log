import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";
import {
  cardFacts,
  cardHeadline,
  cardHeadlineParts,
  changeIsCurrent,
  checkInDue,
  checkInWindow,
  checkPublic,
  moments,
  nudges,
  compareVersions,
  compareViolations,
  derive,
  formatPoints,
  gridChange,
  PROFILE_LINKS,
  isMeasured,
  levelName,
  linkIssues,
  metrics,
  nameIssues,
  normalizeLink,
  profileMissing,
  progressNote,
  publicActivity,
  publicView,
  renderGrid,
  scopeIssues,
  upgradeLevels,
  validate,
  voiceIssues,
} from "../lib/protocol.mjs";
import { STATEMENTS, migrationSql } from "../src/schema.mjs";
import P from "../protocol.json" with { type: "json" };

const seed = async () => {
  const read = async (f) => JSON.parse(await readFile(new URL(`../seed/${f}`, import.meta.url), "utf8"));
  return { meta: await read("log.json"), loops: await read("loops.json"), experiments: await read("experiments.json") };
};

test("the sample log follows every rule", async () => {
  const violations = validate(await seed());
  assert.deepEqual(violations.map((v) => v.message), []);
});

// 7 loops at delegated or autonomous, 3 at assisted: 8.5 points, and 91.5% still him, never rounded.
test("the sample hero is 91.5% still him and 8.5 of 100 delegated", async () => {
  const { metrics: m } = derive(await seed());
  assert.equal(m.total, 100);
  assert.equal(m.stillPct, 91.5);
  assert.equal(m.delegatedPoints, 8.5);
  assert.equal(formatPoints(m.delegatedPoints), "8.5 of 100");
});

test("Delegated counts assisted as half from v1.1, and as nothing on a v1.0 log", async () => {
  const state = await seed();
  state.meta.protocolVersion = "1.0";
  assert.equal(derive(state).metrics.delegatedPoints, 7);
  const loops = ["assisted", "delegated", "autonomous", "assisted", "still"].map((level, i) => ({ code: `P-HOM-0${i + 1}`, level }));
  assert.equal(metrics(loops, "1.1").delegatedPoints, 3);
  assert.equal(metrics(loops.slice(0, 2), "1.1").delegatedPoints, 1.5);
  assert.equal(formatPoints(23.5), "23.5 of 100");
  const b = metrics(loops, "1.1").branches.P;
  assert.deepEqual([b.delegatedPoints, b.total], [3, 5]);
});

test("a Handed off of 0 says the furthest any loop has got, and a higher one says nothing", async () => {
  const note = (loops, version = "1.5") => progressNote({ loops, metrics: metrics(loops, version) });
  const at = (level, extra = {}) => ({ code: "P-HOM-01", level, ...extra });
  assert.equal(progressNote(derive(await seed())), null);
  assert.equal(note([]), null);
  assert.equal(note([at("still")]), "No experiment started yet.");
  assert.equal(note([at("still", { flag: "measuring" })]), "Measuring 1 loop. No experiment started yet.");
  assert.equal(note([at("still", { measured: true }), at("still", { flag: "measuring" })]), "1 loop measured. No experiment started yet.");
  assert.equal(note([at("still", { measured: true }), at("still", { flag: "experimenting" })]), "Trying 1 loop with an agent.");
  const proving = [at("still", { flag: "holding" }), at("still", { flag: "holding" }), at("still", { flag: "experimenting" })];
  assert.equal(note(proving), "2 loops passed a round. Proving them for 3 weeks.");
  assert.equal(note([at("assisted"), ...proving], "1.0"), "1 loop at help me, which counts 0 before v1.1.");
  assert.equal(note([at("assisted")]), null);
});

test("versions compare by number, not by text", () => {
  assert.equal(compareVersions("1.10", "1.9"), 1);
  assert.equal(compareVersions("1.1", "1.1"), 0);
  assert.equal(compareVersions("1.0", "1.1"), -1);
});

test("levels stored before v1.2 read as Still yours, and a mapped loop keeps its measured mark", () => {
  const baseline = { occurrences: 3, confidence: "normal", hoursPerWeek: 1, approvedAt: "2026-03-30" };
  const old = {
    meta: { protocolVersion: "1.1" },
    loops: [
      { code: "P-HOM-01", level: "unmapped" },
      { code: "P-HOM-02", level: "mapped", baseline, drops: [{ from: "assisted", to: "mapped", cause: "harm", at: "2026-05-01" }] },
      { code: "P-HOM-03", level: "assisted", baseline },
    ],
    experiments: [{ code: "EXP-01", startLevel: "mapped", conclusion: { level: "mapped", hypothesis: "refuted", at: "2026-06-01" } }],
  };
  const s = upgradeLevels(old);
  assert.deepEqual(s.loops.map((l) => l.level), ["still", "still", "assisted"]);
  assert.deepEqual(s.loops.map(isMeasured), [false, true, true]);
  assert.equal(s.loops[1].drops[0].to, "still");
  assert.equal(s.experiments[0].startLevel, "still");
  assert.equal(s.experiments[0].conclusion.level, "still");
  assert.equal(levelName("still"), "Still yours");
  assert.equal(levelName("delegated", "es"), "Hazlo, yo apruebo");
});

test("before v1.4 a level above Still yours needs a measured cost; from v1.4 it doesn't", () => {
  const state = (protocolVersion) => ({
    meta: { mode: "building", protocolVersion, languages: ["en"] },
    loops: [{ code: "P-HOM-01", level: "assisted", name: { en: "Pay the rent" }, doneWhen: { en: "The rent is paid" } }],
    experiments: [],
  });
  assert.ok(validate(state("1.3")).some((v) => v.target === "P-HOM-01" && /measured/.test(v.message)));
  assert.ok(!validate(state("1.4")).some((v) => v.target === "P-HOM-01" && /measured/.test(v.message)));
});

test("profile links: known kinds, https, each on its own site, 5 at most", () => {
  assert.deepEqual(linkIssues([{ kind: "x", url: "https://x.com/sam" }, { kind: "linkedin", url: "https://www.linkedin.com/in/sam" }, { kind: "mastodon", url: "https://hachyderm.io/@sam" }]), []);
  assert.match(linkIssues([{ kind: "x", url: "https://x.com.evil.example/sam" }])[0], /not x\.com/);
  assert.match(linkIssues([{ kind: "website", url: "javascript:alert(1)" }])[0], /https/);
  assert.match(linkIssues([{ kind: "myspace", url: "https://myspace.com/sam" }])[0], /not a link kind/);
  assert.match(linkIssues([{ kind: "x", url: "https://x.com/a" }, { kind: "x", url: "https://x.com/b" }])[0], /2 X links/);
  const six = ["x", "linkedin", "github", "instagram", "youtube", "website"].map((kind) => ({ kind, url: `https://${kind === "website" ? "sam.example" : PROFILE_LINKS[kind].hosts[0]}/sam` }));
  assert.match(linkIssues(six)[0], /5 at most/);
});

test("normalizeLink: with or without @, the site, www, http or tracking, each profile has 1 link", () => {
  const same = {
    x: ["https://x.com/sam", ["sam", "@sam", " @sam ", "x.com/sam", "x.com/@sam", "www.x.com/sam/", "http://x.com/sam", "https://twitter.com/sam", "mobile.twitter.com/sam", "https://x.com/sam?s=21&t=abc", "<https://x.com/sam>"]],
    linkedin: ["https://www.linkedin.com/in/sam", ["sam", "@sam", "in/sam", "linkedin.com/in/sam", "www.linkedin.com/in/sam/", "https://linkedin.com/in/@sam", "linkedin.com/sam"]],
    github: ["https://github.com/sam", ["sam", "@sam", "github.com/sam", "github.com/@sam", "http://www.github.com/sam/"]],
    instagram: ["https://www.instagram.com/sam.rivera", ["sam.rivera", "@sam.rivera", "instagram.com/sam.rivera", "instagram.com/@sam.rivera", "https://www.instagram.com/sam.rivera/?igsh=xyz"]],
    youtube: ["https://www.youtube.com/@sam", ["sam", "@sam", "youtube.com/sam", "youtube.com/@sam", "m.youtube.com/@sam/", "https://www.youtube.com/@sam?si=1"]],
    tiktok: ["https://www.tiktok.com/@sam", ["sam", "@sam", "tiktok.com/sam", "tiktok.com/@sam", "https://www.tiktok.com/@sam?lang=en"]],
    threads: ["https://www.threads.com/@sam", ["sam", "@sam", "threads.net/sam", "threads.net/@sam", "https://www.threads.com/@sam"]],
    bluesky: ["https://bsky.app/profile/sam.bsky.social", ["sam", "@sam", "sam.bsky.social", "@Sam.bsky.social", "bsky.app/profile/sam.bsky.social", "https://bsky.app/profile/@sam.bsky.social/"]],
    mastodon: ["https://hachyderm.io/@sam", ["@sam@hachyderm.io", "sam@hachyderm.io", "hachyderm.io/@sam", "hachyderm.io/sam", "http://hachyderm.io/@sam"]],
    website: ["https://sam.example", ["sam.example", "http://sam.example", "https://sam.example/", "SAM.example"]],
  };
  for (const [kind, [want, inputs]] of Object.entries(same)) {
    for (const raw of inputs) assert.equal(normalizeLink(kind, raw), want, `${kind}: ${raw}`);
    assert.equal(normalizeLink(kind, want), want, `${kind} is stable`);
    assert.deepEqual(linkIssues([{ kind, url: want }]), [], kind);
  }
  assert.equal(normalizeLink("bluesky", "sam.example"), "https://bsky.app/profile/sam.example", "a custom domain handle");
  assert.equal(normalizeLink("linkedin", "linkedin.com/company/acme/"), "https://www.linkedin.com/company/acme");
  assert.equal(normalizeLink("youtube", "youtube.com/c/sam"), "https://www.youtube.com/c/sam");
  assert.equal(normalizeLink("website", "sam.example/blog?ref=1"), "https://sam.example/blog?ref=1", "a website keeps its path and query");
  assert.match(linkIssues([{ kind: "x", url: normalizeLink("x", "instagram.com/sam") }])[0], /not x\.com/, "the wrong site is still caught");
  assert.match(linkIssues([{ kind: "website", url: normalizeLink("website", "javascript:alert(1)") }])[0], /https/);
  assert.match(linkIssues([{ kind: "mastodon", url: normalizeLink("mastodon", "sam") }])[0], /not a web address/);
  assert.equal(normalizeLink("x", "  "), "");
  assert.equal(normalizeLink("x", null), "");
  for (const [kind, raw] of [["x", "@sam"], ["instagram", "sam"], ["tiktok", "@sam"], ["threads", "sam"], ["bluesky", "@sam.bsky.social"]])
    assert.deepEqual(linkIssues([{ kind, url: normalizeLink(kind, raw) }]), [], `${kind} ${raw}`);
});

test("profileMissing lists what the public header still lacks; links: [] counts as answered", () => {
  assert.deepEqual(profileMissing({}), ["ownerName", "about", "links"]);
  assert.deepEqual(profileMissing({ ownerName: "Sam", about: { en: " " }, links: [] }), ["about"]);
  assert.deepEqual(profileMissing({ ownerName: "Sam", about: { en: "Why." }, links: [{ kind: "x", url: "https://x.com/sam" }] }), []);
});

test("about is checked like every public text: each language, the voice rules and a word cap", () => {
  const state = (about) => ({ meta: { mode: "building", languages: ["en", "es"], about }, loops: [], experiments: [] });
  assert.deepEqual(validate(state({ en: "I want my evenings back.", es: "Quiero recuperar mis noches." })), []);
  assert.match(validate(state({ en: "I want my evenings back." }))[0].message, /missing in es/);
  assert.ok(validate(state({ en: "Back!", es: "Ya." })).some((v) => /exclamation/.test(v.message)));
  const long = Array(41).fill("word").join(" ");
  assert.ok(validate(state({ en: long, es: "Ya." })).some((v) => /41 words/.test(v.message)));
});

test("public view hides private fields and unpublished partner loops", async () => {
  const view = publicView(await seed());
  assert.deepEqual(checkPublic(view), []);
  const json = JSON.stringify(view);
  for (const field of ["evidence", "peopleInvolved", "notes", "pending"]) assert.ok(!json.includes(`"${field}"`), `${field} leaked`);
  const parPrivate = view.loops.filter((l) => l.code.startsWith("R-PAR-") && l.private);
  assert.ok(parPrivate.length > 0);
  for (const l of parPrivate) assert.equal(l.name, undefined);
  const c = view.loops.find((l) => l.code.startsWith("C-"));
  assert.equal(c.estimate, undefined, "company figures stay private by default");
});

test("public activity keeps allowed events on visible codes, with no ids, names, clocks or undone steps", async () => {
  const view = publicView(await seed());
  const pub = view.loops.find((l) => !l.private).code;
  const priv = view.loops.find((l) => l.private).code;
  const exp = view.experiments[0].code;
  const events = [
    { id: 10, at: "2026-10-12T23:02:11.000Z", actor: "claude", tool: "close_stage_try", target: exp, result: "achieved" },
    { id: 9, at: "2026-10-12T22:00:00.000Z", actor: "owner", tool: "approve_loops", target: `${pub},${priv},X-OLD-01` },
    { id: 8, at: "2026-10-12T21:00:00.000Z", actor: "owner", tool: "approve_loops", target: priv },
    { id: 7, at: "2026-10-11T10:00:00.000Z", actor: "owner", tool: "reject_text", target: pub },
    { id: 6, at: "2026-10-11T09:30:00.000Z", actor: "claude", tool: "propose_loops", target: pub },
    { id: 5, at: "2026-10-11T09:00:00.000Z", actor: "owner", tool: "undo_event", target: exp, undid: 4 },
    { id: 4, at: "2026-10-11T08:00:00.000Z", actor: "claude", tool: "register_stage_try", target: exp },
    { id: 3, at: "2026-10-10T08:00:00.000Z", actor: "owner", tool: "override:record_hold", target: exp, result: "not a result" },
    { id: 2, at: "2026-10-09T08:00:00.000Z", actor: "system", tool: "adopt_protocol", target: "meta" },
    { id: 1, at: "2026-10-08T08:00:00.000Z", actor: "owner", tool: "approve_text", target: `${exp}#1.1,${priv}` },
  ];
  const items = publicActivity(events, view);
  assert.deepEqual(items, [
    { day: "2026-10-12", tool: "close_stage_try", codes: [exp], by: "agent", result: "achieved" },
    { day: "2026-10-12", tool: "approve_loops", codes: [pub], by: "owner" },
    { day: "2026-10-10", tool: "record_hold", codes: [exp], by: "owner" },
    { day: "2026-10-09", tool: "adopt_protocol", codes: [], by: "system" },
    { day: "2026-10-08", tool: "approve_text", codes: [exp], by: "owner" },
  ]);
  assert.ok(!JSON.stringify(items).includes("claude"));
});

test("public view credits the protocol and its author", async () => {
  const { attribution } = publicView(await seed());
  assert.equal(attribution.text, "Onhundred Protocol by Ale Sánchez");
  assert.equal(attribution.url, "https://onhundred.com");
  assert.equal(attribution.license, "CC BY 4.0");
});

test("frozen inventory needs exactly 100 loops", async () => {
  const state = await seed();
  state.loops.pop();
  assert.ok(validate(state).some((v) => v.rule === "count"));
});

test("a level above the ceiling is rejected", async () => {
  const state = await seed();
  const kid = state.loops.find((l) => l.code.startsWith("R-KID-"));
  kid.level = "delegated";
  assert.ok(validate(state).some((v) => v.target === kid.code));
});

test("names: 8 words at most, no failing verbs", () => {
  assert.ok(nameIssues("Remember to call the dentist", "en").length > 0);
  assert.ok(nameIssues("Book one two three four five six seven eight", "en").length > 0);
  assert.deepEqual(nameIssues("Book the dentist", "en"), []);
});

test("decide and choose fail from v1.1, and still pass on a v1.0 log", async () => {
  assert.match(nameIssues("Decide what's for dinner", "en", "1.1")[0], /failing verb \(decide\)/);
  assert.match(nameIssues("Choose the school", "en", "1.1")[0], /failing verb \(choose\)/);
  assert.deepEqual(nameIssues("Decide what's for dinner", "en", "1.0"), []);
  const state = await seed();
  state.loops[0].name.en = "Decide where to eat";
  assert.ok(validate(state).some((v) => v.rule === "name" && v.target === state.loops[0].code));
  state.meta.protocolVersion = "1.0";
  assert.ok(!validate(state).some((v) => v.rule === "name"));
});

test("the change note shows for 1 cycle after adoption", () => {
  const change = { at: "2026-10-12", until: "2026-10-26" };
  assert.equal(changeIsCurrent(change, "2026-10-12"), true);
  assert.equal(changeIsCurrent(change, "2026-10-25"), true);
  assert.equal(changeIsCurrent(change, "2026-10-26"), false);
  assert.equal(changeIsCurrent(undefined, "2026-10-12"), false);
});

test("public view carries the protocol change, and the seed runs the current version", async () => {
  const state = await seed();
  assert.equal(state.meta.protocolVersion, P.version);
  state.meta.protocolChange = { from: "1.0", to: "1.1", at: "2026-10-12", cycle: 0, until: "2026-10-26", delegatedBefore: 7, delegatedAfter: 8, by: "x" };
  const view = publicView(state);
  assert.deepEqual(view.protocolChange, { from: "1.0", to: "1.1", at: "2026-10-12", cycle: 0, until: "2026-10-26", delegatedBefore: 7, delegatedAfter: 8 });
});

test("the schema only ever adds: no DROP, no RENAME", () => {
  for (const s of STATEMENTS) assert.ok(!/\b(DROP|RENAME)\b/i.test(s), `not additive: ${s.slice(0, 60)}`);
  assert.ok(migrationSql().includes(`'protocolVersion', '"${P.version}"'`), "fresh installs start at the current version");
});

test("voice: em-dashes, exclamation marks and retired words", () => {
  assert.ok(voiceIssues("Done — finally", "en").length > 0);
  assert.ok(voiceIssues("Done!", "en").length > 0);
  assert.ok(voiceIssues("Run the weekly task", "en").length > 0);
  assert.deepEqual(voiceIssues("Pay the rent on time", "en"), []);
});

test("scope: optional, capped at 60 words, every language, public when published", async () => {
  assert.ok(scopeIssues(Array(61).fill("word").join(" ")).length > 0);
  assert.deepEqual(scopeIssues("Covers Friday nights. Birthday gifts are another loop."), []);
  const state = await seed();
  const published = state.loops.find((l) => l.code === "R-PAR-01");
  assert.ok(published.scope?.en && published.scope?.es);
  const view = publicView(state);
  assert.equal(view.loops.find((l) => l.code === "R-PAR-01").scope.en, published.scope.en);
  const privateLoop = view.loops.find((l) => l.code === "R-PAR-02");
  assert.equal(privateLoop.private, true);
  assert.equal(privateLoop.scope, undefined);
  published.scope = { en: "Only English." };
  assert.ok(validate(state).some((v) => v.rule === "text" && /scope.*es/.test(v.message)));
  published.scope = { en: Array(61).fill("word").join(" "), es: "Cubre las noches de viernes." };
  assert.ok(validate(state).some((v) => v.rule === "scope" && /60 or fewer/.test(v.message)));
  published.scope = { en: "Covers Friday nights — and then some.", es: "Cubre las noches de viernes." };
  assert.ok(validate(state).some((v) => v.rule === "voice" && /scope/.test(v.message)));
});

test("a write may not add violations, and may repair one at a time", () => {
  const a = [{ message: "x" }];
  assert.equal(compareViolations(a, [{ message: "x" }, { message: "y" }]).ok, false);
  assert.equal(compareViolations(a, []).ok, true);
  assert.equal(compareViolations(a, [{ message: "z" }]).ok, true);
});

test("each migration file matches the schema version the Worker applies", async () => {
  for (const [file, version] of [["0001_init.sql", 1], ["0002_cards.sql", 2]]) {
    const sql = await readFile(new URL(`../migrations/${file}`, import.meta.url), "utf8");
    assert.ok(sql.endsWith(migrationSql(version)), `${file}: run the schema generator again: the migration and schema.mjs differ`);
  }
  assert.ok(STATEMENTS.some((s) => s.includes("CREATE TABLE IF NOT EXISTS cards")));
  assert.ok(STATEMENTS.some((s) => s.includes("CREATE TABLE IF NOT EXISTS nudge_activity")));
});

test("gridChange always says where the grid stands, and a delta only when a level moved", async () => {
  const before = await seed();
  const renamed = structuredClone(before);
  renamed.loops[0].name = { ...renamed.loops[0].name, en: "Another name" };
  const same = gridChange(before, renamed);
  assert.equal(same.delta, null);
  assert.deepEqual(same.now, { delegated: 8.5, stillPct: 91.5, levels: derive(before).metrics.counts });

  const after = structuredClone(before);
  const target = after.loops.find((l) => l.level === "still" && !l.retired && !l.proposed);
  target.level = "delegated";
  const { now, delta } = gridChange(before, after);
  assert.equal(now.delegated, 9.5);
  assert.deepEqual(delta.levels, { still: -1, delegated: 1 });
  assert.deepEqual(delta.moved, [{ code: target.code, from: "still", to: "delegated" }]);
  assert.deepEqual(delta.delegated, { before: 8.5, after: 9.5 });
  assert.equal(delta.summary, `Handed off went from 8.5 to 9.5 of 100. ${target.code} moved from Still yours to Do it, I approve.`);
});

test("grid renders every active loop once", async () => {
  const view = publicView(await seed());
  const { html } = renderGrid(view, { labels: { areas: { relationships: "R", personal: "P", company: "C" }, private: "Private loop" } });
  assert.equal(html.match(/class="cell"/g).length, 100);
  assert.ok(!html.includes("<script"));
});

// ---------------------------------------------------------------------------
// Nudges, check-ins and moments

const NOW = "2026-10-09T12:00:00.000Z";
const loopOf = (code, level = "still", extra = {}) => ({
  code,
  level,
  name: { en: `Handle ${code.toLowerCase()}` },
  doneWhen: { en: "It is done outside my head" },
  estimate: { howOften: "weekly", hoursPerWeek: 1 },
  ...extra,
});
const building = () => ({
  meta: { mode: "building", languages: ["en"], cycle: 0, day: 0, protocolVersion: P.version },
  loops: [loopOf("P-HOM-01"), loopOf("P-HOM-02")],
  experiments: [],
});
const kindsOf = (list) => [...new Set(list.map((n) => n.kind))];
const shownRow = (n, at, extra = {}) => ({ nudge_id: n.id, kind: n.kind, about: n.about, event: "shown", at, ...extra });
const hoursBefore = (h) => new Date(Date.parse(NOW) - h * 3600000).toISOString();

test("checkInWindow: from day 13 of a period to day 3 of the next", () => {
  const w = (cycle, day) => checkInWindow({ cycle, day });
  assert.equal(w(2, 12), null);
  assert.equal(w(2, 13), 2);
  assert.equal(w(2, 14), 2);
  assert.equal(w(3, 1), 2);
  assert.equal(w(3, 3), 2);
  assert.equal(w(3, 4), null);
  assert.equal(w(1, 1), null, "no check-in before the first period ends");
  assert.equal(checkInDue({ cycle: 2, day: 13, checkIns: [{ cycle: 2 }] }, NOW), null, "once per period");
  assert.equal(checkInDue({ cycle: 2, day: 13, pausedUntil: "2026-10-20" }, NOW), null, "never while paused");
});

test("nudges while building: gap questions first, list progress, never a pick challenge", () => {
  const list = nudges(building(), [], NOW);
  assert.equal(list[0].kind, "gaps");
  assert.equal(list[0].type, "question");
  assert.ok(list.some((n) => n.about === "R" && n.ask.example.includes("partner")));
  assert.ok(list.some((n) => n.about === "C" && n.ask.example.includes("working")));
  assert.ok(list.some((n) => n.kind === "listSize" && n.facts.loops === 2 && n.facts.target === 10));
  assert.ok(!list.some((n) => ["pastDeadline", "stuckPick", "emptyPick", "aimHigher", "noHardPick", "safeBet", "funEmpty"].includes(n.kind)));
  assert.ok(!list.some((n) => n.about === "P-HLT"), "health is never asked about");
  for (const n of list) {
    assert.ok(n.id && n.why && n.facts && n.move, `${n.id} has its facts and move`);
    assert.deepEqual(n.outs.map((o) => o.answer), ["took", "not_now", "pause", "stop"]);
  }
});

test("nudges: each question kind turns off on its own", () => {
  const s = building();
  s.meta.questions = { gaps: false, personal: true, romantic: true };
  const list = nudges(s, [], NOW);
  assert.ok(!kindsOf(list).includes("gaps"));
  assert.ok(kindsOf(list).includes("personal"));
  s.meta.questions = { gaps: false, personal: false, romantic: false };
  assert.deepEqual(nudges(s, [], NOW).filter((n) => n.type === "question"), []);
});

test("nudges after freezing: each challenge level adds its kinds, and off stops them", async () => {
  const s = await seed();
  s.experiments.find((e) => e.code === "EXP-07").odds = 75;
  const at = (level) => {
    s.meta.challenge = level;
    s.meta.questions = { gaps: false, personal: false, romantic: false };
    return kindsOf(nudges(s, [], NOW));
  };
  const gentle = at("gentle");
  const normal = at("normal");
  const bold = at("bold");
  assert.ok(gentle.every((k) => ["pastDeadline", "stuckPick", "emptyPick"].includes(k)), gentle.join());
  assert.ok(normal.every((k) => [...gentle, "pastDeadline", "stuckPick", "emptyPick", "aimHigher", "noHardPick"].includes(k)), normal.join());
  assert.ok(!normal.includes("safeBet"));
  assert.ok(bold.includes("safeBet"), "a bet with odds of 70 or more is too safe on bold");
  assert.deepEqual(at("off"), []);
  assert.ok(!kindsOf(nudges(s, [], NOW)).includes("listSize"), "no list progress once frozen");
});

test("nudges budget: counted by showings, a 24-hour cooldown and 3 per check-in period", async () => {
  const s = building();
  const [first, second] = nudges(s, [], NOW);
  assert.deepEqual(nudges(s, [shownRow(first, hoursBefore(2))], NOW), [], "24-hour cooldown");
  const later = nudges(s, [shownRow(first, hoursBefore(30))], NOW);
  assert.ok(later.length && !later.some((n) => n.id === first.id), "a nudge shown this period isn't repeated");
  const three = [first, second, later[0]].map((n, i) => shownRow(n, hoursBefore(30 + i * 30)));
  assert.deepEqual(nudges(s, three, NOW), [], "at most 3 per period");
});

test("nudges: 2 not-now answers in a row silence that kind, and silence after 24 hours counts as not now", () => {
  const s = building();
  const gaps = nudges(s, [], NOW).filter((n) => n.kind === "gaps");
  const rows = [
    shownRow(gaps[0], hoursBefore(80)),
    { nudge_id: gaps[0].id, kind: "gaps", event: "answered", answer: "not_now", at: hoursBefore(79) },
    shownRow(gaps[1], hoursBefore(50)),
  ];
  const list = nudges(s, rows, NOW);
  assert.ok(list.length > 0);
  assert.ok(!kindsOf(list).includes("gaps"));
  const took = [...rows.slice(0, 2), shownRow(gaps[1], hoursBefore(50)), { nudge_id: gaps[1].id, kind: "gaps", event: "answered", answer: "took", at: hoursBefore(49) }];
  assert.ok(kindsOf(nudges(s, took, NOW)).includes("gaps"));
});

test("nudges: a pause hides everything until pausedUntil, and a due check-in holds questions back", () => {
  const s = building();
  s.meta.pausedUntil = "2026-10-20";
  assert.deepEqual(nudges(s, [], NOW), []);
  s.meta.pausedUntil = "2026-10-08";
  assert.ok(nudges(s, [], NOW).length > 0, "the pause ends by itself");
  Object.assign(s.meta, { pausedUntil: null, cycle: 2, day: 13 });
  assert.ok(!nudges(s, [], NOW).some((n) => n.type === "question"));
});

test("moments: each kind, and the biggest one wins when a write sets off several", () => {
  const base = { meta: { mode: "frozen", languages: ["en"], cycle: 3, day: 5, protocolVersion: P.version }, loops: [loopOf("P-FIN-01"), loopOf("P-FIN-02")], experiments: [] };
  const exp = { code: "EXP-01", slot: "easy", loops: ["P-FIN-01"], question: { en: "Can it pay?" }, hypothesis: { en: "If it pays, then fine, because yes." }, odds: 50, stages: [] };
  base.experiments.push(exp);
  const after = structuredClone(base);
  after.loops[0].level = "assisted";
  const held = moments(base, after, "record_hold", { experiment: "EXP-01", hold: "passed", moved: ["P-FIN-01"] });
  assert.deepEqual(held.map((m) => m.moment), ["firstGreen", "itHeld"]);
  assert.deepEqual(held[0], { moment: "firstGreen", kind: "congratulate", page: "loop", target: "P-FIN-01" });

  const building_ = structuredClone(base);
  building_.meta.mode = "building";
  assert.deepEqual(moments(building_, base, "freeze_inventory").map((m) => m.moment), ["listDone"]);
  assert.deepEqual(moments(base, base, "conclude_experiment", { experiment: "EXP-01", conclusion: { hypothesis: "refuted" } }).map((m) => [m.moment, m.page, m.target]), [["wrongBet", "exp", "EXP-01"]]);
  assert.deepEqual(moments(base, base, "close_stage_try", { experiment: "EXP-01", outcome: "notAchieved" })[0].kind, "honest");
  const checked = structuredClone(base);
  checked.meta.checkIns = [{ cycle: 3, at: NOW, by: "get_check_in" }];
  assert.deepEqual(moments(base, checked, "mark_check_in").map((m) => [m.moment, m.page]), [["checkIn", "home"]]);

  const nine = { ...structuredClone(base), loops: Array.from({ length: 10 }, (_, i) => loopOf(`P-FIN-${String(i + 1).padStart(2, "0")}`, i < 9 ? "delegated" : "still")) };
  const ten = structuredClone(nine);
  ten.loops[9].level = "autonomous";
  assert.deepEqual(moments(nine, ten, "record_hold", { hold: "passed" }).map((m) => m.moment), ["tenOfTen", "firstAlone", "itHeld"]);
});

test("cardFacts: only what the public page shows; no card while an unpublished partner loop is involved", async () => {
  const s = await seed();
  const priv = s.loops.find((l) => l.code === "R-PAR-02");
  priv.level = "assisted";
  assert.deepEqual(cardFacts(s, "firstGreen", "R-PAR-02"), { none: "partner hasn't agreed to publish" });
  const facts = cardFacts(s, "itHeld", "P-FIN-01").facts;
  assert.equal(facts.loop.code, "P-FIN-01");
  assert.equal(facts.loop.hours.source, "estimated");
  const text = JSON.stringify(cardFacts(s, "wrongBet", "EXP-02"));
  for (const field of ["evidence", "peopleInvolved", "notes", "reason"]) assert.ok(!text.includes(`"${field}"`), `${field} never reaches a card`);
  const waiting = structuredClone(s);
  const e = waiting.experiments.find((x) => x.code === "EXP-08");
  e.pending = { question: e.question };
  delete e.question;
  assert.deepEqual(cardFacts(waiting, "roundMissed", "EXP-08"), { waiting: ["EXP-08 question"] });
  assert.match(cardHeadline(facts, 0, "en"), /\S/);
  assert.match(cardHeadline(facts, 0, "es"), /\S/);
});

test("moments: a bet card when an experiment's first round starts, not on later rounds or retries", () => {
  const s = { meta: { mode: "frozen", languages: ["en"] }, loops: [loopOf("P-FIN-01")], experiments: [] };
  assert.deepEqual(moments(s, s, "register_stage_try", { experiment: "EXP-01", stage: 1, try: 1 }).map((m) => [m.moment, m.kind, m.page]), [["betPlaced", "challenge", "exp"]]);
  assert.deepEqual(moments(s, s, "register_stage_try", { experiment: "EXP-01", stage: 1, try: 2 }), []);
  assert.deepEqual(moments(s, s, "register_stage_try", { experiment: "EXP-01", stage: 2, try: 1 }), []);
});

test("cardFacts tiles: 10 public loops, the latest activity first, the moment's loop always in, positions in start order", async () => {
  const s = await seed();
  const facts = cardFacts(s, "checkIn").facts;
  assert.equal(facts.tiles.length, 10);
  const priv = new Set(s.loops.filter((l) => l.code.startsWith("R-PAR") && !l.published).map((l) => l.code));
  assert.ok(facts.tiles.every((t) => !priv.has(t.code) && t.name), "no private loop on a card");
  assert.equal(facts.done, facts.tiles.filter((t) => ["delegated", "autonomous"].includes(t.level)).length);
  const hours = facts.tiles.filter((t) => ["delegated", "autonomous"].includes(t.level) && t.hours != null).reduce((a, t) => a + t.hours, 0);
  assert.deepEqual(facts.hoursBack, { perWeek: Math.round(hours * 10) / 10, source: "estimated" });

  const quiet = s.loops.find((l) => l.level === "still" && !s.experiments.some((e) => e.loops.includes(l.code)) && !priv.has(l.code));
  quiet.level = "assisted";
  const own = cardFacts(s, "firstGreen", quiet.code).facts;
  assert.ok(own.tiles.some((t) => t.code === quiet.code), "the moment's loop is always on its card");
  assert.equal(own.loop.position, own.tiles.findIndex((t) => t.code === quiet.code) + 1);

  const fresh = { ...structuredClone(s), experiments: [] };
  for (const l of fresh.loops) l.level = "still";
  const list = cardFacts(fresh, "listDone").facts;
  const byHours = (t) => t.hours ?? -1;
  assert.ok(list.tiles.every((t, i) => i === 0 || byHours(list.tiles[i - 1]) >= byHours(t)), "a new list shows the loops with the most hours");
  assert.equal(list.done, 0);
  assert.equal(list.hoursBack, undefined);
});

test("cardHeadline: starred words are the accent on the image and never reach plain text", async () => {
  const s = await seed();
  const facts = cardFacts(s, "checkIn").facts;
  const parts = cardHeadlineParts({ ...facts, moment: "listDone" }, 0, "en");
  assert.ok(parts.some((p) => p.accent) && parts.some((p) => !p.accent));
  const plain = cardHeadline({ ...facts, moment: "listDone" }, 0, "es");
  assert.ok(!plain.includes("*") && plain.includes(String(facts.tiles.length)));
  for (const [moment, list] of Object.entries(P.cards.headlines))
    for (const h of list) for (const lang of ["en", "es"]) assert.equal((h[lang].match(/\*/g) || []).length % 2, 0, `${moment}: stars come in pairs`);
});
