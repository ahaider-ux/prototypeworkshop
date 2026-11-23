// Home: every prototype in the space on a canvas you can throw around.
//
// Every prototype is a project card: its picture, its name and when it was last edited, readable
// before the picture has even arrived. The interaction follows design.cash.app (observed in the
// browser; nothing copied): cards far apart on an endless field, a dot in place of the pointer, the
// card under it swells a little; and opening one clears the field
// around it and glides it to the middle before the editor takes over. Coming back lands on the
// prototype you opened. With only a few prototypes the field has soft edges instead of repeating
// three tiles forever.
//
// It stays smooth by construction: the camera is one transform on one layer, changed once a frame and
// only while something moves; only the tiles in view exist, and they're reused as you pan; thumbnails
// are pictures from the canvas's own pipeline (gfx.js, drawn by prototype pages in their own process),
// never live pages; what the pointer is over is worked out from geometry, not hit-testing; and picture
// decodes wait while you drag or fling (gfx.setBusy).

import { h, IC, rmo } from "./lib.js";
import * as G from "./gfx.js";
import { thumbJob } from "./canvas.js";
import { spiral, block, bezier, rubber, fitIn } from "./motion.js";

const CW = 400, // one cell: a card (320 × 264) and an 80 gutter
  CH = 344,
  WRAP_MIN = 7, // fewer prototypes than this and the canvas has edges instead of repeating them
  SWELL = 1.05, // the card under the pointer
  LEAVE_MS = 340; // opening one: the field clears and it glides to the middle
const DECAY = 325; // ms: how quickly a fling slows down (the time constant iOS scrolling uses)
const EASE = [0.32, 0.72, 0, 1]; // glides: quick to start, long soft landing
const ease = bezier(EASE);
const mod = (a, n) => ((a % n) + n) % n;
const CARD = { w: 320, h: 264 }, // every prototype is a card: its picture, its name, when it was edited
  PIC = { w: 304, h: 190 }; // the picture inside it

// where each space's canvas was left, and which prototype was opened from it (for this page's life)
const memory = new Map();

// items: [{ id, name, meta, board, edited }] most recent first. open(item) opens one. actions:
// [{ title, desc, icon, run }], what a space can do next (import, connect a folder, connect an
// agent): with only a few prototypes the spare places hold these as empty-state cards, so the canvas
// never needs made-up content to look full. key names the space, for coming back.
export function mountHomeCanvas(host, items, { open, actions = [], key = "" }) {
  const root = h(`<div class="hcanvas" role="region" aria-label="Prototypes. Drag to look around."><div class="hworld"></div><div class="hcur" aria-hidden="true"><i></i></div><div class="hhint" aria-hidden="true">Drag to look around</div></div>`);
  const world = root.querySelector(".hworld");
  const cur = root.querySelector(".hcur");
  host.classList.remove("hleaving");
  host.append(root);
  let list = items,
    wrap = false,
    k = 1, // the repeating pattern is k × k cells
    slotOf = new Map(), // "x,y" → index into list, or -1, -2 … for actions[0], actions[1] …
    bounds = null;
  const cam = { x: 0, y: 0 }; // a cell's centre is its thumbnail's centre: (0,0) is the middle tile
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
      // a few: a small block in reading order, most recent first, centred in the view
      const cells = block(list.length + actions.length);
      cells.forEach(([x, y], i) => slotOf.set(`${x},${y}`, i < list.length ? i : -(i - list.length + 1)));
      const xs = cells.map((c) => c[0]),
        ys = cells.map((c) => c[1]);
      bounds = { x0: Math.min(...xs) * CW - CW / 2, x1: Math.max(...xs) * CW + CW / 2, y0: Math.min(...ys) * CH - CH / 2, y1: Math.max(...ys) * CH + CH / 2 };
    }
  }
  const middle = () => (bounds && !wrap ? { x: -(bounds.x0 + bounds.x1) / 2, y: -(bounds.y0 + bounds.y1) / 2 } : { x: 0, y: 0 });
  // everything is on screen at once: there's nowhere to go, so the group stays centred
  const fitsView = () => !wrap && !!bounds && bounds.x1 - bounds.x0 <= vw && bounds.y1 - bounds.y0 <= vh;
  const sizeOf = () => CARD;
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
    return { x0: -bounds.x1, x1: -bounds.x0, y0: -bounds.y1, y1: -bounds.y0 };
  }

  // ---------- tiles: only those in view exist, reused as you pan ----------
  const tiles = new Map(); // "x,y" → element
  const spare = [];
  function tileFor(idx) {
    const el = spare.pop() || h(`<button type="button" class="htile"><span class="htt"></span><span class="hcap"><b></b><span class="m"></span></span></button>`);
    el.dataset.idx = String(idx);
    const s = sizeOf(idx);
    el.style.width = `${s.w}px`;
    el.style.height = `${s.h}px`;
    const tt = el.querySelector(".htt");
    if (idx < 0) {
      // an empty-state card: what this space can do next, and it does it
      const a = actions[-idx - 1] || {};
      el.className = "htile hnew";
      el.querySelector("b").textContent = a.title || "";
      el.querySelector(".m").textContent = a.desc || "";
      el.setAttribute("aria-label", a.title || "");
      tt.replaceChildren(h(`<span class="hplus">${a.icon || IC.plus}</span>`));
    } else {
      const it = list[idx];
      el.className = "htile";
      el.querySelector("b").textContent = it.name;
      el.querySelector(".m").textContent = it.meta;
      el.setAttribute("aria-label", `Open ${it.name}`);
      if (!tt.querySelector("canvas")) tt.replaceChildren(h(`<canvas aria-hidden="true"></canvas>`));
      paint(el, it);
    }
    return el;
  }
  function sync() {
    const x0 = -cam.x - vw / 2,
      x1 = -cam.x + vw / 2,
      y0 = -cam.y - vh / 2,
      y1 = -cam.y + vh / 2;
    const c0 = Math.floor(x0 / CW) - 1,
      c1 = Math.ceil(x1 / CW) + 1,
      r0 = Math.floor(y0 / CH) - 1,
      r1 = Math.ceil(y1 / CH) + 1;
    const want = new Set();
    for (let cy = r0; cy <= r1; cy++)
      for (let cx = c0; cx <= c1; cx++) {
        const idx = at(cx, cy);
        if (idx === undefined) continue;
        const cell = `${cx},${cy}`;
        want.add(cell);
        if (tiles.has(cell)) continue;
        const el = tileFor(idx);
        const s = sizeOf(idx);
        el.style.transform = `translate3d(${cx * CW - s.w / 2}px, ${cy * CH - s.h / 2}px, 0)`;
        el.dataset.cell = cell;
        el.classList.toggle("hot", cell === hot);
        if (!el.isConnected) world.append(el);
        tiles.set(cell, el);
      }
    for (const [cell, el] of tiles)
      if (!want.has(cell)) {
        tiles.delete(cell);
        if (el === document.activeElement) el.blur();
        el.remove();
        if (spare.length < 24) spare.push(el);
      }
  }

  // ---------- thumbnails ----------
  // drawn a little larger than shown so a swelled picture stays sharp
  const res = Math.min(2.4, (window.devicePixelRatio || 1) * SWELL);
  function paint(el, it) {
    const cv = el.querySelector("canvas");
    if (!cv) return;
    el.classList.toggle("noboard", !it.board);
    const got = it.board ? G.bitmapFor(it.board) : null;
    const was = el.classList.contains("waiting");
    el.classList.toggle("waiting", !!it.board && !got);
    if (!got) return;
    // a picture that arrives while you watch fades in over its placeholder rather than popping
    if (was && !rmo()) (el.classList.add("fresh"), setTimeout(() => el.classList.remove("fresh"), 320));
    const bmp = got.bmp;
    const W = Math.round(PIC.w * res),
      H = Math.round(PIC.h * res);
    if (cv.width !== W || cv.height !== H) (cv.width = W), (cv.height = H);
    const c = cv.getContext("2d");
    const r = fitIn(bmp.width, bmp.height, W, H);
    // a page is a white browser tab underneath, in either theme (as the canvas draws boards): a wide
    // page fills the picture from the top; a phone sits whole in the middle on the card's tint
    c.clearRect(0, 0, W, H);
    c.fillStyle = "#fff";
    if (r.cover) c.fillRect(0, 0, W, H);
    else c.fillRect(r.x, r.y, r.w, r.h);
    c.drawImage(bmp, r.x, r.y, r.w, r.h);
  }
  function request() {
    const jobs = list.filter((it) => it.board && !G.hasFresh(it.board)).map((it) => thumbJob(it.board));
    if (jobs.length) G.want(jobs);
  }
  const off = G.onBitmap((k) => {
    for (const el of tiles.values()) {
      const it = list[+el.dataset.idx];
      if (it?.board && G.keyOf(it.board) === k) paint(el, it);
    }
  });

  // ---------- the pointer: a dot that names what it's over ----------
  // Only for a mouse or pen (a finger has no hover). The tile under it is found from the camera and
  // the cell maths, so it stays right while the field coasts under a still pointer.
  let px = -1,
    py = -1,
    inside = false,
    hot = null, // "x,y" of the tile under the pointer
    leaving = false;
  function hitAt(x, y) {
    const wx = x - vw / 2 - cam.x,
      wy = y - vh / 2 - cam.y;
    const cx = Math.round(wx / CW),
      cy = Math.round(wy / CH);
    const idx = at(cx, cy);
    if (idx === undefined) return null;
    const cell = `${cx},${cy}`;
    const s = sizeOf(idx);
    const g = cell === hot ? SWELL : 1; // once swelled, its swelled edge counts: no flicker at the rim
    return Math.abs(wx - cx * CW) <= (s.w * g) / 2 && Math.abs(wy - cy * CH) <= (s.h * g) / 2 ? cell : null;
  }
  function setHot(next) {
    if (next === hot) return;
    tiles.get(hot)?.classList.remove("hot");
    hot = next;
    const el = tiles.get(hot);
    el?.classList.add("hot");
    cur.classList.toggle("on", !!el);
  }
  const point = () => setHot(inside && !leaving ? hitAt(px, py) : null);
  root.addEventListener("pointermove", (e) => {
    if (e.pointerType === "touch") return;
    const r = root.getBoundingClientRect();
    px = e.clientX - r.left;
    py = e.clientY - r.top;
    if (!inside) (inside = true), root.classList.add("pointing");
    cur.style.transform = `translate3d(${px}px, ${py}px, 0)`;
    if (!drag) point();
  });
  root.addEventListener("pointerleave", () => {
    inside = false;
    root.classList.remove("pointing");
    setHot(null);
  });

  // ---------- the camera ----------
  let raf = 0,
    vx = 0,
    vy = 0, // px per ms
    glide = null,
    spring = false;
  const apply = () => {
    root.classList.toggle("fits", fitsView());
    world.style.transform = `translate3d(${Math.round((cam.x + vw / 2) * 2) / 2}px, ${Math.round((cam.y + vh / 2) * 2) / 2}px, 0)`;
    sync();
    if (inside) point();
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
    for (const [cell, i] of slotOf) {
      if (i !== idx) continue;
      let [x, y] = cell.split(",").map(Number);
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
  const focusCell = (cx, cy, ms) => glideTo(-cx * CW, -cy * CH, ms);

  // opening one: everything else fades, it glides to the middle and swells, then the editor opens.
  // A keyboard open is immediate (nothing animates on keyboard actions), as is reduced motion.
  function choose(el, animate) {
    const idx = +el.dataset.idx;
    if (idx < 0) return actions[-idx - 1]?.run?.();
    const it = list[idx];
    if (!it || leaving) return;
    const [cx, cy] = el.dataset.cell.split(",").map(Number);
    memory.set(key, { x: -cx * CW, y: -cy * CH, id: it.id });
    if (!animate || rmo()) return open(it);
    leaving = true;
    setHot(null);
    el.classList.add("chosen");
    root.classList.add("leaving");
    host.classList.add("hleaving");
    focusCell(cx, cy, LEAVE_MS);
    setTimeout(() => open(it), LEAVE_MS);
  }

  // ---------- input ----------
  let drag = null,
    moved = false;
  root.addEventListener("pointerdown", (e) => {
    if (e.button !== 0 || leaving) return;
    glide = null;
    spring = false;
    vx = vy = 0;
    drag = { id: e.pointerId, x: e.clientX, y: e.clientY, cx: cam.x, cy: cam.y, hist: [[performance.now(), e.clientX, e.clientY]] };
    moved = false;
    root.classList.add("down");
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
      root.classList.add("grabbing", "used");
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
    root.classList.remove("grabbing", "down");
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
    if (el) choose(el, e.detail > 0); // detail 0: Enter or Space on a focused tile
  }, true);
  root.addEventListener("wheel", (e) => {
    e.preventDefault();
    if (e.ctrlKey || leaving) return; // pinch: this canvas doesn't zoom
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
    if (!d || leaving) return;
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
    if (Math.abs(sx) > vw / 2 - CW / 2 || Math.abs(sy) > vh / 2 - CH / 2) focusCell(cx, cy);
  });
  const ro = new ResizeObserver(() => {
    vw = root.clientWidth;
    vh = root.clientHeight;
    // the real size arrives after mount (it starts as the window's): a canvas that fits stays centred
    if (fitsView() && !drag && !glide && !leaving) Object.assign(cam, middle());
    apply();
  });
  ro.observe(root);

  layout();
  Object.assign(cam, middle());
  // coming back: the prototype you opened is in the middle again, wherever it now sits
  const back = memory.get(key);
  let backCell = null;
  if (back) {
    (cam.x = back.x), (cam.y = back.y);
    const idx = list.findIndex((x) => x.id === back.id);
    backCell = idx >= 0 ? cellOf(idx) : null;
    if (backCell && !fitsView()) (cam.x = -backCell.x * CW), (cam.y = -backCell.y * CH);
    else Object.assign(cam, middle());
    root.classList.add("used"); // they know how it works by now: no hint
  }
  apply();
  request();
  // the first look: tiles arrive from the middle out; coming back, the one you opened is already
  // there and the field gathers round it. Under the intro, they arrive once the logo has landed.
  const firstLook = () => {
    root.classList.add(backCell ? "return" : "arrive");
    G.setBusy(true); // pictures decode once the tiles have arrived, not in the middle of it
    setTimeout(() => !raf && !drag && G.setBusy(false), 560); // the middle tiles are in by then
    for (const el of tiles.values()) {
      const [cx, cy] = el.dataset.cell.split(",").map(Number);
      const d = Math.hypot(cx + cam.x / CW, cy + cam.y / CH);
      if (backCell && cx === backCell.x && cy === backCell.y) el.classList.add("hback");
      el.style.setProperty("--d", `${Math.min(8, d) * (backCell ? 24 : 40)}ms`);
    }
    setTimeout(() => {
      root.classList.remove("arrive", "return");
      for (const el of tiles.values()) el.classList.remove("hback");
    }, 900);
  };
  if (!rmo()) {
    if (document.querySelector(".intro")) {
      // under the intro: nothing shows until it has handed over, then the field arrives
      root.classList.add("held");
      addEventListener("atelier:landed", () => root.isConnected && (root.classList.remove("held"), firstLook()), { once: true });
    }
    else firstLook();
  }

  return {
    // new data (names, counts, pictures) without moving the camera
    update(next, nextActions = null) {
      const was = list.map((x) => x.id).join();
      list = next;
      if (next.map((x) => x.id).join() !== was || (nextActions && nextActions.map((a) => a.title).join() !== actions.map((a) => a.title).join())) {
        if (nextActions) actions = nextActions;
        layout();
        if (fitsView()) Object.assign(cam, middle()); // otherwise the camera stays where you were
        setHot(null);
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
      if (!c || leaving) return;
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
      host.classList.remove("hleaving");
      root.remove();
    },
  };
}

// The Home section's recent prototypes: the same project cards, in a plain grid (no camera), with
// their pictures from the same pipeline. Returns { el, destroy }.
export function cardGrid(items, { open, actions = [] }) {
  const el = h(`<div class="hgrid"></div>`);
  const res = Math.min(2.4, window.devicePixelRatio || 1);
  const cards = [];
  const draw = (card, it) => {
    const cv = card.querySelector("canvas");
    card.classList.toggle("noboard", !it.board);
    const got = it.board ? G.bitmapFor(it.board) : null;
    const was = card.classList.contains("waiting");
    card.classList.toggle("waiting", !!it.board && !got);
    if (!got || !cv) return;
    const W = Math.round(PIC.w * res),
      H = Math.round(PIC.h * res);
    if (cv.width !== W || cv.height !== H) (cv.width = W), (cv.height = H);
    const c = cv.getContext("2d");
    const r = fitIn(got.bmp.width, got.bmp.height, W, H);
    c.clearRect(0, 0, W, H);
    c.fillStyle = "#fff"; // a page is a white browser tab underneath, in either theme
    if (r.cover) c.fillRect(0, 0, W, H);
    else c.fillRect(r.x, r.y, r.w, r.h);
    c.drawImage(got.bmp, r.x, r.y, r.w, r.h);
    if (was && !rmo()) (card.classList.add("fresh"), setTimeout(() => card.classList.remove("fresh"), 320));
  };
  for (const it of items) {
    const card = h(`<button type="button" class="htile hcard"><span class="htt"><canvas aria-hidden="true"></canvas></span><span class="hcap"><b></b><span class="m"></span></span></button>`);
    card.querySelector("b").textContent = it.name;
    card.querySelector(".m").textContent = it.meta;
    card.setAttribute("aria-label", `Open ${it.name}`);
    card.onclick = () => open(it);
    draw(card, it);
    cards.push([card, it]);
    el.append(card);
  }
  for (const a of actions) {
    const card = h(`<button type="button" class="htile hcard hnew"><span class="htt"><span class="hplus">${a.icon || IC.plus}</span></span><span class="hcap"><b></b><span class="m"></span></span></button>`);
    card.querySelector("b").textContent = a.title;
    card.querySelector(".m").textContent = a.desc || "";
    card.onclick = () => a.run?.();
    el.append(card);
  }
  const jobs = items.filter((it) => it.board && !G.hasFresh(it.board)).map((it) => thumbJob(it.board));
  if (jobs.length) G.want(jobs);
  const off = G.onBitmap((k) => {
    for (const [card, it] of cards) if (it.board && G.keyOf(it.board) === k) draw(card, it);
  });
  return { el, destroy: off };
}
