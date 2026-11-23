// The first-run intro: six seconds that show what Atelier does, in its own interface.
//
// Creative direction: product-led and restrained, the way the studios people admire present
// software. The real interface, large and calm, one story at a time, never a wall of parts: an empty
// frame is selected, a hand rings it, an agent says it's on it and goes there, and a toast says its
// branch is ready to review. Nothing made up stands in for a prototype: what isn't real is shown in
// Atelier's own empty state. Ink and paper with one blue accent (the agent's cursor and the hand's
// marker are the only other colours); no gradients. The brand is the comment pin with an eye: a
// little critic that peeks at your work, and in the end drops onto the "i" of the name.
//
// Beats:
//   0.15–1.3 s one crop-marked tile cutting through the app's tools, in black and white
//   1.4–1.7 s  the screen, the toolbar and the agent's comment arrive around it
//   1.65 s     a hand rings the empty frame; 1.75 s the agent's cursor heads there
//   2.45 s     "Branch ready to review"
//   2.75–3.25 s everything cuts away, outside in
//   3.25–3.6 s the tile flashes through the palette down to the pin
//   3.6–4.9 s  the pin alone (it blinks), hops up while "atelıer" types, then drops onto the i
//   → hold (one more blink); the pin fades as the word flies into the header, and the header's
//     own pin appears once the word is in place
// Skips on a click or Esc. Shown once per browser; replay from the Atelier menu or /?intro.
// Reduced motion: the final lockup only.

import { h, IC, holdPages, releasePages } from "./lib.js";
import { outline } from "./ink.js";

const KEY = "atelier-intro-v2";
const W = 1600,
  H = 1000;
// the mark: a comment pin with an eye, with depth: its light, shade and top rim come from shared
// gradients in index.html (white and black at low opacity), so they suit any colour the pin takes
export const PIN_MARK = `<svg class="pinmark" viewBox="0 0 24 24" aria-hidden="true"><path class="pb" d="M12 2.5a9.5 9.5 0 0 1 0 19H2.5V12A9.5 9.5 0 0 1 12 2.5Z"/><path class="pl" d="M12 2.5a9.5 9.5 0 0 1 0 19H2.5V12A9.5 9.5 0 0 1 12 2.5Z"/><path class="ps" d="M12 2.5a9.5 9.5 0 0 1 0 19H2.5V12A9.5 9.5 0 0 1 12 2.5Z"/><path class="pr" d="M12 2.5a9.5 9.5 0 0 1 0 19H2.5V12A9.5 9.5 0 0 1 12 2.5Z"/><g class="eye"><circle class="ew" cx="13.4" cy="10.6" r="3.6"/><circle class="ei" cx="13.4" cy="10.6" r="3.6"/></g></svg>`;
const CORNERS = `<i class="ic1"></i><i class="ic2"></i><i class="ic3"></i><i class="ic4"></i>`;
// a real marker stroke, from Atelier's own pen engine
const inkPath = (pts, pen = "marker", size = 7) => outline(pts, pen, size, 1);
const circlePts = (cx, cy, rx, ry, turns = 1.12) => Array.from({ length: 60 }, (_, i) => {
  const a = -2.2 + (i / 59) * Math.PI * 2 * turns;
  return [cx + Math.cos(a) * rx * (1 + i / 400), cy + Math.sin(a) * ry * (1 - i / 500)];
});
// the screen being worked on: an empty frame, in Atelier's own empty state (no made-up design: the
// intro never pretends to be someone's prototype)
const PAGE = `<div class="pempty iempty"><b>Start screen</b>Ask an agent to design it</div>`;

// [class, x, y, w, h, in ms, out ms, html]. x/y: the top-left in the collage, from its centre. The
// collage is shown at 1.5–1.56×, so everything stays inside ±440 × ±270 (paper all round it) and
// clear of the centre tile (±64). Few pieces, each one doing something: no decoration.
const PIECES = () => [
  ["toolbar", -267, 196, 0, 0, 1420, 2760, "TOOLBAR"],
  ["frame", -430, -150, 300, 196, 1400, 2820, `<span class="flbl on">Start screen</span>${PAGE}<span class="isel">${CORNERS}</span>`],
  ["ink", -425, -127, 290, 150, 1640, 2820, "INK:circle"],
  ["pin", 96, -196, 0, 0, 1480, 3060, `<span class="pin agent" style="position:relative;margin:0"><span class="pi">C</span></span>`],
  ["peek", 140, -228, 0, 0, 1560, 2880, `<div class="pinpeek" style="position:relative"><div class="ph"><span class="cav agent">C</span><b>Claude</b><span>now</span></div><p>On it: designing this screen, on a branch.</p></div>`],
  ["cursor", 300, -40, 0, 0, 1600, 2820, `<svg viewBox="0 0 16 16" aria-hidden="true"><path d="M3 2.5 13 8l-4.3 1.2L7 13.5Z"/></svg><b>Claude</b>`],
  ["toast", 144, 72, 0, 0, 2450, 2960, `<div class="toast is-open" style="position:relative"><div class="tcol"><span class="tt2">${IC.fork}Branch ready to review</span></div></div>`],
];

// Hand-drawn marks move like hand-drawn marks: on eights (125 ms a frame), drawn on in four frames
// and then "boiling" — redrawn a hair differently each frame, the way an animator's line lives on
// paper. The interface around them moves smooth. Machines glide, hands flicker.
const FRAME_MS = 125;
const INKS = {
  circle: { w: 290, h: 150, color: "red", strokes: [circlePts(145, 75, 130, 62)], pen: "marker", size: 6 },
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

// what the opening tile cuts through: the app's own tools, in black and white, blue only once
const OPENERS = [
  `<span class="ot ink">${IC.frame}</span>`,
  `<span class="ot white">${IC.cmt}</span>`,
  `<span class="ot ink">${IC.draw}</span>`,
  `<span class="ot white">${IC.spark}</span>`,
  `<span class="ot ink">${IC.fork}</span>`,
  `<span class="ot blue">${IC.play}</span>`,
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

// a real piece of the page underneath, without its ids
function copyOf(id) {
  const src = document.getElementById(id);
  if (!src) return "";
  const c = src.cloneNode(true);
  for (const el of [c, ...c.querySelectorAll("[id]")]) el.removeAttribute("id");
  for (const el of c.querySelectorAll("[data-tip]")) el.removeAttribute("data-tip");
  return c;
}

// Where the dotless i's stem is, from layout in the font actually showing (Inter, or whatever this
// computer falls back to), in stage px from the top-left of the word. A dotless i rises exactly
// to the x-height, so a 1ex marker standing on the letter's baseline ends where the stem does. Layout
// offsets, not screen boxes, so the letters' little typing bounce can't throw it off.
export function stemOf(word, li) {
  const probe = document.createElement("i");
  probe.style.cssText = "display:inline-block;width:0;height:1ex;vertical-align:baseline;padding:0;margin:0";
  li.append(probe);
  // offsets up to the word, whatever sits between: while the letter is still finishing its typing
  // bounce it has a transform, and Chrome measures the marker from the letter instead of the word
  let top = probe.offsetTop;
  for (let el = probe.offsetParent; el && el !== word; el = el.offsetParent) top += el.offsetTop;
  probe.remove();
  let left = li.offsetLeft;
  for (let el = li.offsetParent; el && el !== word; el = el.offsetParent) left += el.offsetLeft;
  // letter-spacing is added after a glyph, so the ink's middle sits half of it to the right of the
  // box's middle (tight spacing is negative: it pulls the box in from the right)
  const ls = parseFloat(getComputedStyle(li).letterSpacing) || 0;
  return { x: left + (li.offsetWidth - ls) / 2, top };
}

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
    // the pin steps aside while the word travels: it fades as the word sets off (the i's own dot
    // shows through as it goes), and the header's pin appears once the word is in place
    mk.animate([{ opacity: 1, transform: getComputedStyle(mk).transform }, { opacity: 0, transform: `${getComputedStyle(mk).transform} scale(.8)` }], { duration: 200, easing: "ease-out", fill: "forwards" });
    logo.classList.add("landing");
    root.classList.add("land");
    setTimeout(landed, FLY - 60); // the home arrives as the word settles
    setTimeout(() => {
      logo.classList.remove("landing");
      logo.classList.add("pinin");
      setTimeout(() => logo.classList.remove("pinin"), 700);
      root.remove();
      releasePages();
      done();
    }, FLY);
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

  // the scene: the app's own pieces, arriving and cutting out on their beats
  const col = root.querySelector(".icol");
  for (const [cls, x, y, w, hh, tin, tout, html] of PIECES()) {
    // piece classes get a p- prefix: bare names (toast, pin…) would pick up the app's own rules
    const el = h(`<div class="ip ${cls.split(" ").map((c) => "p-" + c).join(" ")}" style="left:${W / 2 + x}px;top:${H / 2 + y}px;${w ? `width:${w}px;` : ""}${hh ? `height:${hh}px;` : ""}--in:${tin}ms"></div>`);
    if (html === "TOOLBAR") {
      const c = copyOf("tb");
      if (!c) continue;
      el.append(c);
    } else if (html.startsWith("INK:")) {
      el.innerHTML = inkSvg(html.slice(4));
      addInk(el.querySelector(".ik"), tin + 60);
    } else el.innerHTML = html;
    col.append(el);
    at(tout, () => el.classList.add("cut")); // a cut, never a fade
  }
  at(1750, () => col.querySelector(".p-cursor")?.classList.add("go")); // the agent goes to the cards
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
  // the pin rises to wait right above where the ı will be (the letters are laid out before they
  // show), so when it drops it falls straight down onto the stem
  at(3960, () => {
    root.classList.add("typing");
    const d = dotAt();
    mk.animate([{ transform: getComputedStyle(mk).transform }, { transform: `translate(${d.cx - W / 2}px, ${d.cy - 78 - H / 2}px) scale(${(d.size * 1.25) / 72})` }], { duration: 460, easing: "cubic-bezier(.34,1.3,.64,1)", fill: "forwards" });
  });
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
  // where the pin sits as the i's dot: on top of the ı's stem, centred over it, overlapping a hair
  function dotAt() {
    const word = root.querySelector(".ilock");
    const li = word.querySelector(".li");
    const W0 = word.getBoundingClientRect(); // the word itself doesn't move while the pin drops
    const s = stage.getBoundingClientRect();
    const kk = k();
    const size = li.offsetHeight * 0.34; // the line is 1em tall
    const st = stemOf(word, li);
    return { cx: (W0.left - s.left) / kk + st.x, cy: (W0.top - s.top) / kk + st.top - size * 0.42, size };
  }
  function placeDot(now) {
    const { cx, cy, size } = dotAt();
    const target = `translate(${cx - W / 2}px, ${cy - H / 2}px) scale(${size / 72})`;
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
