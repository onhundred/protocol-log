// The card image: a page at the exact size of the picture, opened only by the screenshot browser.
// Each moment has its own layout. Every word on it comes from the card's facts or the fixed labels below.
import { cardHeadlineParts, esc, levelName, pickText, protocol as P } from "../lib/protocol.mjs";

const HOLD_DAYS = P.limits.holdWeeks * 7;
const BAR_CELLS = 31;
const DAY = 86400000;

const WORDS = {
  en: {
    myList: "MY LIST · DAY 1",
    listSub: (n) => `The ${n} things that eat my week. One by one, an AI takes over. I'll share what works, and what doesn't.`,
    doneByAi: (d, n) => `${d} OF ${n} DONE BY AI`,
    loopOf: (p, n, name) => (p ? `LOOP ${p} OF ${n} · ${name}` : name),
    start: "START YOUR 10 · ONHUNDRED.COM",
    guess: "GUESS HOW IT ENDS · ONHUNDRED.COM",
    site: "ONHUNDRED.COM",
    placeBet: "PLACE YOUR BET",
    asOfToday: (name) => `As of today, an AI takes on: ${name}.`,
    holds: "It'll hold",
    fails: "It won't",
    day: "DAY",
    odds: (o) => `MY ODDS · ${o} IN 100`,
    itHeld: (d) => `IT HELD · ${d} OF ${d} DAYS`,
    next: {
      assisted: "It helps me now. Next step: it does it, I approve.",
      delegated: "I just approve. Next step: it does it alone.",
      autonomous: "It runs without me now.",
    },
    now: "NOW",
    firstGreen: "FIRST GREEN SQUARE",
    greenSub: "A round passed, then it kept working for 3 weeks. Now it counts.",
    alone: "DOES IT ALONE",
    aloneSub: "Level 4 of 4. It runs without me approving each step.",
    wrongBet: (code) => `${code} · WRONG BET`,
    myBet: "MY BET",
    tried: "WHAT WE TRIED",
    learned: "WHAT I LEARNED",
    roundOf: (code, r) => `${code} · ROUND ${r}`,
    question: "THE QUESTION",
    round: "ROUND",
    estimated: "ESTIMATED",
    hoursBack: ["hours", "a week", "back."],
    doneBy: ["done", "by AI."],
    checkIn: (c) => `CHECK-IN ${c}`,
    allSub: (n) => `All ${n} things that ate my week are now done by AI. Next: the rest of my life.`,
  },
  es: {
    myList: "MI LISTA · DÍA 1",
    listSub: (n) => `Las ${n} cosas que se comen mi semana. Una a una, una IA las toma. Voy a compartir lo que funciona, y lo que no.`,
    doneByAi: (d, n) => `${d} DE ${n} LOS HACE UNA IA`,
    loopOf: (p, n, name) => (p ? `LOOP ${p} DE ${n} · ${name}` : name),
    start: "EMPIEZA TUS 10 · ONHUNDRED.COM",
    guess: "ADIVINA CÓMO TERMINA · ONHUNDRED.COM",
    site: "ONHUNDRED.COM",
    placeBet: "HAZ TU APUESTA",
    asOfToday: (name) => `Desde hoy, una IA se encarga de: ${name}.`,
    holds: "Aguantará",
    fails: "No aguantará",
    day: "DÍA",
    odds: (o) => `MIS PROBABILIDADES · ${o} DE 100`,
    itHeld: (d) => `AGUANTÓ · ${d} DE ${d} DÍAS`,
    next: {
      assisted: "Ahora me ayuda. Siguiente paso: lo hace y yo apruebo.",
      delegated: "Solo apruebo. Siguiente paso: lo hace sola.",
      autonomous: "Ya corre sin mí.",
    },
    now: "AHORA",
    firstGreen: "PRIMER CUADRO VERDE",
    greenSub: "Pasó una ronda y siguió funcionando 3 semanas. Ahora cuenta.",
    alone: "LO HACE SOLA",
    aloneSub: "Nivel 4 de 4. Corre sin que yo apruebe cada paso.",
    wrongBet: (code) => `${code} · APUESTA FALLIDA`,
    myBet: "MI APUESTA",
    tried: "LO QUE PROBAMOS",
    learned: "LO QUE APRENDÍ",
    roundOf: (code, r) => `${code} · RONDA ${r}`,
    question: "LA PREGUNTA",
    round: "RONDA",
    estimated: "ESTIMADO",
    hoursBack: ["horas", "a la semana", "de vuelta."],
    doneBy: ["los hace", "una IA."],
    checkIn: (c) => `REVISIÓN ${c}`,
    allSub: (n) => `Las ${n} cosas que se comían mi semana ya las hace una IA. Siguiente: el resto de mi vida.`,
  },
};

const handed = (level) => level === "delegated" || level === "autonomous";

// Long headlines get a smaller size so they never run off the card.
const fit = (text) => {
  const n = text.length;
  return n <= 8 ? 2.4 : n <= 14 ? 1.6 : n <= 24 ? 1.25 : n <= 36 ? 1.05 : n <= 60 ? 0.9 : n <= 85 ? 0.74 : 0.6;
};

const headlineHtml = (parts) => parts.map((p) => (p.accent ? `<em>${esc(p.text)}</em>` : esc(p.text))).join("");

function tilesArt(tiles, lang, { highlight, compact } = {}) {
  if (!tiles.length) return "";
  const cells = tiles
    .map((t, i) => {
      const mark = t.code === highlight ? " is-now" : "";
      const name = compact ? "" : `<span class="tile-name">${esc(pickText(t.name, lang))}</span>`;
      return `<li class="tile lv-${esc(t.level)}${mark}"><span class="tile-num">${String(i + 1).padStart(2, "0")}</span>${name}</li>`;
    })
    .join("");
  return `<ol class="tiles${compact ? " compact" : ""}">${cells}</ol>`;
}

function stepsArt(level, lang, w) {
  const at = P.levels.indexOf(level);
  const bars = P.levels
    .map((l, i) => {
      const state = i === at ? "is-now" : i < at ? "is-past" : "is-next";
      return `<li class="step ${state}" style="--h:${28 + i * 24}%"><span class="bar">${i === at ? `<span class="now">${w.now}</span>` : ""}</span><span class="step-name">${esc(levelName(l, lang))}</span></li>`;
    })
    .join("");
  return `<ol class="steps">${bars}</ol>`;
}

function betArt(x, w, now) {
  const days = Math.max(1, x.days || 1);
  const elapsed = x.start ? Math.max(0, Math.min(days, Math.floor((now - Date.parse(x.start)) / DAY) + 1)) : 0;
  const cells = Math.min(days, BAR_CELLS);
  const filled = Math.round((elapsed / days) * cells);
  const bar = Array.from({ length: cells }, (_, i) => `<span class="cell${i < filled ? " on" : ""}"></span>`).join("");
  return `<div class="bet">
<div class="vote"><span class="yes">${esc(w.holds)}</span><span class="no">${esc(w.fails)}</span></div>
<div class="track"><div class="track-ends"><span>${w.day} 1</span>${x.odds != null ? `<span>${esc(w.odds(x.odds))}</span>` : ""}<span>${w.day} ${days}</span></div><div class="cells">${bar}</div></div>
</div>`;
}

function columnsArt(cols) {
  const shown = cols.filter((c) => c.text);
  if (!shown.length) return "";
  return `<div class="cols">${shown.map((c) => `<div><p class="label">${esc(c.label)}</p><p class="col-text">${esc(c.text)}</p></div>`).join("")}</div>`;
}

function roundsArt(x, w) {
  const at = x.round || 1;
  const boxes = Array.from({ length: P.limits.maxStages }, (_, i) => {
    const n = i + 1;
    const state = n < at ? "is-past" : n === at ? "is-missed" : "is-next";
    return `<li class="round ${state}"><span>${w.round} ${n}</span></li>`;
  }).join("");
  return `<ol class="rounds">${boxes}</ol>`;
}

function statHero(f, lang, w) {
  const n = f.tiles?.length || 0;
  if (f.hoursBack) {
    const value = f.hoursBack.perWeek.toLocaleString(lang === "es" ? "es" : "en", { maximumFractionDigits: 1 });
    return `<div class="stat"><b>${esc(value)}</b><span>${w.hoursBack.map(esc).join("<br>")}</span></div>`;
  }
  return `<div class="stat"><b>${f.done || 0}/${n}</b><span>${w.doneBy.map(esc).join("<br>")}</span></div>`;
}

// What each moment puts on its card. theme: dark, honest, paper or lime.
function layoutFor(f, lang, headline, now) {
  const w = WORDS[lang] || WORDS.en;
  const n = f.tiles?.length || 0;
  const tiles = f.tiles || [];
  const loop = f.loop || f.experiment?.loops?.[0];
  const loopName = pickText(loop?.name, lang);
  const position = f.loop?.position || f.experiment?.loops?.[0]?.position;
  const loopLine = w.loopOf(position, n, loopName);
  const doneLine = w.doneByAi(f.done || 0, n);
  const h1 = `<h1 style="--fit:${fit(headline.map((p) => p.text).join(""))}">${headlineHtml(headline)}</h1>`;
  const x = f.experiment || {};
  switch (f.moment) {
    case "listDone":
      return { theme: "dark", tag: w.myList, hero: h1, sub: w.listSub(n), art: tilesArt(tiles, lang), left: doneLine, right: w.start };
    case "betPlaced":
      return {
        theme: "dark",
        tag: w.placeBet,
        pill: true,
        kicker: `<p class="kicker">${esc(w.asOfToday(loopName))}</p>`,
        hero: h1,
        art: betArt(x, w, now),
        left: loopLine,
        right: w.guess,
      };
    case "itHeld":
      return { theme: "dark", tag: w.itHeld(HOLD_DAYS), pill: true, hero: h1, sub: w.next[loop?.level] || "", art: stepsArt(loop?.level, lang, w), left: loopLine, right: w.start };
    case "firstGreen":
      return { theme: "dark", tag: w.firstGreen, pill: true, hero: h1, sub: w.greenSub, art: tilesArt(tiles, lang, { highlight: loop?.code }), left: loopLine, right: w.start };
    case "firstAlone":
      return { theme: "dark", tag: w.alone, pill: true, hero: h1, sub: w.aloneSub, art: stepsArt("autonomous", lang, w), left: loopLine, right: w.start };
    case "wrongBet":
      return {
        theme: "honest",
        tag: w.wrongBet(x.code),
        pill: true,
        kicker: `<p class="label">${w.myBet}</p><p class="bet-line"><s>${esc(pickText(x.hypothesis, lang))}</s></p>`,
        hero: h1,
        art: columnsArt([
          { label: w.tried, text: x.approach },
          { label: w.learned, text: pickText(x.lesson, lang) },
        ]),
        left: loopLine,
        right: w.site,
      };
    case "roundMissed":
      return {
        theme: "honest",
        tag: w.roundOf(x.code, x.round || 1),
        pill: true,
        kicker: `<p class="label">${w.question}</p><p class="kicker">${esc(pickText(x.question, lang))}</p>`,
        hero: h1,
        art: `${roundsArt(x, w)}${columnsArt([{ label: w.tried, text: x.approach }])}`,
        left: loopLine,
        right: w.start,
      };
    case "checkIn":
      return {
        theme: "paper",
        tag: f.hoursBack ? w.estimated : w.checkIn(f.cycle),
        pill: true,
        hero: statHero(f, lang, w),
        sub: headline.map((p) => p.text).join(""),
        art: tilesArt(tiles, lang, { compact: true }),
        left: doneLine,
        right: w.start,
      };
    case "tenOfTen":
      return { theme: "lime", tag: w.checkIn(f.cycle), hero: h1, sub: w.allSub(n), art: tilesArt(tiles, lang), left: doneLine, right: w.start };
    default:
      return { theme: "dark", tag: "", hero: h1, left: doneLine, right: w.start };
  }
}

const STYLE = (w, h, size) => `
@font-face { font-family: "Card Sans"; src: url("/fonts/inter-tight.woff2") format("woff2"); font-weight: 100 900; font-display: block; }
@font-face { font-family: "Card Mono"; src: url("/fonts/jetbrains-mono.woff2") format("woff2"); font-weight: 400 800; font-display: block; }
* { box-sizing: border-box; }
html, body { margin: 0; padding: 0; width: ${w}px; height: ${h}px; overflow: hidden; background: #0A0A09; }
.card {
  --ink: #0A0A09; --bone: #E8E8E2; --faded: #B4B8AE; --grey: #8C9087; --rule: #3A3D37; --hair: #1F211E;
  --green: #C6F432; --orange: #FF9F5A;
  --bg: var(--ink); --fg: var(--bone); --soft: var(--faded); --muted: var(--grey); --accent: var(--green); --line: var(--rule);
  width: ${w}px; height: ${h}px; display: flex; flex-direction: column; gap: 1.1em;
  font: ${size === "og" ? 22 : size === "tall" ? 34 : 30}px/1.3 "Card Sans", "Helvetica Neue", Arial, sans-serif;
  padding: ${size === "tall" ? "3.4em 2.4em 2.6em" : size === "og" ? "1.9em 2.2em 1.6em" : "2em 2.1em 1.7em"};
  background: var(--bg); color: var(--fg); border: 2px solid var(--hair);
}
.t-honest { --accent: var(--orange); }
.t-paper { --bg: var(--bone); --fg: var(--ink); --soft: #3A3D37; --muted: #5C6058; --accent: var(--ink); --line: #B9BCB2; border-color: #D3D5CC; }
.t-lime { --bg: var(--green); --fg: var(--ink); --soft: #1F211E; --muted: #2E3A0A; --accent: var(--ink); --line: rgba(10, 10, 9, 0.35); border-color: var(--green); }
.top, .foot { display: flex; justify-content: space-between; align-items: center; gap: 1em; font: 500 0.56em/1 "Card Mono", ui-monospace, monospace; letter-spacing: 0.14em; text-transform: uppercase; }
.top { color: var(--muted); }
.mark { display: inline-flex; }
.mark img { display: block; height: 1.5em; width: auto; }
.t-paper .mark, .t-lime .mark { background: var(--ink); padding: 0.55em 0.7em; border-radius: 0.4em; }
.tag { white-space: nowrap; }
.pill { color: var(--accent); border: 2px solid var(--accent); border-radius: 999px; padding: 0.55em 1em; }
.t-paper .pill, .t-lime .pill { color: var(--fg); border-color: var(--fg); }
.body { flex: 1; min-height: 0; display: flex; flex-direction: column; gap: 1em; }
.s-og .body { display: grid; grid-template-columns: 1.1fr 1fr; gap: 1.6em; align-items: center; }
.s-og .body.solo { grid-template-columns: 1fr; }
.text { display: flex; flex-direction: column; gap: 0.5em; min-width: 0; }
.art { flex: 1; min-height: 0; display: flex; flex-direction: column; justify-content: flex-end; gap: 0.8em; }
.s-og .art { height: 100%; justify-content: center; }
h1 { margin: 0; font-weight: 800; font-size: calc(3em * min(var(--fit, 1), var(--fit-max, 9))); line-height: 0.98; letter-spacing: -0.035em; text-wrap: balance; }
.s-og h1 { --fit-max: 1.5; }
.s-tall h1 { font-size: calc(3.2em * var(--fit, 1)); }
h1 em { font-style: normal; color: var(--accent); }
.t-honest h1 { color: var(--orange); }
.sub { margin: 0.2em 0 0; font-size: 0.82em; line-height: 1.4; color: var(--soft); max-width: 34em; }
.t-lime .sub { font-weight: 700; font-size: 1em; line-height: 1.25; color: var(--ink); }
.kicker { margin: 0; font-size: 0.86em; line-height: 1.35; color: var(--soft); }
.label { margin: 0; font: 500 0.46em/1.2 "Card Mono", ui-monospace, monospace; letter-spacing: 0.14em; text-transform: uppercase; color: var(--muted); }
.bet-line { margin: 0 0 0.3em; font-size: 0.95em; line-height: 1.3; color: var(--muted); }
.bet-line s { text-decoration-thickness: 2px; }
.foot { padding-top: 1.1em; border-top: 1px solid var(--line); color: var(--muted); }
.foot span:first-child { min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.foot .cta { color: var(--accent); white-space: nowrap; }
.t-paper .foot .cta, .t-lime .foot .cta { color: var(--fg); }

.tiles { list-style: none; margin: 0; padding: 0; display: grid; grid-template-columns: repeat(5, 1fr); grid-auto-rows: 1fr; gap: 0.32em; flex: 1; max-height: 13em; }
.s-og .tiles { flex: none; }
.s-tall .tiles { grid-template-columns: repeat(2, 1fr); max-height: none; }
.tile { position: relative; display: flex; flex-direction: column; justify-content: space-between; gap: 0.4em; min-height: 3.6em; padding: 0.42em 0.45em; border: 2px solid var(--line); border-radius: 0.3em; overflow: hidden; }
.s-og .tile { min-height: 4.4em; }
.tile-num { font: 500 0.42em/1 "Card Mono", ui-monospace, monospace; letter-spacing: 0.1em; color: var(--muted); }
.tile-name { font-size: 0.48em; font-weight: 600; line-height: 1.2; display: -webkit-box; -webkit-line-clamp: 3; -webkit-box-orient: vertical; overflow: hidden; }
.s-tall .tile-name { font-size: 0.62em; }
.tile.lv-assisted { background: rgba(198, 244, 50, 0.16); border-color: rgba(198, 244, 50, 0.4); }
.tile.lv-delegated { background: rgba(198, 244, 50, 0.5); border-color: rgba(198, 244, 50, 0.7); }
.tile.lv-autonomous { background: var(--green); border-color: var(--green); color: var(--ink); }
.tile.lv-autonomous .tile-num { color: var(--ink); }
.tile.is-now { border-color: var(--green); box-shadow: 0 0 0 3px var(--green); }
.t-dark .tiles .tile:not(.is-now).lv-still { opacity: 0.85; }
.t-lime .tile { background: var(--ink); border-color: var(--ink); color: var(--bone); }
.t-lime .tile .tile-num { color: var(--grey); }
.tiles.compact { flex: none; grid-template-columns: repeat(10, 1fr); grid-auto-rows: auto; gap: 0.28em; }
.s-tall .tiles.compact { flex: none; grid-template-columns: repeat(5, 1fr); }
.tiles.compact .tile { min-height: 0; aspect-ratio: 1; padding: 0; border-color: var(--fg); border-width: 2px; }
.tiles.compact .tile-num { display: none; }
.t-paper .tile.lv-assisted { background: rgba(198, 244, 50, 0.45); border-color: var(--ink); }
.t-paper .tile.lv-delegated, .t-paper .tile.lv-autonomous { background: var(--green); border-color: var(--ink); }

.steps { list-style: none; margin: 0; padding: 0; flex: 1; min-height: 6em; display: grid; grid-template-columns: repeat(4, 1fr); gap: 0.45em; align-items: end; }
.s-og .steps { height: 100%; }
.step { height: 100%; display: flex; flex-direction: column; justify-content: flex-end; gap: 0.4em; }
.bar { position: relative; height: var(--h); border-radius: 0.25em; border: 2px dashed var(--rule); }
.step.is-past .bar { background: rgba(198, 244, 50, 0.32); border: 2px solid rgba(198, 244, 50, 0.45); }
.step.is-now .bar { background: var(--green); border: 2px solid var(--green); }
.now { position: absolute; top: 0.6em; left: 0.6em; font: 500 0.42em/1 "Card Mono", ui-monospace, monospace; letter-spacing: 0.14em; color: var(--ink); }
.step-name { min-height: 2.4em; font: 500 0.4em/1.25 "Card Mono", ui-monospace, monospace; letter-spacing: 0.1em; text-transform: uppercase; color: var(--muted); }
.step.is-now .step-name { color: var(--fg); }

.bet { flex: 1; display: flex; flex-direction: column; gap: 1.2em; }
.vote, .track { margin-top: auto; }
.s-og .bet { justify-content: center; }
.s-og .vote, .s-og .track { margin-top: 0; }
.vote { display: grid; grid-template-columns: 1fr 1fr; gap: 0.4em; }
.vote span { display: flex; align-items: center; justify-content: center; min-height: 2.6em; border-radius: 0.3em; font-weight: 700; font-size: 0.82em; }
.vote .yes { background: var(--green); color: var(--ink); }
.vote .no { border: 2px solid var(--bone); color: var(--bone); }
.track { display: flex; flex-direction: column; gap: 0.5em; }
.track-ends { display: flex; justify-content: space-between; font: 500 0.42em/1 "Card Mono", ui-monospace, monospace; letter-spacing: 0.14em; color: var(--muted); }
.cells { display: flex; gap: 0.14em; }
.cell { flex: 1; height: 0.62em; border: 2px solid var(--rule); border-radius: 0.1em; }
.cell.on { background: var(--green); border-color: var(--green); }

.cols { display: grid; grid-template-columns: 1fr 1fr; gap: 1.2em; padding-top: 0.9em; border-top: 1px solid var(--line); }
.cols > div { display: flex; flex-direction: column; gap: 0.5em; }
.col-text { margin: 0; font-size: 0.6em; line-height: 1.4; color: var(--fg); }
.s-tall .col-text { font-size: 0.72em; }

.rounds { list-style: none; margin: 0; padding: 0; display: grid; grid-template-columns: repeat(${P.limits.maxStages}, 1fr); gap: 0.4em; }
.round { display: flex; align-items: flex-end; min-height: 6em; padding: 0.5em 0.6em; border-radius: 0.3em; border: 2px dashed var(--rule); font: 500 0.42em/1 "Card Mono", ui-monospace, monospace; letter-spacing: 0.14em; color: var(--muted); }
.s-og .round { min-height: 5em; }
.round.is-past { background: rgba(198, 244, 50, 0.32); border: 2px solid rgba(198, 244, 50, 0.45); color: var(--bone); }
.round.is-missed { border: 2px solid var(--orange); color: var(--orange); }

.stat { display: flex; align-items: center; gap: 0.35em; }
.stat b { font-size: 9em; font-weight: 800; line-height: 0.85; letter-spacing: -0.06em; }
.s-og .stat b { font-size: 6.4em; }
.stat span { font-size: 1.5em; font-weight: 800; line-height: 1.02; letter-spacing: -0.02em; }
.s-og .stat span { font-size: 1.2em; }
`;

// The card alone, at the exact size of the image. Only the screenshot browser opens it, with a signed token.
// assets is the prefix for fonts and the wordmark; the preview script points it at public/.
export function cardRenderPage({ card, size, lang, dims, assets = "", now = Date.now() }) {
  const [w, h] = dims;
  const f = card.facts;
  const headline = cardHeadlineParts(f, card.headline, lang);
  const title = headline.map((p) => p.text).join("");
  const l = layoutFor(f, lang, headline, now);
  const text = `${l.kicker || ""}${l.hero}${l.sub ? `<p class="sub">${esc(l.sub)}</p>` : ""}`;
  const style = STYLE(w, h, size).replaceAll('url("/fonts/', `url("${assets}/fonts/`);
  return `<!doctype html>
<html lang="${esc(lang)}">
<head><meta charset="utf-8"><meta name="robots" content="noindex"><meta name="color-scheme" content="dark"><title>${esc(title)}</title>
<style>${style}</style></head>
<body><div class="card t-${l.theme} s-${esc(size)} m-${esc(f.moment)}" data-size="${esc(size)}">
<header class="top"><span class="mark"><img src="${assets}/wordmark.svg" alt="Onhundred"></span>${l.tag ? `<span class="tag${l.pill ? " pill" : ""}">${esc(l.tag)}</span>` : ""}</header>
<div class="body${l.art ? "" : " solo"}"><div class="text">${text}</div>${l.art ? `<div class="art">${l.art}</div>` : ""}</div>
<footer class="foot"><span>${esc(l.left)}</span><span class="cta">${esc(l.right)}</span></footer>
</div></body></html>`;
}
