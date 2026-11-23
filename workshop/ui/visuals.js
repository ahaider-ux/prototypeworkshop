// Product visuals: what Atelier does, shown in Atelier's own interface (see the product-visuals
// skill). Each picture is composed from the app's real classes (branch rows, a comment peek, the
// composer, a toast, a review row, a recipe card) and its real marker engine, set in depth on the
// studio light: one focal piece, crisp; its context frosted and further away. No people, avatars,
// placeholder text or repeated words: the art is part of the product, so it follows the same rules.
//
// The same pictures are the cards on the home and the Learn page, and the art in the Learn dialog
// (an announcement flow: an intro step, then one step per feature, the bars showing the real count).

import { h, esc, IC, modal, closeModal } from "./lib.js";
import { outline } from "./ink.js";

// every picture is drawn in a 360 × 240 design box and scaled to fit wherever it's shown
const BW = 360,
  BH = 240;

// a hand-drawn stroke from Atelier's own pen engine, as an SVG path in the design box
const ring = (cx, cy, rx, ry) =>
  outline(
    Array.from({ length: 54 }, (_, i) => {
      const a = -2.3 + (i / 53) * Math.PI * 2 * 1.08;
      return [cx + Math.cos(a) * rx * (1 + i / 420), cy + Math.sin(a) * ry * (1 - i / 520)];
    }),
    "marker",
    4,
    1,
  );
const arrow = (pts) => outline(pts, "marker", 3.4, 1);

// a piece of a picture: x/y/w in the design box, plus its depth (scale, opacity, blur)
const piece = (x, y, html, { w = 0, s = 1, o = 1, b = 0, z = 1, cls = "" } = {}) =>
  `<div class="pv-x${cls ? " " + cls : ""}" style="left:${x}px;top:${y}px;${w ? `width:${w}px;` : ""}--s:${s};--o:${o};--b:${b}px;z-index:${z}">${html}</div>`;
const PAGE = `<div class="pv-page"><i class="hd"></i><i></i><i></i><i></i><i></i><i></i><i></i></div>`;
const pointer = `<svg class="pv-cursor" viewBox="0 0 16 16" aria-hidden="true"><path d="M3 2.5 13 8l-4.3 1.2L7 13.5Z"/></svg>`;

const ART = {
  // the whole idea at a glance: a selected empty frame, a hand rings it, the agent is on it, and
  // its branch is ready (hero at scale + a popover spilling off a cropped surface)
  intro: () =>
    piece(28, 44, `<span class="pv-lbl">Start screen</span><div class="pv-frame"><div class="pv-empty pempty">Ask an agent to design it</div></div><span class="isel"><i class="ic1"></i><i class="ic2"></i><i class="ic3"></i><i class="ic4"></i></span>`, { w: 196, cls: "pv-sel" }) +
    `<svg class="pv-ink" viewBox="0 0 ${BW} ${BH}" aria-hidden="true"><path class="ik red" d="${ring(126, 108, 94, 48)}"/></svg>` +
    piece(188, 134, `<div class="pinpeek"><div class="ph"><span class="pv-ag">${IC.spark}</span><b>Claude</b><span>now</span></div><p>On it, on a branch.</p></div>`, { w: 160, z: 3 }) +
    piece(118, 200, `<div class="toast is-open"><div class="tcol"><span class="tt2">${IC.fork}Branch ready to review</span></div></div>`, { s: 0.9, z: 2 }),

  // a branch, lifted out of its list: the list frosted behind, the one row crisp and nearer
  branch: () =>
    piece(36, 46, `<div class="pv-panel"><div class="shd"><span>Branches</span><span class="n">3</span></div><div class="pgs"><div class="pg on">${IC.board}<span class="t">Main</span></div><div class="pg">${IC.fork}<span class="t">Denser sidebar</span><span class="m ch">1</span></div><div class="pg pv-slot"></div></div></div>`, { w: 210, o: 0.78, b: 1.2 }) +
    piece(84, 146, `<div class="pg pv-lift">${IC.fork}<span class="t">Roomier cards</span><span class="m ch">2 changes</span></div>`, { w: 196, s: 1.3, z: 3 }),

  // a note at macro scale over its screen, blurred past reading; a hand's arrow points into it
  markup: () =>
    piece(70, 26, `<div class="pv-frame pv-far">${PAGE}</div>`, { w: 250, o: 0.42, b: 5 }) +
    piece(34, 70, `<div class="note warm"><div class="tx">Tighten the cards, they feel cramped</div></div>`, { w: 150, s: 1.35, z: 3, cls: "pv-tilt" }) +
    `<svg class="pv-ink" viewBox="0 0 ${BW} ${BH}" aria-hidden="true"><path class="ik green" d="${arrow(Array.from({ length: 22 }, (_, i) => { const t = i / 21; return [222 + 70 * t, 150 - 46 * t + 18 * Math.sin(Math.PI * t)]; }))}"/><path class="ik green" d="${arrow([[280, 98], [293, 104], [287, 118]])}"/></svg>`,

  // a request in the composer with the agent switched on, the pointer on the switch
  agent: () =>
    piece(56, 34, `<div class="pv-panel pv-far"><div class="pv-rows"><i></i><i></i><i></i></div></div>`, { w: 250, o: 0.5, b: 3 }) +
    piece(46, 98, `<div class="ccomp"><div class="cbox"><span class="ctx">Make the button bolder</span><div class="cbar"><span class="cagent" aria-pressed="true" data-aim>${IC.spark}Agent fixes this</span><span class="sp"></span><span class="csend">${IC.send}</span></div></div></div>`, { w: 236, s: 1.25, z: 3 }) +
    piece(0, 0, pointer, { z: 4, cls: "pv-aim" }),

  // one change in review, in focus; the others step away; the pointer on Merge
  merge: () =>
    piece(62, 30, `<div class="pv-chg"><span class="k">.cards</span><span>padding</span></div>`, { w: 200, s: 1.06, o: 0.3, b: 3.5 }) +
    piece(52, 78, `<div class="pv-chg pv-focus"><span class="k">#hmGrid</span><span>gap</span><span class="pv-was">none</span><span class="pv-now">32px</span></div>`, { w: 230, s: 1.3, z: 3 }) +
    piece(66, 150, `<div class="pv-chg"><span class="k">.side</span><span>width</span></div>`, { w: 200, s: 1.1, o: 0.4, b: 2 }) +
    piece(196, 182, `<button type="button" class="createbtn" tabindex="-1" data-aim>${IC.check}Merge into Main</button>`, { z: 4 }) +
    piece(0, 0, pointer, { z: 5, cls: "pv-aim" }),

  // a recipe in focus, its neighbours in the deck behind
  recipes: () =>
    piece(150, 22, `<div class="pv-card pv-far"><b>Check contrast</b></div>`, { w: 170, s: 1.06, o: 0.3, b: 3.5 }) +
    piece(40, 70, `<div class="isec rcard pv-card"><div class="ih"><b>Polish pass</b><span class="tagro info">Auto</span></div><div class="rcs"><div class="rcbar" aria-hidden="true"><i class="m" style="flex:4"></i><i class="o" style="flex:1"></i></div><span class="rcst">5 runs · 4 merged</span></div></div>`, { w: 220, s: 1.28, z: 3 }) +
    piece(196, 176, `<div class="pv-card pv-far"><b>Tidy spacing</b></div>`, { w: 150, s: 1.1, o: 0.45, b: 2 }),
};

// what each step says; try: what it does for real, when there's a real thing to do
export const FEATURES = [
  { id: "intro", title: "Introducing Atelier", text: "A canvas for your HTML prototypes, where people and agents try ideas on branches and merge what works." },
  { id: "branch", title: "Try every idea on a branch", text: "Change anything on a branch while Main stays as it is. Nothing lands until you merge it." },
  { id: "markup", title: "Mark it up like paper", text: "Notes, highlights, arrows and hand-drawn marks stay on the canvas, and agents read them as feedback." },
  { id: "agent", title: "Hand it to an agent", text: "Ask in plain words. Claude takes the request, works on its own branch and tells you when it's ready.", try: "agent" },
  { id: "merge", title: "Review, then merge", text: "See every change side by side, keep what works and say why. The reason goes in the decision log." },
  { id: "recipes", title: "Save how your team works", text: "Recipes are shared instructions for recurring work that anyone, or any agent, can run again." },
];

// a picture, in a box of any size: the design box is scaled to fit and centred on the studio light
export function artEl(id) {
  const el = h(`<div class="pv" aria-hidden="true"><div class="pv-bloom"></div><div class="pv-box">${(ART[id] || ART.intro)()}</div></div>`);
  const box = el.querySelector(".pv-box");
  const fit = () => {
    const w = el.clientWidth,
      hh = el.clientHeight;
    if (!w || !hh) return;
    const sc = Math.min(w / BW, hh / BH);
    box.style.transform = `translate(-50%, -50%) scale(${sc.toFixed(4)})`;
    // a pointer lands on its control, in the padding just past the label, never on the words
    const ptr = box.querySelector(".pv-aim"),
      to = box.querySelector("[data-aim]");
    if (ptr && to) {
      const b = box.getBoundingClientRect(),
        r = to.getBoundingClientRect();
      ptr.style.left = `${((r.right - b.left) / sc - 9).toFixed(1)}px`;
      ptr.style.top = `${((r.top - b.top + r.height * 0.55) / sc).toFixed(1)}px`;
    }
  };
  new ResizeObserver(fit).observe(el);
  return el;
}

// a card: the picture, its title and one line; opens the Learn dialog on that step
export function featureCard(i, onOpen) {
  const f = FEATURES[i];
  const c = h(`<button type="button" class="lcard"><span class="lart"></span><span class="lcap"><b>${esc(f.title)}</b><span>${esc(f.text)}</span></span></button>`);
  c.querySelector(".lart").replaceWith(Object.assign(artEl(f.id), { className: "pv lart" }));
  c.onclick = () => onOpen(i);
  return c;
}

// The Learn dialog: copy on the left, the picture on the right, one step at a time. The intro step
// offers "Learn more" (the Learn page) and "See what's new" (the next step); the last step's main
// button is Done. actions: { learn(), agent() } for the real things a step can do.
export function openLearn(start = 0, actions = {}) {
  let i = Math.max(0, Math.min(FEATURES.length - 1, start));
  const md = modal(`<div class="lrn"><div class="lrn-c"><div class="lrn-bars" aria-hidden="true">${FEATURES.map(() => "<i></i>").join("")}</div><div class="lrn-t"><h2></h2><p></p></div><div class="lrn-f"><button type="button" class="ghbtn" data-a="try" hidden></button><span class="sp"></span><button type="button" class="dbtn" data-a="back"></button><button type="button" class="createbtn" data-a="next"></button></div></div><div class="lrn-a"></div></div><button type="button" class="ib32 lrn-x" data-a="x" aria-label="Close">${IC.x}</button>`);
  md.classList.add("lrn-md");
  const art = md.querySelector(".lrn-a");
  const show = (animate) => {
    const f = FEATURES[i];
    md.querySelectorAll(".lrn-bars i").forEach((b, k) => b.classList.toggle("on", k <= i));
    md.querySelector(".lrn-bars").setAttribute("aria-label", `Step ${i + 1} of ${FEATURES.length}`);
    md.querySelector("h2").textContent = f.title;
    md.querySelector("p").textContent = f.text;
    const back = md.querySelector('[data-a="back"]'),
      next = md.querySelector('[data-a="next"]'),
      tryB = md.querySelector('[data-a="try"]');
    back.textContent = i === 0 ? "Learn more" : "Back";
    next.textContent = i === 0 ? "See what's new" : i === FEATURES.length - 1 ? "Done" : "Next";
    const t = f.try && actions[f.try] ? f.try : null;
    tryB.hidden = !t;
    tryB.textContent = t === "agent" ? "Connect an agent" : "";
    const pic = artEl(f.id);
    pic.classList.add("lrn-pic");
    if (animate) pic.classList.add("in");
    art.replaceChildren(pic);
    if (animate) md.querySelector(".lrn-t").animate([{ opacity: 0, filter: "blur(2px)" }, { opacity: 1, filter: "blur(0)" }], { duration: 150, easing: "ease-out" });
  };
  md.addEventListener("click", (e) => {
    const a = e.target.closest("[data-a]")?.dataset.a;
    if (a === "x") closeModal();
    else if (a === "next") i < FEATURES.length - 1 ? (i++, show(true)) : closeModal();
    else if (a === "back") i === 0 ? (closeModal(), actions.learn?.()) : (i--, show(true));
    else if (a === "try") (closeModal(), actions[FEATURES[i].try]?.());
  });
  md.addEventListener("keydown", (e) => {
    if (e.key === "ArrowRight" && i < FEATURES.length - 1) (i++, show(false));
    if (e.key === "ArrowLeft" && i > 0) (i--, show(false));
  });
  show(false);
  return md;
}
