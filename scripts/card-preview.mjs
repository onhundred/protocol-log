// Draws every share card from the sample log into HTML files, to look at layouts without a deployed log.
// Usage: node scripts/card-preview.mjs [outDir] [lang]. Then serve outDir (npx serve outDir) and open index.html.
import { cp, mkdir, readFile, writeFile } from "node:fs/promises";
import { cardFacts } from "../lib/protocol.mjs";
import { cardRenderPage } from "../src/card-render.mjs";
import { SIZES } from "../src/cards.mjs";

const out = process.argv[2] || "/tmp/onhundred-cards";
const lang = process.argv[3] || "en";
const root = new URL("../", import.meta.url);
const read = async (f) => JSON.parse(await readFile(new URL(`seed/${f}`, root), "utf8"));
const seed = async () => ({ meta: await read("log.json"), loops: await read("loops.json"), experiments: await read("experiments.json") });
const DAY = 86400000;
const iso = (offset) => new Date(Date.now() + offset * DAY).toISOString().slice(0, 10);

// Sample moments: the seed log, bent a little where a moment needs an earlier or later state.
async function samples() {
  const s = await seed();
  const fresh = structuredClone(s);
  fresh.experiments = [];
  for (const l of fresh.loops) l.level = "still";

  const green = structuredClone(fresh);
  green.loops.find((l) => l.code === "P-FIN-01").level = "assisted";
  green.experiments = [structuredClone(s.experiments.find((e) => e.code === "EXP-01"))];
  green.experiments[0].stages = green.experiments[0].stages.slice(0, 1);
  delete green.experiments[0].conclusion;

  const bet = structuredClone(s);
  const exp7 = bet.experiments.find((e) => e.code === "EXP-07");
  exp7.stages = [{ ...exp7.stages[0], start: iso(-5), deadline: iso(9), outcome: undefined, closedAt: undefined }];

  const wrong = structuredClone(s);
  wrong.experiments.find((e) => e.code === "EXP-02").stages.at(-1).learned = {
    en: "Investors want my voice. An agent can draft the numbers, not the story.",
    es: "Los inversores quieren mi voz. Un agente puede armar los números, no la historia.",
  };

  const ten = structuredClone(s);
  const tiles = cardFacts(ten, "checkIn").facts.tiles.map((t) => t.code);
  for (const l of ten.loops) if (tiles.includes(l.code) && l.level !== "autonomous") l.level = "delegated";

  const alone = s.loops.find((l) => l.level === "autonomous").code;
  return [
    ["listDone", fresh, null],
    ["betPlaced", bet, "EXP-07"],
    ["itHeld", s, "P-FIN-01"],
    ["firstGreen", green, "P-FIN-01"],
    ["firstAlone", s, alone],
    ["wrongBet", wrong, "EXP-02"],
    ["roundMissed", s, "EXP-04"],
    ["checkIn", s, null],
    ["tenOfTen", ten, null],
  ];
}

await mkdir(out, { recursive: true });
await cp(new URL("public/fonts", root), `${out}/fonts`, { recursive: true });
await cp(new URL("public/wordmark.svg", root), `${out}/wordmark.svg`);
const files = [];
for (const [moment, state, target] of await samples()) {
  const r = cardFacts(state, moment, target);
  if (!r.facts) throw new Error(`${moment}: ${JSON.stringify(r)}`);
  for (const size of Object.keys(SIZES)) {
    const file = `${moment}-${size}.html`;
    const page = cardRenderPage({ card: { facts: r.facts, headline: 0 }, size, lang, dims: SIZES[size], assets: "." });
    await writeFile(`${out}/${file}`, page);
    files.push({ moment, size, file });
  }
}

const scale = { og: 0.36, square: 0.4, tall: 0.225 };
const frame = ({ size, file, moment }) => {
  const [w, h] = SIZES[size];
  return `<figure><div style="width:${w * scale[size]}px;height:${h * scale[size]}px;overflow:hidden"><iframe src="${file}" width="${w}" height="${h}" style="border:0;transform:scale(${scale[size]});transform-origin:0 0"></iframe></div><figcaption>${moment}</figcaption></figure>`;
};
const section = (size) => `<section id="${size}"><h2>${size} ${SIZES[size].join("×")}</h2><div class="grid">${files.filter((f) => f.size === size).map(frame).join("")}</div></section>`;
await writeFile(
  `${out}/index.html`,
  `<!doctype html><meta charset="utf-8"><title>Share cards</title><style>body{margin:0;padding:24px;background:#141513;color:#B4B8AE;font:13px ui-monospace,monospace}h2{margin:8px 0 12px;font-weight:500;letter-spacing:.1em;text-transform:uppercase}.grid{display:flex;flex-wrap:wrap;gap:16px}figure{margin:0}figcaption{margin-top:6px}section{margin-bottom:28px}</style>${Object.keys(SIZES).map(section).join("")}`
);
console.log("wrote", `${out}/index.html`);
