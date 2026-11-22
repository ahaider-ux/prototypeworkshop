// Home: every prototype in the space on a canvas you can throw around.
//
// The most recent prototype sits in the middle and the rest spiral out from it. Drag with momentum,
// or scroll with a trackpad or wheel; with enough prototypes the canvas wraps around forever (after
// design.cash.app), with only a few it has soft edges that pull back instead of repeating three tiles.
//
// It stays smooth by construction: the camera is one transform on one layer, changed once a frame and
// only while something moves; only the tiles in view exist, and they're reused as you pan; thumbnails
// are pictures from the canvas's own pipeline (gfx.js, drawn by prototype pages in their own process),
// never live pages; and picture decodes wait while you drag or fling (gfx.setBusy).

import { h, esc, IC, rmo } from "./lib.js";
import * as G from "./gfx.js";
import { thumbJob } from "./canvas.js";
import { spiral, bezier, rubber } from "./motion.js";

const TW = 320, // thumbnail
  TH = 200,
  CW = 392, // one cell: the thumbnail, its caption and the gutter
  CH = 312,
  WRAP_MIN = 7; // fewer prototypes than this and the canvas has edges instead of repeating them
const DECAY = 325; // ms: how quickly a fling slows down (the time constant iOS scrolling uses)
const EASE = [0.32, 0.72, 0, 1]; // glides: quick to start, long soft landing
const ease = bezier(EASE);
const mod = (a, n) => ((a % n) + n) % n;

// items: [{ id, name, meta, board, edited }] most recent first. open(item) opens one; newTile adds an
// "Import a prototype" tile when the canvas has edges.
export function mountHomeCanvas(host, items, { open, newTile = null }) {
  const root = h(`<div class="hcanvas" role="region" aria-label="Prototypes. Drag to look around."><div class="hworld"></div><div class="hhint hand" aria-hidden="true">drag to look around</div></div>`);
  const world = root.querySelector(".hworld");
  host.append(root);
  let list = items,
    wrap = false,
    k = 1, // the repeating pattern is k × k cells
    slotOf = new Map(), // "x,y" → index into list (or -1 for the new tile)
    bounds = null;
  const cam = { x: 0, y: -(-CH / 2 + 24 + TH / 2) }; // the middle tile's thumbnail in the middle of the view
  let vw = root.clientWidth || innerWidth,
    vh = root.clientHeight || innerHeight;

  function layout() {
    wrap = list.length >= WRAP_MIN;
    slotOf = new Map();
    if (wrap) {
      k = Math.ceil(Math.sqrt(list.length));
      if (k % 2 === 0) k++;
      spiral(k * k).forEach(([x, y], i) => slotOf.set(`${x},${y}`, i % list.length));
    } else {
      const cells = spiral(list.length + (newTile ? 1 : 0));
      cells.forEach(([x, y], i) => slotOf.set(`${x},${y}`, i < list.length ? i : -1));
      const xs = cells.map((c) => c[0]),
        ys = cells.map((c) => c[1]);
      bounds = { x0: Math.min(...xs) * CW - CW / 2, x1: Math.max(...xs) * CW + CW / 2, y0: Math.min(...ys) * CH - CH / 2, y1: Math.max(...ys) * CH + CH / 2 };
    }
  }
  // which item a cell shows
  function at(cx, cy) {
    if (wrap) {
      const hk = (k - 1) / 2;
      return slotOf.get(`${mod(cx + hk, k) - hk},${mod(cy + hk, k) - hk}`);
    }
    return slotOf.get(`${cx},${cy}`);
  }
  // how far the camera may go before an edge pulls back (edged canvas only): the content may move
  // until its far side reaches the middle of the view
  function limits() {
    if (wrap || !bounds) return null;
    return { x0: -bounds.x1 + 0, x1: -bounds.x0 + 0, y0: -bounds.y1 + 0, y1: -bounds.y0 + 0 };
  }

  // ---------- tiles: only those in view exist, reused as you pan ----------
  const tiles = new Map(); // "x,y" → element
  const spare = [];
  function tileFor(idx) {
    const el =
      spare.pop() ||
      h(`<button type="button" class="htile"><span class="htt"><canvas width="${TW}" height="${TH}" aria-hidden="true"></canvas></span><span class="hcap"><b></b><span class="m"></span></span></button>`);
    el.dataset.idx = String(idx);
    if (idx === -1) {
      el.className = "htile hnew";
      el.querySelector("b").textContent = "Import a prototype";
      el.querySelector(".m").textContent = "an HTML file, or a whole document";
      el.setAttribute("aria-label", "Import a prototype");
      el.querySelector(".htt").replaceChildren(h(`<span class="hplus">${IC.plus}</span>`));
    } else {
      const it = list[idx];
      el.className = "htile";
      el.querySelector("b").textContent = it.name;
      el.querySelector(".m").textContent = it.meta;
      el.setAttribute("aria-label", `Open ${it.name}`);
      const tt = el.querySelector(".htt");
      if (!tt.querySelector("canvas")) tt.replaceChildren(h(`<canvas width="${TW}" height="${TH}" aria-hidden="true"></canvas>`));
      paint(el, it);
    }
    return el;
  }
  function sync() {
    const x0 = -cam.x - vw / 2,
      x1 = -cam.x + vw / 2,
      y0 = -cam.y - vh / 2,
      y1 = -cam.y + vh / 2;
    const c0 = Math.floor((x0 + CW / 2) / CW) - 1,
      c1 = Math.ceil((x1 + CW / 2) / CW) + 1,
      r0 = Math.floor((y0 + CH / 2) / CH) - 1,
      r1 = Math.ceil((y1 + CH / 2) / CH) + 1;
    const want = new Set();
    for (let cy = r0; cy <= r1; cy++)
      for (let cx = c0; cx <= c1; cx++) {
        const idx = at(cx, cy);
        if (idx === undefined) continue;
        const key = `${cx},${cy}`;
        want.add(key);
        if (tiles.has(key)) continue;
        const el = tileFor(idx);
        el.style.transform = `translate3d(${cx * CW - TW / 2}px, ${cy * CH - CH / 2 + 24}px, 0)`;
        el.dataset.cell = key;
        if (!el.isConnected) world.append(el);
        tiles.set(key, el);
      }
    for (const [key, el] of tiles)
      if (!want.has(key)) {
        tiles.delete(key);
        if (el === document.activeElement) el.blur();
        el.remove();
        if (spare.length < 24) spare.push(el);
      }
  }

  // ---------- thumbnails ----------
  const dpr = Math.min(2, window.devicePixelRatio || 1);
  function paint(el, it) {
    const cv = el.querySelector("canvas");
    if (!cv) return;
    el.classList.toggle("noboard", !it.board);
    const got = it.board ? G.bitmapFor(it.board) : null;
    el.classList.toggle("waiting", !!it.board && !got);
    if (!got) return;
    const bmp = got.bmp;
    if (cv.width !== TW * dpr) (cv.width = TW * dpr), (cv.height = TH * dpr);
    const c = cv.getContext("2d");
    // a page is a white browser tab underneath, in either theme (as the canvas draws boards): a page
    // shorter than its screen mustn't show the tile's dark paper through it
    c.fillStyle = "#fff";
    c.fillRect(0, 0, cv.width, cv.height);
    const bw = bmp.width,
      bh = bmp.height;
    if (bw / bh < 1) {
      // a phone screen: whole, centred on the thumbnail's paper
      const s = Math.min(cv.width / bw, cv.height / bh) * 0.92;
      c.drawImage(bmp, (cv.width - bw * s) / 2, (cv.height - bh * s) / 2, bw * s, bh * s);
    } else {
      // a wide screen fills the thumbnail from the top
      const s = Math.max(cv.width / bw, cv.height / bh);
      c.drawImage(bmp, (cv.width - bw * s) / 2, 0, bw * s, bh * s);
    }
  }
  function request() {
    const jobs = list.filter((it) => it.board && !G.hasFresh(it.board)).map((it) => thumbJob(it.board));
    if (jobs.length) G.want(jobs);
  }
  const off = G.onBitmap((key) => {
    for (const el of tiles.values()) {
      const it = list[+el.dataset.idx];
      if (it?.board && G.keyOf(it.board) === key) paint(el, it);
    }
  });

  // ---------- the camera ----------
  let raf = 0,
    vx = 0,
    vy = 0, // px per ms
    glide = null,
    spring = false;
  const apply = () => {
    world.style.transform = `translate3d(${Math.round((cam.x + vw / 2) * 2) / 2}px, ${Math.round((cam.y + vh / 2) * 2) / 2}px, 0)`;
    sync();
  };
  const settle = () => setTimeout(() => !raf && !drag && G.setBusy(false), 150);
  function frame(t) {
    raf = 0;
    const dt = frame.last ? Math.min(48, t - frame.last) : 16; // the first frame of a move counts as one frame
    frame.last = t;
    if (glide) {
      const p = Math.min(1, (t - glide.t0) / glide.ms);
      const e = ease(p);
      cam.x = glide.x0 + (glide.x1 - glide.x0) * e;
      cam.y = glide.y0 + (glide.y1 - glide.y0) * e;
      if (p >= 1) glide = null;
    } else if (Math.hypot(vx, vy) > 0.01 && dt > 0) {
      // a fling: coast, slowing exponentially; edges pull back harder
      cam.x += vx * dt;
      cam.y += vy * dt;
      const f = Math.exp(-dt / DECAY);
      vx *= f;
      vy *= f;
      const L = limits();
      if (L && (cam.x < L.x0 || cam.x > L.x1 || cam.y < L.y0 || cam.y > L.y1)) {
        vx *= 0.6;
        vy *= 0.6;
        spring = true;
      }
    } else if (spring) {
      // back inside the edges, critically damped
      const L = limits();
      const tx = Math.max(L.x0, Math.min(L.x1, cam.x)),
        ty = Math.max(L.y0, Math.min(L.y1, cam.y));
      const a = 1 - Math.exp(-dt / 90);
      cam.x += (tx - cam.x) * a;
      cam.y += (ty - cam.y) * a;
      if (Math.abs(tx - cam.x) < 0.3 && Math.abs(ty - cam.y) < 0.3) (cam.x = tx), (cam.y = ty), (spring = false);
    } else {
      frame.last = 0;
      apply();
      return settle();
    }
    apply();
    raf = requestAnimationFrame(frame);
  }
  const kick = () => raf || (raf = requestAnimationFrame(frame));
  function glideTo(x, y, ms = 520) {
    vx = vy = 0;
    spring = false;
    if (rmo()) return (cam.x = x), (cam.y = y), apply();
    G.setBusy(true);
    glide = { x0: cam.x, y0: cam.y, x1: x, y1: y, t0: performance.now(), ms };
    kick();
  }
  // nearest copy of an item's cell to where the camera is (the canvas may repeat it)
  function cellOf(idx) {
    let best = null;
    for (const [key, i] of slotOf) {
      if (i !== idx) continue;
      let [x, y] = key.split(",").map(Number);
      if (wrap) {
        const ccx = Math.round(-cam.x / CW),
          ccy = Math.round(-cam.y / CH);
        x += Math.round((ccx - x) / k) * k;
        y += Math.round((ccy - y) / k) * k;
      }
      const d = Math.hypot(x * CW + cam.x, y * CH + cam.y);
      if (!best || d < best.d) best = { x, y, d };
    }
    return best;
  }
  // the thumbnail (not the cell) lands in the middle: it sits a little above the cell's centre
const focusCell = (cx, cy) => glideTo(-cx * CW, -(cy * CH - CH / 2 + 24 + TH / 2));

  // ---------- input ----------
  let drag = null,
    moved = false;
  root.addEventListener("pointerdown", (e) => {
    if (e.button !== 0) return;
    glide = null;
    spring = false;
    vx = vy = 0;
    drag = { id: e.pointerId, x: e.clientX, y: e.clientY, cx: cam.x, cy: cam.y, hist: [[performance.now(), e.clientX, e.clientY]] };
    moved = false;
    G.setBusy(true);
  });
  root.addEventListener("pointermove", (e) => {
    if (!drag || e.pointerId !== drag.id) return;
    const dx = e.clientX - drag.x,
      dy = e.clientY - drag.y;
    if (!moved && Math.hypot(dx, dy) < 4) return;
    if (!moved) {
      moved = true;
      root.setPointerCapture(e.pointerId);
      root.classList.add("grabbing");
      root.classList.add("used");
    }
    let nx = drag.cx + dx,
      ny = drag.cy + dy;
    const L = limits();
    if (L) {
      if (nx < L.x0) nx = L.x0 + rubber(nx - L.x0, vw);
      if (nx > L.x1) nx = L.x1 + rubber(nx - L.x1, vw);
      if (ny < L.y0) ny = L.y0 + rubber(ny - L.y0, vh);
      if (ny > L.y1) ny = L.y1 + rubber(ny - L.y1, vh);
    }
    cam.x = nx;
    cam.y = ny;
    const now = performance.now();
    drag.hist.push([now, e.clientX, e.clientY]);
    while (drag.hist.length > 2 && now - drag.hist[0][0] > 90) drag.hist.shift();
    apply();
  });
  const release = (e) => {
    if (!drag || e.pointerId !== drag.id) return;
    root.classList.remove("grabbing");
    if (moved && !rmo()) {
      // the speed over the last ~90 ms becomes the fling
      const a = drag.hist[0],
        b = drag.hist[drag.hist.length - 1];
      const t = Math.max(16, b[0] - a[0]);
      vx = Math.max(-4, Math.min(4, (b[1] - a[1]) / t));
      vy = Math.max(-4, Math.min(4, (b[2] - a[2]) / t));
      if (performance.now() - b[0] > 80) vx = vy = 0; // held still before letting go: no fling
      const L = limits();
      if (L && (cam.x < L.x0 || cam.x > L.x1 || cam.y < L.y0 || cam.y > L.y1)) spring = true;
    }
    drag = null;
    kick();
  };
  root.addEventListener("pointerup", release);
  root.addEventListener("pointercancel", release);
  // a drag that ends on a tile isn't a click
  root.addEventListener("click", (e) => {
    if (moved) return e.preventDefault(), e.stopPropagation(), (moved = false);
    const el = e.target.closest(".htile");
    if (!el) return;
    const idx = +el.dataset.idx;
    if (idx === -1) return newTile?.();
    open(list[idx]);
  }, true);
  root.addEventListener("wheel", (e) => {
    e.preventDefault();
    if (e.ctrlKey) return; // pinch: this canvas doesn't zoom
    glide = null;
    const m = e.deltaMode === 1 ? 16 : e.deltaMode === 2 ? vh : 1;
    let nx = cam.x - e.deltaX * m,
      ny = cam.y - e.deltaY * m;
    const L = limits();
    if (L) {
      // a trackpad brings its own momentum: past the edge it only gives a little, then springs back
      nx = Math.max(L.x0 - 60, Math.min(L.x1 + 60, nx));
      ny = Math.max(L.y0 - 60, Math.min(L.y1 + 60, ny));
      spring = true;
    }
    cam.x = nx;
    cam.y = ny;
    root.classList.add("used");
    G.setBusy(true);
    apply();
    clearTimeout(root._w);
    root._w = setTimeout(kick, 120); // the spring (and the busy flag) once the wheel stops
  }, { passive: false });
  // keys: arrows move by a cell; a focused tile is glided into view
  root.addEventListener("keydown", (e) => {
    const d = { ArrowLeft: [1, 0], ArrowRight: [-1, 0], ArrowUp: [0, 1], ArrowDown: [0, -1] }[e.key];
    if (!d) return;
    e.preventDefault();
    const cx = Math.round(-cam.x / CW) - d[0],
      cy = Math.round(-cam.y / CH) - d[1];
    focusCell(cx, cy);
    setTimeout(() => tiles.get(`${cx},${cy}`)?.focus({ preventScroll: true }), 40);
  });
  root.addEventListener("focusin", (e) => {
    const el = e.target.closest?.(".htile");
    if (!el || drag) return;
    const [cx, cy] = el.dataset.cell.split(",").map(Number);
    const sx = cx * CW + cam.x,
      sy = cy * CH + cam.y;
    if (Math.abs(sx) > vw / 2 - TW / 2 - 24 || Math.abs(sy) > vh / 2 - CH / 2) focusCell(cx, cy);
  });
  const ro = new ResizeObserver(() => {
    vw = root.clientWidth;
    vh = root.clientHeight;
    apply();
  });
  ro.observe(root);

  layout();
  apply();
  request();
  // the first look: tiles arrive from the middle out
  if (!rmo()) {
    root.classList.add("arrive");
    for (const el of tiles.values()) {
      const [cx, cy] = el.dataset.cell.split(",").map(Number);
      el.style.setProperty("--d", `${Math.min(8, Math.hypot(cx, cy)) * 40}ms`);
    }
    setTimeout(() => root.classList.remove("arrive"), 900);
  }

  return {
    // new data (names, counts, pictures) without moving the camera
    update(next) {
      const ids = list.map((x) => x.id).join();
      list = next;
      if (next.map((x) => x.id).join() !== ids) {
        layout();
        for (const el of tiles.values()) el.remove();
        tiles.clear();
      } else
        for (const el of tiles.values()) {
          const it = list[+el.dataset.idx];
          if (!it) continue;
          el.querySelector("b").textContent = it.name;
          el.querySelector(".m").textContent = it.meta;
          paint(el, it);
        }
      apply();
      request();
    },
    // glide to a prototype and point it out
    show(id) {
      const idx = list.findIndex((x) => x.id === id);
      const c = idx >= 0 ? cellOf(idx) : null;
      if (!c) return;
      focusCell(c.x, c.y);
      setTimeout(() => {
        const el = tiles.get(`${c.x},${c.y}`);
        if (!el) return;
        el.classList.remove("ping");
        void el.offsetWidth;
        el.classList.add("ping");
      }, rmo() ? 0 : 380);
    },
    destroy() {
      cancelAnimationFrame(raf);
      off();
      ro.disconnect();
      G.setBusy(false);
      root.remove();
    },
  };
}
