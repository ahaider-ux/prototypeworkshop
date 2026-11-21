// The first-run intro: a six-second piece that says what Atelier is before the app appears.
//
// Beats (after a reference cut the owner chose; Atelier's own material throughout):
//   0.2–1.3 s  one small tile with crop marks, cutting through what people bring here
//   1.3–1.75 s the studio bursts in around it: frames, notes, ink, branches, agents, cursors
//   1.75–2.7 s a held moment that keeps moving: counters tick, an agent ring turns, a slow push
//   2.7–3.2 s  everything cuts away, outside in, back to the centre tile
//   3.2–3.55 s the tile flashes through palettes as it shrinks to the mark
//   3.55–4.7 s the mark alone with crop marks, then "Atelier" types on behind a block cursor
//   → hold, then the scene lifts away to the app
// Pieces appear and leave by cuts (no fades): a pop is an instant appear with a short scale
// settle. Shown once per browser; replay from the Atelier menu. Skip with a click, Esc or the
// button. Reduced motion: the final lockup only.

import { $, h } from "./lib.js";

const KEY = "atelier-intro-v1";
const W = 1600,
  H = 1000;
const MARK = `<svg class="imark" viewBox="0 0 20 20" aria-hidden="true"><rect x="2.75" y="2.75" width="10.5" height="10.5" rx="2.5" fill="none" stroke="var(--m-a)" stroke-width="1.5"/><rect x="7" y="7" width="10.25" height="10.25" rx="2.5" fill="var(--m-b)"/></svg>`;
const CORNERS = `<i class="ic1"></i><i class="ic2"></i><i class="ic3"></i><i class="ic4"></i>`;
const FORK = `<svg viewBox="0 0 16 16" aria-hidden="true"><circle cx="4.5" cy="3.5" r="1.5"/><circle cx="11.5" cy="3.5" r="1.5"/><circle cx="4.5" cy="12.5" r="1.5"/><path d="M4.5 5v6M11.5 5v1.5a3 3 0 0 1-3 3h-4"/></svg>`;
const CHECK = `<svg viewBox="0 0 16 16" aria-hidden="true"><path d="m3.5 8.5 3 3 6-7"/></svg>`;
const SPARK = `<svg viewBox="0 0 16 16" aria-hidden="true"><path d="M8 2.5c.4 2.6 1.4 3.6 4 4-2.6.4-3.6 1.4-4 4-.4-2.6-1.4-3.6-4-4 2.6-.4 3.6-1.4 4-4Z"/></svg>`;
const ARROW = `<svg viewBox="0 0 16 16" aria-hidden="true"><path d="M5 11 11 5M6 5h5v5"/></svg>`;
const CURSOR = `<svg viewBox="0 0 16 16" aria-hidden="true"><path d="M3 2.5 13 8l-4.3 1.2L7 13.5Z"/></svg>`;
// a little product screen, drawn from boxes (sidebar, header, cards)
const UI = (cards = 6, tint = "") => `<div class="iui ${tint}"><span class="sb"></span><span class="hd"></span><span class="gr">${"<i></i>".repeat(cards)}</span></div>`;
const PHONE = `<div class="iui phone"><span class="hd"></span><span class="st">${"<i></i>".repeat(4)}</span><span class="bt"></span></div>`;
const SCRIBBLE = `<svg class="iscr" viewBox="0 0 200 120" aria-hidden="true"><path d="M30 64c4-30 52-48 96-40 38 7 56 30 42 50-15 22-70 30-108 18C26 82 18 54 52 34c22-13 62-16 90-6"/></svg>`;
const CHART = `<svg class="ichart" viewBox="0 0 520 300" preserveAspectRatio="none" aria-hidden="true"><path d="M0 300V210l40-30 30 20 40-70 40 40 30-60 40 50 30-20 40 60 40-100 30 40 40-50 40 70 40-30 40 40 40-20V300Z"/></svg>`;

// [class, x, y, w, h, in ms, out ms, inner html] — x/y from the centre of a 1600 × 1000 stage
const PIECES = [
  ["tag recipes", -760, -470, 150, 64, 1560, 2800, `<b>Recipes</b>${ARROW}`],
  ["tile frame", -640, -390, 230, 300, 1420, 2980, `<span class="lbl">Start screen</span>${UI(4)}`],
  ["tile board", -420, -440, 420, 290, 1380, 3250, `${UI(6, "green")}<span class="pinchip"><i>C</i>Tighten the cards</span>`],
  ["tile lime", 60, -470, 130, 90, 1420, 3350, `<svg viewBox="0 0 40 30" aria-hidden="true"><path d="m10 16 7 6 13-14"/></svg>`],
  ["tile peach grain", 220, -470, 540, 360, 1500, 2650, ""],
  ["tile sky grain", -470, -170, 230, 270, 1500, 2700, ""],
  ["tile wire", -650, -60, 170, 170, 1520, 2650, UI(4, "line")],
  ["tile chart", 210, -200, 560, 310, 1560, 2900, CHART],
  ["tile burst grain", -180, 110, 360, 270, 1500, 2650, `<span class="rays"></span>`],
  ["tile ink", -430, -60, 230, 140, 1600, 2820, SCRIBBLE],
  ["tile num", 320, 40, 300, 150, 1450, 2950, `<b class="cnt" data-from="248" data-to="251">248</b><span>Versions</span>`],
  ["tile green grain", 320, 180, 400, 270, 1450, 2900, `<span class="grid"></span>`],
  ["tile phone", 130, 80, 200, 260, 1450, 3050, `${PHONE}<span class="chip size">390 × 844</span>`],
  ["note", -160, -250, 190, 150, 1640, 2780, `<b>Tighten the cards</b><span>You · now</span>`],
  ["pill branch", -470, 120, 230, 52, 1520, 3300, `${FORK}<b>Denser sidebar</b>`],
  ["pill merge", 370, 300, 170, 56, 1450, 2950, `<i>${CHECK}</i><b>Merge</b>`],
  ["stat", -40, 270, 170, 100, 1300, 3420, `<b class="cnt" data-from="121" data-to="124">121</b><span>Agent runs</span>${ARROW}`],
  ["ring", -360, 330, 250, 250, 1480, 3420, `<i class="r1"></i><i class="r2"></i>`],
  ["chip spark", -600, 270, 72, 72, 1560, 3450, SPARK],
  ["label", 40, -110, 0, 0, 1700, 3330, `Branching`],
  ["label", -640, 140, 0, 0, 1720, 3380, `Marking up`],
  ["label", 140, -330, 0, 0, 1740, 3300, `Reviewing`],
  ["label", 150, -40, 0, 0, 1760, 3200, `Merging`],
  ["label", -770, 30, 0, 0, 1780, 3280, `Building`],
  ["cursor you", -250, -150, 0, 0, 1620, 2860, `${CURSOR}<b>You</b>`],
  ["cursor agent", 180, -20, 0, 0, 1660, 2840, `${CURSOR}<b>Claude</b>`],
];
// what the opening tile cuts through: people, a frame, a mark, an agent
const OPENERS = [
  `<span class="oav y">Y</span>`,
  `<span class="omini">${UI(4)}</span>`,
  `<span class="oav c">${SPARK}</span>`,
  `<span class="omini ink">${SCRIBBLE}</span>`,
  `<span class="oav g">A</span>`,
];
const OPEN_AT = [230, 470, 700, 930, 1160];
// the centre tile's palettes as it collapses to the mark: [class, at ms]
const FLASHES = [
  ["f1", 3200],
  ["f2", 3285],
  ["f3", 3365],
  ["f4", 3440],
  ["mark", 3520],
];
const WORD = "Atelier";
const TYPE_AT = [3960, 4060, 4160, 4290, 4390, 4490, 4590];
const CURSOR_ON = 3800,
  CURSOR_OFF = 5150,
  END = 6200;

let running = null;

export function introSeen() {
  try {
    return localStorage.getItem(KEY) === "1";
  } catch {
    return true; // no storage (a private window, a preview): never block the app with it
  }
}

export function playIntro({ force = false } = {}) {
  if (running || (!force && introSeen())) return Promise.resolve();
  try {
    localStorage.setItem(KEY, "1");
  } catch {}
  const still = matchMedia("(prefers-reduced-motion: reduce)").matches;
  const root = h(`<div class="intro${still ? " still" : ""}" role="dialog" aria-label="Welcome to Atelier"><div class="istage"><div class="icol"></div><div class="icenter"><div class="itile">${CORNERS}<div class="iopen"></div><div class="ibrand">${MARK}</div></div><div class="ilock"><span class="lmark">${MARK}</span><span class="lword"></span><span class="lcur"></span></div></div></div><button type="button" class="iskip">Skip</button></div>`);
  document.body.append(root);
  const stage = root.querySelector(".istage");
  const fit = () => stage.style.setProperty("--k", Math.min(innerWidth / W, innerHeight / H).toFixed(4));
  fit();
  addEventListener("resize", fit);
  const timers = [];
  const at = (ms, fn) => timers.push(setTimeout(fn, ms));
  let done;
  const finished = new Promise((r) => (done = r));
  const end = () => {
    if (!running) return;
    running = null;
    timers.forEach(clearTimeout);
    clearInterval(tick);
    removeEventListener("resize", fit);
    removeEventListener("keydown", onKey, true);
    root.classList.add("out");
    setTimeout(() => (root.remove(), done()), 420);
  };
  const onKey = (e) => e.key === "Escape" && (e.preventDefault(), end());
  addEventListener("keydown", onKey, true);
  root.querySelector(".iskip").onclick = end;
  root.addEventListener("click", (e) => e.target.closest(".iskip") || end());
  running = end;
  let tick = null;

  if (still) {
    // the lockup, written out, then away
    root.querySelector(".lword").textContent = WORD;
    root.classList.add("lock");
    at(1400, end);
    return finished;
  }

  // the burst: each piece cuts in with a short settle and cuts out on its beat
  const col = root.querySelector(".icol");
  for (const [cls, x, y, w, hh, tin, tout, html] of PIECES) {
    const el = h(`<div class="ip ${cls}" style="left:${W / 2 + x}px;top:${H / 2 + y}px;${w ? `width:${w}px;height:${hh}px;` : ""}--in:${tin}ms">${html}</div>`);
    col.append(el);
    at(tout, () => el.classList.add("cut")); // a cut, not a fade
  }
  // the opening tile
  const tile = root.querySelector(".itile");
  const open = root.querySelector(".iopen");
  OPEN_AT.forEach((ms, i) => at(ms, () => (open.innerHTML = OPENERS[i], tile.classList.add("on"))));
  at(1300, () => tile.classList.add("grow"));
  at(1420, () => ((open.innerHTML = ""), tile.classList.add("brand")));
  // the held moment: counters tick while the agent ring turns and the camera pushes in
  at(1750, () => {
    const cnts = [...col.querySelectorAll(".cnt")].map((el) => ({ el, n: +el.dataset.from, to: +el.dataset.to }));
    tick = setInterval(() => {
      for (const c of cnts) if (c.n < c.to) c.el.textContent = String(++c.n);
    }, 280);
  });
  // the collapse to the mark
  FLASHES.forEach(([cls, ms]) => at(ms, () => (tile.classList.remove("f1", "f2", "f3", "f4"), tile.classList.add(cls))));
  at(3560, () => root.classList.add("lock"));
  at(CURSOR_ON, () => root.classList.add("typing"));
  const word = root.querySelector(".lword");
  TYPE_AT.forEach((ms, i) => at(ms, () => (word.textContent = WORD.slice(0, i + 1))));
  at(CURSOR_OFF, () => root.classList.remove("typing"));
  at(END, end);
  return finished;
}
