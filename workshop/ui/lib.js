// Small UI kit for Atelier: DOM helpers, the API client, live events, menus, modals, toasts and
// icons. Everything renders with the classes and tokens in app.css.

export const $ = (id) => document.getElementById(id);
export const q = (sel, root = document) => root.querySelector(sel);
export const qa = (sel, root = document) => [...root.querySelectorAll(sel)];
export const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
export const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
export const rmo = () => matchMedia("(prefers-reduced-motion: reduce)").matches;

export function h(html) {
  const t = document.createElement("template");
  t.innerHTML = html.trim();
  return t.content.firstElementChild;
}

// The shell is scaled below 1180px (fitShell): client rects are screen px, styles inside the
// frame are CSS px. Divide screen deltas by this before writing them into the frame.
export function frScale() {
  const f = $("frame");
  return f && f.offsetWidth ? f.getBoundingClientRect().width / f.offsetWidth || 1 : 1;
}

// A point or rect in the frame's own CSS px — for anything absolutely placed inside it.
export function inFrame(r) {
  const fr = $("frame").getBoundingClientRect();
  const s = frScale();
  return { left: (r.left - fr.left) / s, top: (r.top - fr.top) / s, right: (r.right - fr.left) / s, bottom: (r.bottom - fr.top) / s, width: r.width / s, height: r.height / s };
}

export function fitShell() {
  const wrap = $("shellwrap"),
    f = $("frame");
  if (!wrap || !f) return;
  const w = wrap.clientWidth || window.innerWidth;
  const availH = Math.max(480, window.innerHeight);
  const sc = Math.min(1, w / 1180);
  f.style.width = w / sc + "px";
  f.style.height = availH / sc + "px";
  f.style.transform = sc < 1 ? `scale(${sc})` : "none";
}

export function timeAgo(iso) {
  const t = Date.parse(iso);
  if (!Number.isFinite(t)) return "";
  const s = Math.max(0, (Date.now() - t) / 1000);
  if (s < 45) return "just now";
  if (s < 3600) return `${Math.round(s / 60)} min ago`;
  if (s < 86400) return `${Math.round(s / 3600)} h ago`;
  if (s < 7 * 86400) return `${Math.round(s / 86400)} d ago`;
  return new Date(t).toLocaleDateString(undefined, { day: "numeric", month: "short" });
}

// ---------- API ----------
export class ApiError extends Error {
  constructor(status, body) {
    super(body?.message || `Request failed (${status})`);
    this.status = status;
    this.code = body?.error;
  }
}
export async function api(path, { method = "GET", body } = {}) {
  const r = await fetch(`/api/${path}`, {
    method,
    headers: method === "GET" ? { "x-workshop": "1" } : { "content-type": "application/json", "x-workshop": "1" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const ct = r.headers.get("content-type") || "";
  const data = ct.includes("json") ? await r.json().catch(() => null) : await r.text();
  if (!r.ok) throw new ApiError(r.status, data);
  return data;
}

export function events(onEvent, onState) {
  let es = null;
  let retry = 500;
  const open = () => {
    es = new EventSource("/api/events");
    es.addEventListener("hello", () => {
      retry = 500;
      onState?.(true);
    });
    es.addEventListener("change", (e) => {
      try {
        onEvent(JSON.parse(e.data));
      } catch {}
    });
    es.onerror = () => {
      onState?.(false);
      es.close();
      setTimeout(open, (retry = Math.min(8000, retry * 2)));
    };
  };
  open();
}

// ---------- icons (16px, 1.4 stroke) ----------
const I = (p, cls = "ic") => `<svg class="${cls}" viewBox="0 0 16 16" aria-hidden="true">${p}</svg>`;
export const IC = {
  plus: I('<path d="M8 3.5v9M3.5 8h9"/>'),
  x: I('<path d="M4.5 4.5l7 7M11.5 4.5l-7 7"/>'),
  chev: I('<path d="M4.7 6.6 8 9.9l3.3-3.3"/>'),
  chevr: I('<path d="M6.6 4.7 9.9 8l-3.3 3.3"/>'),
  check: I('<path d="m3.5 8.5 3 3 6-7"/>'),
  more: I('<circle cx="3.5" cy="8" r=".6" fill="currentColor"/><circle cx="8" cy="8" r=".6" fill="currentColor"/><circle cx="12.5" cy="8" r=".6" fill="currentColor"/>'),
  board: I('<rect x="2" y="3" width="12" height="10" rx="1.5"/><path d="M2 6h12"/>'),
  fork: I('<circle cx="4.5" cy="3.5" r="1.5"/><circle cx="11.5" cy="3.5" r="1.5"/><circle cx="8" cy="12.5" r="1.5"/><path d="M4.5 5v1a2 2 0 0 0 2 2h3a2 2 0 0 0 2-2V5M8 8v3"/>'),
  copy: I('<rect x="5" y="5" width="8.5" height="8.5" rx="1.5"/><path d="M3 10.5V3.5a1 1 0 0 1 1-1h7"/>'),
  link: I('<path d="M6.5 9.5l3-3M7 4.5l1-1a2.5 2.5 0 0 1 3.5 3.5l-1 1M9 11.5l-1 1A2.5 2.5 0 0 1 4.5 9l1-1"/>'),
  share: I('<circle cx="11.5" cy="4" r="1.75"/><circle cx="4.5" cy="8" r="1.75"/><circle cx="11.5" cy="12" r="1.75"/><path d="m6 7.1 4-2.2M6 8.9l4 2.2"/>'),
  play: I('<path d="M5.5 4.2v7.6a.5.5 0 0 0 .76.43l6.1-3.8a.5.5 0 0 0 0-.86l-6.1-3.8a.5.5 0 0 0-.76.43Z"/>'),
  trash: I('<path d="M3 4.5h10M6.5 4.5V3a.5.5 0 0 1 .5-.5h2a.5.5 0 0 1 .5.5v1.5M4.5 4.5l.6 8a1 1 0 0 0 1 .9h3.8a1 1 0 0 0 1-.9l.6-8"/>'),
  ext: I('<path d="M9 3h4v4M13 3 7.5 8.5M11.5 9.5v3a1 1 0 0 1-1 1h-7a1 1 0 0 1-1-1v-7a1 1 0 0 1 1-1h3"/>'),
  upload: I('<path d="M8 10.5V3M5 5.5 8 2.5l3 3M3 10v2a1.5 1.5 0 0 0 1.5 1.5h7A1.5 1.5 0 0 0 13 12v-2"/>'),
  code: I('<path d="M5.5 4.5 2 8l3.5 3.5M10.5 4.5 14 8l-3.5 3.5"/>'),
  info: I('<circle cx="8" cy="8" r="6"/><path d="M8 7.2v3.6M8 5.2v.1"/>'),
  send: I('<path d="M8 13V3.5M4 7.5l4-4 4 4"/>'),
  version: I('<circle cx="8" cy="8" r="5.5"/><path d="M8 5v3l2 1.5"/>'),
  restore: I('<path d="M3 8a5 5 0 1 0 1.5-3.5M3 2.5V5h2.5"/>'),
  cmt: I('<path d="M3 3.5h10a1 1 0 0 1 1 1v6a1 1 0 0 1-1 1H7l-3 2.5v-2.5H3a1 1 0 0 1-1-1v-6a1 1 0 0 1 1-1Z"/>'),
  agent: I('<rect x="3" y="4.5" width="10" height="8" rx="2"/><path d="M8 2v2.5M6 8.5v.5M10 8.5v.5M2 8v2M14 8v2"/>'),
  stop: I('<rect x="4.5" y="4.5" width="7" height="7" rx="1.5"/>'),
  sel: I('<path d="M3 5.5V4a1 1 0 0 1 1-1h1.5M10.5 3H12a1 1 0 0 1 1 1v1.5M13 10.5V12a1 1 0 0 1-1 1h-1.5M5.5 13H4a1 1 0 0 1-1-1v-1.5"/><path d="m7 7 4.5 1.6-1.9.7-.7 1.9Z"/>'),
  draw: I('<path d="M10.6 2.9a1.6 1.6 0 0 1 2.3 2.3L6 12.1l-3.2.9.9-3.2Z"/><path d="m9.4 4.1 2.3 2.3"/>'),
  frame: I('<path d="M5 2.5v11M11 2.5v11M2.5 5h11M2.5 11h11"/>'),
  note: I('<path d="M3 3.5a1 1 0 0 1 1-1h8a1 1 0 0 1 1 1V10l-3.5 3.5H4a1 1 0 0 1-1-1Z"/><path d="M9.5 13.5V11a1 1 0 0 1 1-1H13"/>'),
  box: I('<rect x="2.5" y="2.5" width="11" height="11" rx="2" stroke-dasharray="2 2"/>'),
  arrow: I('<path d="M3 13 13 3M7 3h6v6"/>'),
  compare: I('<rect x="2" y="3" width="5" height="10" rx="1"/><rect x="9" y="3" width="5" height="10" rx="1"/>'),
  home: I('<path d="M2.5 7.2 8 2.8l5.5 4.4V13a.5.5 0 0 1-.5.5H9.5V10h-3v3.5H3a.5.5 0 0 1-.5-.5Z"/>'),
  img: I('<rect x="2.5" y="3" width="11" height="10" rx="1.5"/><circle cx="6" cy="6.5" r="1.2"/><path d="m3 12 3.5-3.5 2.5 2.5 1.5-1.5L13 12"/>'),
  folder: I('<path d="M2.5 4.5a1 1 0 0 1 1-1h3l1.5 1.5h4.5a1 1 0 0 1 1 1v6a1 1 0 0 1-1 1h-9a1 1 0 0 1-1-1Z"/>'),
};

// ---------- menus — .cnmenu, anchored inside the frame ----------
let openMenuEl = null;
let openMenuAnchor = null;
export function closeMenu() {
  if (!openMenuEl) return;
  const m = openMenuEl;
  openMenuEl = null;
  m.classList.remove("open");
  openMenuAnchor?.setAttribute("aria-expanded", "false");
  openMenuAnchor = null;
  setTimeout(() => m.remove(), 200);
}
// items: [{label, icon, kbd, checked, danger, disabled, onClick} | "-" | {head}]
export function menu(anchor, items, { align = "left", up = false, width } = {}) {
  if (openMenuAnchor === anchor) return closeMenu();
  closeMenu();
  const m = h(`<div class="cnmenu" role="menu"></div>`);
  if (width) m.style.width = width + "px";
  for (const it of items) {
    if (it === "-") {
      m.append(h('<div class="tdiv" role="separator"></div>'));
      continue;
    }
    if (it.head) {
      m.append(h(`<div class="mh">${esc(it.head)}</div>`));
      continue;
    }
    const role = it.checked === undefined ? "menuitem" : "menuitemradio";
    const b = h(`<button type="button" role="${role}" ${it.checked !== undefined ? `aria-checked="${!!it.checked}"` : ""} class="${it.danger ? "danger" : ""}" ${it.disabled ? "disabled" : ""}>${it.checked !== undefined ? `<span class="ck">${IC.check}</span>` : it.icon || ""}<span class="l">${esc(it.label)}</span>${it.kbd ? `<span class="k">${esc(it.kbd)}</span>` : ""}</button>`);
    b.addEventListener("click", (e) => {
      e.stopPropagation();
      closeMenu();
      it.onClick?.();
    });
    m.append(b);
  }
  $("frame").append(m);
  const a = inFrame(anchor.getBoundingClientRect());
  const fw = $("frame").offsetWidth,
    fh = $("frame").offsetHeight;
  const mw = m.offsetWidth,
    mh = m.offsetHeight;
  let left = align === "right" ? a.right - mw : align === "center" ? a.left + a.width / 2 - mw / 2 : a.left;
  left = clamp(left, 8, fw - mw - 8);
  let top = up ? a.top - mh - 6 : a.bottom + 6;
  if (!up && top + mh > fh - 8 && a.top - mh - 6 > 8) top = a.top - mh - 6;
  if (up && top < 8) top = a.bottom + 6;
  m.style.left = left + "px";
  m.style.top = clamp(top, 8, fh - mh - 8) + "px";
  m.style.transformOrigin = `${align === "right" ? "right" : "left"} ${top < a.top ? "bottom" : "top"}`;
  anchor.setAttribute("aria-expanded", "true");
  openMenuEl = m;
  openMenuAnchor = anchor;
  requestAnimationFrame(() => m.classList.add("open"));
  m.querySelector("button:not([disabled])")?.focus({ preventScroll: true });
  return m;
}
document.addEventListener("pointerdown", (e) => {
  if (openMenuEl && !openMenuEl.contains(e.target) && !openMenuAnchor?.contains(e.target)) closeMenu();
}, true);
document.addEventListener("keydown", (e) => {
  if (!openMenuEl) return;
  if (e.key === "Escape") {
    e.stopPropagation();
    const a = openMenuAnchor;
    closeMenu();
    a?.focus();
  } else if (e.key === "ArrowDown" || e.key === "ArrowUp") {
    e.preventDefault();
    const bs = qa("button:not([disabled])", openMenuEl);
    const i = bs.indexOf(document.activeElement);
    bs[(i + (e.key === "ArrowDown" ? 1 : -1) + bs.length) % bs.length]?.focus();
  }
}, true);

// A dropdown trigger: label + chevron, opening a radio menu.
export function dropdown({ value, options, onChange, full = false, label }) {
  const cur = options.find((o) => (o.value ?? o) === value);
  const b = h(`<button type="button" class="ddtrig${full ? " full" : ""}" aria-haspopup="menu" aria-expanded="false" ${label ? `aria-label="${esc(label)}"` : ""}><span class="v">${esc(cur ? cur.label ?? cur : value ?? "Choose")}</span>${IC.chev}</button>`);
  b.addEventListener("click", () => {
    const items = [];
    let group = null;
    for (const o of options) {
      if (o.group && o.group !== group) {
        group = o.group;
        items.push({ head: group });
      }
      items.push({ label: o.label ?? o, checked: (o.value ?? o) === value, onClick: () => onChange(o.value ?? o) });
    }
    menu(b, items, { width: Math.max(200, b.offsetWidth) });
  });
  return b;
}

export function segmented(options, value, onChange, { full = false, label = "" } = {}) {
  const s = h(`<div class="segds${full ? " full" : ""}" role="radiogroup" aria-label="${esc(label)}"></div>`);
  for (const o of options) {
    const v = o.value ?? o;
    const b = h(`<button type="button" role="radio" aria-checked="${v === value}" class="${v === value ? "on" : ""}">${esc(o.label ?? o)}</button>`);
    b.addEventListener("click", () => {
      if (v === value) return;
      onChange(v);
    });
    s.append(b);
  }
  return s;
}

// ---------- modal — one at a time, Esc and scrim close, focus returns ----------
let modalReturn = null;
let modalOnClose = null;
export function modal(html, { wide = false, onClose } = {}) {
  const ov = $("modal");
  modalReturn = document.activeElement;
  modalOnClose = onClose || null;
  ov.innerHTML = `<div class="md${wide ? " wide" : ""}">${html}</div>`;
  ov.classList.add("open");
  const md = ov.firstElementChild;
  setTimeout(() => (md.querySelector("[autofocus]") || md.querySelector("input,textarea,button"))?.focus({ preventScroll: true }), 30);
  return md;
}
export function closeModal() {
  const ov = $("modal");
  if (!ov.classList.contains("open")) return;
  ov.classList.remove("open");
  const cb = modalOnClose;
  modalOnClose = null;
  setTimeout(() => {
    if (!ov.classList.contains("open")) ov.innerHTML = "";
  }, 220);
  modalReturn?.focus?.({ preventScroll: true });
  cb?.();
}
document.addEventListener("pointerdown", (e) => {
  const ov = $("modal");
  if (ov && ov.classList.contains("open") && e.target === ov) closeModal();
});
document.addEventListener("keydown", (e) => {
  if (e.key === "Escape" && $("modal")?.classList.contains("open") && !openMenuEl) {
    e.stopPropagation();
    closeModal();
  }
}, true);

// ---------- toasts — top-right, Undo as an inline action ----------
// A loading line: words in the shimmer, with skeleton rows under it while content is on its way.
export function skeleton(label = "", rows = 3, { cards = false } = {}) {
  const w = [44, 68, 56, 80, 50, 72];
  const one = (i) => (cards ? `<div class="skcard"><span class="skel" style="width:${w[i % 6] - 10}%;height:12px"></span><span class="skel" style="width:${w[(i + 3) % 6] + 12}%"></span><span class="skel" style="width:${w[(i + 1) % 6]}%"></span></div>` : `<div class="skrow"><span class="skel ic"></span><span class="skel" style="width:${w[i % 6]}%"></span></div>`);
  return h(`<div class="skload" role="status" aria-live="polite">${label ? `<span class="lab shimmer">${esc(label)}</span>` : `<span class="sr">Loading</span>`}${Array.from({ length: rows }, (_, i) => one(i)).join("")}</div>`);
}
// A button that started something slow: its label says what's happening, in the shimmer, and it
// can't be pressed twice. Returns a function that puts it back (when the action failed).
export function pendingButton(btn, label) {
  if (!btn) return () => {};
  const was = btn.innerHTML;
  btn.disabled = true;
  btn.setAttribute("aria-busy", "true");
  btn.innerHTML = `<span class="shimmer">${esc(label)}</span>`;
  return () => {
    btn.disabled = false;
    btn.removeAttribute("aria-busy");
    btn.innerHTML = was;
  };
}
// a toast for something under way: the title shimmers and it stays until close() (or 20 s)
export const loadingToast = (title, desc = "") => toast(title, desc, null, 20000, { loading: true });

export function toast(title, desc = "", action = null, ms = 4200, { loading = false } = {}) {
  const t = h(`<div class="toast" role="status"><div class="tcol"><span class="tt2${loading ? " shimmer" : ""}">${esc(title)}</span>${desc ? `<span class="tdesc">${esc(desc)}</span>` : ""}${action ? `<button type="button" class="tact">${esc(action.label)}</button>` : ""}</div><button type="button" class="ib24" aria-label="Dismiss">${IC.x}</button></div>`);
  const close = () => {
    t.classList.remove("is-open");
    setTimeout(() => t.remove(), 260);
  };
  t.querySelector(".ib24").onclick = close;
  if (action) t.querySelector(".tact").onclick = () => {
    close();
    action.fn();
  };
  $("toasts").prepend(t);
  requestAnimationFrame(() => t.classList.add("is-open"));
  setTimeout(close, action ? Math.max(ms, 6500) : ms);
  return close;
}

export async function copyText(text) {
  try {
    await navigator.clipboard.writeText(text);
    toast("Copied", text.length > 80 ? text.slice(0, 80) + "…" : text);
  } catch {
    toast("Couldn't copy", "Select the text and copy it yourself");
  }
}

// Prototype pages wait while the intro plays: a page loading behind it takes the main thread for
// 50–100 ms at a time and the intro stutters. Loads queue up and go, a few frames apart, once it ends.
let held = null;
export const holdPages = () => (held = held || []);
export function releasePages() {
  const q = held || [];
  held = null;
  q.forEach((fn, i) => setTimeout(fn, i * 40));
}
// A preview that is only looked at (a home thumbnail) loads from the other loopback name
// (127.0.0.1 ↔ localhost). That's another site to the browser, so it runs the prototype in its own
// process, and the prototype starting up never blocks the editor. The server accepts both names.
export function apartUrl(path) {
  const h = location.hostname;
  const other = h === "127.0.0.1" ? "localhost" : h === "localhost" ? "127.0.0.1" : null;
  return other ? `${location.protocol}//${other}:${location.port}${path}` : path;
}
// resolves when pages may load
export const pagesFree = () => (held ? new Promise((r) => held.push(r)) : Promise.resolve());
// point a frame at a page, now or once the intro is over (only if nothing asked for another page since)
export function loadPage(fr, src) {
  fr.dataset.want = src;
  if (!held) return void (fr.src = src);
  held.push(() => fr.dataset.want === src && (fr.src = src));
}

// ---------- tooltips ----------
// One floating label for every [data-tip] (data-tip-up puts it above). It shows after 300 ms of
// hover or keyboard focus (at once if another was just showing), and goes on leave, press, scroll
// or Escape. It lives outside every panel, so it never widens one or gets clipped by one.
export function initTips() {
  if (matchMedia("(hover: none)").matches) return;
  const tip = document.createElement("div");
  tip.className = "tipl";
  tip.setAttribute("role", "tooltip");
  document.body.append(tip);
  let on = null,
    timer = 0,
    warmUntil = 0;
  const place = (el) => {
    const r = el.getBoundingClientRect();
    if (!r.width && !r.height) return hide();
    tip.textContent = el.getAttribute("data-tip") || "";
    const tw = tip.offsetWidth,
      th = tip.offsetHeight;
    let up = el.hasAttribute("data-tip-up");
    let y = up ? r.top - th - 6 : r.bottom + 6;
    if (!up && y + th > innerHeight - 4) y = r.top - th - 6; // no room below: above
    if (up && y < 4) y = r.bottom + 6;
    const x = Math.max(8, Math.min(innerWidth - tw - 8, r.left + r.width / 2 - tw / 2));
    tip.style.transform = `translate(${Math.round(x)}px, ${Math.round(y)}px)`;
    tip.classList.add("on");
  };
  const show = (el) => {
    clearTimeout(timer);
    if (on === el) return;
    on = el;
    const go = () => on === el && el.isConnected && place(el);
    if (performance.now() < warmUntil) go();
    else timer = setTimeout(go, 300);
  };
  function hide() {
    clearTimeout(timer);
    if (on && tip.classList.contains("on")) warmUntil = performance.now() + 400;
    on = null;
    tip.classList.remove("on");
  }
  addEventListener("pointerover", (e) => {
    const el = e.target.closest?.("[data-tip]");
    if (el) show(el);
    else if (on) hide();
  });
  addEventListener("pointerout", (e) => on && !on.contains(e.relatedTarget) && hide());
  addEventListener("focusin", (e) => {
    const el = e.target.closest?.("[data-tip]");
    if (el && e.target.matches(":focus-visible")) show(el);
  });
  addEventListener("focusout", () => hide());
  addEventListener("pointerdown", () => hide(), true);
  addEventListener("scroll", () => hide(), true);
  addEventListener("keydown", (e) => e.key === "Escape" && hide(), true);
}

