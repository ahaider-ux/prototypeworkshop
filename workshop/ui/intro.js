// The first-run intro: six seconds that show what Atelier is, made of Atelier itself.
//
// Creative direction: a fancy name, a playful studio. Everything on screen is the app's own
// interface — the real toolbar and tabs (copied from the page underneath), frames with their
// selection, comment pins, notes, ink, the Play pill, branches, a recipe running, a merge — on flat
// paper, no gradients. The brand is the comment pin with an eye: a little critic that peeks at
// your work, and in the end drops onto the "i" of the name.
//
// Beats (after the reference cut the owner chose):
//   0.25–1.3 s one crop-marked tile cutting through the app's tools
//   1.3–1.75 s the studio pops in around it, with a little overshoot
//   1.75–2.75 s a held moment with a story: an agent runs a recipe, you merge, a toast confirms
//   2.75–3.25 s everything cuts away, outside in
//   3.25–3.6 s the tile flashes through the palette down to the pin
//   3.6–4.9 s  the pin alone (it blinks), hops up while "atelıer" types, then drops onto the i
//   → hold (one more blink), and the scene lifts away to the app
// Skips on a click or Esc. Shown once per browser; replay from the Atelier menu or /?intro.
// Reduced motion: the final lockup only.

import { h, IC } from "./lib.js";
import { outline } from "./ink.js";

const KEY = "atelier-intro-v2";
const W = 1600,
  H = 1000;
// the mark: a comment pin with an eye
export const PIN_MARK = `<svg class="pinmark" viewBox="0 0 24 24" aria-hidden="true"><path class="pb" d="M12 2.5a9.5 9.5 0 0 1 0 19H2.5V12A9.5 9.5 0 0 1 12 2.5Z"/><g class="eye"><circle class="ew" cx="13.4" cy="10.6" r="3.6"/><circle class="ep" cx="14.3" cy="10.9" r="1.6"/></g></svg>`;
const CORNERS = `<i class="ic1"></i><i class="ic2"></i><i class="ic3"></i><i class="ic4"></i>`;
// a real marker stroke, from Atelier's own pen engine
const inkPath = (pts, pen = "marker", size = 7) => outline(pts, pen, size, 1);
const circlePts = (cx, cy, rx, ry, turns = 1.12) => Array.from({ length: 60 }, (_, i) => {
  const a = -2.2 + (i / 59) * Math.PI * 2 * turns;
  return [cx + Math.cos(a) * rx * (1 + i / 400), cy + Math.sin(a) * ry * (1 - i / 500)];
});
// a little product page inside a frame: flat boxes, the way a wireframe reads at a glance
const PAGE = (kind) =>
  kind === "phone"
    ? `<div class="ipg phone"><i class="hd"></i><i class="hero"></i><i class="row"></i><i class="row"></i><i class="row short"></i><i class="cta"></i></div>`
    : `<div class="ipg desk"><i class="sb"></i><i class="hd"></i><i class="c1"></i><i class="c2"></i><i class="c3"></i><i class="c4"></i><i class="c5"></i><i class="c6"></i></div>`;

// [class, x, y, w, h, in ms, out ms, html] — x/y: top-left, from the centre of a 1600 × 1000 stage
const PIECES = () => [
  ["frame", -525, -300, 300, 196, 1380, 3200, `<span class="flbl">Start screen</span>${PAGE("desk")}`],
  ["box hl", -510, -255, 150, 84, 1560, 2980, `<div class="box" style="width:150px;height:84px"><span class="lb"><i>1</i><span>Tighten the cards</span></span></div>`],
  ["play", -375, -202, 0, 0, 1640, 2900, `<button type="button" class="bplay on" tabindex="-1"><span class="pic">${IC.play}</span><span class="plb">Play</span></button>`],
  ["frame sel", 335, -300, 140, 290, 1420, 3150, `<span class="flbl on">Checkout</span>${PAGE("phone")}<span class="isel">${CORNERS}</span><span class="sizetag">390 × 844</span>`],
  ["ink", 305, -98, 200, 92, 1600, 2880, `<svg viewBox="0 0 200 92" aria-hidden="true"><path class="ik" d="${inkPath(circlePts(100, 47, 88, 34))}"/></svg>`],
  ["note", -170, -300, 170, 0, 1520, 2840, `<div class="note warm" style="width:170px;position:relative"><div class="tx">Tighten the cards, they feel cramped</div><div class="by">You · now</div></div>`],
  ["pin", 40, -215, 0, 0, 1460, 3260, `<span class="pin agent" style="position:relative;margin:0"><span class="pi">C</span><i class="pn">3</i></span>`],
  ["peek", 70, -330, 230, 0, 1700, 2760, `<div class="pinpeek" style="position:relative"><div class="ph"><span class="cav agent">C</span><b>Claude</b><span>just now</span></div><p>On it: 8px more between the cards, on a branch.</p><span class="pr">2 replies</span></div>`],
  ["panel tabs", -530, -72, 0, 0, 1440, 3300, "TABS"],
  ["panel branches", -530, -14, 260, 0, 1480, 3100, `<div class="shd"><span>Branches</span><span class="n">3</span></div><div class="pgs"><div class="pg on">${IC.board}<span class="t">Main</span></div><div class="pg">${IC.fork}<span class="t">Denser sidebar</span><span class="m ch cnt" data-to="3">2</span></div><div class="pg">${IC.fork}<span class="t">Roomier cards</span><span class="m ch">1</span></div></div>`],
  ["panel act", -530, 162, 260, 0, 1620, 2820, `<div class="arow"><span class="av agent">C</span><div class="tx"><div><b>Claude</b> <span class="tm">now</span></div><div class="msg">Finished "Polish pass": cards are 8px tighter</div></div></div>`],
  ["panel recipe", 290, 28, 250, 0, 1500, 2960, `<div class="isec rcard"><div class="ih"><b>Polish pass</b><span class="tagro info">Auto</span><span class="tagro">v2</span></div><div class="rcs"><div class="rcbar" aria-hidden="true"><i class="m" style="flex:4"></i><i class="o" style="flex:1"></i></div><span class="rcst">5 runs · 4 merged · 80% kept</span></div><div class="rca"><button type="button" class="createbtn sm" tabindex="-1" disabled><span class="shimmer">Running…</span></button></div></div>`],
  ["merge", 96, 108, 0, 0, 1560, 3040, `<button type="button" class="createbtn" tabindex="-1">${IC.check}Review and merge</button>`],
  ["toast", 230, 206, 0, 0, 2440, 3000, `<div class="toast is-open" style="position:relative"><div class="tcol"><span class="tt2">Merged Denser sidebar into Main</span><span class="tdesc">3 changes · the branch is archived</span></div></div>`],
  ["tray", -250, 196, 0, 0, 1580, 2920, `<div class="inktray" style="position:relative;left:auto;bottom:auto;transform:none">${["#111111", "#e03131", "#f76707", "#ffd43b", "#2f9e44", "#1c7ed6"].map((c, i) => `<span class="inkdot${i === 1 ? " on" : ""}" style="--ink:${c}"></span>`).join("")}</div>`],
  ["comp", -250, 96, 280, 0, 1680, 2860, `<div class="ccomp" style="padding:0"><span class="cav">Y</span><div class="cbox"><span class="ctx">Make the button bolder</span><div class="cbar"><span class="cagent" aria-pressed="true">${IC.spark}Agent fixes this</span><span class="sp"></span><span class="csend">${IC.send}</span></div></div></div>`],
  ["toolbar", -300, 262, 0, 0, 1400, 3330, "TOOLBAR"],
  ["cursor you", -200, 40, 0, 0, 1600, 2900, `<svg viewBox="0 0 16 16" aria-hidden="true"><path d="M3 2.5 13 8l-4.3 1.2L7 13.5Z"/></svg><b>You</b>`],
  ["cursor agent", 205, -70, 0, 0, 1650, 2880, `<svg viewBox="0 0 16 16" aria-hidden="true"><path d="M3 2.5 13 8l-4.3 1.2L7 13.5Z"/></svg><b>Claude</b>`],
  ["ink under", -440, -98, 150, 30, 1720, 2800, `<svg viewBox="0 0 150 30" aria-hidden="true"><path class="ik green" d="${inkPath([[6, 18], [40, 15], [80, 17], [120, 14], [144, 15]], "marker", 5)}"/></svg>`],
];
// what the opening tile cuts through: the app's own tools
const OPENERS = [
  `<span class="ot blue">${IC.frame}</span>`,
  `<span class="ot yellow"><b>Y</b></span>`,
  `<span class="ot red">${IC.draw}</span>`,
  `<span class="ot ink">${IC.spark}</span>`,
  `<span class="ot white">${IC.cmt}</span>`,
  `<span class="ot blue">${IC.play}</span>`,
];
const OPEN_AT = [250, 440, 630, 820, 1010, 1200];
const FLASHES = [
  ["f1", 3260],
  ["f2", 3340],
  ["f3", 3420],
  ["f4", 3500],
];
const END = 6300;

let running = null;
export const introSeen = () => {
  try {
    return localStorage.getItem(KEY) === "1";
  } catch {
    return true; // no storage (a private window, a preview): never hold the app back with it
  }
};

// a real piece of the page underneath, without its ids
function copyOf(id) {
  const src = document.getElementById(id);
  if (!src) return "";
  const c = src.cloneNode(true);
  for (const el of [c, ...c.querySelectorAll("[id]")]) el.removeAttribute("id");
  for (const el of c.querySelectorAll("[data-tip]")) el.removeAttribute("data-tip");
  return c;
}

export function playIntro({ force = false } = {}) {
  if (running || (!force && introSeen())) return Promise.resolve();
  try {
    localStorage.setItem(KEY, "1");
  } catch {}
  const still = matchMedia("(prefers-reduced-motion: reduce)").matches;
  const root = h(`<div class="intro${still ? " still" : ""}" role="dialog" aria-label="Welcome to Atelier. Click or press Escape to continue."><div class="istage"><div class="icol"></div><div class="itile">${CORNERS}<div class="iopen"></div><div class="ibrand">${PIN_MARK}</div></div><div class="ilock" aria-hidden="true"><span class="lt">a</span><span class="lt">t</span><span class="lt">e</span><span class="lt">l</span><span class="lt li">ı</span><span class="lt">e</span><span class="lt">r</span><span class="lcar"></span></div><div class="imk">${CORNERS}${PIN_MARK}</div></div></div>`);
  document.body.append(root);
  const stage = root.querySelector(".istage");
  const k = () => Math.min(innerWidth / W, innerHeight / H);
  const fit = () => stage.style.setProperty("--k", k().toFixed(4));
  fit();
  addEventListener("resize", fit);
  const timers = [];
  const at = (ms, fn) => timers.push(setTimeout(fn, ms));
  let done,
    tick = null;
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
  root.addEventListener("click", end);
  running = end;
  const mk = root.querySelector(".imk");
  const letters = [...root.querySelectorAll(".ilock .lt")];
  const blink = () => (mk.classList.remove("blink"), void mk.offsetWidth, mk.classList.add("blink"));

  if (still) {
    letters.forEach((l) => l.classList.add("on"));
    root.classList.add("lock", "dotted");
    requestAnimationFrame(() => placeDot(true));
    at(1600, end);
    return finished;
  }

  // the studio: the app's own pieces, popping in and cutting out on their beats
  const col = root.querySelector(".icol");
  for (const [cls, x, y, w, hh, tin, tout, html] of PIECES()) {
    const el = h(`<div class="ip ${cls}" style="left:${W / 2 + x}px;top:${H / 2 + y}px;${w ? `width:${w}px;` : ""}${hh ? `height:${hh}px;` : ""}--in:${tin}ms"></div>`);
    if (html === "TOOLBAR" || html === "TABS") {
      const c = copyOf(html === "TOOLBAR" ? "tb" : "ltabs");
      if (!c) continue;
      if (html === "TABS") {
        // the Agents tab, opened out, as in the app
        for (const b of c.querySelectorAll("[data-t]")) b.setAttribute("aria-selected", String(b.dataset.t === "agents"));
        const pill = c.querySelector(".ltpill");
        if (pill) (pill.style.transform = "translateX(76px)"), (pill.style.width = "80px"), (pill.style.transition = "none");
      }
      el.append(c);
    } else el.innerHTML = html;
    col.append(el);
    at(tout, () => el.classList.add("cut")); // a cut, never a fade
  }
  // the opening tile
  const tile = root.querySelector(".itile");
  const open = root.querySelector(".iopen");
  OPEN_AT.forEach((ms, i) => at(ms, () => ((open.innerHTML = OPENERS[i]), tile.classList.add("on"))));
  at(1300, () => tile.classList.add("grow"));
  at(1420, () => ((open.innerHTML = ""), tile.classList.add("brand")));
  // the held moment: Claude works, you go to Review and merge, the toast confirms
  at(1760, () => {
    const cnts = [...col.querySelectorAll(".cnt")];
    tick = setInterval(() => {
      for (const c of cnts) if (+c.textContent < +c.dataset.to) c.textContent = String(+c.textContent + 1);
    }, 420);
  });
  at(1900, () => col.querySelector(".cursor.you")?.classList.add("go"));
  at(2380, () => col.querySelector(".merge .createbtn")?.classList.add("press"));
  at(2500, () => blinkTile());
  const blinkTile = () => (tile.classList.remove("blink"), void tile.offsetWidth, tile.classList.add("blink"));
  // the collapse: palette flashes down to the pin
  FLASHES.forEach(([cls, ms]) => at(ms, () => (tile.classList.remove("f1", "f2", "f3", "f4"), tile.classList.add(cls))));
  at(3580, () => root.classList.add("lock"));
  at(3820, blink);
  // the name types on while the pin hops up to watch; then it drops onto the i
  at(3960, () => (root.classList.add("typing"), mk.classList.add("hop")));
  const caret = root.querySelector(".ilock .lcar");
  const type = (i) => {
    letters[i].classList.add("on");
    caret.style.left = letters[i].offsetLeft + letters[i].offsetWidth + 4 + "px";
  };
  [3990, 4080, 4170, 4260, 4360].forEach((ms, i) => at(ms, () => type(i)));
  at(4560, () => placeDot(false));
  [4900, 4990].forEach((ms, i) => at(ms, () => type(5 + i)));
  at(5250, () => root.classList.remove("typing"));
  at(5650, blink);
  at(END, end);

  // the pin, from wherever it is, onto the dot of the i
  function placeDot(now) {
    const i = root.querySelector(".ilock .li").getBoundingClientRect();
    const s = stage.getBoundingClientRect();
    const kk = k();
    const em = i.height / kk; // the line is 1em tall
    const size = em * 0.4;
    const cx = (i.left - s.left) / kk + i.width / kk / 2 + size * 0.06;
    const cy = (i.top - s.top) / kk + em * 0.24 - size * 0.42;
    const target = `translate(${cx - W / 2}px, ${cy - H / 2}px) scale(${size / 72})`;
    mk.classList.remove("hop");
    if (now) return void (mk.style.transform = target);
    mk.animate([{ transform: getComputedStyle(mk).transform }, { transform: target }], { duration: 420, easing: "cubic-bezier(.34,1.56,.64,1)", fill: "forwards" });
    setTimeout(() => root.classList.add("dotted"), 380);
  }
  return finished;
}
