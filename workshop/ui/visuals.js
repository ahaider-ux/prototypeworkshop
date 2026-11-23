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

// Each picture, after how Paper presents its guides: a short plain phrase as the picture's headline,
// centred on the canvas, and one real piece of Atelier under it, showing exactly that. Nothing else.
const head = (t) => `<div class="pv-hl">${t}</div>`;
const ART = {
  // people and agents on one canvas: a selected frame, your cursor and Claude's
  intro: () =>
    head("people and agents,<br>one canvas") +
    piece(120, 128, `<div class="pv-frame pv-mini"></div><span class="isel"><i class="ic1"></i><i class="ic2"></i><i class="ic3"></i><i class="ic4"></i></span>`, { w: 120, cls: "pv-sel" }) +
    piece(68, 204, `${pointer}<b class="pv-tag you">You</b>`, { z: 3, cls: "pv-who" }) +
    piece(246, 112, `${pointer}<b class="pv-tag agent">Claude</b>`, { z: 3, cls: "pv-who" }),

  // the home banner's picture: the same scene without a headline (the banner's own title says it)
  hero: () =>
    piece(116, 76, `<div class="pv-frame pv-mini pv-hero"></div><span class="isel"><i class="ic1"></i><i class="ic2"></i><i class="ic3"></i><i class="ic4"></i></span>`, { w: 128, cls: "pv-sel" }) +
    piece(64, 172, `${pointer}<b class="pv-tag you">You</b>`, { z: 3, cls: "pv-who" }) +
    piece(250, 62, `${pointer}<b class="pv-tag agent">Claude</b>`, { z: 3, cls: "pv-who" }),

  import: () =>
    head("bring in any<br>HTML prototype") +
    piece(118, 150, `<button type="button" class="createbtn" tabindex="-1">${IC.upload}Import HTML</button>`, { z: 2 }),

  branch: () =>
    head("try every idea<br>on a branch") +
    piece(73, 132, `<div class="pv-panel"><div class="pgs"><div class="pg on">${IC.board}<span class="t">Main</span></div><div class="pg">${IC.fork}<span class="t">Bigger header</span><span class="m ch">2 changes</span></div></div></div>`, { w: 214, cls: "pv-c" }),

  markup: () =>
    head("mark it up<br>like paper") +
    piece(124, 130, `<div class="note warm"><div class="tx">Make this bolder</div></div>`, { w: 112, cls: "pv-tilt" }),

  agent: () =>
    head("hand it<br>to an agent") +
    piece(66, 134, `<div class="ccomp"><div class="cbox"><span class="ctx">Make the header bigger</span><div class="cbar"><span class="cagent" aria-pressed="true">${IC.spark}Agent fixes this</span><span class="sp"></span><span class="csend">${IC.send}</span></div></div></div>`, { w: 228 }),

  merge: () =>
    head("review it,<br>then merge") +
    piece(108, 150, `<button type="button" class="createbtn" tabindex="-1">${IC.check}Merge into Main</button>`, { z: 2 }),

  recipes: () =>
    head("save how<br>you work") +
    piece(92, 132, `<div class="isec rcard pv-card"><div class="ih"><b>Polish pass</b><span class="tagro">Recipe</span></div><div class="rca"><button type="button" class="dbtn sm" tabindex="-1">${IC.play}Run</button></div></div>`, { w: 176 }),
};

// what each guide says, in plain words: what you do, and what you get
export const FEATURES = [
  { id: "intro", title: "Welcome to Atelier", text: "Prototype in HTML with your team and AI agents on one canvas. Learn the basics in two minutes." },
  { id: "import", title: "Import a prototype", text: "Bring in an HTML file or a whole folder. Each screen becomes a frame on the canvas.", try: "import" },
  { id: "branch", title: "Try an idea on a branch", text: "Change anything on a branch while Main stays as it is. Nothing lands until you merge it.", try: "branch" },
  { id: "markup", title: "Mark up a screen", text: "Leave notes, highlights, arrows and drawings on any screen. Agents read them as feedback.", try: "markup" },
  { id: "agent", title: "Ask an agent", text: "Describe a change in plain words. Claude makes it on its own branch and tells you when it's ready.", try: "agent" },
  { id: "merge", title: "Review and merge", text: "See every change side by side, keep what works and note why. The reason goes in the decision log.", try: "merge" },
  { id: "recipes", title: "Save a recipe", text: "Turn work you repeat into a recipe that anyone, or any agent, can run again.", try: "recipes" },
];

// a picture, in a box of any size: the design box is scaled to fit and centred on the studio light
export function artEl(id) {
  const el = h(`<div class="pv" aria-hidden="true"><div class="pv-box">${(ART[id] || ART.intro)()}</div></div>`);
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
// button is Done. actions: { learn() } plus, for each step's `try`, { label, run() }: the real thing
// the step describes, done on the person's own prototypes (missing when it can't be done here).
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
    const t = f.try ? actions[f.try] : null;
    tryB.hidden = !t;
    tryB.textContent = t ? t.label : "";
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
    else if (a === "try") (closeModal(), actions[FEATURES[i].try]?.run());
  });
  md.addEventListener("keydown", (e) => {
    if (e.key === "ArrowRight" && i < FEATURES.length - 1) (i++, show(false));
    if (e.key === "ArrowLeft" && i > 0) (i--, show(false));
  });
  show(false);
  return md;
}
