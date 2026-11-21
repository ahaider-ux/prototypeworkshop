// The canvas's graphics layer. Boards are drawn as bitmaps on one <canvas>, so panning and zooming
// a page of many screens stays smooth: no live page is laid out or repainted while you move. The
// real pages (the DOM) run in the background — a small pool of hidden frames loads each board, lets
// the prototype settle, and turns it into a bitmap. Only the boards you're working in are mounted
// live on top (see canvas.js), and they hand back a fresh bitmap when they're put away.
//
// Pictures are also saved on this computer (the server's .workshop/snapshots), named by what the
// board shows: its prototype's look (a hash of its files, overrides and settings, from the server),
// screen, state and size. Opening a page again, or a branch nobody has changed, draws at once.

const LEVEL = 0.5; // bitmaps are kept at half size: sharp up to 50% zoom on a 1× screen
const POOL = 3; // background pages loading at once
const MAX_BITMAPS = 160; // Guard: bitmaps are ~2 MB each at half size; past this the oldest go
const SETTLE = 1600; // ms after load, at most, for the prototype to go to its screen, state and variants
const SETTLE_MIN = 450; // ...and at least: its own start-up scripts run first
const SETTLE_TEXT = 2700; // text edits are re-applied up to ~2.5 s after load
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
export const keyOf = (it) => `${lookOf(it.env) || `${it.env}@${rev(it.env)}`}|${it.screen || ""}|${it.state || ""}|${it.w}x${it.h}|${LEVEL}`;

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
    return await svgToBitmap(URL.createObjectURL(await r.blob()), w, h);
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
// an SVG (by blob URL, revoked here) → a bitmap at the kept size
async function svgToBitmap(url, w, h, scale = LEVEL) {
  try {
    const img = new Image();
    img.src = url;
    await img.decode();
    const W = Math.max(1, Math.round(w * scale)),
      H = Math.max(1, Math.round(h * scale));
    try {
      return await createImageBitmap(img, { resizeWidth: W, resizeHeight: H, resizeQuality: "high" });
    } catch {
      // some browsers won't make a bitmap from an SVG image: draw it to a canvas instead
      const c = document.createElement("canvas");
      c.width = W;
      c.height = H;
      c.getContext("2d").drawImage(img, 0, 0, W, H);
      return c;
    }
  } finally {
    URL.revokeObjectURL(url);
  }
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
const IMG_CACHE = new Map(); // url → data: url
async function inlineImage(url) {
  if (IMG_CACHE.has(url)) return IMG_CACHE.get(url);
  const p = (async () => {
    try {
      const r = await fetch(url);
      const b = await r.blob();
      // Guard: an SVG snapshot carries its images inline; skip anything huge rather than stall.
      if (!r.ok || b.size > 4 * 1024 * 1024) return null;
      return await new Promise((res) => {
        const fr = new FileReader();
        fr.onload = () => res(String(fr.result));
        fr.onerror = () => res(null);
        fr.readAsDataURL(b);
      });
    } catch {
      return null;
    }
  })();
  IMG_CACHE.set(url, p);
  return p;
}
// An SVG image can't fetch anything, so the clone carries its styles, images and form state inline.
// out: when given, out.svg receives the drawing, so it can be saved
export async function rasterize(doc, w, h, scale = LEVEL, out = null) {
  if (!doc?.documentElement) throw new Error("no page");
  const clone = doc.documentElement.cloneNode(true);
  // scrolled boxes show the part you scrolled to (matched before anything is taken out of the clone)
  const all = [...doc.querySelectorAll("*")];
  const call = [...clone.querySelectorAll("*")];
  // Hidden parts of the page (other screens of a one-page app, closed menus, dialogs) can be most of
  // it: they're left out of the picture, which makes it several times quicker to draw. Never style
  // or SVG parts (icons point at hidden <symbol>s), and never display:contents boxes.
  const prune = [];
  if (all.length === call.length && typeof Element.prototype.checkVisibility === "function") {
    const body = doc.body;
    const SVGE = doc.defaultView?.SVGElement;
    for (let i = 0; i < all.length; i++) {
      const e = all[i];
      if (e === body || !body?.contains(e) || (SVGE && e instanceof SVGE) || /^(STYLE|LINK|META|SCRIPT|TEMPLATE|SLOT|BR|WBR|SOURCE|TRACK)$/.test(e.tagName)) continue;
      if (e.checkVisibility() || doc.defaultView.getComputedStyle(e).display === "contents") continue;
      prune.push(call[i]);
    }
  }
  if (all.length === call.length) {
    let n = 0;
    for (let i = 0; i < all.length && n < 40; i++) {
      const e = all[i];
      if (!e.scrollTop && !e.scrollLeft) continue;
      n++;
      for (const k of call[i].children) k.setAttribute("style", `${k.getAttribute("style") || ""};translate:${-e.scrollLeft}px ${-e.scrollTop}px`);
    }
  }
  for (const n of clone.querySelectorAll("script,noscript,iframe,object,embed,video,audio,.ws-ghost")) n.remove();
  const live = [...doc.querySelectorAll('link[rel~="stylesheet"]')];
  const dead = [...clone.querySelectorAll('link[rel~="stylesheet"]')];
  live.forEach((l, i) => {
    let css = "";
    try {
      if (!l.disabled && l.sheet) css = [...l.sheet.cssRules].map((r) => r.cssText).join("\n");
    } catch {}
    const st = doc.createElement("style");
    st.textContent = css;
    dead[i]?.replaceWith(st);
  });
  for (const l of clone.querySelectorAll("link")) l.remove();
  // An SVG image is painted once, at the first frame of every animation: a fade-in would be caught
  // invisible. Show everything as it rests instead.
  const still = doc.createElement("style");
  still.textContent = "*,*::before,*::after{animation:none!important;transition:none!important}";
  (clone.querySelector("head") || clone).append(still);
  // what's typed in fields and which boxes are ticked
  const lf = [...doc.querySelectorAll("input,textarea,select")],
    cf = [...clone.querySelectorAll("input,textarea,select")];
  lf.forEach((f, i) => {
    const c = cf[i];
    if (!c) return;
    if (f.localName === "textarea") c.textContent = f.value;
    else if (f.localName === "select") [...c.options].forEach((o, j) => (o.selected = j === f.selectedIndex) && o.setAttribute("selected", ""));
    else if (/checkbox|radio/.test(f.type)) f.checked ? c.setAttribute("checked", "") : c.removeAttribute("checked");
    else c.setAttribute("value", f.value);
  });
  // canvases inside the page keep their current picture
  const lc = [...doc.querySelectorAll("canvas")],
    cc = [...clone.querySelectorAll("canvas")];
  lc.forEach((c, i) => {
    try {
      const img = doc.createElement("img");
      img.src = c.toDataURL();
      img.setAttribute("style", c.getAttribute("style") || "");
      img.className = c.className;
      img.width = c.width;
      img.height = c.height;
      cc[i]?.replaceWith(img);
    } catch {}
  });
  const imgs = [...clone.querySelectorAll("img[src]")].filter((i) => !prune.some((p) => p.contains(i))).filter((i) => !/^data:/.test(i.getAttribute("src"))).slice(0, 60);
  await Promise.all(
    imgs.map(async (i) => {
      const abs = new URL(i.getAttribute("src"), doc.baseURI).href;
      const d = await inlineImage(abs);
      if (d) i.setAttribute("src", d);
      else i.removeAttribute("src");
    }),
  );
  for (const i of clone.querySelectorAll("img[srcset]")) i.removeAttribute("srcset");
  for (const n of prune) n.remove();
  const xml = new XMLSerializer().serializeToString(clone);
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}"><foreignObject x="0" y="0" width="${w}" height="${h}">${xml}</foreignObject></svg>`;
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
    const out = {};
    const bmp = await rasterize(doc, it.w, it.h, LEVEL, out);
    if (keyOf(it) === k) {
      store(k, bmp, it.w, it.h);
      save(k, out.svg);
    }
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
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const frames = (win) => new Promise((r) => win.requestAnimationFrame(() => win.requestAnimationFrame(r)));
// Wait until the page has started up, reached its screen and loaded its fonts, instead of always
// waiting the longest it might need. Text edits are re-applied on a timer, so they still wait.
async function settle(win, it, textEdits) {
  if (textEdits) return sleep(SETTLE_TEXT);
  const t0 = performance.now();
  await sleep(SETTLE_MIN);
  try {
    await Promise.race([win.document.fonts?.ready, sleep(SETTLE - SETTLE_MIN)]);
  } catch {}
  while (performance.now() - t0 < SETTLE) {
    try {
      const rt = win.__workshop;
      const ad = rt?.adapter();
      const there = !it.screen || !ad?.screens?.length || ad.screen === it.screen || !ad.screens.some((x) => x.name === it.screen);
      if (rt && there) break;
    } catch {
      break;
    }
    await sleep(100);
  }
  try {
    await frames(win);
  } catch {}
  await sleep(120);
}
async function render({ key, it, src, textEdits }) {
  // saved from an earlier visit (or by a branch that looks the same): no page to load at all
  const kept = await loadSaved(key, it.w, it.h);
  if (kept) return store(key, kept, it.w, it.h);
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
      fr.src = src;
    });
    if (document.activeElement === fr) fr.blur();
    await settle(fr.contentWindow, it, textEdits);
    if (keyOf(it) !== key) return; // it changed while loading; the next pass asks again
    try {
      await onFrame(fr.contentWindow, it);
    } catch {}
    const out = {};
    const bmp = await rasterize(fr.contentDocument, it.w, it.h, LEVEL, out);
    store(key, bmp, it.w, it.h);
    save(key, out.svg);
  } finally {
    fr.src = "about:blank";
    fr.remove();
  }
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
      waiting++;
      if (!STILL && w > 24) {
        // a soft band sweeping across, every 1.6 s, like the shimmer on loading text
        const t = (performance.now() % 1600) / 1600;
        const bx = x - w * 0.5 + t * w * 2;
        const g = ctx.createLinearGradient(bx - w * 0.25, 0, bx + w * 0.25, 0);
        g.addColorStop(0, "rgba(255,255,255,0)");
        g.addColorStop(0.5, colors.shine);
        g.addColorStop(1, "rgba(255,255,255,0)");
        ctx.fillStyle = g;
        ctx.fillRect(x, y, w, h);
      }
      if (w > 120) {
        ctx.fillStyle = colors.text;
        ctx.font = `400 ${Math.max(10, Math.min(24, w / 24))}px ${colors.font}`;
        ctx.textAlign = "center";
        ctx.textBaseline = "middle";
        ctx.fillText(colors.label(it), x + w / 2, y + h / 2);
      }
    }
  }
  return waiting;
}
export const stats = () => ({ bitmaps: CACHE.size, running: RUNNING.size, queued: QUEUE.length });
