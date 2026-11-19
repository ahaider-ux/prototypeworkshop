// The canvas: every environment is a live board — a real browser page at its device size, so a
// prototype runs exactly like the app it imitates. Design mode puts a hit layer over each board
// to select the elements inside it; Prototype mode hands the pointer to the page itself.

import { S, on, fire, envList } from "./state.js";
import { $, h, esc, clamp, frScale, api, toast, IC, menu, rmo } from "./lib.js";

const B = new Map(); // id → {id, el, frame, hit, ready, flashT}
let cv, world, hud;
const hudEls = { labels: new Map(), pins: new Map(), sel: null, hover: null, handles: [] };
let pop = null; // open canvas popover {el, env, x, y, kind, id}
let dirty = true;

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
const posOf = (id) => S.ws?.canvas?.boards?.[id] || null;
const devOf = (id) => S.envs.get(id)?.device || { w: 1728, h: 1117 };
export const markDirty = () => (dirty = true);

// ---------- coordinates ----------
function local(e) {
  const r = cv.getBoundingClientRect();
  const fr = frScale();
  return { x: (e.clientX - r.left) / fr, y: (e.clientY - r.top) / fr };
}
const toWorld = (p) => ({ x: (p.x - S.cam.x) / S.cam.z, y: (p.y - S.cam.y) / S.cam.z });
const toScreen = (w) => ({ x: w.x * S.cam.z + S.cam.x, y: w.y * S.cam.z + S.cam.y });

function boardAt(p) {
  const w = toWorld(p);
  for (const id of [...B.keys()].reverse()) {
    const pos = posOf(id),
      d = devOf(id);
    if (pos && w.x >= pos.x && w.x <= pos.x + d.w && w.y >= pos.y && w.y <= pos.y + d.h) return id;
  }
  return null;
}

function elAt(id, p) {
  const d = docOf(id),
    pos = posOf(id);
  if (!d || !pos) return null;
  const w = toWorld(p);
  let el = null;
  try {
    el = d.elementFromPoint(w.x - pos.x, w.y - pos.y);
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
function saveCam() {
  clearTimeout(camT);
  camT = setTimeout(() => {
    try {
      localStorage.setItem("ws-cam", JSON.stringify(S.cam));
    } catch {}
  }, 300);
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
  const ease = (t) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2); // ease-io for an on-screen move
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
const center = () => ({ x: cv.clientWidth / 2, y: cv.clientHeight / 2 });
export function zoomBy(f) {
  zoomAt(center(), f);
}
export function zoomTo(z) {
  const c = center();
  const w = toWorld(c);
  camTo({ z, x: c.x - w.x * z, y: c.y - w.y * z }, 240);
}
export function fit(ids, { ms = 320, maxZ = 1, pad: padIn = 56, toolbar = true } = {}) {
  const list = (ids && ids.length ? ids : [...B.keys()]).filter((id) => posOf(id));
  if (!list.length) return;
  let x0 = Infinity,
    y0 = Infinity,
    x1 = -Infinity,
    y1 = -Infinity;
  for (const id of list) {
    const p = posOf(id),
      d = devOf(id);
    x0 = Math.min(x0, p.x);
    y0 = Math.min(y0, p.y - 30);
    x1 = Math.max(x1, p.x + d.w);
    y1 = Math.max(y1, p.y + d.h);
  }
  if (!toolbar) y0 += 30; // presenting: no label room above the board
  const pad = padIn,
    vw = cv.clientWidth - pad * 2,
    vh = cv.clientHeight - pad * 2 - (toolbar ? 56 : 0); // the toolbar sits at the bottom
  const z = clamp(Math.min(vw / (x1 - x0), vh / (y1 - y0), maxZ), MINZ, MAXZ);
  camTo({ z, x: pad + (vw - (x1 - x0) * z) / 2 - x0 * z, y: pad + (vh - (y1 - y0) * z) / 2 - y0 * z }, ms);
}
export function focusEnv(id, opts) {
  fit([id], opts);
}

// ---------- boards ----------
export function syncBoards() {
  const ids = new Set(S.envs.keys());
  for (const [id, b] of B) {
    if (!ids.has(id)) {
      b.el.remove();
      B.delete(id);
      hudEls.labels.get(id)?.remove();
      hudEls.labels.delete(id);
      if (S.sel?.env === id) clearSel();
    }
  }
  let placeX = null;
  for (const env of envList()) {
    let b = B.get(env.id);
    if (!posOf(env.id)) {
      // an environment that appeared on disk without a spot (an agent made the folder): put it at the end
      if (placeX === null) placeX = Math.max(0, ...[...B.keys()].map((k) => (posOf(k)?.x || 0) + devOf(k).w + 160));
      S.ws.canvas.boards[env.id] = { x: placeX, y: 0 };
      api(`canvas/boards/${env.id}`, { method: "PUT", body: { x: placeX, y: 0 } }).catch(() => {});
      placeX += env.device.w + 160;
    }
    if (!b) b = makeBoard(env);
    const p = posOf(env.id);
    b.el.style.left = p.x + "px";
    b.el.style.top = p.y + "px";
    b.el.style.width = env.device.w + "px";
    b.el.style.height = env.device.h + "px";
    b.frame.title = env.name;
    b.el.querySelector(".boot").textContent = `Opening ${env.name}`;
  }
  $("cvEmpty").hidden = S.envs.size > 0;
  dirty = true;
}

function makeBoard(env) {
  const el = h(`<div class="bd" data-env="${esc(env.id)}"><iframe src="/env/${esc(env.id)}/" title="${esc(env.name)}" allow="clipboard-read; clipboard-write; fullscreen"></iframe><div class="boot">Opening ${esc(env.name)}</div><div class="hit"></div></div>`);
  const b = { id: env.id, el, frame: el.querySelector("iframe"), hit: el.querySelector(".hit"), ready: false };
  b.frame.addEventListener("load", () => onBoardLoad(b));
  world.append(el);
  B.set(env.id, b);
  return b;
}

function onBoardLoad(b) {
  b.ready = true;
  b.el.classList.add("ready");
  const d = docOf(b.id);
  if (d) {
    // keys typed inside a board still reach the canvas in Design mode (Prototype mode leaves them to the app)
    d.addEventListener("keydown", (e) => {
      if (S.presenting && e.key === "Escape") return fire("exit-present");
      if (S.mode === "prototype" && !(e.key === "Escape" && (e.metaKey || e.ctrlKey))) return;
      if (isTyping(e.target)) return;
      onKey(e);
    }, true);
    d.addEventListener("keyup", (e) => onKeyUp(e), true);
    d.addEventListener("pointerdown", () => {
      if (S.mode === "prototype" && S.sel?.env !== b.id) selectBoard(b.id, { quiet: true });
    }, true);
  }
  if (S.sel?.kind === "el" && S.sel.env === b.id && !S.sel.el.isConnected) {
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

function safeQuery(d, sel) {
  try {
    return d?.querySelector(sel) || null;
  } catch {
    return null;
  }
}

export async function reloadBoard(id, files = []) {
  const b = B.get(id);
  if (!b) return;
  const f = files.filter(Boolean);
  const onlyOverrides = f.length && f.every((x) => x === "overrides.css");
  const onlyMeta = f.length && f.every((x) => x === "env.json" || x === "overrides.css");
  if (onlyOverrides || onlyMeta) {
    if (f.includes("overrides.css")) {
      try {
        const { css } = await api(`envs/${id}/styles`);
        rt(id)?.setOverrides(css);
      } catch {}
    }
    fire("env-meta", id);
    return;
  }
  try {
    b.frame.contentWindow.location.reload();
  } catch {
    b.frame.src = `/env/${id}/`;
  }
  b.ready = false;
  b.el.classList.remove("ready");
  flash(id, "Updated");
}

function flash(id, text) {
  const l = hudEls.labels.get(id);
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
    const env = s ? S.envs.get(s.env) : null;
    let body = null;
    if (s && env) {
      body = { env: s.env, envName: env.name, kind: s.kind };
      if (s.kind === "el" && s.info) {
        const i = s.info;
        Object.assign(body, { selector: S.scope === "exact" ? i.exactSelector : i.selector, exactSelector: i.exactSelector, matches: i.matches, label: i.label, text: i.text, html: i.html, styles: i.styles, rect: i.rect, screen: rt(s.env)?.adapter()?.screen || null });
      }
    }
    api("selection", { method: "PUT", body: { selection: body } }).catch(() => {});
  }, 200);
}
export function selectBoard(id, { quiet = false } = {}) {
  if (!S.envs.has(id)) return;
  S.sel = { kind: "board", env: id };
  dirty = true;
  pushSelection();
  fire("sel", { quiet });
}
export function selectEl(id, el, { quiet = false } = {}) {
  const r = rt(id);
  const info = r?.describe(el) || { tag: el.localName, label: el.localName, selector: el.localName, exactSelector: el.localName, matches: 1, styles: {}, rect: {} };
  S.sel = { kind: "el", env: id, el, info };
  dirty = true;
  pushSelection();
  fire("sel", { quiet });
}
export function clearSel() {
  if (!S.sel) return;
  S.sel = null;
  dirty = true;
  pushSelection();
  fire("sel", {});
}
export function refreshSelInfo() {
  if (S.sel?.kind === "el" && S.sel.el?.isConnected) {
    S.sel.info = rt(S.sel.env)?.describe(S.sel.el) || S.sel.info;
    pushSelection();
  }
}
export function setHover(env, el) {
  const same = S.hover && S.hover.env === env && S.hover.el === el;
  if (same) return;
  S.hover = el ? { env, el } : null;
  dirty = true;
  fire("hover");
}

// ---------- tools & modes ----------
export function setTool(t) {
  S.tool = t;
  cv.classList.remove("tool-move", "tool-hand", "tool-comment");
  cv.classList.add(`tool-${t}`);
  for (const b of document.querySelectorAll("#cvtools [data-tool]")) b.classList.toggle("on", b.dataset.tool === t);
  if (t !== "move") setHover(null, null);
  closePop();
}
export function setMode(m) {
  S.mode = m;
  cv.classList.toggle("mode-design", m === "design");
  cv.classList.toggle("mode-prototype", m === "prototype");
  for (const b of document.querySelectorAll("#modeSeg button")) {
    b.classList.toggle("on", b.dataset.mode === m);
    b.setAttribute("aria-checked", String(b.dataset.mode === m));
  }
  if (m === "prototype") {
    setHover(null, null);
    if (S.sel?.kind === "el") selectBoard(S.sel.env, { quiet: true });
    if (S.tool !== "move") setTool("move");
  }
  dirty = true;
  fire("mode");
}

// ---------- HUD ----------
function boxFor(cls) {
  const el = h(`<div class="box ${cls}"><span class="tag"></span></div>`);
  hud.append(el);
  return el;
}
function placeBox(el, r, tag) {
  if (!r) {
    el.hidden = true;
    return;
  }
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
  const pos = posOf(id);
  if (!pos) return null;
  const r = el.getBoundingClientRect();
  if (!r.width && !r.height) return null;
  const a = toScreen({ x: pos.x + r.left, y: pos.y + r.top });
  return { x: a.x, y: a.y, w: r.width * S.cam.z, h: r.height * S.cam.z, rw: Math.round(r.width), rh: Math.round(r.height) };
}
function boardScreenRect(id) {
  const pos = posOf(id),
    d = devOf(id);
  if (!pos) return null;
  const a = toScreen(pos);
  return { x: a.x, y: a.y, w: d.w * S.cam.z, h: d.h * S.cam.z };
}

export function drawHud() {
  dirty = false;
  // board labels
  for (const env of S.envs.values()) {
    let l = hudEls.labels.get(env.id);
    if (!l) {
      l = h(`<div class="blabel" data-env="${esc(env.id)}"><span class="n"></span><span class="m"></span><span class="flash"></span></div>`);
      hud.append(l);
      hudEls.labels.set(env.id, l);
    }
    const r = boardScreenRect(env.id);
    if (!r) continue;
    l.style.left = r.x + "px";
    l.style.top = r.y + "px";
    l.style.maxWidth = Math.max(120, r.w) + "px";
    const n = l.querySelector(".n");
    if (n.textContent !== env.name) n.textContent = env.name;
    const m = `${env.device.w} × ${env.device.h}${env.parent ? " · fork" : ""}`;
    const me = l.querySelector(".m");
    if (me.textContent !== m) me.textContent = m;
    l.classList.toggle("on", S.sel?.env === env.id);
  }
  // selection
  if (!hudEls.sel) {
    hudEls.sel = boxFor("sel");
    hudEls.hover = boxFor("hover");
    for (const k of ["e", "s", "se"]) {
      const d = h(`<div class="hdl ${k}" data-h="${k}"></div>`);
      hud.append(d);
      hudEls.handles.push(d);
    }
  }
  const s = S.sel;
  let selRect = null;
  if (s?.kind === "board") {
    selRect = boardScreenRect(s.env);
    hudEls.sel.classList.add("board");
    placeBox(hudEls.sel, selRect, null);
  } else if (s?.kind === "el" && S.mode === "design") {
    selRect = elScreenRect(s.env, s.el);
    hudEls.sel.classList.remove("board");
    placeBox(hudEls.sel, selRect, selRect ? `${s.info?.label || s.el.localName}  ${selRect.rw}×${selRect.rh}` : null);
  } else placeBox(hudEls.sel, null);
  // resize handles only for a selected board
  const br = s?.kind === "board" ? selRect : null;
  for (const d of hudEls.handles) {
    d.hidden = !br;
    if (!br) continue;
    const k = d.dataset.h;
    d.style.left = (k === "s" ? br.x + br.w / 2 : br.x + br.w) + "px";
    d.style.top = (k === "e" ? br.y + br.h / 2 : br.y + br.h) + "px";
  }
  // hover
  const hv = S.hover;
  const hr = hv && S.mode === "design" && S.tool === "move" && !(s?.kind === "el" && s.el === hv.el) ? elScreenRect(hv.env, hv.el) : null;
  placeBox(hudEls.hover, hr, null);
  // comment pins
  const live = new Set();
  const top = S.comments.filter((c) => !c.parent && S.envs.has(c.env));
  top.forEach((c, i) => {
    live.add(c.id);
    let p = hudEls.pins.get(c.id);
    if (!p) {
      p = h(`<button type="button" class="pin" data-c="${esc(c.id)}" aria-label="Comment"></button>`);
      hud.append(p);
      hudEls.pins.set(c.id, p);
    }
    const pos = posOf(c.env);
    if (!pos) return;
    const a = toScreen({ x: pos.x + c.x, y: pos.y + c.y });
    p.style.left = a.x + "px";
    p.style.top = a.y + "px";
    p.textContent = String(i + 1);
    p.classList.toggle("done", !!c.resolved);
    p.classList.toggle("on", pop?.kind === "thread" && pop.id === c.id);
    p.hidden = !!c.resolved && !S.showResolved;
  });
  for (const [id, p] of hudEls.pins) if (!live.has(id)) (p.remove(), hudEls.pins.delete(id));
  placePop();
}

function tracking() {
  return dirty || S.sel?.kind === "el" || !!S.hover || !!pop;
}
function loop() {
  if (S.view === "canvas" && tracking()) drawHud();
  requestAnimationFrame(loop);
}

// ---------- popovers on the canvas: comment composer and thread ----------
function closePop() {
  if (!pop) return;
  pop.el.remove();
  pop = null;
  dirty = true;
}
function placePop() {
  if (!pop) return;
  const pos = posOf(pop.env);
  if (!pos) return closePop();
  const a = toScreen({ x: pos.x + pop.x, y: pos.y + pop.y });
  const w = pop.el.offsetWidth,
    hgt = pop.el.offsetHeight;
  pop.el.style.left = clamp(a.x + 16, 8, cv.clientWidth - w - 8) + "px";
  pop.el.style.top = clamp(a.y - 28, 8, cv.clientHeight - hgt - 8) + "px";
}
function composeComment(env, bx, by, selector) {
  closePop();
  const el = h(`<div class="pop" role="dialog" aria-label="New comment"><textarea class="afld-ta" placeholder="Add a comment" aria-label="Comment"></textarea><div class="acts"><button type="button" class="ghbtn sm" data-a="cancel">Cancel</button><button type="button" class="createbtn sm" data-a="post">Comment</button></div></div>`);
  cv.append(el);
  pop = { el, env, x: bx, y: by, kind: "new" };
  placePop();
  const ta = el.querySelector("textarea");
  ta.focus();
  let busy = false;
  const post = async () => {
    const text = ta.value.trim();
    if (!text || busy) return;
    busy = true;
    try {
      await api("comments", { method: "POST", body: { env, x: bx, y: by, selector, text } });
      closePop();
      fire("comments-changed");
    } catch (e) {
      toast("Couldn't add the comment", e.message);
      busy = false;
    }
  };
  el.querySelector('[data-a="post"]').onclick = post;
  el.querySelector('[data-a="cancel"]').onclick = closePop;
  ta.addEventListener("keydown", (e) => {
    if (e.key === "Enter" && (e.metaKey || e.ctrlKey || !e.shiftKey)) {
      e.preventDefault();
      post();
    } else if (e.key === "Escape") {
      e.stopPropagation();
      closePop();
    }
  });
}
export function openThread(id) {
  const c = S.comments.find((x) => x.id === id);
  if (!c) return;
  closePop();
  const replies = S.comments.filter((r) => r.parent === id);
  const row = (x) => `<div class="cm"><span class="av">${esc((x.author || "?")[0].toUpperCase())}</span><div class="tx"><b>${esc(x.author)}</b><i>${esc(new Date(x.createdAt).toLocaleString(undefined, { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" }))}</i><p>${esc(x.text)}</p></div></div>`;
  const el = h(`<div class="pop" role="dialog" aria-label="Comment thread">${row(c)}${replies.map(row).join("")}<textarea class="afld-ta" placeholder="Reply" aria-label="Reply" style="min-height:40px"></textarea><div class="acts"><button type="button" class="ghbtn sm" data-a="del" style="margin-right:auto;color:var(--text-error)">Delete</button><button type="button" class="dbtn sm" data-a="agent">Ask agent</button><button type="button" class="dbtn sm" data-a="res">${c.resolved ? "Reopen" : "Resolve"}</button><button type="button" class="createbtn sm" data-a="reply">Reply</button></div></div>`);
  cv.append(el);
  pop = { el, env: c.env, x: c.x, y: c.y, kind: "thread", id };
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
    const d = docOf(c.env);
    const target = c.selector ? safeQuery(d, c.selector) : null;
    if (target) selectEl(c.env, target);
    else selectBoard(c.env);
    fire("ask-agent", { prompt: c.text });
  };
  ta.addEventListener("keydown", (e) => {
    if (e.key === "Escape") {
      e.stopPropagation();
      closePop();
    }
  });
}

// ---------- inline text editing (double-click a text element in Design mode) ----------
function editText(id, el) {
  const info = rt(id)?.describe(el);
  if (!info?.editableText) return false;
  const b = B.get(id);
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
    if (!keep) {
      el.textContent = before;
      return;
    }
    if (text === before) return;
    try {
      await api(`envs/${id}/text`, { method: "PUT", body: { selector: info.exactSelector, text } });
      toast("Text changed", "Saved as a text edit on this environment", { label: "Undo", fn: async () => { el.textContent = before; await api(`envs/${id}/text`, { method: "PUT", body: { selector: info.exactSelector, text: null } }); } });
    } catch (e) {
      el.textContent = before;
      toast("Couldn't save the text", e.message);
    }
    refreshSelInfo();
    fire("sel", { quiet: true });
  };
  const onk = (e) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      finish(true);
    } else if (e.key === "Escape") {
      e.preventDefault();
      e.stopPropagation();
      finish(false);
    }
    e.stopPropagation();
  };
  const onb = () => finish(true);
  el.addEventListener("keydown", onk, true);
  el.addEventListener("blur", onb);
  return true;
}

// ---------- pointer ----------
let drag = null;
let spaceDown = false;

function onDown(e) {
  if (e.button !== 0 && e.button !== 1) return;
  if (e.target.closest(".cvtools,.pop,.cvempty .in")) return;
  const p = local(e);
  const pin = e.target.closest(".pin");
  if (pin) return; // click opens the thread
  const handle = e.target.closest(".hdl");
  const label = e.target.closest(".blabel");
  const onBoard = e.target.closest(".bd");
  const pan = e.button === 1 || S.tool === "hand" || spaceDown;
  closePop();
  if (handle && S.sel?.kind === "board") {
    const env = S.envs.get(S.sel.env);
    drag = { kind: "resize", id: env.id, h: handle.dataset.h, p0: p, w0: env.device.w, h0: env.device.h };
  } else if (pan) {
    drag = { kind: "pan", p0: p, c0: { ...S.cam } };
    cv.classList.add("grabbing");
  } else if (label) {
    const id = label.dataset.env;
    selectBoard(id);
    drag = { kind: "move", id, p0: p, b0: { ...posOf(id) }, moved: false };
  } else if (onBoard) {
    const id = onBoard.dataset.env;
    if (S.tool === "comment") {
      const w = toWorld(p),
        pos = posOf(id);
      const el = elAt(id, p);
      composeComment(id, Math.round(w.x - pos.x), Math.round(w.y - pos.y), el ? rt(id)?.selectorFor(el, true) || null : null);
      e.preventDefault();
      return;
    }
    drag = { kind: "board", id, p0: p, b0: { ...posOf(id) }, moved: false, el: elAt(id, p) };
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
      const t = e.target;
      const onBoard = t.closest?.(".bd");
      if (onBoard) setHover(onBoard.dataset.env, elAt(onBoard.dataset.env, p));
      else setHover(null, null);
    }
    return;
  }
  const dx = p.x - drag.p0.x,
    dy = p.y - drag.p0.y;
  const far = Math.abs(dx) + Math.abs(dy) > 4;
  if (drag.kind === "pan" || (drag.kind === "empty" && far)) {
    drag.moved = true;
    cv.classList.add("grabbing");
    S.cam.x = drag.c0.x + dx;
    S.cam.y = drag.c0.y + dy;
    applyCam();
  } else if ((drag.kind === "move" || drag.kind === "board") && (far || drag.moved)) {
    drag.moved = true;
    const nx = Math.round((drag.b0.x + dx / S.cam.z) / SNAP) * SNAP;
    const ny = Math.round((drag.b0.y + dy / S.cam.z) / SNAP) * SNAP;
    S.ws.canvas.boards[drag.id] = { x: nx, y: ny };
    const b = B.get(drag.id);
    b.el.style.left = nx + "px";
    b.el.style.top = ny + "px";
    if (S.sel?.env !== drag.id) selectBoard(drag.id);
    setHover(null, null);
    dirty = true;
  } else if (drag.kind === "resize") {
    const env = S.envs.get(drag.id);
    let w = drag.w0,
      hh = drag.h0;
    if (drag.h.includes("e")) w = clamp(Math.round((drag.w0 + dx / S.cam.z) / SNAP) * SNAP, 240, 4096);
    if (drag.h.includes("s")) hh = clamp(Math.round((drag.h0 + dy / S.cam.z) / SNAP) * SNAP, 240, 4096);
    env.device = { w, h: hh };
    const b = B.get(drag.id);
    b.el.style.width = w + "px";
    b.el.style.height = hh + "px";
    drag.moved = true;
    dirty = true;
    fire("device-live", drag.id);
  }
}

async function onUp(e) {
  const d = drag;
  drag = null;
  cv.classList.remove("grabbing");
  if (!d) return;
  const p = local(e);
  if ((d.kind === "move" || d.kind === "board") && d.moved) {
    const pos = posOf(d.id);
    api(`canvas/boards/${d.id}`, { method: "PUT", body: pos }).catch((er) => toast("Couldn't move the board", er.message));
    return;
  }
  if (d.kind === "resize" && d.moved) {
    const env = S.envs.get(d.id);
    try {
      const next = await api(`envs/${d.id}`, { method: "PATCH", body: { device: env.device } });
      S.envs.set(d.id, next);
      fire("env-meta", d.id);
    } catch (er) {
      toast("Couldn't resize the board", er.message);
    }
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
  if (d.kind === "empty" && !d.moved) clearSel();
}

function onDbl(e) {
  if (S.mode !== "design" || S.tool !== "move") return;
  const onBoard = e.target.closest(".bd");
  const label = e.target.closest(".blabel");
  if (label) return fire("rename", label.dataset.env);
  if (!onBoard) return;
  const p = local(e);
  const el = elAt(onBoard.dataset.env, p);
  if (el && editText(onBoard.dataset.env, el)) e.preventDefault();
}

function onWheel(e) {
  if (e.target.closest(".cvtools,.pop")) return;
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
  if (S.view !== "canvas") return;
  if ($("modal").classList.contains("open") || $("pal").classList.contains("open")) return;
  const mod = e.metaKey || e.ctrlKey;
  const k = e.key;
  if (k === " " && !spaceDown) {
    spaceDown = true;
    cv.classList.add("panning");
    e.preventDefault();
    return;
  }
  if (mod && (k === "d" || k === "D")) {
    e.preventDefault();
    if (S.sel) fire("duplicate", S.sel.env);
    return;
  }
  if (mod && (k === "=" || k === "+")) return e.preventDefault(), zoomBy(1.25);
  if (mod && k === "-") return e.preventDefault(), zoomBy(0.8);
  if (mod && k === "0") return e.preventDefault(), zoomTo(1);
  if (mod) return;
  if (k === "Escape") {
    if (pop) return closePop();
    if (S.sel?.kind === "el") {
      const parent = S.sel.el.parentElement;
      const d = docOf(S.sel.env);
      if (parent && parent !== d.body && parent !== d.documentElement) selectEl(S.sel.env, parent);
      else selectBoard(S.sel.env);
    } else clearSel();
    return;
  }
  if (k === "v" || k === "V") return setTool("move");
  if (k === "h" || k === "H") return setTool("hand");
  if (k === "c" || k === "C") return setTool(S.tool === "comment" ? "move" : "comment");
  if (k === "p" || k === "P") return setMode(S.mode === "design" ? "prototype" : "design");
  if (k === "!" || (e.shiftKey && k === "1")) return fit();
  if (k === "@" || (e.shiftKey && k === "2")) return S.sel && fit([S.sel.env]);
  if (k === "=" || k === "+") return zoomBy(1.25);
  if (k === "-" || k === "_") return zoomBy(0.8);
  if ((k === "Backspace" || k === "Delete") && S.sel?.kind === "board") {
    e.preventDefault();
    return fire("delete", S.sel.env);
  }
  if (k === "Enter" && S.sel?.kind === "board" && S.mode === "design") {
    const d = docOf(S.sel.env);
    const first = d?.body?.firstElementChild;
    if (first) selectEl(S.sel.env, first);
  }
}
function onKeyUp(e) {
  if (e.key === " ") {
    spaceDown = false;
    cv.classList.remove("panning");
  }
}

// ---------- dropping HTML files onto the canvas ----------
function initDrop() {
  const has = (e) => [...(e.dataTransfer?.types || [])].includes("Files");
  cv.addEventListener("dragover", (e) => {
    if (!has(e)) return;
    e.preventDefault();
    cv.classList.add("dropping");
  });
  cv.addEventListener("dragleave", (e) => {
    if (e.target === cv) cv.classList.remove("dropping");
  });
  cv.addEventListener("drop", async (e) => {
    if (!has(e)) return;
    e.preventDefault();
    cv.classList.remove("dropping");
    const w = toWorld(local(e));
    const files = [...e.dataTransfer.files].filter((f) => /\.html?$/i.test(f.name) || f.type === "text/html");
    if (!files.length) return toast("Drop an HTML file", "Prototypes are .html files — a folder's index.html works too");
    let x = Math.round(w.x / SNAP) * SNAP;
    for (const f of files) {
      try {
        const env = await importFile(f);
        await api(`canvas/boards/${env.id}`, { method: "PUT", body: { x, y: Math.round(w.y / SNAP) * SNAP } });
        S.ws.canvas.boards[env.id] = { x, y: Math.round(w.y / SNAP) * SNAP };
        x += env.device.w + 160;
      } catch (er) {
        toast(`Couldn't add ${f.name}`, er.message);
      }
    }
    fire("reload-workspace");
  });
}
export async function importFile(file, name) {
  // Guard: the server caps uploads too; this keeps a huge drop from freezing the tab first.
  if (file.size > 64 * 1024 * 1024) throw new Error("That file is over 64 MB");
  const html = await file.text();
  const env = await api("envs", { method: "POST", body: { html, name: name || undefined, source: { kind: "upload", path: file.name } } });
  toast(`Added ${env.name}`, `Saved to envs/${env.id}/index.html`);
  return env;
}

// ---------- init ----------
export function initCanvas() {
  cv = $("cv");
  world = $("world");
  hud = $("hud");
  window.__workshopCanvas = true; // the runtime in each board checks this to know it is on the canvas
  try {
    const c = JSON.parse(localStorage.getItem("ws-cam") || "null");
    if (c && [c.x, c.y, c.z].every(Number.isFinite)) Object.assign(S.cam, { x: c.x, y: c.y, z: clamp(c.z, MINZ, MAXZ) });
  } catch {}
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
  document.addEventListener("keydown", (e) => {
    if (isTyping(e.target)) return;
    onKey(e);
  });
  document.addEventListener("keyup", onKeyUp);
  window.addEventListener("blur", () => {
    spaceDown = false;
    cv.classList.remove("panning");
  });
  for (const b of document.querySelectorAll("#cvtools [data-tool]")) b.addEventListener("click", () => setTool(b.dataset.tool));
  for (const b of document.querySelectorAll("#modeSeg button")) b.addEventListener("click", () => setMode(b.dataset.mode));
  $("zIn").onclick = () => zoomBy(1.25);
  $("zOut").onclick = () => zoomBy(0.8);
  $("zPct").onclick = () =>
    menu($("zPct"), [
      { label: "Zoom in", kbd: "+", onClick: () => zoomBy(1.25) },
      { label: "Zoom out", kbd: "−", onClick: () => zoomBy(0.8) },
      "-",
      { label: "Zoom to 100%", kbd: "⌘0", onClick: () => zoomTo(1) },
      { label: "Zoom to fit", kbd: "⇧1", onClick: () => fit() },
      { label: "Zoom to selection", kbd: "⇧2", disabled: !S.sel, onClick: () => S.sel && fit([S.sel.env]) },
    ], { up: true, align: "center" });
  new ResizeObserver(() => (dirty = true)).observe(cv);
  window.addEventListener("resize", () => (dirty = true));
  initDrop();
  on("comments", () => (dirty = true));
  requestAnimationFrame(loop);
}
