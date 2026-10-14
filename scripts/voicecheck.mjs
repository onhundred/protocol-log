// Enforces VOICE.md rule zero (plain English) in the documents this repo publishes:
// banned words, sentences over MAX_WORDS words, and sections above MAX_GRADE (Flesch-Kincaid).
// Usage: node scripts/voicecheck.mjs [--update] [FILE ...]. Exits 1 if anything new fails.
//
// Skipped: code, HTML tags, the Changelog section, and text between <!-- voice:skip --> and <!-- voice:end -->.
// scripts/voice-debt.json lists the sentences and sections that already failed when the check started.
// Each one passes until it is edited; edited or new text must pass. --update only removes fixed entries.
import { readFile, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
export const DEBT_FILE = join(root, "scripts", "voice-debt.json");
export const DOCUMENTS = ["README.md", "docs/protocol.md", "docs/LOOPS.md", "docs/VOICE.md", "docs/PLAYBOOK.md"];
export const MAX_WORDS = 20;
export const MAX_GRADE = 8;
// Below this a section is too short for a grade to mean anything.
const MIN_GRADE_WORDS = 60;

// [pattern, plain swap, flags]. Matched as whole words.
const BANNED = [
  ["inventor(y|ies)", "your list"],
  ["owners?", "you / the person running it"],
  ["participants?", "you / the person running it / employees"],
  ["(reference )?applications?", "run / Ale's own run"],
  ["branch(es)?", "part (of life)"],
  ["baselines?", "what it costs today"],
  ["timed", "measured"],
  ["occurrences?", "each time it happens"],
  ["triage", "score"],
  ["slots?", "pick"],
  ["stages?", "round"],
  ["holding( period)?", "proving it / prove it for 3 weeks"],
  ["flags?", "status"],
  ["ceilings?", "limit"],
  ["evals?", "goal"],
  ["success (tests?|criteri(a|on))", "goals"],
  ["hypothes[ie]s", "your bet"],
  ["cycles?", "the 2 weeks between check-ins"],
  ["assisted", "help me"],
  ["Delegated", "do it, I approve / handed off", "g"],
  ["autonomous", "do it alone"],
  ["parameters?", "number / setting"],
  ["metrics?", "number"],
  ["criteri(a|on)", "what counts / rule"],
  ["thresholds?", "minimum"],
  ["achieved", "passed"],
  ["terminated", "stopped"],
  ["pre-?regist(er|ered|ration)", "write it down before you start"],
  ["aggregated?", "total / combined"],
  ["comparability", "so results can be compared"],
  ["procedures?", "steps"],
  ["methodology", "method"],
  ["frameworks?", "method"],
  ["implement(s|ed|ing)?", "do"],
  ["utili[sz](e|es|ed|ing)", "use"],
  ["facilitat(e|es|ed|ing)", "help"],
  ["commenc(e|es|ed|ing)", "start"],
  ["iterat(e|es|ed|ing)", "try again"],
  ["optimi[sz](e|es|ed|ing)", "improve"],
  ["workflows?", "setup / steps"],
  ["stakeholders?", "the people involved"],
  ["subsequent(ly)?", "next / later"],
  ["prior", "before"],
  ["regarding", "about"],
  ["verifiable", "can be checked"],
  ["material harm", "real harm"],
  ["(un)?mapped", "still yours / measured"],
  ["leverag(e|es|ed|ing)", "use"],
  ["unlock(s|ed|ing)?", "(cut it)"],
  ["empower(s|ed|ing)?", "(cut it)"],
  ["revolutioni[sz]e", "(cut it)"],
  ["game-?changer", "(cut it)"],
  ["seamless(ly)?", "(cut it)"],
  ["cutting-edge", "(cut it)"],
  ["supercharg(e|es|ed|ing)", "(cut it)"],
  ["journey", "(cut it)"],
  ["delve", "(cut it)"],
  ["robust", "(cut it)"],
  ["ai-powered", "(cut it)"],
  ["10x", "(cut it)"],
  ["in today's world", "(cut it)"],
  ["the future of work", "(cut it)"],
].map(([pattern, swap, flags = "gi"]) => ({ re: new RegExp(`\\b(?:${pattern})\\b`, flags), swap }));

const words = (s) => s.split(/\s+/).filter((w) => /[\p{L}\p{N}]/u.test(w));

function syllables(word) {
  const w = word.toLowerCase().replace(/[^a-z]/g, "");
  if (w.length <= 3) return 1;
  const groups = w.replace(/(?:[^laeiouy]es|ed|[^laeiouy]e)$/, "").replace(/^y/, "").match(/[aeiouy]{1,2}/g);
  return Math.max(1, groups?.length ?? 1);
}

// Flesch-Kincaid grade, or null when the section is too short to grade.
export function grade(sentences) {
  const all = sentences.flatMap(words);
  if (all.length < MIN_GRADE_WORDS) return null;
  const syl = all.reduce((n, w) => n + syllables(w), 0);
  return 0.39 * (all.length / sentences.length) + 11.8 * (syl / all.length) - 15.59;
}

// Inline code becomes CODE: it still counts as a word, but field names like `baseline` aren't flagged.
function plain(source) {
  return source
    .split(/^## (?:Changelog|What changed)\s*$/m)[0]
    .replace(/<!--\s*voice:skip\b[\s\S]*?-->[\s\S]*?(?:<!--\s*voice:end\s*-->|$)/g, "")
    .replace(/<!--[\s\S]*?-->/g, "")
    .replace(/^(```|~~~)[\s\S]*?^\1.*$/gm, "")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<[^>]+>/g, "")
    .replace(/!\[[^\]]*\]\([^)]*\)/g, "")
    .replace(/\[([^\]]*)\]\([^)]*\)/g, "$1")
    .replace(/`[^`\n]+`/g, "CODE")
    .replace(/\*\*|__/g, "");
}

function sections(source) {
  const out = [];
  let title = "top";
  for (const part of plain(source).split(/^(#{1,2} .*)$/m)) {
    if (/^#{1,2} /.test(part)) title = part.replace(/^#+\s*/, "").trim();
    else out.push({ title, text: part });
  }
  return out;
}

// Every line, list item and table cell is its own sentence or more.
function sentences(text) {
  return text
    .split("\n")
    .map((l) => l.trim().replace(/^(>\s*)+/, ""))
    .filter((l) => l && !/^\|?[\s:|-]+\|?$/.test(l) && !/^\[!\w+\]$/.test(l))
    .flatMap((l) => l.replace(/^(#{1,6}|[-*+]|\d+[.)])\s+/, "").replace(/^\[[ xX]\]\s+/, "").split("|"))
    .flatMap((cell) => cell.trim().replace(/^[*_\s]+|[*_\s]+$/g, "").split(/(?<=[.!?:;])\s+(?=[A-Z0-9"(])/))
    .map((s) => s.trim())
    .filter((s) => words(s).length);
}

export function checkText(source) {
  const found = { sentences: [], sections: [] };
  for (const { title, text } of sections(source)) {
    const sents = sentences(text);
    for (const s of sents) {
      const banned = BANNED.flatMap(({ re, swap }) => [...s.matchAll(re)].map((m) => `${m[0]} -> ${swap}`));
      const n = words(s).length;
      if (banned.length || n > MAX_WORDS) found.sentences.push({ text: s, banned, words: n });
    }
    const g = grade(sents);
    if (g !== null && g > MAX_GRADE) found.sections.push({ title, grade: Math.round(g * 10) / 10 });
  }
  return found;
}

export async function readDebt() {
  try {
    return JSON.parse(await readFile(DEBT_FILE, "utf8"));
  } catch {
    return {};
  }
}

// What fails and isn't in the debt list (fresh), and debt entries that now pass (fixed).
export async function checkFile(file, debt) {
  const found = checkText(await readFile(join(root, file), "utf8"));
  const owed = { sentences: new Set(debt[file]?.sentences), sections: new Set(debt[file]?.sections) };
  const failing = { sentences: new Set(found.sentences.map((s) => s.text)), sections: new Set(found.sections.map((s) => s.title)) };
  return {
    file,
    fresh: {
      sentences: found.sentences.filter((s) => !owed.sentences.has(s.text)),
      sections: found.sections.filter((s) => !owed.sections.has(s.title)),
    },
    kept: {
      sentences: [...owed.sentences].filter((s) => failing.sentences.has(s)),
      sections: [...owed.sections].filter((s) => failing.sections.has(s)),
    },
    fixed: [...owed.sentences].filter((s) => !failing.sentences.has(s)).length + [...owed.sections].filter((s) => !failing.sections.has(s)).length,
  };
}

export function report(results) {
  const lines = [];
  for (const { file, fresh } of results) {
    if (!fresh.sentences.length && !fresh.sections.length) continue;
    lines.push(file);
    for (const s of fresh.sections) lines.push(`  GRADE ${s.grade} > ${MAX_GRADE} in "${s.title}"`);
    for (const s of fresh.sentences) {
      lines.push(`  "${s.text.length > 140 ? s.text.slice(0, 140) + "..." : s.text}"`);
      for (const b of s.banned) lines.push(`    BANNED ${b}`);
      if (s.words > MAX_WORDS) lines.push(`    LONG ${s.words} words, ${MAX_WORDS} at most`);
    }
  }
  return lines.join("\n");
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const args = process.argv.slice(2);
  const update = args.includes("--update");
  const files = args.filter((a) => !a.startsWith("--"));
  const debt = await readDebt();
  const results = await Promise.all((files.length ? files : DOCUMENTS).map((f) => checkFile(f, debt)));
  const fixed = results.reduce((n, r) => n + r.fixed, 0);
  if (update && fixed) {
    for (const r of results) debt[r.file] = r.kept;
    await writeFile(DEBT_FILE, JSON.stringify(debt, null, 2) + "\n");
    console.log("removed", fixed, "fixed entries from scripts/voice-debt.json");
  } else if (fixed) {
    console.log(`${fixed} entries in scripts/voice-debt.json now pass. Run npm run voice -- --update to remove them.`);
  }
  const out = report(results);
  if (out) {
    console.log(out);
    console.log("\nRewrite these in plain English (VOICE.md, rule zero).");
    process.exit(1);
  }
  console.log("voice check passed:", results.map((r) => r.file).join(", "));
}
