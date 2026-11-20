// The canvas shows one page: a prototype's main, or one of its branches. Boards are live pages (the
// prototype at one screen) at their real size, titled like frames in a design tool. Notes,
// highlight boxes, arrows and comment pins annotate the page. On a branch, Compare puts main's
// screens above the branch's, live. Design mode puts a hit layer over each board to select elements
// inside it; Interact hands the pointer to the page.

import { S, on, fire, itemsOf, isBranch, screenName, pageItems, pageEnv } from "./state.js";
import { $, h, esc, clamp, frScale, api, toast, IC, menu, rmo, timeAgo } from "./lib.js";

const B = new Map(); // board item id → {id, env, el, frame, hit, ready, loaded}
const NEL = new Map(); // note/box item id → element
const GH = new Map(); // compare boards: main's screens above a branch's, not saved anywhere
const HUD = { labels: new Map(), alabels: new Map(), pins: new Map(), sel: null, hover: null, size: null, handles: [], draft: null };
let cv, world, hud, wires, boardLayer, noteLayer, rulerH, rulerV;
const RULER = 20;
const KEEP_LOADED = 24; // boards of other pages stay loaded so switching back is instant, up to this many
let pop = null;
let dirty = true;
let lastZ = 0;

const SNAP = 8;
const MINZ = 0.05,
  MAXZ = 4;

export const boardOf = (id) => B.get(id);
export const docOf = (id) => {
  try {
    return B.get(id)?.frame.contentDocument || null;
  } catch {
    return null;
  }
};
export const winOf = (id) => {
  try {
    return B.get(id)?.frame.contentWindow || null;
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
export const markDirty = () => (dirty = true);
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
  const banner = $("banner").childElementCount ? 80 : RULER;
  return { x0: RULER, y0: banner, x1: cv.clientWidth, y1: cv.clientHeight - 72 };
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
  let el = null;
  try {
    el = d.elementFromPoint(w.x - b.x, w.y - b.y);
  } catch {
    return null;
  }
  if (!el || el === d.documentElement || el === d.body || el.closest?.(".ws-ghost")) return null;
  return el;
}

// ---------- camera ----------
function applyCam() {
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
  // boards: this page's are shown; other pages' stay loaded, hidden, so switching back is instant
  for (const [id, b] of B) {
    const it = item(id);
    if (!it || (!want.has(id) && (B.size > KEEP_LOADED || id.startsWith("cmp-")))) {
      b.el.remove();
      B.delete(id);
      HUD.labels.get(id)?.remove();
      HUD.labels.delete(id);
      continue;
    }
    b.el.hidden = !want.has(id);
  }
  for (const it of pageBoards()) {
    let b = B.get(it.id);
    if (!b) b = makeBoard(it);
    b.el.hidden = false;
    b.el.style.left = it.x + "px";
    b.el.style.top = it.y + "px";
    b.el.style.width = it.w + "px";
    b.el.style.height = it.h + "px";
    b.frame.title = `${S.envs.get(it.env)?.name || it.env} · ${screenName(it)}`;
    const next = boardSrc(it);
    if (b.loaded && b.src !== next && b.srcStale !== next) b.srcStale = next; // takes effect on the next reload
  }
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
      el.querySelector(".by").textContent = `${(it.author || "You").toUpperCase()} · ${timeAgo(it.updatedAt || it.createdAt).toUpperCase()}`;
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
  const env = S.envs.get(it.env);
  const el = h(`<div class="bd${it.ghost ? " ghost" : ""}" data-item="${esc(it.id)}"><iframe title="${esc(env?.name || it.env)}" allow="clipboard-read; clipboard-write; fullscreen"></iframe><div class="boot">${esc(screenName(it))}</div><div class="hit"></div></div>`);
  const b = { id: it.id, el, frame: el.querySelector("iframe"), hit: el.querySelector(".hit"), ready: false, loaded: false, src: "" };
  b.frame.addEventListener("load", () => b.loaded && onBoardLoad(b));
  boardLayer.append(el);
  B.set(it.id, b);
  return b;
}

// Boards load when they come into view, so a canvas of many screens opens quickly.
function loadVisible() {
  const v = viewRect();
  const m = 600;
  for (const [id, b] of B) {
    if (b.loaded || b.el.hidden) continue;
    const it = item(id);
    if (!it) continue;
    const a = toScreen(it),
      w = it.w * S.cam.z,
      hh = it.h * S.cam.z;
    if (a.x + w < v.x0 - m || a.x > v.x1 + m || a.y + hh < -m || a.y > cv.clientHeight + m) continue;
    b.loaded = true;
    b.src = boardSrc(it);
    b.frame.src = b.src;
  }
}

const catalogSent = new Set();
function onBoardLoad(b) {
  b.ready = true;
  b.el.classList.add("ready");
  const it = item(b.id);
  const d = docOf(b.id);
  if (d) {
    d.addEventListener("keydown", (e) => {
      if (S.presenting && e.key === "Escape") return fire("exit-present");
      if (S.mode === "prototype" && !(e.key === "Escape" && (e.metaKey || e.ctrlKey))) return;
      if (isTyping(e.target)) return;
      onKey(e);
    }, true);
    d.addEventListener("keyup", onKeyUp, true);
    d.addEventListener("pointerdown", () => {
      if (S.mode === "prototype" && S.sel?.item !== b.id && !GH.has(b.id)) selectBoard(b.id, { quiet: true });
    }, true);
  }
  // the page was served with the settings of that moment; they may have changed while it loaded
  const env0 = it && S.envs.get(it.env);
  if (env0) setTimeout(() => rt(b.id)?.apply({ theme: env0.theme, variants: env0.variants, patches: env0.patches }, {}), 300);
  // remember what the prototype offers, for the Screens panel and for agents
  if (it && !catalogSent.has(it.env)) {
    setTimeout(() => {
      const ad = (() => {
        try {
          return rt(b.id)?.adapter();
        } catch {
          return null;
        }
      })();
      if (!ad) return;
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
    }, 900);
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
    fire("env-meta", env);
    return;
  }
  for (const b of bs) reloadBoard(b.id);
}
export function reloadBoard(id) {
  const b = B.get(id),
    it = item(id);
  if (!b || !it || !b.loaded) return;
  b.ready = false;
  b.el.classList.remove("ready");
  b.src = boardSrc(it);
  b.srcStale = null;
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
    } else if (s && s.item && item(s.item)) body = { kind: s.kind, item: item(s.item) };
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
  if (it) setSel({ kind: it.type, item: id }, quiet);
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
    const g = it.ghost ? parentName.toUpperCase().slice(0, 32) : GH.size ? "THIS BRANCH" : "";
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
  }
  const s = S.sel;
  let selRect = null;
  if (s?.kind === "board" && item(s.item)) {
    selRect = screenRect(item(s.item));
    placeBox(HUD.sel, selRect, null);
  } else if (s?.kind === "el" && S.mode === "design") {
    selRect = elScreenRect(s.item, s.el);
    placeBox(HUD.sel, selRect, selRect ? `${s.info?.label || s.el.localName}  ${selRect.rw}×${selRect.rh}` : null);
  } else placeBox(HUD.sel, null);
  for (const [id, el] of NEL) el.classList.toggle("on", s?.item === id);
  const br = s?.kind === "board" ? selRect : null;
  HUD.size.hidden = !br;
  if (br) {
    const bi = item(s.item);
    HUD.size.style.left = br.x + br.w / 2 + "px";
    HUD.size.style.top = br.y + br.h + "px";
    const t = `${bi.w} × ${bi.h}`;
    if (HUD.size.textContent !== t) HUD.size.textContent = t;
  }
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
  loadVisible();
}

function tracking() {
  return dirty || S.sel?.kind === "el" || !!S.hover || !!pop || !!drag;
}
function loop() {
  if (tracking()) drawHud();
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
async function createItem(body) {
  try {
    // annotations belong to the page they're made on
    if (body.type !== "board") body = { ...body, env: S.page };
    const it = await api("canvas/items", { method: "POST", body });
    S.items.set(it.id, it);
    sync();
    fire("items-changed");
    return it;
  } catch (e) {
    toast("Couldn't add that", e.message);
    return null;
  }
}
const saveT = new Map();
function saveItem(id, patch) {
  clearTimeout(saveT.get(id));
  saveT.set(id, setTimeout(() => api(`canvas/items/${id}`, { method: "PATCH", body: patch }).then((n) => S.items.set(id, n)).catch((e) => toast("Couldn't save that", e.message)), 150));
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
  const it = await createItem({ type: "board", env, screen: screen || null, state: state && state !== "Default" ? state : null, ...(x !== undefined ? { x, y } : {}) });
  return it;
}
async function removeItems(ids) {
  const gone = [];
  for (const id of ids) {
    const it = item(id);
    if (!it) continue;
    try {
      await api(`canvas/items/${id}`, { method: "DELETE" });
      S.items.delete(id);
      for (const a of itemsOf("arrow")) if (a.from?.item === id || a.to?.item === id) S.items.delete(a.id);
      gone.push(it);
    } catch (e) {
      toast("Couldn't remove that", e.message);
    }
  }
  if (!gone.length) return;
  clearSel();
  sync();
  fire("items-changed");
  const what = gone.length > 1 ? `${gone.length} items` : gone[0].type === "board" ? `${screenName(gone[0])} board` : gone[0].type;
  toast(`Removed ${what}`, gone.some((g) => g.type === "board") ? "The page keeps its files; only the board left the canvas" : "", {
    label: "Undo",
    fn: async () => {
      for (const g of gone) {
        const { id, createdAt, updatedAt, author, ...rest } = g;
        await createItem(rest);
      }
    },
  });
}
export function duplicateSel() {
  const s = S.sel;
  const it = s?.item && item(s.item);
  if (!it) return;
  if (it.type === "board") return placeScreen(it.env, it.screen, it.state);
  if (it.type === "note") return createItem({ type: "note", x: it.x + 40, y: it.y + 40, w: it.w, text: it.text, tone: it.tone });
  if (it.type === "box") return createItem({ type: "box", x: it.x + 40, y: it.y + 40, w: it.w, h: it.h, label: it.label });
}

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
  if (handle && S.sel?.kind === "board") {
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
    drag = { kind: "board", id, p0: p, group: [{ id, x: item(id).x, y: item(id).y }], moved: false, el: elAt(id, p) };
  } else {
    drag = { kind: "empty", p0: p, c0: { ...S.cam }, moved: false };
  }
  cv.setPointerCapture?.(e.pointerId);
  e.preventDefault();
}

function onMove(e) {
  const p = local(e);
  if (!drag) {
    if (S.mode === "design" && S.tool === "move" && !spaceDown) {
      const onBoard = e.target.closest?.(".bd:not(.ghost)");
      if (onBoard) setHover(onBoard.dataset.item, elAt(onBoard.dataset.item, p));
      else setHover(null, null);
    }
    return;
  }
  const dx = p.x - drag.p0.x,
    dy = p.y - drag.p0.y;
  const far = Math.abs(dx) + Math.abs(dy) > 4;
  const z = S.cam.z;
  if (drag.kind === "pan" || (drag.kind === "empty" && far)) {
    drag.moved = true;
    cv.classList.add("grabbing");
    S.cam.x = drag.c0.x + dx;
    S.cam.y = drag.c0.y + dy;
    applyCam();
  } else if ((drag.kind === "group" || drag.kind === "board") && (far || drag.moved)) {
    drag.moved = true;
    for (const g of drag.group) {
      const it = item(g.id);
      if (!it) continue;
      it.x = Math.round((g.x + dx / z) / SNAP) * SNAP;
      it.y = Math.round((g.y + dy / z) / SNAP) * SNAP;
      const el = B.get(g.id)?.el || NEL.get(g.id);
      if (el) (el.style.left = it.x + "px"), (el.style.top = it.y + "px");
    }
    if (drag.kind === "board" && S.sel?.item !== drag.id) selectBoard(drag.id);
    setHover(null, null);
    dirty = true;
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
  if ((d.kind === "group" || d.kind === "board") && d.moved) {
    for (const g of d.group) {
      const it = item(g.id);
      if (it) saveItem(it.id, { x: it.x, y: it.y });
    }
    return;
  }
  if (d.kind === "arrowmove" && d.moved) {
    const it = item(d.id);
    saveItem(it.id, { from: it.from, to: it.to });
    return;
  }
  if (d.kind === "resize" && d.moved) {
    const it = item(d.id);
    saveItem(it.id, { w: it.w, h: it.h });
    return;
  }
  if (d.kind === "board" && !d.moved) {
    if (S.mode === "design" && S.tool === "move") {
      const el = d.el || elAt(d.id, p);
      if (el) selectEl(d.id, el);
      else selectBoard(d.id);
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
  if (d.kind === "empty" && !d.moved) clearSel();
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
  if ((k === "Backspace" || k === "Delete") && S.sel?.item && S.sel.kind !== "el") {
    e.preventDefault();
    return removeItems([S.sel.item]);
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
  window.__workshopCanvas = true; // the runtime in each board checks this to know it is on the canvas
  applyCam();
  cv.addEventListener("pointerdown", onDown);
  cv.addEventListener("pointermove", onMove);
  cv.addEventListener("pointerup", onUp);
  cv.addEventListener("pointercancel", () => {
    drag = null;
    cv.classList.remove("grabbing");
  });
  cv.addEventListener("pointerleave", () => !drag && setHover(null, null));
  cv.addEventListener("dblclick", onDbl);
  cv.addEventListener("wheel", onWheel, { passive: false });
  hud.addEventListener("click", (e) => {
    const pin = e.target.closest(".pin");
    if (pin) openThread(pin.dataset.c);
  });
  document.addEventListener("keydown", (e) => !isTyping(e.target) && onKey(e));
  document.addEventListener("keyup", onKeyUp);
  window.addEventListener("blur", () => ((spaceDown = false), cv.classList.remove("panning")));
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
  new ResizeObserver(() => (dirty = true)).observe(cv);
  window.addEventListener("resize", () => (dirty = true));
  initDrop();
  requestAnimationFrame(loop);
}
