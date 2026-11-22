// The first-run intro: six seconds that say what Atelier is without showing its screens.
//
// Creative direction: abstract, not literal. No toolbars, panels, cursors or captions: flat paper
// sheets and blocks of colour land loosely on the page, then snap into an arranged composition, and
// a hand-drawn ring marks one piece, which is the whole job (rough ideas, arranged, critiqued) in
// one gesture. Flat paper, no gradients, the palette and nothing else. The brand is the comment pin
// with an eye: a little critic that peeks at your work, and in the end drops onto the "i" of the name.
//
// Beats:
//   0.15–1.3 s one crop-marked tile cutting through flat shapes in the palette
//   1.3–1.75 s sheets and blocks land around it, loose and a little askew
//   1.9–2.5 s  they snap into place, an arranged page; 2.3 s a hand-drawn ring marks one
//   2.75–3.25 s everything cuts away, outside in
//   3.25–3.6 s the tile flashes through the palette down to the pin
//   3.6–4.9 s  the pin alone (it blinks), hops up while "atelıer" types, then drops onto the i
//   → hold (one more blink), and the word flies into the header, the pin riding its i
// Skips on a click or Esc. Shown once per browser; replay from the Atelier menu or /?intro.
// Reduced motion: the final lockup only.

import { h, holdPages, releasePages } from "./lib.js";
import { outline } from "./ink.js";

const KEY = "atelier-intro-v2";
const W = 1600,
  H = 1000;
// the mark: a comment pin with an eye
export const PIN_MARK = `<svg class="pinmark" viewBox="0 0 24 24" aria-hidden="true"><path class="pb" d="M12 2.5a9.5 9.5 0 0 1 0 19H2.5V12A9.5 9.5 0 0 1 12 2.5Z"/><g class="eye"><circle class="ew" cx="13.4" cy="10.6" r="3.6"/></g></svg>`;
const CORNERS = `<i class="ic1"></i><i class="ic2"></i><i class="ic3"></i><i class="ic4"></i>`;
// a real marker stroke, from Atelier's own pen engine
const inkPath = (pts, pen = "marker", size = 7) => outline(pts, pen, size, 1);
const circlePts = (cx, cy, rx, ry, turns = 1.12) => Array.from({ length: 60 }, (_, i) => {
  const a = -2.2 + (i / 59) * Math.PI * 2 * turns;
  return [cx + Math.cos(a) * rx * (1 + i / 400), cy + Math.sin(a) * ry * (1 - i / 500)];
});
// The composition, arranged: [look, x, y, w, h, scatter dx, dy, turn°]. x/y are the top-left in the
// collage, from its centre, shown at 1:1 (a slow push to 1.04×): a page with paper all round it,
// inside ±490 × ±292, with a gap left in the middle (±104 × ±108) that the brand tile fits into. Looks: a paper
// sheet, a sheet with crop marks, and flat colour (blue, yellow, red, black), squared, round or a pill.
const BLOCKS = [
  ["sheet", -480, -292, 296, 184, -60, -40, -6],
  ["blue", -168, -292, 128, 84, 40, -70, 8],
  ["yellow round", -146, -192, 84, 84, -30, 50, 0],
  ["sheet marked", -24, -292, 160, 184, 20, -90, 5],
  ["black pill", 152, -292, 176, 44, 90, -30, -4],
  ["red", 152, -232, 176, 124, 60, 40, 6],
  ["sheet", 344, -292, 146, 184, 70, -50, -7],
  ["yellow", -480, -84, 148, 168, -80, 10, 5],
  ["sheet", -316, -84, 212, 168, -40, 60, -5],
  ["blue round", 104, -56, 112, 112, 50, 20, 0],
  ["sheet", 232, -84, 258, 168, 80, 30, 4],
  ["sheet", -480, 108, 360, 184, -70, 70, -4],
  ["red pill", -104, 108, 176, 44, -20, 90, 6],
  ["black", -104, 168, 176, 124, 30, 80, -6],
  ["sheet", 88, 108, 232, 184, 40, 90, 5],
  ["yellow", 336, 108, 154, 184, 90, 60, -5],
];
const RING = { x: 80, y: -80, w: 160, h: 160 }; // the hand-drawn mark, round the blue disc
const LAND = 1380, // the first block lands; the rest follow from the middle out
  ARRANGE = 1900, // they snap into place
  MARK = 2300, // the ring is drawn
  CUT0 = 2760, // the outermost block cuts away first …
  CUT1 = 3240; // … the innermost last

// Hand-drawn marks move like hand-drawn marks: on eights (125 ms a frame), drawn on in four frames
// and then "boiling" — redrawn a hair differently each frame, the way an animator's line lives on
// paper. The interface around them moves smooth. Machines glide, hands flicker.
const FRAME_MS = 125;
const INKS = {
  ring: { w: 160, h: 160, color: "red", strokes: [circlePts(80, 80, 70, 66, 1.08)], pen: "marker", size: 6 },
  under: {
    w: 400, h: 36, color: "blue", pen: "marker", size: 9,
    strokes: [Array.from({ length: 30 }, (_, i) => { const t = i / 29; return [12 + 374 * t, 24 - 3 * Math.sin(Math.PI * t) - 10 * t * t]; })],
  },
};
// a small seeded wobble, so each frame of a line is the same line drawn again
function jitter(pts, seed, amt = 1.3) {
  let x = seed * 9301 + 49297;
  const rnd = () => ((x = (x * 9301 + 49297) % 233280) / 233280 - 0.5) * 2 * amt;
  return pts.map(([a, b]) => [a + rnd(), b + rnd()]);
}
function inkFrames(spec) {
  const total = spec.strokes.reduce((n, s) => n + s.length, 0);
  const draw = (frac, seed) => {
    let left = Math.max(2, Math.ceil(total * frac));
    const parts = [];
    for (const s of spec.strokes) {
      if (left <= 0) break;
      const part = s.slice(0, left);
      left -= s.length;
      if (part.length > 1) parts.push(outline(jitter(part, seed), spec.pen, spec.size, 1));
    }
    return parts.join(" ");
  };
  return { on: [0.3, 0.58, 0.84, 1].map((f, i) => draw(f, i + 1)), boil: [7, 8, 9].map((seed) => draw(1, seed)) };
}
const inkSvg = (name) => `<svg viewBox="0 0 ${INKS[name].w} ${INKS[name].h}" aria-hidden="true"><path class="ik ${INKS[name].color}" data-ink="${name}" d=""/></svg>`;

// what the opening tile cuts through: flat shapes in the palette (a cut every 200 ms)
const OPENERS = [
  `<span class="ot blue"><i class="s-dot"></i></span>`,
  `<span class="ot yellow"><i class="s-half"></i></span>`,
  `<span class="ot red"><i class="s-bar"></i></span>`,
  `<span class="ot ink"><i class="s-ring"></i></span>`,
  `<span class="ot white"><i class="s-sq"></i></span>`,
  `<span class="ot blue"><i class="s-tri"></i></span>`,
];
const OPEN_AT = [160, 360, 560, 760, 960, 1160];
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

// the app is uncovered: the home canvas brings its pictures in now, once the logo has settled
const landed = () => dispatchEvent(new Event("atelier:landed"));
// index.html hides the app before first paint when the intro is due, so it never flashes up first
const reveal = () => document.documentElement.removeAttribute("data-intro");

export function playIntro({ force = false } = {}) {
  if (running || (!force && introSeen())) return (reveal(), Promise.resolve());
  try {
    localStorage.setItem(KEY, "1");
  } catch {}
  const still = matchMedia("(prefers-reduced-motion: reduce)").matches;
  const root = h(`<div class="intro${still ? " still" : ""}" role="dialog" aria-label="Welcome to Atelier. Click or press Escape to continue."><div class="istage"><div class="icol"></div><div class="itile">${CORNERS}<div class="iopen"></div><div class="ibrand">${PIN_MARK}</div></div><div class="ilock" aria-hidden="true"><span class="lt">a</span><span class="lt">t</span><span class="lt">e</span><span class="lt">l</span><span class="lt li">ı</span><span class="lt">e</span><span class="lt">r</span><span class="lcar"></span><span class="iund">${inkSvg("under")}</span></div><div class="imk">${CORNERS}${PIN_MARK}</div></div></div>`);
  document.body.append(root);
  reveal(); // the intro covers the app now
  holdPages(); // and the prototype pages behind it wait until it's over, so it plays smooth
  const stage = root.querySelector(".istage");
  const k = () => Math.min(innerWidth / W, innerHeight / H);
  const fit = () => stage.style.setProperty("--k", k().toFixed(4));
  fit();
  addEventListener("resize", fit);
  const timers = [];
  const at = (ms, fn) => timers.push(setTimeout(fn, ms));
  let done;
  const finished = new Promise((r) => (done = r));
  const end = (land = false) => {
    if (!running) return;
    running = null;
    timers.forEach(clearTimeout);
    clearInterval(inkTick);
    removeEventListener("resize", fit);
    removeEventListener("keydown", onKey, true);
    if (land === true && landInHeader()) return;
    root.classList.add("out");
    setTimeout(() => (root.remove(), landed(), releasePages(), done()), 420);
  };
  // The ending: the paper lifts off the app and the lockup flies into the header, the name onto
  // the name and the pin onto the pin, so the intro hands over to the real logo it was all along.
  const landInHeader = () => {
    const logo = document.querySelector(".tlogo");
    const wm = logo?.querySelector(".wm");
    const pin = logo?.querySelector(".pinmark");
    const word = root.querySelector(".ilock");
    if (!wm || !pin || !word) return false;
    // the pin was the i's dot: as it flies off it leaves one behind, and the word takes the header's
    // spacing, so what lands is letter for letter the logo it hands over to
    const li = word.querySelector(".li");
    if (li) (li.textContent = "i"), li.classList.remove("li");
    word.classList.add("flying");
    const B = wm.getBoundingClientRect(),
      C = pin.getBoundingClientRect(),
      A = word.getBoundingClientRect(),
      S = stage.getBoundingClientRect();
    if (!B.width || !C.width || !A.width) return false;
    const kk = k();
    const sc = B.width / A.width; // land exactly on the header's word, edge to edge
    // a journey across the screen: it eases out of the middle and settles softly into the header
    // (an ease-out alone covers half the way in the first frames and reads as a jump)
    const ease = "cubic-bezier(.65,0,.25,1)",
      FLY = 760;
    const from = getComputedStyle(word).transform;
    word.style.transformOrigin = "0 0";
    word.animate([{ transform: from }, { transform: `translate(${(B.left - A.left) / kk}px, ${(B.top + B.height / 2 - A.top - (A.height * sc) / 2) / kk}px) ${from === "none" ? "" : from} scale(${sc})` }], { duration: FLY, easing: ease, fill: "forwards" });
    // the pin rides on the i all the way in (same path, same clock as the word), then hops off to
    // its own place beside the name, and the i's dot is there underneath it
    const P = mk.getBoundingClientRect();
    const L = { x: B.left, y: B.top + B.height / 2 - (A.height * sc) / 2 }; // where the word's corner lands
    const at2 = (x, y, size) => `translate(${(x - S.left - S.width / 2) / kk}px, ${(y - S.top - S.height / 2) / kk}px) scale(${size / (72 * kk)})`;
    const ride = at2(L.x + (P.left + P.width / 2 - A.left) * sc, L.y + (P.top + P.height / 2 - A.top) * sc, P.width * sc);
    const home = at2(C.left + C.width / 2, C.top + C.height / 2, C.width);
    const arc = at2((L.x + (P.left + P.width / 2 - A.left) * sc + C.left + C.width / 2) / 2, Math.min(L.y + (P.top + P.height / 2 - A.top) * sc, C.top + C.height / 2) - 3, (P.width * sc + C.width) / 2);
    mk.animate([{ transform: getComputedStyle(mk).transform }, { transform: ride }], { duration: FLY, easing: ease, fill: "forwards" });
    const HOP = 260;
    setTimeout(() => mk.animate([{ transform: ride }, { transform: arc, offset: 0.45 }, { transform: home }], { duration: HOP, easing: "cubic-bezier(.3,.7,.4,1)", fill: "forwards" }), FLY);
    logo.classList.add("landing");
    root.classList.add("land");
    setTimeout(landed, FLY - 60); // the home arrives as the word settles, while the pin hops home
    setTimeout(() => (logo.classList.remove("landing"), root.remove(), releasePages(), done()), FLY + HOP + 40);
    return true;
  };
  const onKey = (e) => e.key === "Escape" && (e.preventDefault(), end());
  addEventListener("keydown", onKey, true);
  root.addEventListener("click", () => end());
  // every hand-drawn line on its own clock, all stepped together at eight frames a second
  const inks = [];
  const t0 = performance.now();
  const inkTick = setInterval(() => {
    const now = performance.now() - t0;
    for (const ink of inks) {
      if (now < ink.at) continue;
      const n = Math.floor((now - ink.at) / FRAME_MS);
      const d = n < ink.f.on.length ? ink.f.on[n] : ink.f.boil[(n - ink.f.on.length) % ink.f.boil.length];
      if (ink.path.getAttribute("d") !== d) ink.path.setAttribute("d", d);
    }
  }, FRAME_MS / 2);
  const addInk = (path, at) => path && inks.push({ path, at, f: inkFrames(INKS[path.dataset.ink]) });
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

  // the composition: blocks land loose and askew, then snap into place; a ring marks one; then they
  // cut away from the outside in
  const col = root.querySelector(".icol");
  const far = Math.max(...BLOCKS.map(([, x, y, w, hh]) => Math.hypot(x + w / 2, y + hh / 2)));
  BLOCKS.forEach(([look, x, y, w, hh, dx, dy, turn]) => {
    const d = Math.hypot(x + w / 2, y + hh / 2) / far; // 0 in the middle, 1 at the edge
    // piece classes get a p- prefix: bare names would pick up the app's own rules
    const el = h(`<div class="ip p-block ${look.split(" ").map((c) => "p-" + c).join(" ")}" style="left:${W / 2 + x}px;top:${H / 2 + y}px;width:${w}px;height:${hh}px;--in:${Math.round(LAND + d * 220)}ms;--set:${Math.round(d * 120)}ms;--dx:${dx}px;--dy:${dy}px;--r:${turn}deg">${look.includes("marked") ? CORNERS : ""}</div>`);
    col.append(el);
    at(Math.round(CUT1 - d * (CUT1 - CUT0)), () => el.classList.add("cut")); // a cut, never a fade
  });
  at(ARRANGE, () => col.classList.add("set"));
  const ring = h(`<div class="ip p-ink" style="left:${W / 2 + RING.x}px;top:${H / 2 + RING.y}px;width:${RING.w}px;height:${RING.h}px;--in:${MARK}ms">${inkSvg("ring")}</div>`);
  col.append(ring);
  addInk(ring.querySelector(".ik"), MARK + 40);
  at(CUT0 + 120, () => ring.classList.add("cut"));
  // the opening tile
  const tile = root.querySelector(".itile");
  const open = root.querySelector(".iopen");
  OPEN_AT.forEach((ms, i) => at(ms, () => ((open.innerHTML = OPENERS[i]), tile.classList.add("on"))));
  at(1300, () => tile.classList.add("grow"));
  at(1420, () => ((open.innerHTML = ""), tile.classList.add("brand")));
  at(2560, () => blinkTile()); // the pin looks the arrangement over
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
    caret.style.left = letters[i].offsetLeft + letters[i].offsetWidth + 12 + "px";
  };
  [3990, 4080, 4170, 4260, 4360].forEach((ms, i) => at(ms, () => type(i)));
  at(4560, () => placeDot(false));
  [4900, 4990].forEach((ms, i) => at(ms, () => type(5 + i)));
  at(5250, () => root.classList.remove("typing"));
  addInk(root.querySelector(".iund .ik"), 5300); // the hand underlines it
  at(5700, blink);
  at(END, () => end(true));

  // the pin, from wherever it is, onto the dot of the i
  function placeDot(now) {
    const i = root.querySelector(".ilock .li").getBoundingClientRect();
    const s = stage.getBoundingClientRect();
    const kk = k();
    const em = i.height / kk; // the line is 1em tall
    // tuned to the slab's ı: the pin sits just above the stem, a little to the left of centre
    const size = em * 0.34;
    const cx = (i.left - s.left) / kk + i.width / kk / 2 - em * 0.02;
    const cy = (i.top - s.top) / kk + em * 0.327 - size * 0.42;
    const target = `translate(${cx - W / 2}px, ${cy - H / 2}px) scale(${size / 72})`;
    mk.classList.remove("hop");
    if (now) return void (mk.style.transform = target);
    mk.animate([{ transform: getComputedStyle(mk).transform }, { transform: target }], { duration: 380, easing: "cubic-bezier(.34,1.4,.64,1)", fill: "forwards" });
    setTimeout(() => {
      root.classList.add("dotted");
      // it lands with a squash, like something soft dropped onto a letter
      mk.querySelector(".pinmark")?.animate([{ transform: "scale(1.18,.78)" }, { transform: "scale(.94,1.08)" }, { transform: "none" }], { duration: 260, easing: "cubic-bezier(.22,1,.36,1)" });
    }, 340);
  }
  return finished;
}
