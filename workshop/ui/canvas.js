// The canvas shows one page: a prototype's main, or one of its branches. Boards are live pages (the
// prototype at one screen) at their real size, titled like frames in a design tool. Notes,
// highlight boxes, arrows and comment pins annotate the page. On a branch, Compare puts main's
// screens above the branch's, live. Design mode puts a hit layer over each board to select elements
// inside it; Interact hands the pointer to the page.

import { S, on, fire, itemsOf, isBranch, screenName, pageItems, pageEnv, plural } from "./state.js";
import { $, h, esc, clamp, frScale, api, toast, IC, menu, rmo, timeAgo } from "./lib.js";
import { commitRules, preview, endPreview, undoStyle, idle as stylesIdle } from "./styles.js";
import * as G from "./gfx.js";
import { record, rid, remap, undo as histUndo, redo as histRedo } from "./history.js";

const B = new Map(); // board item id → {id, el, hit, frame, live, ready} — frame only while mounted live
const NEL = new Map(); // note/box item id → element
const GH = new Map(); // compare boards: main's screens above a branch's, not saved anywhere
const HUD = { labels: new Map(), alabels: new Map(), pins: new Map(), sel: null, hover: null, size: null, handles: [], ehandles: [], ins: null, draft: null, multi: [], guides: [] };
let cv, world, hud, wires, boardLayer, noteLayer, rulerH, rulerV;
const RULER = 20;
const MAX_LIVE = 3; // Guard: live pages are costly to pan and zoom; everything else is a bitmap
let gfxDirty = true;
let hoverBoard = null,
  hoverT = 0;
let pendingPick = null; // a click on a board that wasn't live yet: picked once its page is ready
let pop = null;
let dirty = true;
let lastZ = 0;

const SNAP = 8;
const MINZ = 0.05,
  MAXZ = 4;

export const boardOf = (id) => B.get(id);
export const docOf = (id) => {
  try {
    return B.get(id)?.frame?.contentDocument || null;
  } catch {
    return null;
  }
};
export const winOf = (id) => {
  try {
    return B.get(id)?.frame?.contentWindow || null;
  } catch {
    return null;
  }
};
export const rt = (id) => {
  try {
    return winOf(id)?.__workshop || null;
  } catch {
    return null;
  }
};
export const markDirty = () => ((dirty = true), (gfxDirty = true));
export const isDragging = () => !!drag;
const item = (id) => S.items.get(id) || GH.get(id);
export const isGhost = (id) => GH.has(id);
const pageBoards = () => [...pageItems("board"), ...GH.values()];

// ---------- coordinates ----------
function local(e) {
  const r = cv.getBoundingClientRect();
  const fr = frScale();
  return { x: (e.clientX - r.left) / fr, y: (e.clientY - r.top) / fr };
}
export const toWorld = (p) => ({ x: (p.x - S.cam.x) / S.cam.z, y: (p.y - S.cam.y) / S.cam.z });
export const toScreen = (w) => ({ x: w.x * S.cam.z + S.cam.x, y: w.y * S.cam.z + S.cam.y });

// the part of the canvas the rulers, the page banner and the toolbar don't cover
export function viewRect() {
  if ($("frame").classList.contains("present")) return { x0: 0, y0: 0, x1: cv.clientWidth, y1: cv.clientHeight };
  const r = S.rulers === false ? 0 : RULER;
  const banner = $("banner").childElementCount ? 80 : r;
  return { x0: r, y0: banner, x1: cv.clientWidth, y1: cv.clientHeight - 72 };
}

function boardAtPoint(p) {
  const w = toWorld(p);
  for (const b of [...pageItems("board")].reverse()) if (w.x >= b.x && w.x <= b.x + b.w && w.y >= b.y && w.y <= b.y + b.h) return b;
  return null;
}
function elAt(id, p) {
  const d = docOf(id),
    b = item(id);
  if (!d || !b) return null;
  const w = toWorld(p);
  let hits = [];
  try {
    hits = d.elementsFromPoint(w.x - b.x, w.y - b.y);
  } catch {
    return null;
  }
  // the topmost element you can actually see: pages often keep transparent overlays on top
  const win = d.defaultView;
  const seen = (el) => {
    for (let x = el; x && x !== d.documentElement; x = x.parentElement) {
      const cs = win.getComputedStyle(x);
      if (cs.visibility === "hidden" || parseFloat(cs.opacity) < 0.05) return false;
    }
    return true;
  };
  for (const el of hits.slice(0, 12)) {
    if (el === d.documentElement || el === d.body) return null;
    if (el.closest?.(".ws-ghost") || !seen(el)) continue;
    return el;
  }
  return null;
}

// ---------- camera ----------
function applyCam() {
  gfxDirty = true;
  world.style.transform = `translate(${S.cam.x}px, ${S.cam.y}px) scale(${S.cam.z})`;
  $("zPct").textContent = Math.round(S.cam.z * 100) + "%";
  dirty = true;
  saveCam();
}
let camT = 0;
// each page keeps its own view, in this browser
function cams() {
  try {
    const c = JSON.parse(localStorage.getItem("ws-cams") || "{}");
    return c && typeof c === "object" ? c : {};
  } catch {
    return {};
  }
}
function saveCam() {
  clearTimeout(camT);
  const page = S.page;
  if (!page || S.presenting) return;
  const cam = { ...S.cam };
  camT = setTimeout(() => {
    try {
      const c = cams();
      c[page] = cam;
      const keys = Object.keys(c);
      if (keys.length > 200) delete c[keys[0]];
      localStorage.setItem("ws-cams", JSON.stringify(c));
    } catch {}
  }, 300);
}
// the view this page had last time, if any
export function restoreCam(page) {
  const c = cams()[page];
  if (!c || ![c.x, c.y, c.z].every(Number.isFinite)) return false;
  cancelAnimationFrame(tween);
  Object.assign(S.cam, { x: c.x, y: c.y, z: clamp(c.z, MINZ, MAXZ) });
  applyCam();
  return true;
}
let tween = 0;
function camTo(target, ms = 320) {
  cancelAnimationFrame(tween);
  if (rmo() || ms <= 0) {
    Object.assign(S.cam, target);
    return applyCam();
  }
  const from = { ...S.cam },
    t0 = performance.now();
  const ease = (t) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2);
  const step = (t) => {
    const k = clamp((t - t0) / ms, 0, 1),
      e = ease(k);
    S.cam.x = from.x + (target.x - from.x) * e;
    S.cam.y = from.y + (target.y - from.y) * e;
    S.cam.z = from.z + (target.z - from.z) * e;
    applyCam();
    if (k < 1) tween = requestAnimationFrame(step);
  };
  tween = requestAnimationFrame(step);
}
export function zoomAt(p, f) {
  const z = clamp(S.cam.z * f, MINZ, MAXZ);
  S.cam.x = p.x - (p.x - S.cam.x) * (z / S.cam.z);
  S.cam.y = p.y - (p.y - S.cam.y) * (z / S.cam.z);
  S.cam.z = z;
  applyCam();
}
const viewCenter = () => {
  const v = viewRect();
  return { x: (v.x0 + v.x1) / 2, y: (v.y0 + v.y1) / 2 };
};
export const viewCenterWorld = () => toWorld(viewCenter());
export const zoomBy = (f) => zoomAt(viewCenter(), f);
export function zoomTo(z) {
  const c = viewCenter();
  const w = toWorld(c);
  camTo({ z, x: c.x - w.x * z, y: c.y - w.y * z }, 240);
}
function rectsBounds(rects) {
  if (!rects.length) return null;
  return { x0: Math.min(...rects.map((r) => r.x)), y0: Math.min(...rects.map((r) => r.y)), x1: Math.max(...rects.map((r) => r.x + r.w)), y1: Math.max(...rects.map((r) => r.y + r.h)) };
}
export function fitRect(r, { ms = 320, maxZ = 1, pad = 48 } = {}) {
  if (!r) return;
  const v = viewRect();
  const vw = v.x1 - v.x0 - pad * 2,
    vh = v.y1 - v.y0 - pad * 2;
  const z = clamp(Math.min(vw / (r.x1 - r.x0), vh / (r.y1 - r.y0), maxZ), MINZ, MAXZ);
  camTo({ z, x: v.x0 + pad + (vw - (r.x1 - r.x0) * z) / 2 - r.x0 * z, y: v.y0 + pad + (vh - (r.y1 - r.y0) * z) / 2 - r.y0 * z }, ms);
}
export function fit(opts) {
  fitRect(pageBounds(), { maxZ: 0.6, ...opts });
}
// Notes are counter-scaled so they stay readable when zoomed out: size them for the zoom the boards
// alone would fit at, or a fit would cut them off.
export function pageBounds() {
  const v = viewRect();
  const zOf = (r) => (r ? clamp(Math.min((v.x1 - v.x0 - 96) / (r.x1 - r.x0 || 1), (v.y1 - v.y0 - 96) / (r.y1 - r.y0 || 1), 0.6), MINZ, MAXZ) : 1);
  let r = rectsBounds([...pageBoards(), ...pageItems("box")]);
  if (!pageItems("note").length) return r;
  for (let i = 0; i < 4; i++) {
    const k = clamp(10 / (16 * zOf(r)), 1, 4);
    r = rectsBounds([...pageBoards(), ...pageItems("box"), ...pageItems("note").map((n) => ({ x: n.x, y: n.y, w: n.w * k, h: 140 * k }))]);
  }
  return r;
}
export function focusItem(id, opts) {
  const it = item(id);
  if (!it) return;
  if (it.type === "arrow") return;
  fitRect(rectsBounds([it.type === "note" ? noteRect(it) : it]), { maxZ: 1, ...opts });
}
const noteRect = (n) => ({ x: n.x, y: n.y, w: n.w, h: 140 });

export function isVisible(id) {
  const it = item(id);
  if (!it) return false;
  const v = viewRect(),
    a = toScreen(it);
  return a.x < v.x1 && a.y < v.y1 && a.x + (it.w || 0) * S.cam.z > v.x0 && a.y + (it.h || 140) * S.cam.z > v.y0;
}

// ---------- render ----------
function buildGhosts() {
  GH.clear();
  const env = pageEnv();
  if (!S.compare || !isBranch(env)) return;
  for (const b of pageItems("board")) GH.set(`cmp-${b.id}`, { id: `cmp-${b.id}`, type: "board", env: env.parent, screen: b.screen, state: b.state, x: b.x, y: b.y - b.h - 240, w: b.w, h: b.h, ghost: true, of: b.id });
}
export function sync() {
  buildGhosts();
  const want = new Set(pageBoards().map((b) => b.id));
  // boards: this page's; other pages' keep their bitmaps in the graphics layer, not their pages
  for (const [id, b] of B) {
    if (item(id) && want.has(id)) continue;
    unmount(id, true);
    b.el.remove();
    B.delete(id);
    HUD.labels.get(id)?.remove();
    HUD.labels.delete(id);
  }
  for (const it of pageBoards()) {
    let b = B.get(it.id);
    if (!b) b = makeBoard(it);
    b.el.style.left = it.x + "px";
    b.el.style.top = it.y + "px";
    b.el.style.width = it.w + "px";
    b.el.style.height = it.h + "px";
    if (b.live && b.src !== boardSrc(it)) reloadBoard(it.id);
  }
  gfxDirty = true;
  // notes and boxes on this page
  const anns = [...pageItems("note"), ...pageItems("box")];
  const live = new Set(anns.map((a) => a.id));
  for (const [id, el] of NEL) if (!live.has(id)) (el.remove(), NEL.delete(id));
  const boxes = pageItems("box");
  for (const it of anns) {
    let el = NEL.get(it.id);
    if (!el) {
      el = it.type === "note" ? h(`<div class="note" data-item="${esc(it.id)}"><div class="tx"></div><div class="by"></div></div>`) : h(`<div class="box" data-item="${esc(it.id)}"><span class="lb"><i></i><span></span></span></div>`);
      noteLayer.append(el);
      NEL.set(it.id, el);
      lastZ = 0; // counter-scale the new one on the next frame
    }
    el.style.left = it.x + "px";
    el.style.top = it.y + "px";
    if (it.type === "note") {
      el.className = `note ${it.tone || "warm"}`;
      el.style.width = it.w + "px";
      const tx = el.querySelector(".tx");
      if (!tx.isContentEditable && tx.textContent !== it.text) tx.textContent = it.text || "";
      el.querySelector(".by").textContent = `${it.author || "You"} · ${timeAgo(it.updatedAt || it.createdAt)}`;
    } else {
      el.style.width = it.w + "px";
      el.style.height = it.h + "px";
      el.querySelector(".lb i").textContent = String(boxes.indexOf(it) + 1);
      el.querySelector(".lb span").textContent = it.label || "Highlight";
    }
  }
  $("cvEmpty").hidden = !S.page || pageBoards().length > 0 || anns.length > 0;
  dirty = true;
}

function boardSrc(it) {
  const q = new URLSearchParams({ "ws-board": it.id });
  if (it.screen) q.set("ws-screen", it.screen);
  if (it.state) q.set("ws-state", it.state);
  return `/env/${encodeURIComponent(it.env)}/?${q}`;
}

function makeBoard(it) {
  const el = h(`<div class="bd${it.ghost ? " ghost" : ""}" data-item="${esc(it.id)}"><div class="hit"></div></div>`);
  const b = { id: it.id, el, hit: el.querySelector(".hit"), frame: null, live: false, ready: false, src: "" };
  boardLayer.append(el);
  B.set(it.id, b);
  return b;
}

// ---------- live pages: only where you're working ----------
function mount(id) {
  const b = B.get(id),
    it = item(id);
  if (!b || !it || b.live) return;
  const env = S.envs.get(it.env);
  const fr = h(`<iframe title="${esc(env?.name || it.env)} · ${esc(screenName(it))}" allow="clipboard-read; clipboard-write; fullscreen"></iframe>`);
  b.frame = fr;
  b.live = true;
  b.ready = false;
  b.touched = false;
  b.src = boardSrc(it);
  fr.addEventListener("load", () => b.frame === fr && onBoardLoad(b));
  b.el.insertBefore(fr, b.hit);
  b.el.classList.add("live");
  fr.src = b.src;
  gfxDirty = true;
}
// put a live page away; it leaves a fresh bitmap behind if it changed while live
function unmount(id, now = false) {
  const b = B.get(id);
  if (!b?.live) return;
  const it = item(id);
  const fr = b.frame;
  const done = () => {
    if (b.frame !== fr) return;
    b.frame = null;
    b.live = false;
    b.ready = false;
    b.shown = false;
    b.el.classList.remove("live", "ready");
    fr.src = "about:blank";
    fr.remove();
    gfxDirty = true;
  };
  if (!now && it && b.ready && (b.touched || !G.hasFresh(it))) {
    b.leaving = true;
    G.captureLive(it, fr.contentDocument).finally(() => ((b.leaving = false), done()));
  } else done();
}
// which boards are live: the selected one, the one under the pointer, the one presenting, and —
// when zoomed in close enough to read — the few in view
function planLive() {
  const wantLive = [];
  const add = (id) => id && B.has(id) && !isGhost(id) && !wantLive.includes(id) && wantLive.push(id);
  add(S.presenting);
  if (S.sel?.item && item(S.sel.item)?.type === "board") add(S.sel.item);
  add(pop?.board);
  add(pendingPick?.id);
  add(hoverBoard);
  const dpr = window.devicePixelRatio || 1;
  if (S.cam.z * dpr >= 0.55) {
    const v = viewRect();
    const seen = pageItems("board")
      .map((it) => {
        const a = toScreen(it);
        const w = Math.max(0, Math.min(a.x + it.w * S.cam.z, v.x1) - Math.max(a.x, v.x0)),
          hh = Math.max(0, Math.min(a.y + it.h * S.cam.z, v.y1) - Math.max(a.y, v.y0));
        return { id: it.id, area: w * hh };
      })
      .filter((x) => x.area > 0)
      .sort((a, b) => b.area - a.area);
    for (const x of seen) if (wantLive.length < MAX_LIVE) add(x.id);
  }
  const keep = new Set(wantLive.slice(0, Math.max(MAX_LIVE, wantLive.indexOf(hoverBoard) + 1)));
  for (const id of keep) mount(id);
  const now = performance.now();
  for (const [id, b] of B) {
    if (!b.live || keep.has(id) || b.leaving) {
      b.idleSince = 0;
      continue;
    }
    // a short grace period, so sweeping the pointer across boards doesn't thrash them
    if (!b.idleSince) b.idleSince = now;
    else if (now - b.idleSince > 1500) unmount(id);
  }
}
// what the background pool should render next: this page's boards, the ones in view first
function planSnapshots() {
  const v = viewRect();
  const jobs = pageBoards()
    .filter((it) => !G.hasFresh(it))
    .map((it) => {
      const a = toScreen(it);
      const inView = a.x < v.x1 && a.y < v.y1 && a.x + it.w * S.cam.z > v.x0 && a.y + it.h * S.cam.z > v.y0;
      const cx = a.x + (it.w * S.cam.z) / 2 - (v.x0 + v.x1) / 2,
        cy = a.y + (it.h * S.cam.z) / 2 - (v.y0 + v.y1) / 2;
      return { it, prio: (inView ? 0 : 1e9) + Math.hypot(cx, cy) };
    })
    .sort((a, b) => a.prio - b.prio)
    .map(({ it }) => ({ key: G.keyOf(it), it: { ...it }, src: boardSrc({ ...it, id: `snap-${it.id}` }), textEdits: !!S.envs.get(it.env)?.patches?.length }));
  // a ready live board renders itself; no need to load it twice
  G.want(jobs.filter((j) => !(B.get(j.it.id)?.ready && !isGhost(j.it.id))));
}
let gfxCol = null;
function gfxColors() {
  const theme = document.documentElement.getAttribute("data-ltheme");
  if (gfxCol?.theme === theme) return gfxCol;
  const cs = getComputedStyle(document.documentElement);
  const v = (n) => cs.getPropertyValue(n).trim();
  return (gfxCol = { theme, edge: v("--border-subtle"), page: v("--bg-layer"), text: v("--text-placeholder"), font: v("--fakt") || "sans-serif", label: (it) => screenName(it) });
}
function drawGfx() {
  gfxDirty = false;
  G.draw(
    pageBoards().map((it) => ({ it, covered: !!B.get(it.id)?.shown })),
    S.cam,
    gfxColors(),
  );
}
// the live page and its bitmap must agree: once the page has settled, it renders itself
function captureSoon(b) {
  clearTimeout(b.capT);
  b.capT = setTimeout(() => {
    const it = item(b.id);
    if (b.ready && it) G.captureLive(it, b.frame?.contentDocument);
  }, 1600);
}
// While designing, the keyboard belongs to the canvas: prototypes often focus a field of their own
// (a chat box, a search) when they load or change screen. In Interact mode the page keeps it, and so
// does a text edit in progress.
function guardKeys() {
  const a = document.activeElement;
  if (S.mode !== "design" || a?.tagName !== "IFRAME" || document.querySelector(".bd.editing")) return;
  try {
    a.contentDocument?.activeElement?.blur?.();
  } catch {}
  cv.focus({ preventScroll: true });
}
// A prototype can go back to its own first screen while it starts up (an intro finishing, a saved
// screen restored). Once it has settled, put the board back on its screen and state if it wandered.
function ensureScreen(win, it) {
  try {
    const rtw = win?.__workshop;
    if (!rtw || !it) return false;
    const ad = rtw.adapter();
    let moved = false;
    if (it.screen && ad.screen && ad.screen !== it.screen && ad.screens?.some((x) => x.name === it.screen)) {
      rtw.go(it.screen);
      moved = true;
    }
    if (moved && it.state && it.state !== "Default") setTimeout(() => rtw.setState(it.state), 400);
    return moved;
  } catch {
    return false;
  }
}
function captureCatalog(win, it) {
  if (!it || catalogSent.has(it.env)) return;
  let ad = null;
  try {
    ad = win?.__workshop?.adapter() || null;
  } catch {
    ad = null;
  }
  // Guard: a page read before its tools are ready offers nothing; never let that replace what we know
  if (!ad || !ad.screens?.length) return;
  catalogSent.add(it.env);
  const env = S.envs.get(it.env);
  const cat = { adapter: ad.name, screens: ad.screens, states: ad.states, variants: ad.variants.map((v) => ({ label: v.label, options: v.options })) };
  if (JSON.stringify(env?.catalog || null) !== JSON.stringify(cat))
    api(`envs/${it.env}`, { method: "PATCH", body: { catalog: cat } })
      .then((next) => {
        S.envs.set(it.env, next);
        fire("catalog", it.env);
      })
      .catch(() => {});
}

const catalogSent = new Set();
function onBoardLoad(b) {
  b.ready = true;
  // the bitmap stays in front until the page has settled on its screen, so going live never flashes
  clearTimeout(b.showT);
  const fr0 = b.frame;
  b.showT = setTimeout(() => {
    if (b.frame !== fr0) return;
    b.shown = true;
    b.el.classList.add("ready");
    gfxDirty = true;
  }, 2000);
  const it = item(b.id);
  const d = docOf(b.id);
  if (d) {
    d.addEventListener("keydown", (e) => {
      if (S.presenting && e.key === "Escape") return fire("exit-present");
      if (S.mode === "prototype" && !(e.key === "Escape" && (e.metaKey || e.ctrlKey))) return;
      if (isTyping(e.target)) return;
      // a key pressed while a board's page has focus acts on the canvas (undo, search, nudge…), as if
      // pressed outside it, and doesn't reach the prototype's own shortcuts while you're designing
      const fwd = new KeyboardEvent("keydown", { key: e.key, code: e.code, metaKey: e.metaKey, ctrlKey: e.ctrlKey, shiftKey: e.shiftKey, altKey: e.altKey, bubbles: true, cancelable: true });
      document.dispatchEvent(fwd);
      e.stopPropagation();
      if (fwd.defaultPrevented) e.preventDefault();
    }, true);
    d.addEventListener("keyup", onKeyUp, true);
    // A page that focuses its own field on load (a chat box, a search) would take the keyboard from
    // the canvas. While designing, the canvas keeps it — unless you're editing text in the page.
    const keepKeys = () => {
      if (S.mode !== "design" || b.el.classList.contains("editing") || document.activeElement !== b.frame) return;
      try {
        d.activeElement?.blur?.();
      } catch {}
      cv.focus({ preventScroll: true });
    };
    d.addEventListener("focusin", () => setTimeout(keepKeys, 0), true);
    for (const ms of [0, 400, 1500, 3000]) setTimeout(keepKeys, ms);
    d.addEventListener("pointerdown", () => {
      b.touched = true;
      if (S.mode === "prototype" && S.sel?.item !== b.id && !GH.has(b.id)) selectBoard(b.id, { quiet: true });
    }, true);
  }
  // the page was served with the settings of that moment; they may have changed while it loaded
  const env0 = it && S.envs.get(it.env);
  if (env0) setTimeout(() => rt(b.id)?.apply({ theme: env0.theme, variants: env0.variants, patches: env0.patches }, {}), 300);
  // remember what the prototype offers, for the Screens panel and for agents
  setTimeout(() => captureCatalog(winOf(b.id), it), 900);
  for (const ms of [800, 1800, 3200]) setTimeout(() => b.ready && ensureScreen(winOf(b.id), item(b.id)) && captureSoon(b), ms);
  if (S.outlines) applyOutlines(b);
  captureSoon(b);
  // a click that arrived before the page did
  if (pendingPick?.id === b.id) {
    const pk = pendingPick;
    pendingPick = null;
    setTimeout(() => {
      if (S.mode !== "design" || S.sel?.item !== b.id) return;
      const el = elAt(b.id, toScreen(pk.w));
      if (el) selectEl(b.id, el);
    }, 250);
  }
  if (S.sel?.kind === "el" && S.sel.item === b.id && !S.sel.el.isConnected) {
    const sel = S.sel.info?.exactSelector;
    setTimeout(() => {
      const el = sel ? safeQuery(docOf(b.id), sel) : null;
      if (el) selectEl(b.id, el, { quiet: true });
      else selectBoard(b.id, { quiet: true });
    }, 900);
  }
  fire("board-ready", b.id);
  dirty = true;
}
const safeQuery = (d, sel) => {
  try {
    return d?.querySelector(sel) || null;
  } catch {
    return null;
  }
};

// Something changed in a prototype's folder: swap the overrides in place, or reload its boards.
export async function reloadEnv(env, files = []) {
  G.invalidate(env);
  gfxDirty = true;
  const f = files.filter(Boolean);
  const onlyMeta = f.length && f.every((x) => x === "env.json" || x === "overrides.css");
  const bs = [...B.values()].filter((b) => item(b.id)?.env === env);
  if (onlyMeta) {
    // settings changed (from this canvas, another one, or an agent): show them on every board now
    const e = S.envs.get(env);
    if (e && f.includes("env.json")) for (const b of bs) rt(b.id)?.apply({ theme: e.theme, variants: e.variants, patches: e.patches }, {});
    if (f.includes("overrides.css")) {
      try {
        const { css } = await api(`envs/${env}/styles`);
        for (const b of bs) rt(b.id)?.setOverrides(css);
      } catch {}
    }
    for (const b of bs) if (b.ready) captureSoon(b);
    fire("env-meta", env);
    return;
  }
  for (const b of bs) reloadBoard(b.id);
}
export function reloadBoard(id) {
  const b = B.get(id),
    it = item(id);
  gfxDirty = true;
  if (!b || !it || !b.live) return;
  b.ready = false;
  b.shown = false;
  b.el.classList.remove("ready");
  b.src = boardSrc(it);
  b.frame.src = b.src;
  flash(id, "Updated");
}
function flash(id, text) {
  const l = HUD.labels.get(id);
  if (!l) return;
  const f = l.querySelector(".flash");
  f.textContent = text;
  f.classList.add("on");
  clearTimeout(l._ft);
  l._ft = setTimeout(() => f.classList.remove("on"), 2400);
}

// ---------- selection ----------
let selT = 0;
function pushSelection() {
  clearTimeout(selT);
  selT = setTimeout(() => {
    const s = S.sel;
    let body = null;
    const env = s ? S.envs.get(s.env || item(s.item)?.env) : null;
    if (s && env) {
      const b = s.item ? item(s.item) : null;
      body = { env: env.id, envName: env.name, kind: s.kind, board: b?.type === "board" ? b.id : null, screen: b?.type === "board" ? b.screen : null };
      if (s.kind === "el" && s.info) {
        const i = s.info;
        Object.assign(body, { selector: S.scope === "exact" ? i.exactSelector : i.selector, exactSelector: i.exactSelector, matches: i.matches, label: i.label, text: i.text, html: i.html, styles: i.styles, rect: i.rect });
      }
    } else if (s?.kind === "multi") body = { kind: "multi", items: s.items.map((id) => S.items.get(id)).filter(Boolean) };
    else if (s && s.item && item(s.item)) body = { kind: s.kind, item: item(s.item) };
    api("selection", { method: "PUT", body: { selection: body } }).catch(() => {});
  }, 200);
}
function setSel(sel, quiet) {
  S.sel = sel;
  dirty = true;
  pushSelection();
  fire("sel", { quiet });
}
export function selectBoard(id, { quiet = false } = {}) {
  const it = item(id);
  if (it && !it.ghost) setSel({ kind: "board", item: id, env: it.env }, quiet);
}
export function selectEl(id, el, { quiet = false } = {}) {
  const it = item(id);
  if (!it || it.ghost) return;
  const info = rt(id)?.describe(el) || { tag: el.localName, label: el.localName, selector: el.localName, exactSelector: el.localName, matches: 1, styles: {}, rect: {} };
  setSel({ kind: "el", item: id, env: it.env, el, info }, quiet);
}
export function selectItem(id, { quiet = false } = {}) {
  const it = item(id);
  if (it) setSel({ kind: it.type, item: id, ...(it.type === "board" ? { env: it.env } : {}) }, quiet);
}
// what's selected on the canvas, as item ids (an element counts as nothing here)
export function selIds() {
  const s = S.sel;
  if (!s) return [];
  if (s.kind === "multi") return s.items.filter((id) => S.items.has(id));
  return s.kind !== "el" && s.item && S.items.has(s.item) ? [s.item] : [];
}
export function selectMany(ids, { quiet = false } = {}) {
  const list = [...new Set(ids)].filter((id) => S.items.has(id));
  if (!list.length) return clearSel();
  if (list.length === 1) return selectItem(list[0], { quiet });
  setSel({ kind: "multi", items: list }, quiet);
}
// Shift-click: add to the selection or take out of it
export function toggleSel(id) {
  const cur = selIds();
  selectMany(cur.includes(id) ? cur.filter((x) => x !== id) : [...cur, id]);
}
export function clearSel() {
  if (S.sel) setSel(null, false);
}
export function refreshSelInfo() {
  if (S.sel?.kind === "el" && S.sel.el?.isConnected) {
    S.sel.info = rt(S.sel.item)?.describe(S.sel.el) || S.sel.info;
    pushSelection();
  }
}
export function setHover(itemId, el) {
  if (S.hover && S.hover.item === itemId && S.hover.el === el) return;
  S.hover = el ? { item: itemId, el } : null;
  dirty = true;
  fire("hover");
}

// ---------- tools & modes ----------
export function setTool(t) {
  S.tool = t;
  cv.className = cv.className.replace(/\btool-\w+/g, "").trim() + ` tool-${t}`;
  for (const b of document.querySelectorAll("#tb [data-tool]")) b.classList.toggle("on", b.dataset.tool === t);
  if (t !== "move") setHover(null, null);
  if (t !== "move" && t !== "hand" && S.mode === "prototype") setMode("design");
  closePop();
}
export function setMode(m) {
  S.mode = m;
  cv.classList.toggle("mode-design", m === "design");
  cv.classList.toggle("mode-prototype", m === "prototype");
  $("interactBtn").setAttribute("aria-pressed", String(m === "prototype"));
  if (m === "prototype") {
    setHover(null, null);
    if (S.sel?.kind === "el") selectBoard(S.sel.item, { quiet: true });
    if (S.tool !== "move" && S.tool !== "hand") setTool("move");
  }
  dirty = true;
  fire("mode");
}

// ---------- HUD ----------
function placeBox(el, r, tag) {
  if (!r) return void (el.hidden = true);
  el.hidden = false;
  el.style.left = r.x + "px";
  el.style.top = r.y + "px";
  el.style.width = Math.max(1, r.w) + "px";
  el.style.height = Math.max(1, r.h) + "px";
  const t = el.querySelector(".tag");
  if (t) {
    t.hidden = !tag;
    if (tag) t.textContent = tag;
  }
  el.classList.toggle("flip", r.y < 24);
}
function elScreenRect(id, el) {
  if (!el || !el.isConnected) return null;
  const it = item(id);
  if (!it) return null;
  const r = el.getBoundingClientRect();
  if (!r.width && !r.height) return null;
  const a = toScreen({ x: it.x + r.left, y: it.y + r.top });
  return { x: a.x, y: a.y, w: r.width * S.cam.z, h: r.height * S.cam.z, rw: Math.round(r.width), rh: Math.round(r.height) };
}
const screenRect = (r) => {
  const a = toScreen(r);
  return { x: a.x, y: a.y, w: r.w * S.cam.z, h: r.h * S.cam.z };
};

function endPoint(end, other) {
  if (end?.item) {
    const it = item(end.item);
    if (!it) return null;
    const r = it.type === "note" ? { ...noteRect(it), h: NEL.get(it.id)?.offsetHeight * noteScale() || 140 } : it;
    const c = { x: r.x + r.w / 2, y: r.y + r.h / 2 };
    if (!other) return c;
    // where the line from the centre towards the other end leaves the rectangle
    const dx = other.x - c.x,
      dy = other.y - c.y;
    if (!dx && !dy) return c;
    const k = Math.min(Math.abs(r.w / 2 / (dx || 1e-9)), Math.abs(r.h / 2 / (dy || 1e-9)));
    return { x: c.x + dx * Math.min(k, 1), y: c.y + dy * Math.min(k, 1) };
  }
  return end ? { x: end.x, y: end.y } : null;
}
function arrowEnds(a) {
  const c0 = endPoint(a.from, null),
    c1 = endPoint(a.to, null);
  if (!c0 || !c1) return null;
  return { p0: endPoint(a.from, c1), p1: endPoint(a.to, c0) };
}
const noteScale = () => clamp(10 / (16 * S.cam.z), 1, 4);

function drawWires() {
  const want = new Set();
  for (const a of pageItems("arrow")) {
    const e = arrowEnds(a);
    if (!e) continue;
    want.add(a.id);
    let g = wires.querySelector(`g[data-item="${a.id}"]`);
    if (!g) {
      g = document.createElementNS("http://www.w3.org/2000/svg", "g");
      g.dataset.item = a.id;
      g.innerHTML = `<path class="hitw"></path><path class="vis" marker-end="url(#ah)"></path>`;
      wires.append(g);
    }
    const d = `M${e.p0.x} ${e.p0.y} L${e.p1.x} ${e.p1.y}`;
    for (const p of g.querySelectorAll("path")) p.setAttribute("d", d);
    g.querySelector(".vis").classList.toggle("on", S.sel?.item === a.id);
    // label in screen space, so it stays readable
    let l = HUD.alabels.get(a.id);
    if (a.label) {
      if (!l) {
        l = h(`<div class="alabel" data-item="${esc(a.id)}"></div>`);
        hud.append(l);
        HUD.alabels.set(a.id, l);
      }
      const m = toScreen({ x: (e.p0.x + e.p1.x) / 2, y: (e.p0.y + e.p1.y) / 2 });
      l.style.left = m.x + "px";
      l.style.top = m.y + "px";
      if (l.textContent !== a.label) l.textContent = a.label;
    } else if (l) (l.remove(), HUD.alabels.delete(a.id));
  }
  for (const g of [...wires.querySelectorAll("g[data-item]")]) if (!want.has(g.dataset.item)) g.remove();
  for (const [id, l] of HUD.alabels) if (!want.has(id)) (l.remove(), HUD.alabels.delete(id));
}

// ---------- rulers ----------
let rKey = "";
let rCol = null;
function rulerColors() {
  const theme = document.documentElement.getAttribute("data-ltheme");
  if (rCol?.theme === theme) return rCol;
  const cs = getComputedStyle(document.documentElement);
  const v = (n) => cs.getPropertyValue(n).trim();
  return (rCol = { theme, tick: v("--border-default"), text: v("--text-secondary"), band: v("--accent-subtle"), edge: v("--text-accent") });
}
function selWorldRect() {
  const s = S.sel;
  if (!s) return null;
  if (s.kind === "el") {
    const r = elScreenRect(s.item, s.el);
    if (!r) return null;
    const a = toWorld(r);
    return { x0: a.x, y0: a.y, x1: a.x + r.w / S.cam.z, y1: a.y + r.h / S.cam.z };
  }
  const it = item(s.item);
  if (!it || it.type === "arrow") return null;
  const r = it.type === "note" ? noteRect(it) : it;
  return { x0: r.x, y0: r.y, x1: r.x + r.w, y1: r.y + r.h };
}
function drawRulers() {
  const sr = selWorldRect();
  const col = rulerColors();
  const key = [S.cam.x.toFixed(1), S.cam.y.toFixed(1), S.cam.z.toFixed(5), cv.clientWidth, cv.clientHeight, col.theme, sr ? [sr.x0, sr.y0, sr.x1, sr.y1].map(Math.round).join(",") : ""].join("|");
  if (key === rKey) return;
  rKey = key;
  const z = S.cam.z;
  const step = [1, 2, 5, 10, 20, 50, 100, 200, 500, 1000, 2000, 5000, 10000, 20000, 50000].find((x) => x * z >= 64) || 50000;
  const minor = step * z >= 120 ? step / 10 : step / 5;
  const dpr = window.devicePixelRatio || 1;
  for (const [el, horiz] of [
    [rulerH, true],
    [rulerV, false],
  ]) {
    const w = el.clientWidth,
      hh = el.clientHeight;
    if (!w || !hh) continue;
    if (el.width !== Math.round(w * dpr) || el.height !== Math.round(hh * dpr)) (el.width = Math.round(w * dpr)), (el.height = Math.round(hh * dpr));
    const c = el.getContext("2d");
    if (!c) continue;
    c.setTransform(dpr, 0, 0, dpr, 0, 0);
    c.clearRect(0, 0, w, hh);
    const off = (horiz ? S.cam.x : S.cam.y) - RULER; // each ruler starts RULER px into the canvas
    const len = horiz ? w : hh;
    if (sr) {
      // the selection's extent, as in a design tool
      const a = (horiz ? sr.x0 : sr.y0) * z + off,
        b = (horiz ? sr.x1 : sr.y1) * z + off;
      c.fillStyle = col.band;
      horiz ? c.fillRect(a, 0, b - a, hh) : c.fillRect(0, a, w, b - a);
      c.fillStyle = col.edge;
      horiz ? (c.fillRect(a, 0, 1, hh), c.fillRect(b - 1, 0, 1, hh)) : (c.fillRect(0, a, w, 1), c.fillRect(0, b - 1, w, 1));
    }
    c.font = '500 10px "Geist Mono", ui-monospace, monospace';
    c.textBaseline = "top";
    const i0 = Math.floor(-off / z / minor),
      i1 = Math.ceil((len - off) / z / minor);
    // Guard: a corrupt camera could ask for millions of ticks; a ruler never needs more than a few hundred.
    if (!Number.isFinite(i0) || !Number.isFinite(i1) || i1 - i0 > 2000) continue;
    for (let i = i0; i <= i1; i++) {
      const v = i * minor;
      const p = Math.round(v * z + off) + 0.5;
      const major = Math.abs(v / step - Math.round(v / step)) < 1e-6;
      c.fillStyle = col.tick;
      const tl = major ? 8 : 4;
      horiz ? c.fillRect(p, hh - tl, 1, tl) : c.fillRect(w - tl, p, tl, 1);
      if (!major) continue;
      c.fillStyle = col.text;
      const label = String(Math.round(v));
      if (horiz) c.fillText(label, p + 4, 4);
      else {
        c.save();
        c.translate(4, p - 4);
        c.rotate(-Math.PI / 2);
        c.fillText(label, 0, 0);
        c.restore();
      }
    }
  }
}

export function drawHud() {
  dirty = false;
  if (S.cam.z !== lastZ) {
    lastZ = S.cam.z;
    const k = noteScale();
    for (const [id, el] of NEL) {
      if (item(id)?.type === "note") el.style.transform = k > 1 ? `scale(${k})` : "";
      else el.querySelector(".lb").style.transform = `translateY(-100%) scale(${clamp(12 / (14 * S.cam.z), 1, 6)})`;
    }
  }
  drawWires();
  drawRulers();
  // frame titles
  const live = new Set();
  const par = GH.size ? S.envs.get(pageEnv()?.parent) : null;
  const parentName = par ? (isBranch(par) ? par.name : "Main") : "";
  for (const it of pageBoards()) {
    if (!B.has(it.id)) continue;
    live.add(it.id);
    let l = HUD.labels.get(it.id);
    if (!l) {
      l = h(`<div class="blabel" data-item="${esc(it.id)}"><span class="g"></span><span class="n"></span><span class="flash"></span></div>`);
      hud.append(l);
      HUD.labels.set(it.id, l);
    }
    const s = screenRect(it);
    l.style.left = s.x + "px";
    l.style.top = s.y + "px";
    l.style.maxWidth = Math.max(80, s.w) + "px";
    const g = it.ghost ? parentName.slice(0, 32) : GH.size ? "This branch" : "";
    if (l.querySelector(".g").textContent !== g) l.querySelector(".g").textContent = g;
    const n = `${screenName(it)}${it.state && it.state !== "Default" ? ` · ${it.state}` : ""}`;
    if (l.querySelector(".n").textContent !== n) l.querySelector(".n").textContent = n;
    l.classList.toggle("on", S.sel?.item === it.id);
    l.classList.toggle("ghost", !!it.ghost);
    l.hidden = s.w < 64;
  }
  for (const [id, l] of HUD.labels) if (!live.has(id)) (l.remove(), HUD.labels.delete(id));
  // selection
  if (!HUD.sel) {
    HUD.sel = h(`<div class="selbox"><span class="tag"></span></div>`);
    HUD.hover = h(`<div class="selbox hover"></div>`);
    HUD.size = h(`<span class="sizetag"></span>`);
    hud.append(HUD.sel, HUD.hover, HUD.size);
    for (const k of ["e", "s", "se"]) {
      const d = h(`<div class="hdl ${k}" data-h="${k}"></div>`);
      hud.append(d);
      HUD.handles.push(d);
    }
    for (const k of ["nw", "n", "ne", "e", "se", "s", "sw", "w"]) {
      const d = h(`<div class="hdl ${k}" data-h="${k}" data-el="1"></div>`);
      hud.append(d);
      HUD.ehandles.push(d);
    }
    HUD.ins = h(`<div class="insline" hidden></div>`);
    hud.append(HUD.ins);
  }
  const s = S.sel;
  let selRect = null;
  if (s?.kind === "board" && item(s.item)) {
    selRect = screenRect(item(s.item));
    placeBox(HUD.sel, selRect, null);
  } else if (s?.kind === "el" && S.mode === "design") {
    selRect = elScreenRect(s.item, s.el);
    placeBox(HUD.sel, selRect, selRect ? s.info?.label || s.el.localName : null);
  } else placeBox(HUD.sel, null);
  const many = s?.kind === "multi" ? selIds() : [];
  for (const [id, el] of NEL) el.classList.toggle("on", s?.item === id || many.includes(id));
  // several selected: each one outlined, and a box around them all
  const boxes = many.map((id) => item(id)).filter((it) => it && it.type !== "arrow").map((it) => screenRect(rectOf(it)));
  while (HUD.multi.length < boxes.length + 1) {
    const d = h(`<div class="selbox"></div>`);
    hud.append(d);
    HUD.multi.push(d);
  }
  HUD.multi.forEach((d, k) => {
    if (k < boxes.length) return placeBox(d, boxes[k], null);
    if (k === boxes.length && boxes.length) {
      const x0 = Math.min(...boxes.map((r) => r.x)),
        y0 = Math.min(...boxes.map((r) => r.y));
      placeBox(d, { x: x0, y: y0, w: Math.max(...boxes.map((r) => r.x + r.w)) - x0, h: Math.max(...boxes.map((r) => r.y + r.h)) - y0 }, plural(many.length, "item"));
      return d.classList.add("group");
    }
    placeBox(d, null);
  });
  drawGuides();
  const br = s?.kind === "board" ? selRect : null;
  const er = s?.kind === "el" && S.mode === "design" ? selRect : null;
  HUD.size.hidden = !(br || er);
  if (br || er) {
    const r = br || er;
    HUD.size.style.left = r.x + r.w / 2 + "px";
    HUD.size.style.top = r.y + r.h + "px";
    const t = br ? `${item(s.item).w} × ${item(s.item).h}` : `${r.rw} × ${r.rh}`;
    if (HUD.size.textContent !== t) HUD.size.textContent = t;
  }
  // an element's resize handles, as on a frame
  const eh = er && S.tool === "move" && drag?.mode !== "reorder" ? er : null;
  for (const d of HUD.ehandles) {
    const k = d.dataset.h;
    // on a small element the handles would cover it: keep its middle free to drag
    const tooSmall = eh && ((k.length === 1 && (/[ns]/.test(k) ? eh.h : eh.w) < 28) || (k.length === 2 && Math.min(eh.w, eh.h) < 14));
    d.hidden = !eh || tooSmall;
    if (d.hidden) continue;
    d.style.left = (k.includes("w") ? eh.x : k.includes("e") ? eh.x + eh.w : eh.x + eh.w / 2) + "px";
    d.style.top = (k.includes("n") ? eh.y : k.includes("s") ? eh.y + eh.h : eh.y + eh.h / 2) + "px";
  }
  drawInsertion();
  for (const d of HUD.handles) {
    d.hidden = !br;
    if (!br) continue;
    const k = d.dataset.h;
    d.style.left = (k === "s" ? br.x + br.w / 2 : br.x + br.w) + "px";
    d.style.top = (k === "e" ? br.y + br.h / 2 : br.y + br.h) + "px";
  }
  const hv = S.hover;
  const hr = hv && S.mode === "design" && S.tool === "move" && !(s?.kind === "el" && s.el === hv.el) ? elScreenRect(hv.item, hv.el) : null;
  placeBox(HUD.hover, hr, null);
  // comment pins sit on their board
  const pins = new Set();
  const top = S.comments.filter((c) => !c.parent && c.env === S.page);
  top.forEach((c, i) => {
    const b = (c.board && S.items.get(c.board)) || pageItems("board")[0];
    if (!b || !B.has(b.id)) return;
    pins.add(c.id);
    let p = HUD.pins.get(c.id);
    if (!p) {
      p = h(`<button type="button" class="pin" data-c="${esc(c.id)}" aria-label="Comment"></button>`);
      hud.append(p);
      HUD.pins.set(c.id, p);
    }
    const a = toScreen({ x: b.x + c.x, y: b.y + c.y });
    p.style.left = a.x + "px";
    p.style.top = a.y + "px";
    p.textContent = String(i + 1);
    p.classList.toggle("done", !!c.resolved);
    p.classList.toggle("on", pop?.kind === "thread" && pop.id === c.id);
    p.hidden = !!c.resolved && !S.showResolved;
  });
  for (const [id, p] of HUD.pins) if (!pins.has(id)) (p.remove(), HUD.pins.delete(id));
  placePop();
}

function tracking() {
  return dirty || S.sel?.kind === "el" || !!S.hover || !!pop || !!drag;
}

// ---------- editing elements: move, reorder, resize, nudge, remove ----------
// Every edit is CSS in the page's overrides.css (see styles.js), so it shows in the prototype
// everywhere it runs. Inside an auto layout (a flex or grid parent) dragging reorders, with the CSS
// order property; anywhere else it moves the element with translate.
const cssOf = (id, el) => {
  try {
    return winOf(id).getComputedStyle(el);
  } catch {
    return null;
  }
};
export const exactSel = (id, el) => {
  try {
    return rt(id)?.selectorFor(el, true) || null;
  } catch {
    return null;
  }
};
export function parseTranslate(v) {
  const m = /(-?[\d.]+)px(?:\s+(-?[\d.]+)px)?/.exec(String(v || ""));
  return m ? { x: +m[1] || 0, y: +(m[2] || 0) || 0 } : { x: 0, y: 0 };
}
const shown = (id, el) => {
  const r = el.getBoundingClientRect();
  return (r.width > 0 || r.height > 0) && cssOf(id, el)?.display !== "none" && !el.classList.contains("ws-ghost");
};
// how an element's parent lays it out
export function flowOf(id, el) {
  const p = el?.parentElement;
  const cs = p && cssOf(id, p);
  if (!cs) return { kind: "free" };
  const flex = /flex/.test(cs.display),
    grid = /grid/.test(cs.display);
  if (!flex && !grid) return { kind: "free", parent: p, pcs: cs };
  const sibs = [...p.children].filter((c) => shown(id, c));
  // Guard: reordering writes one rule per sibling; past this many it would bloat overrides.css.
  if (sibs.length < 2 || sibs.length > 60 || !sibs.includes(el)) return { kind: "free", parent: p, pcs: cs };
  // the order you see: by the order property, then document order (the sort is stable)
  sibs.sort((a, b) => (parseInt(cssOf(id, a)?.order, 10) || 0) - (parseInt(cssOf(id, b)?.order, 10) || 0));
  const row = grid || !/column/.test(cs.flexDirection);
  return { kind: grid || /wrap/.test(cs.flexWrap) ? "grid" : "flex", row, sibs, parent: p, pcs: cs };
}
function insertIndex(flow, pt, dragged) {
  const others = flow.sibs.filter((x) => x !== dragged);
  for (let i = 0; i < others.length; i++) {
    const r = others[i].getBoundingClientRect();
    if (flow.kind === "grid") {
      if (pt.y < r.top || (pt.y <= r.bottom && pt.x < r.left + r.width / 2)) return i;
    } else if (flow.row ? pt.x < r.left + r.width / 2 : pt.y < r.top + r.height / 2) return i;
  }
  return others.length;
}
function drawInsertion() {
  const d = drag;
  if (!HUD.ins) return;
  if (d?.kind !== "el" || d.mode !== "reorder" || d.idx === undefined) return void (HUD.ins.hidden = true);
  const it = item(d.id);
  const others = d.flow.sibs.filter((x) => x !== d.el);
  const ref = others[Math.min(d.idx, others.length - 1)];
  if (!ref || !it) return void (HUD.ins.hidden = true);
  const r = ref.getBoundingClientRect();
  const after = d.idx >= others.length;
  const vertical = d.flow.kind === "grid" || d.flow.row;
  const a = toScreen({ x: it.x + (vertical ? (after ? r.right : r.left) : r.left), y: it.y + (vertical ? r.top : after ? r.bottom : r.top) });
  HUD.ins.hidden = false;
  HUD.ins.style.left = a.x - (vertical ? 1 : 0) + "px";
  HUD.ins.style.top = a.y - (vertical ? 0 : 1) + "px";
  HUD.ins.style.width = (vertical ? 2 : r.width * S.cam.z) + "px";
  HUD.ins.style.height = (vertical ? r.height * S.cam.z : 2) + "px";
}
// the element's selector for size and style edits: this one, or all like it
const scopeSel = (s) => (S.scope === "exact" ? s.info?.exactSelector : s.info?.selector) || exactSel(s.item, s.el);
function scopeEls(s) {
  if (S.scope === "exact") return [s.el];
  try {
    const all = [...docOf(s.item).querySelectorAll(s.info.selector)];
    return all.length ? all : [s.el];
  } catch {
    return [s.el];
  }
}
async function saveOrder(id, env, list, el) {
  const rules = list.map((x, i) => ({ selector: exactSel(id, x), props: { order: String(i) } }));
  if (rules.some((r) => !r.selector)) return toast("Couldn't reorder that", "One of its neighbours has no selector to write a rule for");
  await commitRules(env, rules, "order");
  if (el.isConnected) selectEl(id, el, { quiet: true });
  fire("sel", { quiet: true });
}
function startElDrag(d) {
  const s = S.sel;
  if (!(s?.kind === "el" && s.el === d.el)) selectEl(d.id, d.el, { quiet: true });
  d.env = item(d.id)?.env;
  d.flow = flowOf(d.id, d.el);
  d.mode = d.flow.kind === "free" ? "move" : "reorder";
  d.t0 = parseTranslate(cssOf(d.id, d.el)?.translate);
  d.sel = exactSel(d.id, d.el);
  d.started = true;
  setHover(null, null);
}
function moveElDrag(d, dx, dy, e) {
  const z = S.cam.z;
  const st = e.shiftKey ? 8 : 1;
  const x = Math.round((d.t0.x + dx / z) / st) * st,
    y = Math.round((d.t0.y + dy / z) / st) * st;
  if (d.mode === "move") {
    d.cur = { x, y };
    preview([d.el], { translate: `${x}px ${y}px` });
  } else {
    preview([d.el], { translate: `${d.t0.x + dx / z}px ${d.t0.y + dy / z}px`, opacity: "0.6" });
    const it = item(d.id);
    const w = toWorld(local(e));
    d.idx = insertIndex(d.flow, { x: w.x - it.x, y: w.y - it.y }, d.el);
  }
  dirty = true;
}
async function endElDrag(d) {
  if (d.mode === "move") {
    const { x, y } = d.cur || d.t0;
    if (d.sel && (x !== d.t0.x || y !== d.t0.y)) await commitRules(d.env, [{ selector: d.sel, props: { translate: x || y ? `${x}px ${y}px` : null } }], "position");
    endPreview([d.el], ["translate"]);
    return;
  }
  endPreview([d.el], ["translate", "opacity"]);
  const others = d.flow.sibs.filter((x) => x !== d.el);
  const next = [...others.slice(0, d.idx), d.el, ...others.slice(d.idx)];
  if (d.idx === undefined || next.every((x, i) => x === d.flow.sibs[i])) return void (dirty = true);
  await saveOrder(d.id, d.env, next, d.el);
}
function startElResize(handle, p) {
  const s = S.sel;
  const cs = cssOf(s.item, s.el);
  if (!cs) return null;
  const r = s.el.getBoundingClientRect();
  const num = (v) => parseFloat(v) || 0;
  const border = cs.boxSizing === "border-box";
  return {
    kind: "elresize",
    id: s.item,
    env: s.env,
    el: s.el,
    h: handle.dataset.h,
    p0: p,
    w0: r.width,
    h0: r.height,
    t0: parseTranslate(cs.translate),
    // content-box elements: the rule's width leaves out padding and border
    padW: border ? 0 : num(cs.paddingLeft) + num(cs.paddingRight) + num(cs.borderLeftWidth) + num(cs.borderRightWidth),
    padH: border ? 0 : num(cs.paddingTop) + num(cs.paddingBottom) + num(cs.borderTopWidth) + num(cs.borderBottomWidth),
    targets: scopeEls(s),
    selAll: scopeSel(s),
    sel: s.info?.exactSelector || exactSel(s.item, s.el),
    flow: flowOf(s.item, s.el),
  };
}
function moveElResize(d, dx, dy, e) {
  const z = S.cam.z;
  const st = e.shiftKey ? 8 : 1;
  const k = d.h;
  const snap = (v) => Math.max(1, Math.round(v / st) * st);
  const w = k.includes("e") ? snap(d.w0 + dx / z) : k.includes("w") ? snap(d.w0 - dx / z) : d.w0;
  const hh = k.includes("s") ? snap(d.h0 + dy / z) : k.includes("n") ? snap(d.h0 - dy / z) : d.h0;
  const props = {};
  if (/[ew]/.test(k)) props.width = `${Math.max(0, w - d.padW)}px`;
  if (/[ns]/.test(k)) props.height = `${Math.max(0, hh - d.padH)}px`;
  // a fixed size in an auto layout doesn't grow or shrink along its axis
  const pflex = d.flow.pcs && /flex/.test(d.flow.pcs.display);
  const prow = pflex && !/column/.test(d.flow.pcs.flexDirection);
  if (pflex && ((prow && props.width) || (!prow && props.height))) props.flex = "0 0 auto";
  d.props = props;
  d.w = w;
  d.hh = hh;
  preview(d.targets, props);
  // dragging a left or top edge keeps the opposite edge where it was
  if (/[nw]/.test(k)) {
    d.tr = { x: d.t0.x + (k.includes("w") ? d.w0 - w : 0), y: d.t0.y + (k.includes("n") ? d.h0 - hh : 0) };
    preview([d.el], { translate: `${d.tr.x}px ${d.tr.y}px` });
  }
  d.moved = true;
  dirty = true;
}
async function endElResize(d) {
  if (!d.props) return;
  // a min or max size in the prototype's CSS would hold the element back: lift it
  const r = d.el.getBoundingClientRect();
  if (d.props.width && Math.abs(r.width - d.w) > 1) Object.assign(d.props, { "min-width": "0", "max-width": "none" });
  if (d.props.height && Math.abs(r.height - d.hh) > 1) Object.assign(d.props, { "min-height": "0", "max-height": "none" });
  const rules = [{ selector: d.selAll, props: d.props }];
  if (d.tr) {
    const t = { translate: d.tr.x || d.tr.y ? `${d.tr.x}px ${d.tr.y}px` : null };
    if (d.selAll === d.sel) Object.assign(rules[0].props, t);
    else rules.push({ selector: d.sel, props: t });
  }
  await commitRules(d.env, rules, "size");
  endPreview(d.targets, Object.keys(d.props));
  if (d.tr) endPreview([d.el], ["translate"]);
}
// arrow keys: reorder inside an auto layout, nudge anywhere else (Shift: 8 px)
let nudging = null;
function nudge(key, big) {
  const s = S.sel;
  const flow = flowOf(s.item, s.el);
  if (flow.kind !== "free") {
    const i = flow.sibs.indexOf(s.el);
    const j = clamp(i + (key === "ArrowLeft" || key === "ArrowUp" ? -1 : 1), 0, flow.sibs.length - 1);
    if (i === j) return;
    const next = flow.sibs.filter((x) => x !== s.el);
    next.splice(j, 0, s.el);
    return saveOrder(s.item, s.env, next, s.el);
  }
  const st = big ? 8 : 1;
  if (!nudging || nudging.el !== s.el) {
    if (nudging) flushNudge();
    nudging = { id: s.item, env: s.env, el: s.el, sel: s.info?.exactSelector || exactSel(s.item, s.el), t: parseTranslate(cssOf(s.item, s.el)?.translate) };
  }
  const n = nudging;
  if (key === "ArrowLeft") n.t.x -= st;
  if (key === "ArrowRight") n.t.x += st;
  if (key === "ArrowUp") n.t.y -= st;
  if (key === "ArrowDown") n.t.y += st;
  preview([n.el], { translate: `${n.t.x}px ${n.t.y}px` });
  dirty = true;
  clearTimeout(n.timer);
  n.timer = setTimeout(flushNudge, 350);
}
async function flushNudge() {
  const n = nudging;
  nudging = null;
  if (!n) return;
  clearTimeout(n.timer);
  await commitRules(n.env, [{ selector: n.sel, props: { translate: n.t.x || n.t.y ? `${n.t.x}px ${n.t.y}px` : null } }], "position");
  endPreview([n.el], ["translate"]);
}
export async function removeEl() {
  const s = S.sel;
  if (s?.kind !== "el") return;
  const sel = scopeSel(s);
  if (!sel) return;
  const parent = s.el.parentElement;
  const d = docOf(s.item);
  if (!(await commitRules(s.env, [{ selector: sel, props: { display: "none" } }], "removal"))) return;
  toast("Removed from the page", "It's display: none in overrides.css, so it can come back", { label: "Undo", fn: () => undoStyle() });
  if (parent && d && parent !== d.body && parent !== d.documentElement) selectEl(s.item, parent);
  else selectBoard(s.item);
}
let planAt = 0;
function loop() {
  if (tracking()) drawHud();
  // which pages are live and which bitmaps to render next: a few times a second, idle or not
  const now = performance.now();
  if (now - planAt > 200 && S.page) {
    planAt = now;
    planLive();
    planSnapshots();
    guardKeys();
  }
  if (gfxDirty) drawGfx();
  requestAnimationFrame(loop);
}

// ---------- canvas popovers: comment composer and thread ----------
function closePop() {
  if (!pop) return;
  pop.el.remove();
  pop = null;
  dirty = true;
}
function placePop() {
  if (!pop) return;
  const b = item(pop.board);
  if (!b) return closePop();
  const a = toScreen({ x: b.x + pop.x, y: b.y + pop.y });
  const w = pop.el.offsetWidth,
    hh = pop.el.offsetHeight;
  pop.el.style.left = clamp(a.x + 16, 8, cv.clientWidth - w - 8) + "px";
  pop.el.style.top = clamp(a.y - 28, 8, cv.clientHeight - hh - 8) + "px";
}
function composeComment(boardId, bx, by, selector) {
  closePop();
  const b = item(boardId);
  const el = h(`<div class="pop" role="dialog" aria-label="New comment"><textarea class="afld-ta" placeholder="Add a comment" aria-label="Comment"></textarea><div class="acts"><button type="button" class="ghbtn sm" data-a="cancel">Cancel</button><button type="button" class="createbtn sm" data-a="post">Comment</button></div></div>`);
  cv.append(el);
  pop = { el, board: boardId, x: bx, y: by, kind: "new" };
  placePop();
  const ta = el.querySelector("textarea");
  ta.focus();
  let busy = false;
  const post = async () => {
    const text = ta.value.trim();
    if (!text || busy) return;
    busy = true;
    try {
      await api("comments", { method: "POST", body: { env: b.env, board: boardId, x: bx, y: by, selector, text } });
      closePop();
      setTool("move");
      fire("comments-changed");
    } catch (e) {
      toast("Couldn't add the comment", e.message);
      busy = false;
    }
  };
  el.querySelector('[data-a="post"]').onclick = post;
  el.querySelector('[data-a="cancel"]').onclick = closePop;
  ta.addEventListener("keydown", (e) => {
    if (e.key === "Enter" && !e.shiftKey) (e.preventDefault(), post());
    else if (e.key === "Escape") (e.stopPropagation(), closePop());
  });
}
export function openThread(id) {
  const c = S.comments.find((x) => x.id === id);
  if (!c) return;
  const b = (c.board && S.items.get(c.board)) || itemsOf("board").find((x) => x.env === c.env);
  if (!b) return;
  closePop();
  const replies = S.comments.filter((r) => r.parent === id);
  const row = (x) => `<div class="cm"><span class="av">${esc((x.author || "?")[0].toUpperCase())}</span><div class="tx"><b>${esc(x.author)}</b><i>${esc(timeAgo(x.createdAt))}</i><p>${esc(x.text)}</p></div></div>`;
  const el = h(`<div class="pop" role="dialog" aria-label="Comment thread">${row(c)}${replies.map(row).join("")}<textarea class="afld-ta" placeholder="Reply" aria-label="Reply" style="min-height:40px"></textarea><div class="acts"><button type="button" class="ghbtn sm" data-a="del" style="margin-right:auto;color:var(--text-error)">Delete</button><button type="button" class="dbtn sm" data-a="agent">Ask agent</button><button type="button" class="dbtn sm" data-a="res">${c.resolved ? "Reopen" : "Resolve"}</button><button type="button" class="createbtn sm" data-a="reply">Reply</button></div></div>`);
  cv.append(el);
  pop = { el, board: b.id, x: c.x, y: c.y, kind: "thread", id };
  placePop();
  dirty = true;
  const ta = el.querySelector("textarea");
  el.querySelector('[data-a="reply"]').onclick = async () => {
    const text = ta.value.trim();
    if (!text) return ta.focus();
    try {
      await api("comments", { method: "POST", body: { env: c.env, parent: c.id, text } });
      fire("comments-changed", { reopen: id });
    } catch (e) {
      toast("Couldn't reply", e.message);
    }
  };
  el.querySelector('[data-a="res"]').onclick = async () => {
    await api(`comments/${id}`, { method: "PATCH", body: { resolved: !c.resolved } }).catch((e) => toast("Couldn't update the comment", e.message));
    closePop();
    fire("comments-changed");
  };
  el.querySelector('[data-a="del"]').onclick = async () => {
    await api(`comments/${id}`, { method: "DELETE" }).catch((e) => toast("Couldn't delete the comment", e.message));
    closePop();
    fire("comments-changed");
    toast("Comment deleted");
  };
  el.querySelector('[data-a="agent"]').onclick = () => {
    closePop();
    const target = c.selector ? safeQuery(docOf(b.id), c.selector) : null;
    if (target) selectEl(b.id, target);
    else selectBoard(b.id);
    fire("ask-agent", { prompt: c.text });
  };
  ta.addEventListener("keydown", (e) => e.key === "Escape" && (e.stopPropagation(), closePop()));
}

// ---------- inline editing ----------
function editText(id, el) {
  const info = rt(id)?.describe(el);
  if (!info?.editableText) return false;
  const b = B.get(id),
    it = item(id);
  const before = el.textContent;
  b.el.classList.add("editing");
  el.setAttribute("contenteditable", "plaintext-only");
  if (el.contentEditable !== "plaintext-only") el.setAttribute("contenteditable", "true");
  el.focus();
  try {
    const d = docOf(id);
    const r = d.createRange();
    r.selectNodeContents(el);
    const s = d.getSelection();
    s.removeAllRanges();
    s.addRange(r);
  } catch {}
  let done = false;
  const finish = async (keep) => {
    if (done) return;
    done = true;
    el.removeAttribute("contenteditable");
    b.el.classList.remove("editing");
    el.removeEventListener("keydown", onk, true);
    el.removeEventListener("blur", onb);
    const text = el.textContent;
    if (!keep) return void (el.textContent = before);
    if (text === before) return;
    try {
      await api(`envs/${it.env}/text`, { method: "PUT", body: { selector: info.exactSelector, text } });
      toast("Text changed", "Saved on this branch", { label: "Undo", fn: async () => ((el.textContent = before), await api(`envs/${it.env}/text`, { method: "PUT", body: { selector: info.exactSelector, text: null } })) });
    } catch (e) {
      el.textContent = before;
      toast("Couldn't save the text", e.message);
    }
    refreshSelInfo();
    fire("sel", { quiet: true });
  };
  const onk = (e) => {
    if (e.key === "Enter" && !e.shiftKey) (e.preventDefault(), finish(true));
    else if (e.key === "Escape") (e.preventDefault(), e.stopPropagation(), finish(false));
    e.stopPropagation();
  };
  const onb = () => finish(true);
  el.addEventListener("keydown", onk, true);
  el.addEventListener("blur", onb);
  return true;
}
export function editNote(id) {
  const el = NEL.get(id),
    it = item(id);
  if (!el || it?.type !== "note") return;
  const tx = el.querySelector(".tx");
  tx.setAttribute("contenteditable", "plaintext-only");
  if (tx.contentEditable !== "plaintext-only") tx.setAttribute("contenteditable", "true");
  tx.focus();
  try {
    const r = document.createRange();
    r.selectNodeContents(tx);
    r.collapse(false);
    const s = getSelection();
    s.removeAllRanges();
    s.addRange(r);
  } catch {}
  const finish = async () => {
    tx.removeAttribute("contenteditable");
    tx.removeEventListener("blur", finish);
    const text = tx.textContent.trim();
    if (!text && !it.text) {
      // an empty new note leaves no trace
      await api(`canvas/items/${id}`, { method: "DELETE" }).catch(() => {});
      S.items.delete(id);
      if (S.sel?.item === id) clearSel();
      sync();
      return;
    }
    if (text !== (it.text || "")) {
      try {
        const next = await api(`canvas/items/${id}`, { method: "PATCH", body: { text } });
        S.items.set(id, next);
      } catch (e) {
        toast("Couldn't save the note", e.message);
      }
    }
    sync();
    fire("items-changed");
  };
  tx.addEventListener("blur", finish);
  tx.addEventListener("keydown", (e) => {
    e.stopPropagation();
    if (e.key === "Escape" || (e.key === "Enter" && (e.metaKey || e.ctrlKey))) (e.preventDefault(), tx.blur());
  });
}

// ---------- creating and moving things ----------
// ---------- creating, moving and removing things — each one a step in the undo history ----------
const strip = ({ id, createdAt, updatedAt, author, ...rest }) => rest;
const kindName = (it) => (it.type === "board" ? "board" : it.type === "box" ? "highlight" : it.type);
async function postItem(body) {
  const it = await api("canvas/items", { method: "POST", body });
  S.items.set(it.id, it);
  return it;
}
async function deleteRaw(id) {
  await api(`canvas/items/${id}`, { method: "DELETE" });
  S.items.delete(id);
  // the server takes arrows pinned to it too
  for (const a of itemsOf("arrow")) if (a.from?.item === id || a.to?.item === id) S.items.delete(a.id);
}
const refresh = () => (sync(), fire("items-changed"));
async function createItem(body, { track = true } = {}) {
  try {
    // annotations belong to the page they're made on
    if (body.type !== "board") body = { ...body, env: S.page };
    const it = await postItem(body);
    refresh();
    if (track)
      record({
        label: `add ${kindName(it)}`,
        undo: async () => (await deleteRaw(rid(it.id)), clearSel(), refresh()),
        redo: async () => {
          const n = await postItem(strip(it));
          remap(rid(it.id), n.id);
          refresh();
        },
      });
    return it;
  } catch (e) {
    toast("Couldn't add that", e.message);
    return null;
  }
}
// several new items as one step: paste, duplicate
async function createMany(bodies, label) {
  const made = [];
  const idOf = new Map();
  try {
    for (const b0 of bodies.filter((b) => b.type !== "arrow").concat(bodies.filter((b) => b.type === "arrow"))) {
      const b = { ...b0 };
      if (b.type === "arrow") for (const k of ["from", "to"]) if (b[k]?.item) b[k] = { item: idOf.get(b[k].item) || b[k].item };
      const it = await postItem(b.type === "board" ? b : { ...b, env: S.page });
      if (b0._src) idOf.set(b0._src, it.id);
      made.push(it);
    }
  } catch (e) {
    toast("Couldn't add all of it", e.message);
  }
  refresh();
  if (made.length)
    record({
      label,
      undo: async () => {
        for (const it of made) if (S.items.has(rid(it.id))) await deleteRaw(rid(it.id));
        clearSel();
        refresh();
      },
      redo: async () => {
        for (const it of made) {
          const b = strip(it);
          if (b.type === "arrow") for (const k of ["from", "to"]) if (b[k]?.item) b[k] = { item: rid(b[k].item) };
          const n = await postItem(b);
          remap(rid(it.id), n.id);
        }
        refresh();
      },
    });
  return made;
}
const saveT = new Map();
function saveItem(id, patch) {
  clearTimeout(saveT.get(id));
  saveT.set(id, setTimeout(() => api(`canvas/items/${id}`, { method: "PATCH", body: patch }).then((n) => S.items.set(id, n)).catch((e) => toast("Couldn't save that", e.message)), 150));
}
// put items at these positions now, and save them
function placeAll(list) {
  for (const g of list) {
    const id = rid(g.id);
    const it = item(id);
    if (!it) continue;
    const patch = {};
    for (const k of ["x", "y", "w", "h", "from", "to"]) if (g[k] !== undefined) (it[k] = g[k]), (patch[k] = g[k]);
    const el = B.get(id)?.el || NEL.get(id);
    if (el && g.x !== undefined) (el.style.left = it.x + "px"), (el.style.top = it.y + "px");
    if (B.get(id) && g.w !== undefined) (B.get(id).el.style.width = it.w + "px"), (B.get(id).el.style.height = it.h + "px");
    saveItem(id, patch);
  }
  sync();
}
// a move (or resize) from `before` to the items' current geometry, as one undo step
function recordMove(before, label = "move") {
  const after = before.map((g) => {
    const it = item(g.id);
    const o = { id: g.id };
    for (const k of Object.keys(g)) if (k !== "id") o[k] = it ? JSON.parse(JSON.stringify(it[k])) : g[k];
    return o;
  });
  if (JSON.stringify(before) === JSON.stringify(after)) return;
  record({ label, undo: async () => placeAll(before), redo: async () => placeAll(after) });
}
export async function placeScreen(env, screen, state = null, at = null) {
  const e = S.envs.get(env);
  if (!e) return null;
  const mine = itemsOf("board").filter((b) => b.env === env);
  let x, y;
  if (at) (x = Math.round(at.x / SNAP) * SNAP), (y = Math.round(at.y / SNAP) * SNAP);
  else if (mine.length) {
    const last = mine.reduce((a, b) => (b.x + b.w > a.x + a.w ? b : a));
    x = last.x + last.w + 120;
    y = last.y;
  }
  return createItem({ type: "board", env, screen: screen || null, state: state && state !== "Default" ? state : null, ...(x !== undefined ? { x, y } : {}) });
}
export async function removeItems(ids) {
  const gone = [];
  for (const id0 of ids) {
    const id = rid(id0);
    const it = S.items.get(id);
    if (!it) continue;
    const pinned = itemsOf("arrow").filter((a) => a.id !== id && (a.from?.item === id || a.to?.item === id) && !ids.includes(a.id));
    try {
      await deleteRaw(id);
      gone.push(it, ...pinned);
    } catch (e) {
      toast("Couldn't remove that", e.message);
    }
  }
  if (!gone.length) return;
  clearSel();
  refresh();
  const putBack = async () => {
    for (const g of gone.filter((x) => x.type !== "arrow").concat(gone.filter((x) => x.type === "arrow"))) {
      const b = strip(g);
      if (b.type === "arrow") for (const k of ["from", "to"]) if (b[k]?.item) b[k] = { item: rid(b[k].item) };
      const n = await postItem(b);
      remap(rid(g.id), n.id);
    }
    refresh();
  };
  const what = gone.length > 1 ? `${gone.length} items` : gone[0].type === "board" ? `${screenName(gone[0])} board` : kindName(gone[0]);
  record({ label: `removal of ${what}`, undo: putBack, redo: async () => (await removeQuiet(gone.map((g) => g.id)), refresh()) });
  toast(`Removed ${what}`, gone.some((g) => g.type === "board") ? "The page keeps its files; only the board left the canvas" : "", { label: "Undo", fn: () => undoAll() });
}
async function removeQuiet(ids) {
  for (const id of ids) if (S.items.has(rid(id))) await deleteRaw(rid(id)).catch(() => {});
  clearSel();
}

// ---------- the clipboard: boards and annotations, within and across pages ----------
let CLIP = null;
let pasteN = 0;
let lastWorld = null; // where the pointer last was on the canvas, for paste
function collect(ids) {
  const set = new Set(ids);
  const list = ids.map((id) => S.items.get(id)).filter(Boolean);
  // arrows come along when both ends do, or when they end on points
  for (const a of pageItems("arrow")) if (!set.has(a.id) && [a.from, a.to].every((e) => !e?.item || set.has(e.item)) && [a.from, a.to].some((e) => e?.item && set.has(e.item))) list.push(a);
  return list.map((it) => ({ ...strip(it), _src: it.id }));
}
export function copySel() {
  const ids = selIds();
  if (!ids.length) return false;
  CLIP = collect(ids);
  pasteN = 0;
  try {
    navigator.clipboard?.writeText(JSON.stringify({ workshop: 1, items: CLIP })).catch(() => {});
  } catch {}
  toast(`Copied ${plural(ids.length, "item")}`);
  return true;
}
export async function cutSel() {
  if (copySel()) await removeItems(selIds());
}
async function pasteList(list, { offset = 40, label = "paste" } = {}) {
  if (!list?.length) return;
  const rects = list.filter((x) => x.type !== "arrow");
  const bx = Math.min(...rects.map((r) => r.x)),
    by = Math.min(...rects.map((r) => r.y));
  // onto the pointer when it's over the canvas, otherwise just beside the original
  let dx = offset,
    dy = offset;
  if (label === "paste" && lastWorld) (dx = Math.round(lastWorld.x - bx)), (dy = Math.round(lastWorld.y - by));
  const bodies = list.map((x) => {
    const b = { ...x };
    if (b.type === "board") b.env = S.page; // a pasted screen shows this page's version of the prototype
    if (b.type === "arrow") {
      for (const k of ["from", "to"]) if (b[k] && !b[k].item) b[k] = { x: b[k].x + dx, y: b[k].y + dy };
    } else (b.x += dx), (b.y += dy);
    return b;
  });
  const made = await createMany(bodies, label === "paste" ? `paste of ${plural(made0(list), "item")}` : `duplicate`);
  if (made.length) selectMany(made.map((m) => m.id));
}
const made0 = (list) => list.filter((x) => x.type !== "arrow").length;
export async function pasteClip() {
  if (!CLIP) {
    try {
      const t = await navigator.clipboard?.readText();
      const j = JSON.parse(t || "null");
      if (j?.workshop && Array.isArray(j.items)) CLIP = j.items;
    } catch {}
  }
  if (!CLIP) return toast("Nothing to paste", "Copy boards, notes or highlights first (⌘C)");
  pasteN++;
  await pasteList(CLIP, { offset: 40 * pasteN });
}
export async function duplicateSel() {
  if (S.sel?.kind === "el") return toast("Duplicating an element changes the page's HTML", "Ask an agent to do it, or duplicate the whole board");
  const ids = selIds();
  if (!ids.length) return;
  await pasteList(collect(ids), { offset: 40, label: "duplicate" });
}
export function selectAll() {
  selectMany([...pageItems("board"), ...pageItems("note"), ...pageItems("box"), ...pageItems("arrow")].map((i) => i.id));
}

// ---------- align and distribute, for several boards and annotations ----------
function rectOf(it) {
  if (it.type === "note") {
    const el = NEL.get(it.id);
    return { x: it.x, y: it.y, w: it.w, h: el?.offsetHeight || 120 };
  }
  return { x: it.x, y: it.y, w: it.w, h: it.h };
}
export function alignSel(how) {
  const its = selIds().map((id) => S.items.get(id)).filter((i) => i && i.type !== "arrow");
  if (its.length < 2) return;
  const rs = its.map(rectOf);
  const x0 = Math.min(...rs.map((r) => r.x)),
    x1 = Math.max(...rs.map((r) => r.x + r.w)),
    y0 = Math.min(...rs.map((r) => r.y)),
    y1 = Math.max(...rs.map((r) => r.y + r.h));
  const before = its.map((i) => ({ id: i.id, x: i.x, y: i.y }));
  const next = its.map((i, k) => {
    const r = rs[k];
    const o = { id: i.id, x: i.x, y: i.y };
    if (how === "left") o.x = x0;
    if (how === "right") o.x = x1 - r.w;
    if (how === "hcenter") o.x = Math.round((x0 + x1) / 2 - r.w / 2);
    if (how === "top") o.y = y0;
    if (how === "bottom") o.y = y1 - r.h;
    if (how === "vcenter") o.y = Math.round((y0 + y1) / 2 - r.h / 2);
    return o;
  });
  placeAll(next);
  recordMove(before, "alignment");
}
export function distributeSel(axis) {
  const its = selIds().map((id) => S.items.get(id)).filter((i) => i && i.type !== "arrow");
  if (its.length < 3) return toast("Distribute needs three or more", "Select at least three boards or annotations");
  const k = axis === "h" ? "x" : "y",
    d = axis === "h" ? "w" : "h";
  const rs = its.map((i) => ({ i, r: rectOf(i) })).sort((a, b) => a.r[k] - b.r[k]);
  const first = rs[0].r,
    last = rs[rs.length - 1].r;
  const total = rs.reduce((n, x) => n + x.r[d], 0);
  const gap = (last[k] + last[d] - first[k] - total) / (rs.length - 1);
  const before = its.map((i) => ({ id: i.id, x: i.x, y: i.y }));
  let at = first[k];
  const next = rs.map(({ i, r }) => {
    const o = { id: i.id, x: i.x, y: i.y };
    o[k] = Math.round(at);
    at += r[d] + gap;
    return o;
  });
  placeAll(next);
  recordMove(before, "distribution");
}

// ---------- element structure: walk the tree, and stack order ----------
const visibleKids = (el) => [...(el?.children || [])].filter((c) => !c.classList.contains("ws-ghost") && c.getBoundingClientRect().width + c.getBoundingClientRect().height > 0);
export function walkEl(dir) {
  const s = S.sel;
  if (s?.kind === "board") {
    const first = visibleKids(docOf(s.item)?.body)[0];
    if (first && dir === "child") selectEl(s.item, first);
    return;
  }
  if (s?.kind !== "el") return;
  const d = docOf(s.item);
  if (dir === "parent") {
    const p = s.el.parentElement;
    return p && p !== d.body && p !== d.documentElement ? selectEl(s.item, p) : selectBoard(s.item);
  }
  if (dir === "child") {
    const k = visibleKids(s.el)[0];
    return k ? selectEl(s.item, k) : toast("No layers inside this one");
  }
  const sibs = visibleKids(s.el.parentElement);
  const i = sibs.indexOf(s.el);
  if (sibs.length < 2 || i < 0) return;
  selectEl(s.item, sibs[(i + (dir === "next" ? 1 : -1) + sibs.length) % sibs.length]);
}
export async function arrangeEl(how) {
  const s = S.sel;
  if (s?.kind !== "el") return;
  const cs = cssOf(s.item, s.el);
  if (!cs) return;
  const z = parseInt(cs.zIndex, 10) || 0;
  const sibZ = visibleKids(s.el.parentElement)
    .filter((x) => x !== s.el)
    .map((x) => parseInt(cssOf(s.item, x)?.zIndex, 10) || 0);
  const next = how === "forward" ? z + 1 : how === "backward" ? z - 1 : how === "front" ? Math.max(z, ...sibZ) + 1 : Math.min(z, ...sibZ) - 1;
  // stacking order only applies to positioned elements
  const props = { "z-index": String(next), ...(cs.position === "static" ? { position: "relative" } : {}) };
  await commitRules(s.env, [{ selector: s.info?.exactSelector || exactSel(s.item, s.el), props }], how === "front" ? "bring to front" : how === "back" ? "send to back" : how === "forward" ? "bring forward" : "send backward");
}

// ---------- view: outlines and rulers ----------
const OUTLINE_CSS = "*{outline:1px solid rgba(82,102,186,.55)!important;outline-offset:-1px!important}";
function applyOutlines(b) {
  try {
    const d = b.frame?.contentDocument;
    if (!d) return;
    let st = d.getElementById("ws-outlines");
    if (S.outlines && !st) {
      st = d.createElement("style");
      st.id = "ws-outlines";
      st.textContent = OUTLINE_CSS;
      (d.head || d.documentElement).append(st);
    } else if (!S.outlines && st) st.remove();
  } catch {}
}
export function toggleOutlines() {
  S.outlines = !S.outlines;
  for (const b of B.values()) applyOutlines(b);
  toast(S.outlines ? "Outlines on" : "Outlines off", S.outlines ? "Every element's box shows on the live boards · ⌘Y" : "");
}
export function toggleRulers() {
  S.rulers = !S.rulers;
  $("stage").classList.toggle("no-rulers", !S.rulers);
  dirty = gfxDirty = true;
}
const undoAll = () => histUndo();

// ---------- pointer ----------
let drag = null;
let spaceDown = false;

function itemUnder(t) {
  const n = t.closest?.(".note,.box");
  if (n) return n.dataset.item;
  const g = t.closest?.("g[data-item]");
  if (g) return g.dataset.item;
  return null;
}

function onDown(e) {
  if (e.button !== 0 && e.button !== 1) return;
  if (e.target.closest(".pop,.cvempty .in")) return;
  // pointerdown below calls preventDefault, which keeps focus where it was: let a note or a panel field finish first
  const ae = document.activeElement;
  if (ae && ae !== document.body && !e.target.closest(".note .tx[contenteditable]") && (ae.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(ae.tagName))) ae.blur();
  const p = local(e);
  const w = toWorld(p);
  if (e.target.closest(".pin")) return;
  closePop();
  const pan = e.button === 1 || S.tool === "hand" || spaceDown;
  const handle = e.target.closest(".hdl");
  const label = e.target.closest(".blabel:not(.ghost)");
  const alabel = e.target.closest(".alabel");
  const ghost = e.target.closest(".bd.ghost");
  const onBoard = ghost ? null : e.target.closest(".bd");
  const under = itemUnder(e.target) || alabel?.dataset.item;
  const editingNote = e.target.closest(".note .tx[contenteditable]");
  if (editingNote) return;
  if (handle && handle.dataset.el && S.sel?.kind === "el") {
    drag = startElResize(handle, p);
    if (!drag) return;
  } else if (handle && S.sel?.kind === "board") {
    const it = item(S.sel.item);
    drag = { kind: "resize", id: it.id, h: handle.dataset.h, p0: p, w0: it.w, h0: it.h };
  } else if (pan) {
    drag = { kind: "pan", p0: p, c0: { ...S.cam } };
    cv.classList.add("grabbing");
  } else if (S.tool === "note") {
    createItem({ type: "note", x: Math.round(w.x), y: Math.round(w.y), text: "", tone: "warm" }).then((n) => {
      if (!n) return;
      setTool("move");
      selectItem(n.id);
      requestAnimationFrame(() => editNote(n.id));
    });
    e.preventDefault();
    return;
  } else if (S.tool === "box") {
    drag = { kind: "box", p0: p, w0: w };
  } else if (S.tool === "arrow") {
    const from = under && S.items.get(under)?.type !== "arrow" ? { item: under } : onBoard ? { item: onBoard.dataset.item } : { x: Math.round(w.x), y: Math.round(w.y) };
    drag = { kind: "arrow", p0: p, from, w0: w };
  } else if (S.tool === "comment") {
    if (ghost) return toast("That's main's screen", "Comment on it from main's page, or on this branch's screen below");
    const b = onBoard ? item(onBoard.dataset.item) : boardAtPoint(p);
    if (!b) return toast("Comments go on a board", "Click a screen to pin a comment to it");
    const el = elAt(b.id, p);
    composeComment(b.id, Math.round(w.x - b.x), Math.round(w.y - b.y), el ? rt(b.id)?.selectorFor(el, true) || null : null);
    e.preventDefault();
    return;
  } else if (e.shiftKey && S.tool === "move" && (label || (under && item(under)) || (onBoard && S.mode === "design"))) {
    // Shift-click adds to the selection, or takes out of it
    toggleSel(label?.dataset.item || (under && item(under) ? under : null) || onBoard.dataset.item);
    e.preventDefault();
    return;
  } else if ((label || under || onBoard) && selIds().length > 1 && selIds().includes(label?.dataset.item || under || onBoard?.dataset.item)) {
    // dragging one of several selected moves them all
    drag = { kind: "group", p0: p, group: groupOf(selIds()), moved: false };
  } else if (label) {
    const id = label.dataset.item;
    selectBoard(id);
    drag = { kind: "group", p0: p, group: [{ id, x: item(id).x, y: item(id).y }], moved: false };
  } else if (under && item(under)) {
    const it = item(under);
    selectItem(it.id);
    if (it.type === "arrow") drag = { kind: "arrowmove", id: it.id, p0: p, from: { ...it.from }, to: { ...it.to }, moved: false };
    else drag = { kind: "group", p0: p, group: [{ id: it.id, x: it.x, y: it.y }], moved: false };
  } else if (onBoard) {
    const id = onBoard.dataset.item;
    const boardSel = S.sel?.kind === "board" && S.sel.item === id;
    const under = elAt(id, p);
    // Design mode: a drag inside a board edits what's under the pointer — or the selected element
    // when the drag starts on it. Drag a frame by its title, or once the frame itself is selected.
    if (S.mode === "design" && S.tool === "move" && !boardSel && under) {
      const cur = S.sel?.kind === "el" && S.sel.item === id && S.sel.el.isConnected ? S.sel.el : null;
      const r = cur && elScreenRect(id, cur);
      const onCur = r && p.x >= r.x && p.x <= r.x + r.w && p.y >= r.y && p.y <= r.y + r.h;
      drag = { kind: "el", id, el: onCur ? cur : under, click: under, p0: p, moved: false };
    } else drag = { kind: "board", id, p0: p, group: [{ id, x: item(id).x, y: item(id).y }], moved: false, el: under };
  } else {
    // an empty spot: drag a box to select what it touches (pan with Space, the hand, or scrolling)
    drag = { kind: "marquee", p0: p, w0: w, add: e.shiftKey ? selIds() : [], moved: false };
  }
  cv.setPointerCapture?.(e.pointerId);
  e.preventDefault();
}

function onMove(e) {
  const p = local(e);
  lastWorld = toWorld(p);
  if (!drag) {
    const over = e.target.closest?.(".bd:not(.ghost)")?.dataset.item || null;
    // the board under the pointer goes live after a moment, so it's ready to pick from or use
    if (over !== hoverBoard) {
      clearTimeout(hoverT);
      if (over) hoverT = setTimeout(() => ((hoverBoard = over), (dirty = true)), S.mode === "prototype" ? 60 : 160);
    }
    if (S.mode === "design" && S.tool === "move" && !spaceDown) {
      if (over) setHover(over, elAt(over, p));
      else setHover(null, null);
    }
    return;
  }
  const dx = p.x - drag.p0.x,
    dy = p.y - drag.p0.y;
  const far = Math.abs(dx) + Math.abs(dy) > 4;
  const z = S.cam.z;
  if (drag.kind === "marquee" && (far || drag.moved)) {
    drag.moved = true;
    if (!HUD.draft) (HUD.draft = h(`<div class="draftbox marquee"></div>`)), hud.append(HUD.draft);
    const a = toScreen(drag.w0);
    placeBox(HUD.draft, { x: Math.min(a.x, p.x), y: Math.min(a.y, p.y), w: Math.abs(p.x - a.x), h: Math.abs(p.y - a.y) });
    const w1 = toWorld(p);
    const r = { x0: Math.min(drag.w0.x, w1.x), y0: Math.min(drag.w0.y, w1.y), x1: Math.max(drag.w0.x, w1.x), y1: Math.max(drag.w0.y, w1.y) };
    const hit = (q) => q.x < r.x1 && q.x + q.w > r.x0 && q.y < r.y1 && q.y + q.h > r.y0;
    const ids = [...pageItems("board"), ...pageItems("note"), ...pageItems("box")].filter((it) => hit(rectOf(it))).map((it) => it.id);
    for (const a2 of pageItems("arrow")) {
      const en = arrowEnds(a2);
      if (en && [en.p0, en.p1].every((pt) => pt.x >= r.x0 && pt.x <= r.x1 && pt.y >= r.y0 && pt.y <= r.y1)) ids.push(a2.id);
    }
    const key = ids.join(",");
    if (key !== drag.key) (drag.key = key), selectMany([...drag.add, ...ids], { quiet: true });
  } else if (drag.kind === "pan") {
    drag.moved = true;
    cv.classList.add("grabbing");
    S.cam.x = drag.c0.x + dx;
    S.cam.y = drag.c0.y + dy;
    applyCam();
  } else if ((drag.kind === "group" || drag.kind === "board") && (far || drag.moved)) {
    drag.moved = true;
    // smart guides: line the group up with the other things on the page
    const snap = e.altKey ? { dx: 0, dy: 0, lines: [] } : guideSnap(drag.group, dx / z, dy / z);
    guideLines = snap.lines;
    for (const g of drag.group) {
      const it = item(g.id);
      if (!it) continue;
      it.x = snap.sx ? Math.round(g.x + dx / z + snap.dx) : Math.round((g.x + dx / z) / SNAP) * SNAP;
      it.y = snap.sy ? Math.round(g.y + dy / z + snap.dy) : Math.round((g.y + dy / z) / SNAP) * SNAP;
      const el = B.get(g.id)?.el || NEL.get(g.id);
      if (el) (el.style.left = it.x + "px"), (el.style.top = it.y + "px");
    }
    if (drag.kind === "board" && S.sel?.item !== drag.id) selectBoard(drag.id);
    setHover(null, null);
    dirty = true;
  } else if (drag.kind === "el" && (far || drag.moved)) {
    if (!drag.started) startElDrag(drag);
    drag.moved = true;
    moveElDrag(drag, dx, dy, e);
  } else if (drag.kind === "elresize") {
    moveElResize(drag, dx, dy, e);
  } else if (drag.kind === "arrowmove" && (far || drag.moved)) {
    drag.moved = true;
    const it = item(drag.id);
    const mv = (end0) => (end0.item ? end0 : { x: Math.round(end0.x + dx / z), y: Math.round(end0.y + dy / z) });
    it.from = mv(drag.from);
    it.to = mv(drag.to);
    dirty = true;
  } else if (drag.kind === "resize") {
    const it = item(drag.id);
    if (drag.h.includes("e")) it.w = clamp(Math.round((drag.w0 + dx / z) / SNAP) * SNAP, 240, 4096);
    if (drag.h.includes("s")) it.h = clamp(Math.round((drag.h0 + dy / z) / SNAP) * SNAP, 240, 4096);
    const b = B.get(drag.id);
    b.el.style.width = it.w + "px";
    b.el.style.height = it.h + "px";
    drag.moved = true;
    dirty = true;
    fire("board-size", drag.id);
  } else if (drag.kind === "box") {
    const w = toWorld(p);
    if (!HUD.draft) (HUD.draft = h(`<div class="draftbox"></div>`)), hud.append(HUD.draft);
    const a = toScreen(drag.w0);
    placeBox(HUD.draft, { x: Math.min(a.x, p.x), y: Math.min(a.y, p.y), w: Math.abs(p.x - a.x), h: Math.abs(p.y - a.y) });
    drag.w1 = w;
  } else if (drag.kind === "arrow") {
    const w = toWorld(p);
    drag.w1 = w;
    let g = wires.querySelector("g.draft");
    if (!g) {
      g = document.createElementNS("http://www.w3.org/2000/svg", "g");
      g.setAttribute("class", "draft");
      g.innerHTML = `<path class="vis draft" marker-end="url(#ah)"></path>`;
      wires.append(g);
    }
    const a = drag.from.item ? endPoint(drag.from, w) : drag.from;
    g.querySelector("path").setAttribute("d", `M${a.x} ${a.y} L${w.x} ${w.y}`);
  }
}

async function onUp(e) {
  const d = drag;
  drag = null;
  cv.classList.remove("grabbing");
  if (!d) return;
  const p = local(e);
  guideLines = [];
  dirty = true;
  if ((d.kind === "group" || d.kind === "board") && d.moved) {
    for (const g of d.group) {
      const it = item(g.id);
      if (it) saveItem(it.id, { x: it.x, y: it.y });
    }
    recordMove(d.group.map((g) => ({ id: g.id, x: g.x, y: g.y })));
    return;
  }
  if (d.kind === "arrowmove" && d.moved) {
    const it = item(d.id);
    saveItem(it.id, { from: it.from, to: it.to });
    recordMove([{ id: d.id, from: d.from, to: d.to }]);
    return;
  }
  if (d.kind === "resize" && d.moved) {
    const it = item(d.id);
    saveItem(it.id, { w: it.w, h: it.h });
    recordMove([{ id: d.id, w: d.w0, h: d.h0 }], "resize");
    return;
  }
  if (d.kind === "marquee") {
    HUD.draft?.remove();
    HUD.draft = null;
    if (!d.moved) return clearSel();
    return fire("sel", {});
  }
  if (d.kind === "el") {
    if (d.moved) return endElDrag(d);
    return selectEl(d.id, d.click || d.el);
  }
  if (d.kind === "elresize") return endElResize(d);
  if (d.kind === "board" && !d.moved) {
    if (S.mode === "design" && S.tool === "move") {
      const el = d.el || elAt(d.id, p);
      if (el) selectEl(d.id, el);
      else {
        if (!B.get(d.id)?.ready) pendingPick = { id: d.id, w: toWorld(p) };
        selectBoard(d.id);
      }
    } else selectBoard(d.id);
    return;
  }
  if (d.kind === "box") {
    HUD.draft?.remove();
    HUD.draft = null;
    const a = d.w0,
      b = d.w1 || a;
    const w = Math.abs(b.x - a.x),
      hh = Math.abs(b.y - a.y);
    setTool("move");
    if (w * S.cam.z < 8 || hh * S.cam.z < 8) return toast("Drag to draw a highlight", "Draw a box around what you want to point out");
    const it = await createItem({ type: "box", x: Math.round(Math.min(a.x, b.x)), y: Math.round(Math.min(a.y, b.y)), w: Math.round(w), h: Math.round(hh), label: "" });
    if (it) (selectItem(it.id), fire("focus-label"));
    return;
  }
  if (d.kind === "arrow") {
    wires.querySelector("g.draft")?.remove();
    setTool("move");
    const end = d.w1 || d.w0;
    if (Math.hypot(end.x - d.w0.x, end.y - d.w0.y) * S.cam.z < 12) return toast("Drag to draw an arrow", "From a note, a box or a board to what it's about");
    const t = document.elementFromPoint(e.clientX, e.clientY);
    const under = t && (itemUnder(t) || t.closest?.(".bd:not(.ghost)")?.dataset.item);
    const to = under && under !== d.from.item && item(under)?.type !== "arrow" ? { item: under } : { x: Math.round(end.x), y: Math.round(end.y) };
    const it = await createItem({ type: "arrow", from: d.from, to, label: "" });
    if (it) selectItem(it.id);
    return;
  }
}

function onDbl(e) {
  const note = e.target.closest(".note");
  if (note) return editNote(note.dataset.item);
  if (e.target.closest(".box,.alabel,g[data-item]")) return fire("focus-label");
  const label = e.target.closest(".blabel:not(.ghost)");
  if (label) return focusItem(label.dataset.item, { maxZ: 0.8 });
  if (S.mode !== "design" || S.tool !== "move") return;
  const onBoard = e.target.closest(".bd:not(.ghost)");
  if (!onBoard) return;
  const el = elAt(onBoard.dataset.item, local(e));
  if (el && editText(onBoard.dataset.item, el)) e.preventDefault();
}

function onWheel(e) {
  if (e.target.closest(".pop")) return;
  e.preventDefault();
  const k = e.deltaMode === 1 ? 16 : e.deltaMode === 2 ? cv.clientHeight : 1;
  const fr = frScale();
  if (e.ctrlKey || e.metaKey) zoomAt(local(e), Math.exp((-e.deltaY * k) / 240));
  else {
    S.cam.x -= (e.deltaX * k) / fr;
    S.cam.y -= (e.deltaY * k) / fr;
    applyCam();
  }
}

function groupOf(ids) {
  return ids.map((id) => S.items.get(id)).filter((it) => it && it.type !== "arrow").map((it) => ({ id: it.id, x: it.x, y: it.y }));
}

// ---------- smart guides ----------
let guideLines = [];
function guideSnap(group, dx, dy) {
  const ids = new Set(group.map((g) => g.id));
  const moving = group.map((g) => item(g.id)).filter(Boolean).map((it, k) => ({ ...rectOf(it), x: group[k].x + dx, y: group[k].y + dy }));
  if (!moving.length) return { dx: 0, dy: 0, lines: [] };
  const mb = { x0: Math.min(...moving.map((r) => r.x)), y0: Math.min(...moving.map((r) => r.y)), x1: Math.max(...moving.map((r) => r.x + r.w)), y1: Math.max(...moving.map((r) => r.y + r.h)) };
  const others = [...pageItems("board"), ...pageItems("note"), ...pageItems("box")].filter((it) => !ids.has(it.id)).map(rectOf);
  const tol = 6 / S.cam.z;
  let best = { x: null, y: null };
  const xs = [mb.x0, (mb.x0 + mb.x1) / 2, mb.x1],
    ys = [mb.y0, (mb.y0 + mb.y1) / 2, mb.y1];
  for (const o of others) {
    for (const t of [o.x, o.x + o.w / 2, o.x + o.w])
      for (const m of xs) {
        const dd = t - m;
        if (Math.abs(dd) <= tol && (best.x === null || Math.abs(dd) < Math.abs(best.x.d))) best.x = { d: dd, at: t, o };
      }
    for (const t of [o.y, o.y + o.h / 2, o.y + o.h])
      for (const m of ys) {
        const dd = t - m;
        if (Math.abs(dd) <= tol && (best.y === null || Math.abs(dd) < Math.abs(best.y.d))) best.y = { d: dd, at: t, o };
      }
  }
  const lines = [];
  if (best.x) lines.push({ x: best.x.at, y0: Math.min(mb.y0, best.x.o.y), y1: Math.max(mb.y1, best.x.o.y + best.x.o.h) });
  if (best.y) lines.push({ y: best.y.at, x0: Math.min(mb.x0, best.y.o.x), x1: Math.max(mb.x1, best.y.o.x + best.y.o.w) });
  return { dx: best.x?.d || 0, dy: best.y?.d || 0, sx: !!best.x, sy: !!best.y, lines };
}
function drawGuides() {
  while (HUD.guides.length < guideLines.length) {
    const d = h(`<div class="guide"></div>`);
    hud.append(d);
    HUD.guides.push(d);
  }
  HUD.guides.forEach((d, k) => {
    const g = guideLines[k];
    d.hidden = !g;
    if (!g) return;
    if (g.x !== undefined) {
      const a = toScreen({ x: g.x, y: g.y0 });
      Object.assign(d.style, { left: a.x + "px", top: a.y + "px", width: "1px", height: (g.y1 - g.y0) * S.cam.z + "px" });
    } else {
      const a = toScreen({ x: g.x0, y: g.y });
      Object.assign(d.style, { left: a.x + "px", top: a.y + "px", width: (g.x1 - g.x0) * S.cam.z + "px", height: "1px" });
    }
  });
}

// ---------- right-click ----------
let ctxAnchor = null;
function onContext(e) {
  e.preventDefault();
  const p = local(e);
  lastWorld = toWorld(p);
  const t = e.target;
  const label = t.closest(".blabel:not(.ghost)");
  const onBoard = t.closest(".bd:not(.ghost)");
  const under = itemUnder(t) || t.closest(".alabel")?.dataset.item;
  const K = (k) => (navigator.platform?.startsWith("Mac") ? k : k.replace("⌘", "Ctrl+").replace("⌥", "Alt+").replace("⇧", "Shift+"));
  let items;
  if (onBoard && !label && S.mode === "design" && S.tool === "move") {
    const id = onBoard.dataset.item;
    const el = (S.sel?.kind === "el" && S.sel.item === id && S.sel.el) || elAt(id, p);
    if (el && !(S.sel?.kind === "el" && S.sel.el === el)) selectEl(id, el);
  }
  if (!S.sel?.kind && (label || under || onBoard)) selectItem(label?.dataset.item || under || onBoard.dataset.item);
  if ((label || under) && !selIds().includes(label?.dataset.item || under)) selectItem(label?.dataset.item || under);
  const s = S.sel;
  const many = selIds().length > 1;
  if (s?.kind === "el") {
    items = [
      { head: s.info?.label || "Element" },
      { label: "Select parent", kbd: K("⇧Enter"), onClick: () => walkEl("parent") },
      { label: "Select first child", kbd: "Enter", onClick: () => walkEl("child") },
      { label: "Select next", kbd: "Tab", onClick: () => walkEl("next") },
      "-",
      { label: "Bring to front", kbd: "]", onClick: () => arrangeEl("front") },
      { label: "Bring forward", kbd: K("⌘]"), onClick: () => arrangeEl("forward") },
      { label: "Send backward", kbd: K("⌘["), onClick: () => arrangeEl("backward") },
      { label: "Send to back", kbd: "[", onClick: () => arrangeEl("back") },
      "-",
      { label: "Copy CSS", onClick: () => fire("copy-css") },
      { label: "Ask an agent about this", onClick: () => fire("ask-agent", {}) },
      { label: "Select the frame", kbd: "Esc", onClick: () => selectBoard(s.item) },
      "-",
      { label: "Remove", kbd: "Delete", danger: true, onClick: () => removeEl() },
    ];
  } else if (selIds().length) {
    const one = !many && S.items.get(selIds()[0]);
    items = [
      { head: many ? plural(selIds().length, "item") : one.type === "board" ? screenName(one) : kindName(one) },
      { label: "Copy", kbd: K("⌘C"), onClick: copySel },
      { label: "Cut", kbd: K("⌘X"), onClick: cutSel },
      { label: "Paste here", kbd: K("⌘V"), disabled: !CLIP, onClick: pasteClip },
      { label: "Duplicate", kbd: K("⌘D"), onClick: duplicateSel },
      ...(many
        ? [
            "-",
            { label: "Align left", kbd: K("⌥A"), onClick: () => alignSel("left") },
            { label: "Align centre", kbd: K("⌥H"), onClick: () => alignSel("hcenter") },
            { label: "Align right", kbd: K("⌥D"), onClick: () => alignSel("right") },
            { label: "Align top", kbd: K("⌥W"), onClick: () => alignSel("top") },
            { label: "Align middle", kbd: K("⌥V"), onClick: () => alignSel("vcenter") },
            { label: "Align bottom", kbd: K("⌥S"), onClick: () => alignSel("bottom") },
            { label: "Distribute horizontally", kbd: K("⌥⇧H"), onClick: () => distributeSel("h") },
            { label: "Distribute vertically", kbd: K("⌥⇧V"), onClick: () => distributeSel("v") },
          ]
        : one?.type === "board"
          ? ["-", { label: "Present", onClick: () => fire("present", one.id) }, { label: "Open in a new tab", onClick: () => window.open(`/env/${one.env}/?ws-screen=${encodeURIComponent(one.screen || "")}`, "_blank", "noopener") }, { label: "Zoom to it", kbd: "⇧2", onClick: () => focusItem(one.id) }]
          : []),
      "-",
      { label: "Delete", kbd: "Delete", danger: true, onClick: () => removeItems(selIds()) },
    ];
  } else {
    items = [
      { label: "Paste here", kbd: K("⌘V"), disabled: !CLIP, onClick: pasteClip },
      { label: "Select all", kbd: K("⌘A"), onClick: selectAll },
      "-",
      { label: "Zoom to fit", kbd: "⇧1", onClick: () => fit() },
      { label: S.outlines ? "Hide outlines" : "Show outlines", kbd: K("⌘Y"), onClick: toggleOutlines },
      { label: S.rulers === false ? "Show rulers" : "Hide rulers", kbd: "⇧R", onClick: toggleRulers },
      "-",
      { label: "Keyboard shortcuts", kbd: "?", onClick: () => fire("shortcuts") },
    ];
  }
  if (!ctxAnchor) (ctxAnchor = h(`<span class="ctxa" aria-hidden="true"></span>`)), $("frame").append(ctxAnchor);
  const fr = $("frame").getBoundingClientRect();
  ctxAnchor.style.left = e.clientX - fr.left + "px";
  ctxAnchor.style.top = e.clientY - fr.top + "px";
  menu(ctxAnchor, items, { width: 248 });
}

// ---------- keys ----------
export function isTyping(t) {
  return !!t && (t.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName));
}
function onKey(e) {
  if ($("modal").classList.contains("open") || $("pal").classList.contains("open")) return;
  const mod = e.metaKey || e.ctrlKey;
  const k = e.key;
  if (k === " " && !spaceDown) {
    spaceDown = true;
    cv.classList.add("panning");
    e.preventDefault();
    return;
  }
  if (mod && (k === "d" || k === "D")) return e.preventDefault(), duplicateSel();
  if (mod && (k === "z" || k === "Z")) {
    e.preventDefault();
    // finish what's still on its way (a nudge, a write) so undo steps back from where you are
    const go = e.shiftKey ? histRedo : histUndo;
    return void (async () => (await flushNudge(), await stylesIdle(), go()))();
  }
  if (mod && (k === "c" || k === "C") && selIds().length) return e.preventDefault(), copySel();
  if (mod && (k === "x" || k === "X") && selIds().length) return e.preventDefault(), cutSel();
  if (mod && (k === "v" || k === "V")) return e.preventDefault(), pasteClip();
  if (mod && (k === "a" || k === "A")) return e.preventDefault(), selectAll();
  if (mod && (k === "y" || k === "Y")) return e.preventDefault(), toggleOutlines();
  if (mod && (k === "]" || k === "[") && S.sel?.kind === "el") return e.preventDefault(), arrangeEl(k === "]" ? "forward" : "backward");
  if (e.altKey && !mod && selIds().length > 1) {
    const al = { KeyA: "left", KeyD: "right", KeyH: "hcenter", KeyW: "top", KeyS: "bottom", KeyV: "vcenter" }[e.code];
    if (al && !e.shiftKey) return e.preventDefault(), alignSel(al);
    if (e.shiftKey && (e.code === "KeyH" || e.code === "KeyV")) return e.preventDefault(), distributeSel(e.code === "KeyH" ? "h" : "v");
  }
  if (mod && (k === "=" || k === "+")) return e.preventDefault(), zoomBy(1.25);
  if (mod && k === "-") return e.preventDefault(), zoomBy(0.8);
  if (mod && k === "0") return e.preventDefault(), zoomTo(1);
  if (mod) return;
  if (k === "Escape") {
    if (pop) return closePop();
    if (S.tool !== "move") return setTool("move");
    if (S.sel?.kind === "el") {
      const parent = S.sel.el.parentElement;
      const d = docOf(S.sel.item);
      if (parent && parent !== d.body && parent !== d.documentElement) selectEl(S.sel.item, parent);
      else selectBoard(S.sel.item);
    } else clearSel();
    return;
  }
  const tools = { v: "move", h: "hand", n: "note", b: "box", a: "arrow", c: "comment" };
  if (tools[k.toLowerCase()] && !e.shiftKey) return setTool(S.tool === tools[k.toLowerCase()] && k.toLowerCase() !== "v" ? "move" : tools[k.toLowerCase()]);
  if (k === "p" || k === "P") return setMode(S.mode === "design" ? "prototype" : "design");
  if (k === "!" || (e.shiftKey && k === "1")) return fit();
  if (k === "@" || (e.shiftKey && k === "2")) return S.sel && focusItem(S.sel.item);
  if (k === "=" || k === "+") return zoomBy(1.25);
  if (k === "-" || k === "_") return zoomBy(0.8);
  if ((k === "]" || k === "[") && S.sel?.kind === "el") return e.preventDefault(), arrangeEl(k === "]" ? "front" : "back");
  if (k === "Tab" && (S.sel?.kind === "el" || S.sel?.kind === "board") && S.mode === "design") return e.preventDefault(), walkEl(e.shiftKey ? "prev" : "next");
  if (k === "Enter" && e.shiftKey && S.sel?.kind === "el") return e.preventDefault(), walkEl("parent");
  if (k === "Enter" && S.sel?.kind === "el" && S.mode === "design") return e.preventDefault(), walkEl("child");
  if ((k === "R" || (e.shiftKey && k === "r")) && !e.altKey) return toggleRulers();
  if (k === "?") return fire("shortcuts");
  // several boards or annotations: arrow keys move them all
  if (selIds().length > 1 && /^Arrow(Left|Right|Up|Down)$/.test(k)) {
    e.preventDefault();
    const st = e.shiftKey ? 8 : 1;
    const before = groupOf(selIds());
    placeAll(before.map((g) => ({ id: g.id, x: g.x + (k === "ArrowLeft" ? -st : k === "ArrowRight" ? st : 0), y: g.y + (k === "ArrowUp" ? -st : k === "ArrowDown" ? st : 0) })));
    return recordMove(before);
  }
  if (S.sel?.kind === "el" && S.mode === "design" && /^Arrow(Left|Right|Up|Down)$/.test(k)) {
    e.preventDefault();
    return nudge(k, e.shiftKey);
  }
  if ((k === "Backspace" || k === "Delete") && S.sel?.kind === "el" && S.mode === "design") {
    e.preventDefault();
    return removeEl();
  }
  if ((k === "Backspace" || k === "Delete") && selIds().length) {
    e.preventDefault();
    return removeItems(selIds());
  }
  if (k === "Enter" && S.sel?.kind === "board" && S.mode === "design") {
    const first = docOf(S.sel.item)?.body?.firstElementChild;
    if (first) selectEl(S.sel.item, first);
  }
}
function onKeyUp(e) {
  if (e.key === " ") {
    spaceDown = false;
    cv.classList.remove("panning");
  }
}

// ---------- dropping HTML files and screens onto the canvas ----------
function initDrop() {
  const hasFiles = (e) => [...(e.dataTransfer?.types || [])].includes("Files");
  const hasScreen = (e) => [...(e.dataTransfer?.types || [])].includes("application/x-workshop-screen");
  cv.addEventListener("dragover", (e) => {
    if (!hasFiles(e) && !hasScreen(e)) return;
    e.preventDefault();
    if (hasFiles(e)) cv.classList.add("dropping");
  });
  cv.addEventListener("dragleave", (e) => e.target === cv && cv.classList.remove("dropping"));
  cv.addEventListener("drop", async (e) => {
    const w = toWorld(local(e));
    if (hasScreen(e)) {
      e.preventDefault();
      try {
        const s = JSON.parse(e.dataTransfer.getData("application/x-workshop-screen"));
        const it = await placeScreen(S.page || s.env, s.screen, s.state, w);
        if (it) selectBoard(it.id);
      } catch {}
      return;
    }
    if (!hasFiles(e)) return;
    e.preventDefault();
    cv.classList.remove("dropping");
    const files = [...e.dataTransfer.files].filter((f) => /\.html?$/i.test(f.name) || f.type === "text/html");
    if (!files.length) return toast("Drop an HTML file", "Prototypes are .html files — a folder's index.html works too");
    let last = null;
    for (const f of files) {
      try {
        last = await importFile(f);
      } catch (er) {
        toast(`Couldn't add ${f.name}`, er.message);
      }
    }
    if (last) fire("open-proto", last.id);
  });
}
export async function importFile(file, name) {
  // Guard: the server caps uploads too; this keeps a huge drop from freezing the tab first.
  if (file.size > 64 * 1024 * 1024) throw new Error("That file is over 64 MB");
  const html = await file.text();
  const env = await api("envs", { method: "POST", body: { html, name: name || undefined, source: { kind: "upload", path: file.name } } });
  toast(`Added ${env.name}`, `A new prototype, saved to envs/${env.id}/index.html`);
  return env;
}

// ---------- init ----------
export function initCanvas() {
  cv = $("cv");
  world = $("world");
  hud = $("hud");
  wires = $("wires");
  boardLayer = $("boards");
  noteLayer = $("notes");
  rulerH = $("rulerH");
  rulerV = $("rulerV");
  G.initGfx($("gfx"), $("bgFrames"), {
    ready: () => (gfxDirty = true),
    frame: async (win, it) => {
      captureCatalog(win, it);
      if (ensureScreen(win, it)) await new Promise((r) => setTimeout(r, it.state ? 1100 : 700));
    },
  });
  window.__workshopCanvas = true; // the runtime in each board checks this to know it is on the canvas
  applyCam();
  cv.addEventListener("pointerdown", onDown);
  cv.addEventListener("pointermove", onMove);
  cv.addEventListener("pointerup", onUp);
  cv.addEventListener("pointercancel", () => {
    const d = drag;
    drag = null;
    cv.classList.remove("grabbing");
    // a cancelled edit leaves the page as it was
    if (d?.kind === "el" && d.started) endPreview([d.el], ["translate", "opacity"]);
    if (d?.kind === "elresize") endPreview([...d.targets, d.el], [...Object.keys(d.props || {}), "translate"]);
  });
  cv.addEventListener("pointerleave", () => (!drag && setHover(null, null), (lastWorld = null)));
  cv.addEventListener("contextmenu", onContext);
  cv.addEventListener("dblclick", onDbl);
  cv.addEventListener("wheel", onWheel, { passive: false });
  hud.addEventListener("click", (e) => {
    const pin = e.target.closest(".pin");
    if (pin) openThread(pin.dataset.c);
  });
  document.addEventListener("keydown", (e) => !isTyping(e.target) && onKey(e));
  document.addEventListener("keyup", onKeyUp);
  window.addEventListener("blur", () => ((spaceDown = false), cv.classList.remove("panning")));
  // a background page that focuses itself on load would take the keyboard: hand it straight back
  window.addEventListener("blur", () =>
    setTimeout(() => {
      const a = document.activeElement;
      if (a?.closest?.("#bgFrames")) {
        a.blur();
        cv.focus({ preventScroll: true });
      }
    }, 0),
  );
  for (const b of document.querySelectorAll("#tb [data-tool]")) b.addEventListener("click", () => setTool(b.dataset.tool));
  $("interactBtn").onclick = () => setMode(S.mode === "design" ? "prototype" : "design");
  $("zPct").onclick = () =>
    menu($("zPct"), [
      { label: "Zoom in", kbd: "+", onClick: () => zoomBy(1.25) },
      { label: "Zoom out", kbd: "−", onClick: () => zoomBy(0.8) },
      "-",
      { label: "Zoom to 100%", kbd: "⌘0", onClick: () => zoomTo(1) },
      { label: "Zoom to fit", kbd: "⇧1", onClick: () => fit() },
      { label: "Zoom to selection", kbd: "⇧2", disabled: !S.sel, onClick: () => S.sel && focusItem(S.sel.item) },
    ], { align: "right", width: 220 });
  new ResizeObserver(() => ((dirty = true), (gfxDirty = true))).observe(cv);
  window.addEventListener("resize", () => ((dirty = true), (gfxDirty = true)));
  // a theme change redraws the canvas in the new colours
  new MutationObserver(() => (gfxDirty = true)).observe(document.documentElement, { attributes: true, attributeFilter: ["data-ltheme"] });
  initDrop();
  requestAnimationFrame(loop);
}
