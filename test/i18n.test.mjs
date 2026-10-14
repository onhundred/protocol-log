import assert from "node:assert/strict";
import { test } from "node:test";
import { voiceIssues } from "../lib/protocol.mjs";
import { UI_LANGUAGES, WORDS, plural, t } from "../src/i18n.mjs";

// Every leaf as [path, value]: arrays and objects open up, functions and strings are leaves.
const leaves = (v, path = "") =>
  v && typeof v === "object"
    ? Object.entries(v).flatMap(([k, x]) => leaves(x, path ? `${path}.${k}` : k))
    : [[path, v]];

// What a leaf reads like with placeholder arguments, so the voice check sees every branch's text.
const texts = (v) => {
  if (typeof v !== "function") return [v];
  return [1, 2].flatMap((n) => [v(...Array.from({ length: v.length }, (_, i) => (i === 0 ? n : "x")))]).flat();
};

test("i18n: every language has the same keys, with the same kind of value and arguments", () => {
  const shape = (lang) => leaves(WORDS[lang]).map(([k, v]) => `${k}:${typeof v}${typeof v === "function" ? v.length : ""}`).sort();
  for (const lang of UI_LANGUAGES) assert.deepEqual(shape(lang), shape("en"), `${lang} doesn't match en`);
});

test("i18n: Spanish words follow VOICE.md: no em-dash, no exclamation marks, no hype or guilt", () => {
  const bad = leaves(WORDS.es)
    .flatMap(([k, v]) => texts(v).map((s) => [k, s]))
    .flatMap(([k, s]) => voiceIssues(String(s), "es").filter((i) => !i.includes("retired word")).map((i) => `${k}: ${i}`));
  assert.deepEqual(bad, []);
});

test("i18n: t() fills arguments, falls back to English, and refuses unknown keys", () => {
  assert.equal(t("es", "loop.showAll", 12), "VER LOS 12");
  assert.equal(t("en", "loop.showAll", 12), "SHOW ALL 12");
  assert.equal(t("fr", "nav.log"), "LOG");
  assert.equal(t("es", "exp.pick", "easy"), "ELECCIÓN FÁCIL");
  assert.throws(() => t("es", "nope.nothing"), /No words for nope.nothing/);
  assert.equal(plural("es", 1, "cambio", "cambios"), "cambio");
  assert.equal(plural("es", 0, "cambio", "cambios"), "cambios");
});
