import assert from "node:assert/strict";
import { test } from "node:test";
import { voiceIssues } from "../lib/protocol.mjs";
import P from "../protocol.json" with { type: "json" };
import { DOCUMENTS, MAX_GRADE, checkFile, checkText, readDebt, report } from "../scripts/voicecheck.mjs";

test("voice: the playbook is checked like every published document", async () => {
  assert.ok(DOCUMENTS.includes("docs/PLAYBOOK.md"));
  const out = report([await checkFile("docs/PLAYBOOK.md", {})]);
  assert.equal(out, "", out);
});

test("voice: agent text that guilts or hypes the reader is flagged, with the fix", () => {
  assert.ok(P.voice.guilt.includes("you haven't") && P.voice.guilt.includes("falling behind") && P.voice.guilt.includes("don't break"));
  assert.ok(P.voice.hype.includes("crushing it"));
  assert.match(voiceIssues("You haven't paid the rent", "en").join(" "), /guilts the reader/);
  assert.match(voiceIssues("You haven’t paid the rent", "en").join(" "), /guilts the reader/, "curly apostrophes count too");
  assert.match(voiceIssues("We're falling behind on bills", "en").join(" "), /guilts the reader/);
  assert.match(voiceIssues("Crushing it with the rent", "en").join(" "), /hype/);
  assert.deepEqual(voiceIssues("The rent was paid on time", "en"), []);
});

test("voice: every document passes, apart from the text listed in scripts/voice-debt.json", async () => {
  const debt = await readDebt();
  const out = report(await Promise.all(DOCUMENTS.map((f) => checkFile(f, debt))));
  assert.equal(out, "", `${out}\n\nRewrite these in plain English, or run npm run voice for details.`);
});

test("voice: banned words come with their plain swap; Delegated only as the level name", () => {
  const [s] = checkText("Build the inventory before the first cycle.").sentences;
  assert.deepEqual(s.banned, ["inventory -> your list", "cycle -> the 2 weeks between check-ins"]);
  assert.equal(checkText("Delegated loops count 1.").sentences.length, 1);
  assert.equal(checkText("I delegated it.").sentences.length, 0);
  assert.equal(checkText("Pay the rent on time.").sentences.length, 0);
});

test("voice: sentences over 20 words fail, one sentence at a time", () => {
  const long = "You write down what it costs today so you can later prove the agent saved you time and money on every loop.";
  assert.equal(checkText(long).sentences[0].words, 22);
  assert.equal(checkText("You write it down. You prove it later.").sentences.length, 0);
});

test("voice: code, skipped blocks and the Changelog are exempt", () => {
  const doc = [
    "Set `baseline` in the seed.",
    "```json\n{ \"triage\": 3 }\n```",
    "<!-- voice:skip: a word list -->\n| Inventory | Your list |\n<!-- voice:end -->",
    "## Changelog",
    "- Renamed the inventory.",
  ].join("\n\n");
  assert.deepEqual(checkText(doc).sentences, []);
});

test("voice: sections above an 8th-grade level fail", () => {
  const dense =
    "Organizational implementations necessitate comprehensive documentation. Institutional accountability requires continuous verification. ".repeat(8);
  const [section] = checkText(`## Dense\n\n${dense}`).sections;
  assert.equal(section.title, "Dense");
  assert.ok(section.grade > MAX_GRADE);
  assert.deepEqual(checkText(`## Plain\n\n${"You pick a loop. You try it for 2 weeks. ".repeat(8)}`).sections, []);
});
