// The canvas's graphics layer. Boards are drawn as bitmaps on one <canvas>, so panning and zooming
// a page of many screens stays smooth: no live page is laid out or repainted while you move. The
// real pages (the DOM) run in the background — a small pool of hidden frames loads each board, lets
// the prototype settle, and turns it into a bitmap. Only the boards you're working in are mounted
// live on top (see canvas.js), and they hand back a fresh bitmap when they're put away.
//
// Pictures are also saved on this computer (the server's .workshop/snapshots), named by what the
// board shows: its prototype's look (a hash of its files, overrides and settings, from the server),
// screen, state and size. Opening a page again, or a branch nobody has changed, draws at once.

import { pagesFree, apartUrl } from "./lib.js";
import { drawingOf, settle, sleep } from "./snap.js";

const LEVEL = 0.5; // bitmaps are kept at half size: sharp up to 50% zoom on a 1× screen
const POOL = 3; // background pages loading at once
const MAX_BITMAPS = 160; // Guard: bitmaps are ~2 MB each at half size; past this the oldest go
const LOAD_TIMEOUT = 25000;

const CACHE = new Map(); // content key → {bmp, w, h, used}
const LAST = new Map(); // board id → content key last drawn, so a stale board keeps its old picture
const REV = new Map(); // env id → revision, bumped whenever its files or settings change
const FAILED = new Map(); // content key → when it failed
let QUEUE = []; // jobs wanted now, most important first
const RUNNING = new Map(); // content key → promise
let host = null,
  canvas = null,
  ctx = null,
  onReady = () => {},
  onFrame = () => {},
  lookOf = () => null;

export function initGfx(canvasEl, hostEl, { ready, frame, look } = {}) {
  if (look) lookOf = look;
  canvas = canvasEl;
  ctx = canvas.getContext("2d", { alpha: true });
  host = hostEl;
  if (ready) onReady = ready;
  if (frame) onFrame = frame;
}
export const rev = (env) => REV.get(env) || 0;
export function invalidate(env) {
  REV.set(env, rev(env) + 1);
}
// what a board shows; without a look from the server yet, only this session can match it
const DRAWING = 7; // the snapshot format: bump it when what goes into a drawing changes, so old ones aren't reused
export const keyOf = (it) => `${lookOf(it.env) || `${it.env}@${rev(it.env)}`}|${it.file || ""}|${it.screen || ""}|${it.state || ""}|${it.w}x${it.h}|${LEVEL}|d${DRAWING}`;

// ---------- saved pictures ----------
const HASHES = new Map();
async function hashOf(k) {
  if (HASHES.has(k)) return HASHES.get(k);
  const d = await crypto.subtle.digest("SHA-1", new TextEncoder().encode(k));
  const hx = [...new Uint8Array(d)].map((b) => b.toString(16).padStart(2, "0")).join("");
  HASHES.set(k, hx);
  return hx;
}
const saved = (k) => !k.includes("@"); // only keys that name the content can be shared across visits
async function loadSaved(k, w, h) {
  if (!saved(k)) return null;
  try {
    const r = await fetch(`/api/snapshots/${await hashOf(k)}`);
    if (r.status !== 200) return null;
    const blob = await r.blob();
    // The pictures inside a saved drawing finish decoding a moment after the drawing itself, and a
    // bitmap made too early can come out empty: draw it again once they're in, and swap it in. The
    // redraw reuses the decoded drawing; decoding it again would cost as much as the first time.
    const keep = {};
    const bmp = await svgToBitmap(URL.createObjectURL(blob), w, h, LEVEL, keep);
    setTimeout(async () => {
      if (!CACHE.has(k) || !keep.img) return;
      const again = await bitmapOf(keep.img, w, h, LEVEL).catch(() => null);
      keep.img = null;
      if (again && CACHE.has(k)) {
        CACHE.get(k).bmp.close?.();
        CACHE.set(k, { ...CACHE.get(k), bmp: again });
        onReady(k);
      }
    }, 900);
    return bmp;
  } catch {
    return null;
  }
}
// Pictures of these pages can't be read back as pixels (the browser forbids it for drawn pages), so
// what's saved is the drawing itself: the SVG the bitmap was made from.
function save(k, svg) {
  if (!saved(k) || !svg) return;
  hashOf(k)
    .then((hx) => fetch(`/api/snapshots/${hx}`, { method: "PUT", headers: { "x-workshop": "1", "content-type": "image/svg+xml" }, body: svg }))
    .catch(() => {});
}
// Decoding a drawing lays out a whole page on the main thread (100–300 ms): one at a time, and only
// when the browser is idle, so scrolling, typing and the panels never wait behind several at once.
let decoding = Promise.resolve();
const idle = () => new Promise((r) => (window.requestIdleCallback ? requestIdleCallback(() => r(), { timeout: 600 }) : setTimeout(r, 16)));
// (src is set inside the turn: an SVG image starts parsing, the costly part, as soon as it has one)
function decodeInTurn(img, url) {
  const turn = decoding.then(idle).then(() => ((img.src = url), img.decode()));
  decoding = turn.catch(() => {});
  return turn;
}
// an SVG (by blob URL, revoked here) → a bitmap at the kept size; keep.img holds the decoded drawing
async function svgToBitmap(url, w, h, scale = LEVEL, keep = null) {
  try {
    const img = new Image();
    await decodeInTurn(img, url);
    // let the browser paint the drawing (its fonts and inner pictures) before taking the bitmap
    await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
    if (keep) keep.img = img;
    return await bitmapOf(img, w, h, scale);
  } finally {
    URL.revokeObjectURL(url);
  }
}
// The drawing is vector: painting it straight onto a canvas at the kept size is several times quicker
// than createImageBitmap, which paints it at full size and then scales the pixels down.
async function bitmapOf(img, w, h, scale) {
  const W = Math.max(1, Math.round(w * scale)),
    H = Math.max(1, Math.round(h * scale));
  const c = document.createElement("canvas");
  c.width = W;
  c.height = H;
  c.getContext("2d").drawImage(img, 0, 0, W, H);
  return c;
}
export function bitmapFor(it) {
  const k = keyOf(it);
  const hit = CACHE.get(k);
  if (hit) {
    hit.used = performance.now();
    LAST.set(it.id, k);
    return { bmp: hit.bmp, fresh: true };
  }
  const old = CACHE.get(LAST.get(it.id));
  return old ? { bmp: old.bmp, fresh: false } : null;
}
export const hasFresh = (it) => CACHE.has(keyOf(it));

// ---------- DOM → bitmap ----------
export async function rasterize(doc, w, h, scale = LEVEL, out = null) {
  const svg = await drawingOf(doc, w, h);
  if (out) out.svg = svg;
  return svgToBitmap(URL.createObjectURL(new Blob([svg], { type: "image/svg+xml;charset=utf-8" })), w, h, scale);
}
function store(k, bmp, w, h) {
  CACHE.set(k, { bmp, w, h, used: performance.now() });
  FAILED.delete(k);
  if (CACHE.size > MAX_BITMAPS) {
    const old = [...CACHE.entries()].sort((a, b) => a[1].used - b[1].used).slice(0, CACHE.size - MAX_BITMAPS);
    for (const [key, v] of old) {
      CACHE.delete(key);
      v.bmp.close?.();
    }
  }
  onReady(k);
}
// a board that is mounted live hands over its picture directly
export async function captureLive(it, doc) {
  const k = keyOf(it);
  try {
    // kept for this visit only: a live board shows whatever someone did in it (a menu left open,
    // a screen mid-transition), which mustn't become the saved picture everyone else gets
    const bmp = await rasterize(doc, it.w, it.h);
    if (keyOf(it) === k) store(k, bmp, it.w, it.h);
    LAST.set(it.id, k);
    return true;
  } catch {
    return false;
  }
}

// ---------- the background pool ----------
// jobs: [{key, it, src}] most important first; replaces what was wanted before
export function want(jobs) {
  QUEUE = jobs.filter((j) => !CACHE.has(j.key) && !RUNNING.has(j.key) && !(performance.now() - (FAILED.get(j.key) || -1e9) < 30000));
  pump();
}
function pump() {
  while (RUNNING.size < POOL && QUEUE.length) {
    const j = QUEUE.shift();
    if (CACHE.has(j.key) || RUNNING.has(j.key)) continue;
    const p = render(j)
      .catch(() => FAILED.set(j.key, performance.now()))
      .finally(() => {
        RUNNING.delete(j.key);
        pump();
      });
    RUNNING.set(j.key, p);
  }
}
async function render({ key, it, src, textEdits }) {
  await pagesFree(); // nothing heavy while the intro plays (lib.js)
  // saved from an earlier visit (or by a branch that looks the same): no page to load at all
  const kept = await loadSaved(key, it.w, it.h);
  if (kept) return store(key, kept, it.w, it.h);
  const apart = apartUrl(src);
  const fr = document.createElement("iframe");
  fr.setAttribute("aria-hidden", "true");
  fr.tabIndex = -1;
  // a background page must never take the keyboard, even if it focuses a field on load
  fr.inert = true;
  fr.style.cssText = `position:absolute;left:0;top:0;width:${it.w}px;height:${it.h}px;border:0;background:#fff`;
  host.append(fr);
  try {
    await new Promise((res, rej) => {
      const t = setTimeout(() => rej(new Error("timeout")), LOAD_TIMEOUT);
      fr.addEventListener("load", () => (clearTimeout(t), res()), { once: true });
      // From the other loopback name the page is another site: the browser runs it in its own process,
      // so its start-up and layout never block the editor. It draws itself and sends the drawing back.
      fr.src = apart === src ? src : `${apart}${apart.includes("?") ? "&" : "?"}ws-embed=1`;
    });
    if (document.activeElement === fr) fr.blur();
    let svg;
    if (apart === src) {
      await settle(fr.contentWindow, it, textEdits);
      if (keyOf(it) !== key) return; // it changed while loading; the next pass asks again
      try {
        await onFrame(fr.contentWindow, it);
      } catch {}
      svg = await drawingOf(fr.contentDocument, it.w, it.h);
    } else {
      const r = await askForDrawing(fr, it, textEdits);
      if (keyOf(it) !== key) return;
      // what the page can show (its screens and states), as the canvas reads it from a page
      try {
        if (r.catalog) await onFrame({ __workshop: { adapter: () => r.catalog, go() {}, setState() {} } }, it);
      } catch {}
      svg = r.svg;
    }
    if (!svg) throw new Error("no drawing");
    const bmp = await svgToBitmap(URL.createObjectURL(new Blob([svg], { type: "image/svg+xml;charset=utf-8" })), it.w, it.h, LEVEL);
    store(key, bmp, it.w, it.h);
    save(key, svg);
  } finally {
    fr.src = "about:blank";
    fr.remove();
  }
}
let asks = 0;
function askForDrawing(fr, it, textEdits) {
  const id = ++asks;
  const origin = new URL(fr.src).origin;
  return new Promise((res, rej) => {
    const t = setTimeout(() => (removeEventListener("message", on), rej(new Error("timeout"))), LOAD_TIMEOUT);
    // Guard: only the page we asked, from where we loaded it, answers this request
    const on = (e) => {
      if (e.source !== fr.contentWindow || e.origin !== origin || e.data?.ws !== "snapped" || e.data.id !== id) return;
      clearTimeout(t);
      removeEventListener("message", on);
      e.data.error ? rej(new Error(e.data.error)) : res(e.data);
    };
    addEventListener("message", on);
    fr.contentWindow.postMessage({ ws: "snap", id, w: it.w, h: it.h, screen: it.screen || null, state: it.state || null, textEdits: !!textEdits }, origin);
  });
}

// ---------- drawing ----------
export function resize() {
  if (!canvas) return;
  const dpr = window.devicePixelRatio || 1;
  const w = canvas.clientWidth,
    h = canvas.clientHeight;
  if (canvas.width !== Math.round(w * dpr) || canvas.height !== Math.round(h * dpr)) {
    canvas.width = Math.round(w * dpr);
    canvas.height = Math.round(h * dpr);
  }
}
// boards: [{it, live}] — a live board that is ready is drawn by its page, not here
// Returns how many boards on screen are still waiting for their picture, so the caller keeps
// drawing while their shimmer runs.
const STILL = typeof matchMedia === "function" && matchMedia("(prefers-reduced-motion: reduce)").matches;
export function draw(boards, cam, colors) {
  if (!ctx) return 0;
  let waiting = 0;
  resize();
  const dpr = window.devicePixelRatio || 1;
  const W = canvas.width / dpr,
    H = canvas.height / dpr;
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.clearRect(0, 0, W, H);
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = cam.z < 0.25 ? "medium" : "high";
  for (const { it, covered } of boards) {
    const x = it.x * cam.z + cam.x,
      y = it.y * cam.z + cam.y,
      w = it.w * cam.z,
      h = it.h * cam.z;
    if (x > W || y > H || x + w < 0 || y + h < 0) continue;
    // the frame: a soft edge, then the page
    ctx.fillStyle = colors.edge;
    ctx.fillRect(x - 0.5, y - 0.5, w + 1, h + 1);
    if (covered) continue;
    const b = bitmapFor(it);
    if (b) {
      // a page that sets no background shows on white, as it does in a browser tab
      ctx.fillStyle = "#fff";
      ctx.fillRect(x, y, w, h);
      ctx.drawImage(b.bmp, x, y, w, h);
    }
    else {
      ctx.fillStyle = colors.page;
      ctx.fillRect(x, y, w, h);
      if (w > 120) {
        // only the screen's name shimmers, like loading text elsewhere: the frame itself stays still
        const label = colors.label(it);
        const cx = x + w / 2,
          cy = y + h / 2;
        ctx.font = `400 ${Math.max(10, Math.min(24, w / 24))}px ${colors.font}`;
        ctx.textAlign = "center";
        ctx.textBaseline = "middle";
        ctx.fillStyle = colors.text;
        if (STILL) ctx.fillText(label, cx, cy);
        else {
          waiting++;
          const tw = ctx.measureText(label).width;
          ctx.globalAlpha = 0.42;
          ctx.fillText(label, cx, cy);
          ctx.globalAlpha = 1;
          // a band sweeping across the words every 1.6 s
          const t = (performance.now() % 1600) / 1600;
          const bx = cx - tw / 2 - tw * 0.4 + t * tw * 1.8;
          const g = ctx.createLinearGradient(bx - tw * 0.2, 0, bx + tw * 0.2, 0);
          g.addColorStop(0, "transparent");
          g.addColorStop(0.5, colors.text);
          g.addColorStop(1, "transparent");
          ctx.fillStyle = g;
          ctx.fillText(label, cx, cy);
        }
      }
    }
  }
  return waiting;
}
export const stats = () => ({ bitmaps: CACHE.size, running: RUNNING.size, queued: QUEUE.length });
