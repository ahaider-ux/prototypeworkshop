// Panels around the canvas.
// Left: Branches (a calm git graph), Screens (every screen and flow, ready to place) and Layers
// (landmarks only). Right: Design (whatever is selected), Notes (every annotation and comment) and
// Chat (requests to an agent, which can work on a branch of their own).

import { S, on, fire, envList, visibleEnvs, boardsOf, itemsOf, selEnv, selEnvId, isBranch, rootOf, screenName } from "./state.js";
import { $, h, esc, api, toast, IC, menu, dropdown, segmented, copyText, timeAgo } from "./lib.js";
import { rt, docOf, selectSection, selectBoard, selectEl, selectItem, setHover, focusEnv, focusItem, refreshSelInfo, markDirty, placeScreen, editNote, openThread, sync, reloadBoard } from "./canvas.js";

// ---------- Libra tokens offered by the inspector ----------
const FILL = [
  { name: "bg-layer", css: "var(--bg-layer, #fff)", hex: ["#ffffff", "#232321", "#1b1b19"] },
  { name: "bg-base", css: "var(--bg-base, #fafafa)", hex: ["#fafafa", "#1e1e1c"] },
  { name: "bg-input", css: "var(--bg-input, #f4f4f4)", hex: ["#f4f4f4", "#282826"] },
  { name: "bg-hover", css: "var(--bg-hover, #e9eaea)", hex: ["#e9eaea", "#31302d"] },
  { name: "bg-warm", css: "var(--bg-warm, #f6f4f2)", hex: ["#f6f4f2", "#22211f"] },
  { name: "accent-subtle", css: "var(--accent-subtle, #eef2fb)", hex: ["#eef2fb"] },
  { name: "bg-primary", css: "var(--text-primary, #161a1b)", hex: ["#161a1b", "#ecebe8"] },
  { name: "none", css: "transparent", hex: ["transparent"] },
];
const INK = [
  { name: "text-primary", css: "var(--text-primary, #161a1b)", hex: ["#161a1b", "#ecebe8"] },
  { name: "text-primary-warm", css: "var(--text-primary-warm, #251f1a)", hex: ["#251f1a", "#eeebe6"] },
  { name: "text-secondary", css: "var(--text-secondary, #57514b)", hex: ["#57514b", "#a8a39c"] },
  { name: "text-muted", css: "var(--text-muted, #8a8079)", hex: ["#8a8079", "#9c968f"] },
  { name: "text-placeholder", css: "var(--text-placeholder, #888989)", hex: ["#888989", "#99938c"] },
  { name: "text-disabled", css: "var(--text-disabled, #a8abac)", hex: ["#a8abac", "#7d7a75"] },
  { name: "text-accent", css: "var(--text-accent, #5266ba)", hex: ["#5266ba", "#95a6f2"] },
  { name: "text-error", css: "var(--text-error, #c00c30)", hex: ["#c00c30", "#ff6b85"] },
  { name: "text-success", css: "var(--text-success, #327b5d)", hex: ["#327b5d", "#6fd29f"] },
  { name: "white", css: "#fff", hex: ["#ffffff"] },
];
const SPACE = [0, 2, 4, 6, 8, 12, 16, 24, 32, 40];
const RADII = [0, 4, 6, 8, 12, 16, 99];
const SIZES = [10, 12, 14, 16, 20, 24, 36];
export const DEVICES = [
  { label: "Desktop · 1728 × 1117", w: 1728, h: 1117 },
  { label: "Desktop · 1440 × 900", w: 1440, h: 900 },
  { label: "Laptop · 1280 × 800", w: 1280, h: 800 },
  { label: "Small laptop · 1180 × 760", w: 1180, h: 760 },
  { label: "Tablet · 1024 × 768", w: 1024, h: 768 },
  { label: "Phone · 390 × 844", w: 390, h: 844 },
];
function hexOf(rgb) {
  const m = /rgba?\(\s*([\d.]+)[ ,]+([\d.]+)[ ,]+([\d.]+)(?:[ ,/]+([\d.]+%?))?\s*\)/.exec(String(rgb || ""));
  if (!m) return String(rgb || "").trim().toLowerCase();
  const a = m[4] === undefined ? 1 : m[4].endsWith("%") ? parseFloat(m[4]) / 100 : parseFloat(m[4]);
  if (a === 0) return "transparent";
  const hx = [m[1], m[2], m[3]].map((v) => Math.round(+v).toString(16).padStart(2, "0")).join("");
  return a < 1 ? `#${hx}/${Math.round(a * 100)}` : `#${hx}`;
}
const tokenOf = (set, rgb) => set.find((t) => t.hex.includes(hexOf(rgb))) || null;
const px = (v) => Math.round(parseFloat(v) || 0);

// ---------- overrides cache ----------
const OV = new Map();
export async function loadOverrides(id, force = false) {
  if (!force && OV.has(id)) return OV.get(id);
  try {
    OV.set(id, (await api(`envs/${id}/styles`)).css);
  } catch {
    OV.set(id, "");
  }
  return OV.get(id);
}
function parseRules(css) {
  const out = [];
  const re = /([^{}@][^{}]*)\{([^{}]*)\}/g;
  let m;
  const src = String(css || "").replace(/\/\*[\s\S]*?\*\//g, "");
  while ((m = re.exec(src))) out.push({ selector: m[1].trim().replace(/\s+/g, " "), decls: m[2].split(";").map((d) => d.trim()).filter(Boolean).map((d) => [d.slice(0, d.indexOf(":")).trim(), d.slice(d.indexOf(":") + 1).trim().replace(/\s*!important$/, "")]) });
  return out;
}
const norm = (s) => String(s || "").replace(/\s+/g, " ").replace(/\s*>\s*/g, " > ").trim();
const boardsLive = (env) => boardsOf(env).map((b) => rt(b.id)).filter(Boolean);

// ---------- style edits, with undo ----------
const UNDO = [];
async function applyStyle(props, label) {
  const s = S.sel;
  if (s?.kind !== "el") return;
  const selector = S.scope === "exact" ? s.info.exactSelector : s.info.selector;
  const cur = parseRules(await loadOverrides(s.env)).find((r) => norm(r.selector) === norm(selector));
  const prev = {};
  for (const p of Object.keys(props)) prev[p] = cur?.decls.find(([k]) => k === p)?.[1] ?? null;
  try {
    const r = await api(`envs/${s.env}/styles`, { method: "PATCH", body: { selector, props } });
    OV.set(s.env, r.css);
    for (const x of boardsLive(s.env)) x.setOverrides(r.css);
    UNDO.push({ env: s.env, selector, prev, label });
    if (UNDO.length > 100) UNDO.shift();
    S.diffs.delete(s.env);
  } catch (e) {
    return toast("Couldn't apply that", e.message);
  }
  requestAnimationFrame(() => (refreshSelInfo(), renderDesign(), markDirty()));
}
export async function undoStyle() {
  const u = UNDO.pop();
  if (!u) return false;
  try {
    const r = await api(`envs/${u.env}/styles`, { method: "PATCH", body: { selector: u.selector, props: u.prev } });
    OV.set(u.env, r.css);
    for (const x of boardsLive(u.env)) x.setOverrides(r.css);
    toast(`Undid ${u.label}`);
    requestAnimationFrame(() => (refreshSelInfo(), renderDesign(), markDirty()));
  } catch (e) {
    toast("Couldn't undo", e.message);
  }
  return true;
}

export async function loadDiff(id) {
  const e = S.envs.get(id);
  if (!isBranch(e) || e.archived || !e.branch) return null;
  try {
    S.diffs.set(id, await api(`envs/${id}/diff`));
  } catch {
    S.diffs.delete(id);
  }
  markDirty();
  return S.diffs.get(id);
}
export async function loadVersions(id) {
  try {
    S.versions.set(id, await api(`envs/${id}/versions`));
  } catch {
    S.versions.set(id, []);
  }
  if (selEnvId() === id) renderDesign();
}

// ======================= LEFT PANEL =======================
export function renderLeft() {
  const body = $("lBody"),
    foot = $("lFoot");
  foot.replaceChildren();
  if (S.leftTab === "branches") renderBranches(body, foot);
  else if (S.leftTab === "screens") renderScreens(body, foot);
  else renderLayers(body, foot);
}

function branchStatus(e) {
  if (e.archived && e.mergedAt) return { t: "MERGED", cls: "" };
  if (e.archived) return { t: "ARCHIVED", cls: "" };
  if (!boardsOf(e.id).length) return { t: "NOT ON THE CANVAS", cls: "" };
  if (!isBranch(e)) return { t: `MAIN · ${boardsOf(e.id).length} SCREEN${boardsOf(e.id).length === 1 ? "" : "S"}`, cls: "" };
  const d = S.diffs.get(e.id);
  if (!d) return { t: "BRANCH", cls: "" };
  if (d.conflicts) return { t: `${d.changes.length} CHANGES · ${d.conflicts} CONFLICT${d.conflicts === 1 ? "" : "S"}`, cls: "warn" };
  return { t: d.changes.length ? `${d.changes.length} CHANGE${d.changes.length === 1 ? "" : "S"}` : "NO CHANGES YET", cls: d.changes.length ? "warn" : "" };
}

function renderBranches(body, foot) {
  const envs = envList().filter((e) => S.showArchived || !e.archived);
  if (!envs.length) {
    body.innerHTML = `<div class="pempty"><b>No prototypes yet</b>Import an HTML file or drop one on the canvas. Each prototype gets a section; branches you make from it get their own, joined by a line.</div>`;
  } else {
    const ids = new Set(envs.map((e) => e.id));
    const kids = new Map();
    for (const e of envs) {
      const p = e.parent && ids.has(e.parent) && S.envs.has(e.parent) ? e.parent : null;
      if (!kids.has(p)) kids.set(p, []);
      kids.get(p).push(e);
    }
    const tree = h(`<div class="btree" role="tree" aria-label="Branches"></div>`);
    const active = selEnvId();
    const add = (e, depth, isLast) => {
      const st = branchStatus(e);
      const main = !e.parent || !ids.has(e.parent);
      const row = h(`<div class="brow${main ? " main" : ""}${active === e.id ? " on" : ""}${e.archived ? " archived" : ""}" role="treeitem" tabindex="0" style="padding-left:${depth * 16}px"><span class="rail ${main ? "only" : isLast ? "last" : ""}">${main ? "" : '<span class="elbow"></span>'}<span class="dot"></span></span><span class="tx"><b title="${esc(e.name)}">${esc(e.name)}</b><span class="${st.cls}">${esc(st.t)}</span></span><button type="button" class="ib24 rmore" aria-label="More for ${esc(e.name)}" aria-haspopup="menu">${IC.more}</button></div>`);
      row.addEventListener("click", async (ev) => {
        if (ev.target.closest(".rmore")) return;
        if (!boardsOf(e.id).length) {
          const it = await placeScreen(e.id, e.screen || null);
          if (it) setTimeout(() => focusEnv(e.id), 60);
          return;
        }
        selectSection(e.id);
        focusEnv(e.id);
      });
      row.addEventListener("keydown", (ev) => ev.key === "Enter" && row.click());
      row.querySelector(".rmore").addEventListener("click", (ev) => (ev.stopPropagation(), fire("env-menu", { anchor: ev.currentTarget, env: e.id })));
      tree.append(row);
      const ks = kids.get(e.id) || [];
      ks.forEach((k, i) => add(k, depth + 1, i === ks.length - 1));
    };
    for (const e of kids.get(null) || []) add(e, 0, true);
    body.replaceChildren(tree);
  }
  const imp = h(`<button type="button" class="dbtn sm">${IC.upload}Import HTML</button>`);
  imp.onclick = () => fire("import");
  foot.append(imp, h(`<span class="sp"></span>`));
  const archived = envList().filter((e) => e.archived).length;
  if (archived) {
    const tg = h(`<button type="button" class="ghbtn sm">${S.showArchived ? "Hide" : "Show"} merged · ${archived}</button>`);
    tg.onclick = () => {
      S.showArchived = !S.showArchived;
      sync();
      renderLeft();
    };
    foot.append(tg);
  }
}

// ----- screens: everything a prototype offers, ready to place -----
let screensEnv = null;
function renderScreens(body, foot) {
  const envs = visibleEnvs().filter((e) => !e.archived);
  const env = S.envs.get(selEnvId()) || S.envs.get(screensEnv) || envs[0];
  body.replaceChildren();
  if (!env) {
    body.innerHTML = `<div class="pempty"><b>No prototypes yet</b>Import one first; its screens and flows show here.</div>`;
    return;
  }
  screensEnv = env.id;
  const head = h(`<div class="sstate"></div>`);
  head.append(dropdown({ value: env.id, options: envs.map((e) => ({ label: `${isBranch(e) ? "⑂ " : ""}${e.name}`, value: e.id })), full: true, label: "Prototype", onChange: (v) => ((screensEnv = v), selectSection(v), focusEnv(v)) }));
  body.append(head);
  const cat = env.catalog;
  const states = cat?.states?.length ? ["Default", ...cat.states.filter((x) => x !== "Default")] : [];
  if (states.length) {
    const st = h(`<div class="sstate"><span>New boards show</span></div>`);
    st.append(dropdown({ value: S.placeState, options: states, full: true, label: "State for new boards", onChange: (v) => ((S.placeState = v), renderLeft()) }));
    body.append(st);
  }
  if (!cat?.screens?.length) {
    body.append(h(`<div class="pempty"><b>${cat ? "This prototype doesn't list its screens" : "Open one of its boards first"}</b>${cat ? "Place more boards and pick their screen in Design, or describe the screens with window.workshopEnv (see the README)." : "Its screens, states and flows appear here once a board of it has loaded."}</div>`));
  } else {
    const groups = new Map();
    for (const s of cat.screens) {
      if (!groups.has(s.group)) groups.set(s.group, []);
      groups.get(s.group).push(s);
    }
    const placed = (name) => boardsOf(env.id).filter((b) => (b.screen || null) === name && (b.state || "Default") === (S.placeState || "Default"));
    for (const [g, list] of groups) {
      const grp = h(`<div class="sgrp"><div class="sgh"><span>${esc(g.toUpperCase())}</span><span class="sp"></span><button type="button">Place all</button></div></div>`);
      grp.querySelector("button").onclick = async () => {
        let n = 0;
        for (const s of list) if (!placed(s.name).length && (await placeScreen(env.id, s.name, S.placeState))) n++;
        toast(n ? `Placed ${n} screen${n === 1 ? "" : "s"}` : "They're all on the canvas", n ? `${g} · ${env.name}` : "");
        if (n) setTimeout(() => focusEnv(env.id), 80);
      };
      for (const s of list) {
        const n = placed(s.name).length;
        const flow = g === "Flows";
        const r = h(`<div class="srow" role="button" tabindex="0" draggable="true" title="${esc(s.name)}">${flow ? IC.play : IC.board}<span class="t">${esc(s.name.replace(/^Settings › /, ""))}</span>${n ? `<span class="tct" title="On the canvas">${n}</span>` : ""}<button type="button" class="ib24 add" aria-label="Place ${esc(s.name)}">${IC.plus}</button></div>`);
        const place = async () => {
          const it = await placeScreen(env.id, s.name, S.placeState);
          if (it) (selectBoard(it.id), setTimeout(() => focusItem(it.id, { maxZ: 0.6 }), 60));
        };
        r.querySelector(".add").onclick = (e) => (e.stopPropagation(), place());
        r.onclick = () => {
          const there = placed(s.name)[0];
          if (there) (selectBoard(there.id), focusItem(there.id, { maxZ: 0.6 }));
          else place();
        };
        r.onkeydown = (e) => e.key === "Enter" && r.click();
        r.ondragstart = (e) => {
          e.dataTransfer.setData("application/x-workshop-screen", JSON.stringify({ env: env.id, screen: s.name, state: S.placeState }));
          e.dataTransfer.effectAllowed = "copy";
        };
        grp.append(r);
      }
      body.append(grp);
    }
  }
  foot.append(h(`<span style="font-size:12px;color:var(--text-secondary);padding:0 4px">Drag a screen onto the canvas, or click to place it.</span>`));
}

// ----- layers: the page's landmarks, folded -----
const OPEN = new WeakSet();
const LAND = new Set(["header", "nav", "main", "aside", "section", "footer", "form", "dialog", "article", "table"]);
const STRUCT = /(sidebar|content|crumb|panel|toolbar|modal|menu|card|header|footer|stage|grid|list)/i;
function isLandmark(el) {
  if (el.id && !/^[a-z]{1,2}\d+$/i.test(el.id)) return true;
  if (LAND.has(el.localName) || el.hasAttribute("role")) return true;
  return [...el.classList].some((c) => STRUCT.test(c) && c.length < 24);
}
function visible(el) {
  const r = el.getBoundingClientRect();
  return r.width > 0 && r.height > 0;
}
function landmarks(el, depth, budget) {
  const out = [];
  if (depth > 6) return out;
  for (const c of el.children) {
    if (budget.n <= 0) break;
    if (/^(SCRIPT|STYLE|LINK|META|TEMPLATE|NOSCRIPT|svg)$/i.test(c.tagName) || c.classList.contains("ws-ghost") || !visible(c)) continue;
    if (isLandmark(c)) {
      budget.n--;
      out.push({ el: c, kids: landmarks(c, depth + 1, budget) });
    } else out.push(...landmarks(c, depth + 1, budget));
  }
  return out;
}
function lname(el) {
  const cls = [...el.classList].find((c) => !/^(on|open|active|ws-)/.test(c));
  return el.id ? `#${el.id}` : cls ? `${el.localName}.${cls}` : el.localName;
}
function renderLayers(body, foot) {
  const s = S.sel;
  const bid = s?.item && S.items.get(s.item)?.type === "board" ? s.item : null;
  const d = bid ? docOf(bid) : null;
  if (!bid || !d?.body) {
    body.innerHTML = `<div class="pempty"><b>Select a board</b>Its layers are the live page. Only landmarks show here — the sidebar, the content, panels and sections — so the list stays short.</div>`;
    return;
  }
  const tree = landmarks(d.body, 0, { n: 300 });
  // open the path to what's selected
  if (s.kind === "el") for (let el = s.el; el && el !== d.body; el = el.parentElement) OPEN.add(el);
  const near = s.kind === "el" ? (() => {
    for (let el = s.el; el && el !== d.body; el = el.parentElement) if (isLandmark(el)) return el;
    return null;
  })() : null;
  const box = h(`<div class="ltree" role="tree" aria-label="Layers"></div>`);
  const add = (n, depth) => {
    const open = OPEN.has(n.el);
    const r = h(`<div class="lrow${near === n.el ? " on" : ""}" role="treeitem" tabindex="0" style="padding-left:${4 + depth * 14}px"><span class="tw${n.kids.length ? (open ? " open" : "") : " none"}">${IC.chevr}</span><span class="t">${esc(lname(n.el))}</span>${n.kids.length ? `<span class="x">${n.kids.length}</span>` : ""}</div>`);
    r.querySelector(".tw").onclick = (e) => {
      e.stopPropagation();
      open ? OPEN.delete(n.el) : OPEN.add(n.el);
      renderLeft();
    };
    r.onclick = () => selectEl(bid, n.el);
    r.onpointerenter = () => setHover(bid, n.el);
    r.onpointerleave = () => setHover(null, null);
    box.append(r);
    if (open) for (const k of n.kids) add(k, depth + 1);
  };
  for (const n of tree) add(n, 0);
  if (!tree.length) box.append(h(`<div class="pempty">This page has no landmarks to list. Click into the board to select elements directly.</div>`));
  body.replaceChildren(box);
  box.querySelector(".lrow.on")?.scrollIntoView({ block: "nearest" });
  foot.append(h(`<span style="font-size:12px;color:var(--text-secondary);padding:0 4px">Click inside a board to reach any element.</span>`));
}

// ======================= RIGHT PANEL =======================
const sec = (title, extra = "") => h(`<div class="isec"><div class="ih"><b>${esc(title)}</b>${extra}</div></div>`);
const row = (k, v, stack = false) => {
  const r = h(`<div class="irow${stack ? " stack" : ""}"><span class="k">${esc(k)}</span><span class="v"></span></div>`);
  if (typeof v === "string") r.querySelector(".v").innerHTML = v;
  else if (v) r.querySelector(".v").append(v);
  return r;
};

export function renderRight() {
  const body = $("rBody");
  $("rFoot").replaceChildren();
  const st = body.scrollTop;
  body.replaceChildren();
  if (S.rightTab === "design") renderDesignInto(body);
  else if (S.rightTab === "comments") renderNotes(body);
  else renderChat(body);
  body.scrollTop = st;
  const active = S.tasks.filter((t) => t.status === "queued" || t.status === "working").length;
  $("rChatN").textContent = active || "";
  $("rNotesN").textContent = S.comments.filter((c) => !c.parent && !c.resolved).length + itemsOf("note").length + itemsOf("box").length || "";
}
export function renderDesign() {
  if (S.rightTab === "design") renderRight();
}
function renderDesignInto(body) {
  const s = S.sel;
  if (!s) return designCanvas(body);
  if (s.kind === "section") return designSection(body, s.env);
  if (s.kind === "board") return designBoard(body, s.item);
  if (s.kind === "el") return designEl(body, s);
  return designAnnotation(body, s.item);
}

function designCanvas(body) {
  const ws = S.ws;
  const branches = envList().filter((e) => isBranch(e) && !e.archived).length;
  const a = sec("This canvas");
  const plural = (n, one, many) => `${n} ${n === 1 ? one : many}`;
  const notes = itemsOf("note").length + itemsOf("box").length + S.comments.filter((c) => !c.parent).length;
  a.append(h(`<span style="color:var(--text-secondary)">${plural(envList().filter((e) => !isBranch(e)).length, "prototype", "prototypes")} · ${plural(branches, "open branch", "open branches")} · ${plural(itemsOf("board").length, "board", "boards")} · ${plural(notes, "note", "notes")}</span>`));
  a.append(h(`<div class="legend">
    <span class="sw2" style="background:var(--bg-input);box-shadow:0 0 0 .5px var(--border-subtle)"></span><span>A prototype's main section: one board per screen</span>
    <span class="sw2" style="background:var(--bg-warm);box-shadow:0 0 0 .5px var(--border-subtle)"></span><span>A branch, joined to what it came from by a line</span>
    <span class="sw2" style="background:var(--bg-warm);box-shadow:var(--sh-md)"></span><span>A note — <b>N</b></span>
    <span class="sw2" style="border:2px dashed var(--text-accent)"></span><span>A highlight — <b>B</b>, and arrows — <b>A</b></span>
  </div>`));
  body.append(a);
  const b = sec("Agent");
  const hs = ws.harnesses || [];
  b.append(h(`<div class="ahar"><span class="hdot${hs.length || ws.agent ? " on" : ""}"></span><span>${hs.length ? `<b>${esc(hs[0].client)}</b> is connected` : ws.agent ? `Requests run with <b>${esc(ws.agent.name)}</b>` : "No agent connected"}</span><span class="sp"></span><button type="button">${hs.length || ws.agent ? "Settings" : "Connect"}</button></div>`));
  b.querySelector("button").onclick = () => fire("connect");
  body.append(b);
  const c = sec("Shortcuts");
  c.append(h(`<div class="kbdl"><span>Select · Hand</span><kbd>V · H</kbd><span>Note · Highlight · Arrow</span><kbd>N · B · A</kbd><span>Comment</span><kbd>C</kbd><span>Design or Prototype</span><kbd>P</kbd><span>Zoom to fit</span><kbd>⇧1</kbd><span>Duplicate</span><kbd>⌘D</kbd><span>Search</span><kbd>⌘K</kbd><span>Hide panels</span><kbd>⌘\\</kbd></div>`));
  body.append(c);
}

async function patchEnv(id, patch) {
  try {
    const next = await api(`envs/${id}`, { method: "PATCH", body: patch });
    S.envs.set(id, next);
    S.diffs.delete(id);
    fire("env-meta", id);
    return next;
  } catch (e) {
    toast("Couldn't save that", e.message);
    return null;
  }
}

function envSettings(body, env) {
  const cat = env.catalog;
  const e1 = sec("Prototype settings", cat?.adapter ? `<span class="tagro" title="Screens, states and variants come from the prototype's own tools">${esc(cat.adapter.toUpperCase())}</span>` : "");
  e1.append(h(`<span style="font-size:12px;color:var(--text-secondary);margin-top:-4px">Every board of ${esc(env.name)} shows these.</span>`));
  e1.append(row("Theme", segmented([{ label: "Light", value: "light" }, { label: "Dark", value: "dark" }, { label: "System", value: "system" }], env.theme, async (v) => {
    for (const r of boardsLive(env.id)) r.setTheme(v);
    await patchEnv(env.id, { theme: v });
  }, { full: true, label: "Theme" })));
  const live = boardsLive(env.id)[0];
  const variants = (() => {
    try {
      return live?.adapter()?.variants || null;
    } catch {
      return null;
    }
  })() || cat?.variants?.map((v) => ({ ...v, value: env.variants?.[v.label] || v.options[0] })) || [];
  for (const x of variants) {
    e1.append(row(x.label, dropdown({ value: env.variants?.[x.label] || x.value, options: x.options, full: true, label: x.label, onChange: async (o) => {
      for (const r of boardsLive(env.id)) r.setVariant(x.label, o);
      await patchEnv(env.id, { variants: { [x.label]: o } });
      setTimeout(renderDesign, 60);
    } }), true));
  }
  if (variants.length && !isBranch(env)) e1.append(h(`<span style="font-size:12px;color:var(--text-secondary)">To compare a variant, create a branch and change it there.</span>`));
  body.append(e1);
}

function history(body, env) {
  const vs = S.versions.get(env.id) || [];
  const v = sec("History", `<span class="tct">${vs.length || ""}</span>`);
  const sv = h(`<button type="button" class="dbtn sm">${IC.version}Save version</button>`);
  v.querySelector(".ih").append(sv);
  sv.onclick = () => fire("save-version", env.id);
  if (!vs.length) v.append(h(`<span style="color:var(--text-secondary)">No versions yet. Merges and agents save one before they change anything.</span>`));
  for (const x of vs.slice(0, 6)) {
    const vr = h(`<div class="vrow"><span class="n">V${x.n}</span><span class="tx"><b title="${esc(x.label)}">${esc(x.label)}</b><span>${esc(x.author || "You")} · ${esc(timeAgo(x.at))}</span></span><span class="va"><button type="button" class="ib24" aria-label="Restore version ${x.n}" data-tip="Restore">${IC.restore}</button><button type="button" class="ib24" aria-label="Copy version ${x.n}" data-tip="Copy as a new prototype">${IC.copy}</button></span></div>`);
    const [rb, fb] = vr.querySelectorAll(".ib24");
    rb.onclick = () => fire("restore-version", { id: env.id, n: x.n });
    fb.onclick = () => fire("fork-version", { id: env.id, n: x.n });
    v.append(vr);
  }
  body.append(v);
  if (!S.versions.has(env.id)) loadVersions(env.id);
}

function designSection(body, id) {
  const env = S.envs.get(id);
  if (!env) return;
  const branch = isBranch(env);
  const parent = branch ? S.envs.get(env.parent) : null;
  const t = h(`<div class="isec"><div class="ititle"><div class="afld-in"><input aria-label="Name" value="${esc(env.name)}" maxlength="120"></div><span class="pth"><span title="envs/${esc(id)}/">envs/${esc(id)}/</span><button type="button" class="ib24" aria-label="Copy folder path" data-tip="Copy path">${IC.copy}</button></span></div></div>`);
  const inp = t.querySelector("input");
  inp.addEventListener("keydown", (e) => (e.key === "Enter" && inp.blur(), e.key === "Escape" && ((inp.value = env.name), inp.blur())));
  inp.addEventListener("blur", async () => {
    const v = inp.value.trim();
    if (v && v !== env.name) await patchEnv(id, { name: v });
    else inp.value = env.name;
  });
  t.querySelector(".ib24").onclick = () => copyText(`${S.ws.root}/envs/${id}`);
  body.append(t);
  // lineage and status
  const L = sec(branch ? "Branch" : "Main");
  if (branch) {
    L.append(h(`<div class="lineage"><span>Branch of <b>${esc(parent.name)}</b>, made ${esc(timeAgo(env.branch?.at || env.created))}${env.author ? ` by ${esc(env.author)}` : ""}.</span>${env.base ? `<span>It reads ${esc(S.envs.get(env.base)?.name || env.base)}'s files until it changes them.</span>` : ""}</div>`));
    if (env.archived) {
      L.append(h(`<div class="shnote">${IC.info}<div><b>${env.mergedAt ? `Merged into ${esc(S.envs.get(env.mergedInto)?.name || "its parent")}` : "Archived"}</b><br><span>${env.mergedAt ? esc(timeAgo(env.mergedAt)) : "It's hidden from the canvas."}</span></div></div>`));
      const un = h(`<button type="button" class="dbtn sm" style="align-self:flex-start">Unarchive</button>`);
      un.onclick = () => patchEnv(id, { archived: false }).then(() => (sync(), renderLeft()));
      L.append(un);
    } else {
      const d = S.diffs.get(id);
      if (!d) loadDiff(id).then(() => selEnvId() === id && renderDesign());
      L.append(h(`<div class="status">${d ? `<span class="tagro${d.changes.length ? " info" : ""}">${d.changes.length} CHANGE${d.changes.length === 1 ? "" : "S"}</span>${d.conflicts ? `<span class="tagro err">${d.conflicts} CONFLICT${d.conflicts === 1 ? "" : "S"}</span>` : ""}${d.behind ? `<span class="tagro">${d.behind} BEHIND ${esc(parent.name.toUpperCase().slice(0, 24))}</span>` : ""}` : `<span class="tagro">CHECKING</span>`}</div>`));
      const acts = h(`<div style="display:flex;gap:8px;flex-wrap:wrap"></div>`);
      const rv = h(`<button type="button" class="createbtn sm" ${d && d.changes.length ? "" : "disabled"}>Review and merge</button>`);
      rv.onclick = () => fire("review", id);
      const up = h(`<button type="button" class="dbtn sm" ${d && d.behind ? "" : "disabled"}>Update from ${esc(parent.name.length > 18 ? "main" : parent.name)}</button>`);
      up.onclick = () => fire("update-from-main", id);
      acts.append(rv, up);
      L.append(acts);
      if (d && !d.changes.length) L.append(h(`<span style="font-size:12px;color:var(--text-secondary)">Change something on this branch — a token, a variant, a file — and it shows up here to review.</span>`));
    }
  } else {
    const kids = envList().filter((e) => e.parent === id && !e.archived);
    L.append(h(`<div class="lineage"><span>${boardsOf(id).length} screen${boardsOf(id).length === 1 ? "" : "s"} on the canvas${kids.length ? ` · ${kids.length} open branch${kids.length === 1 ? "" : "es"}` : ""}.</span></div>`));
    const br = h(`<button type="button" class="dbtn sm" style="align-self:flex-start">${IC.fork}Create branch</button>`);
    br.onclick = () => fire("branch", id);
    L.append(br);
  }
  body.append(L);
  if (!env.archived) envSettings(body, env);
  // its screens
  const bs = boardsOf(id);
  const sc = sec("Screens", `<span class="tct">${bs.length || ""}</span>`);
  for (const b of bs) {
    const r = h(`<div class="vrow" role="button" tabindex="0" style="cursor:pointer"><span class="tx"><b>${esc(screenName(b))}${b.state && b.state !== "Default" ? ` · ${esc(b.state)}` : ""}</b><span>${b.w} × ${b.h}</span></span></div>`);
    r.onclick = () => (selectBoard(b.id), focusItem(b.id, { maxZ: 0.6 }));
    sc.append(r);
  }
  const more = h(`<button type="button" class="ghbtn sm" style="align-self:flex-start">${IC.plus}Place a screen</button>`);
  more.onclick = () => fire("left-tab", "screens");
  sc.append(more);
  body.append(sc);
  history(body, env);
  const a = h(`<div class="isec"><div style="display:flex;gap:8px;flex-wrap:wrap"><button type="button" class="dbtn sm" data-a="present">${IC.play}Present</button><button type="button" class="dbtn sm" data-a="share">${IC.share}Share</button><button type="button" class="dbtn sm" data-a="chat">${IC.agent}Ask agent</button></div></div>`);
  a.querySelector('[data-a="present"]').onclick = () => fire("present", bs[0]?.id);
  a.querySelector('[data-a="share"]').onclick = () => fire("share", id);
  a.querySelector('[data-a="chat"]').onclick = () => fire("ask-agent", {});
  body.append(a);
  const del = h(`<div class="isec" style="display:flex;flex-direction:row;gap:8px">${branch && !env.archived ? `<button type="button" class="dbtn sm" data-a="arch">Archive branch</button>` : ""}<button type="button" class="dbtn sm err" data-a="del">${IC.trash}Delete ${branch ? "branch" : "prototype"}</button></div>`);
  del.querySelector('[data-a="del"]').onclick = () => fire("delete", id);
  const ar = del.querySelector('[data-a="arch"]');
  if (ar) ar.onclick = () => patchEnv(id, { archived: true }).then(() => (sync(), renderLeft(), toast(`Archived ${env.name}`, "Show merged branches from the Branches panel", { label: "Undo", fn: () => patchEnv(id, { archived: false }).then(() => (sync(), renderLeft())) })));
  body.append(del);
}

function designBoard(body, bid) {
  const b = S.items.get(bid);
  const env = b && S.envs.get(b.env);
  if (!env) return;
  const r = rt(bid);
  const ad = (() => {
    try {
      return r?.adapter() || null;
    } catch {
      return null;
    }
  })();
  const t = h(`<div class="isec"><div class="ititle"><span class="nm">${esc(screenName(b))}</span><span class="pth"><span>${esc(env.name)}${isBranch(env) ? " · branch" : ""}</span><button type="button" class="ib24" aria-label="Open in a new tab" data-tip="Open in a new tab">${IC.ext}</button></span></div></div>`);
  t.querySelector(".ib24").onclick = () => window.open(`/env/${b.env}/?ws-screen=${encodeURIComponent(b.screen || "")}`, "_blank", "noopener");
  body.append(t);
  const B1 = sec("Board");
  const screens = ad?.screens?.length ? ad.screens : env.catalog?.screens || [];
  if (screens.length) {
    const opts = [{ label: "Its start screen", value: "" }, ...screens.map((x) => ({ group: x.group, label: x.name.replace("Settings › ", ""), value: x.name }))];
    B1.append(row("Screen", dropdown({ value: b.screen || "", options: opts, full: true, label: "Screen", onChange: async (v) => {
      const next = await api(`canvas/items/${bid}`, { method: "PATCH", body: { screen: v || null } }).catch((e) => toast("Couldn't change the screen", e.message));
      if (next) (S.items.set(bid, next), reloadBoard(bid), markDirty(), renderDesign());
    } })));
  }
  const states = ad?.states?.length ? ad.states : env.catalog?.states || [];
  if (states.length) {
    B1.append(row("State", dropdown({ value: b.state || "Default", options: states, full: true, label: "State", onChange: async (v) => {
      const next = await api(`canvas/items/${bid}`, { method: "PATCH", body: { state: v === "Default" ? null : v } }).catch((e) => toast("Couldn't change the state", e.message));
      if (next) (S.items.set(bid, next), reloadBoard(bid), markDirty(), renderDesign());
    } })));
  }
  const cur = DEVICES.find((d) => d.w === b.w && d.h === b.h);
  B1.append(row("Size", dropdown({ value: cur ? `${cur.w}x${cur.h}` : "custom", options: [...DEVICES.map((d) => ({ label: d.label, value: `${d.w}x${d.h}` })), ...(cur ? [] : [{ label: `Custom · ${b.w} × ${b.h}`, value: "custom" }])], full: true, label: "Size", onChange: async (v) => {
    if (v === "custom") return;
    const [w, hh] = v.split("x").map(Number);
    const next = await api(`canvas/items/${bid}`, { method: "PATCH", body: { w, h: hh } }).catch((e) => toast("Couldn't resize", e.message));
    if (next) (S.items.set(bid, next), sync(), renderDesign());
  } })));
  if (ad?.screen) B1.append(h(`<span style="font-size:12px;color:var(--text-secondary)">Showing ${esc(ad.screen)} now. Switch to Prototype (P) to click through it.</span>`));
  body.append(B1);
  const L = sec(isBranch(env) ? "Branch" : "Prototype");
  const go = h(`<div class="prow" role="button" tabindex="0" style="display:flex;align-items:center;gap:8px;height:32px;cursor:pointer;margin:0 -8px;padding:0 8px;border-radius:8px">${isBranch(env) ? IC.fork : IC.board}<span style="flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${esc(env.name)}</span>${IC.chevr}</div>`);
  go.onclick = () => selectSection(env.id);
  L.append(go);
  const acts = h(`<div style="display:flex;gap:8px;flex-wrap:wrap"><button type="button" class="dbtn sm" data-a="dup">${IC.copy}Duplicate board</button><button type="button" class="dbtn sm" data-a="br">${IC.fork}Branch from here</button><button type="button" class="dbtn sm" data-a="pr">${IC.play}Present</button></div>`);
  acts.querySelector('[data-a="dup"]').onclick = () => placeScreen(b.env, b.screen, b.state).then((it) => it && selectBoard(it.id));
  acts.querySelector('[data-a="br"]').onclick = () => fire("branch", b.env);
  acts.querySelector('[data-a="pr"]').onclick = () => fire("present", bid);
  L.append(acts);
  body.append(L);
  envSettings(body, env);
}

function swatches(set, current, onPick) {
  const w = h(`<div class="sws" role="radiogroup"></div>`);
  for (const t of set) {
    const b = h(`<button type="button" class="swc${t.name === "none" ? " none" : ""}${current?.name === t.name ? " on" : ""}" role="radio" aria-checked="${current?.name === t.name}" aria-label="${esc(t.name)}" title="${esc(t.name)}" style="${t.name === "none" ? "" : `background:${t.css}`}"></button>`);
    b.onclick = () => onPick(t);
    w.append(b);
  }
  return w;
}

function designEl(body, s) {
  const i = s.info || {};
  const st = i.styles || {};
  const env = S.envs.get(s.env);
  const t = h(`<div class="isec"><div class="ititle"><span class="nm">${esc(i.label || s.el.localName)}</span><span class="pth"><span>${esc(env?.name || s.env)} · ${esc(screenName(S.items.get(s.item)))}</span></span></div><div class="crumbs"></div></div>`);
  const chain = [];
  for (let el = s.el; el && el.parentElement && chain.length < 4; el = el.parentElement) chain.unshift(el);
  for (const el of chain) {
    const b = h(`<button type="button" class="${el === s.el ? "cur" : ""}">${esc(rt(s.item)?.label(el) || el.localName)}</button>`);
    b.onclick = () => selectEl(s.item, el);
    b.onpointerenter = () => setHover(s.item, el);
    b.onpointerleave = () => setHover(null, null);
    t.querySelector(".crumbs").append(b);
  }
  if (i.matches > 1) t.append(segmented([{ label: "This element", value: "exact" }, { label: `All ${i.matches} like it`, value: "class" }], S.scope, (v) => ((S.scope = v), renderDesign(), fire("scope")), { full: true, label: "Apply changes to" }));
  body.append(t);
  if (i.editableText) {
    const tx = sec("Text");
    const ta = h(`<textarea class="afld-ta" aria-label="Text" style="min-height:44px">${esc(i.text)}</textarea>`);
    ta.addEventListener("change", async () => {
      try {
        await api(`envs/${s.env}/text`, { method: "PUT", body: { selector: i.exactSelector, text: ta.value } });
        s.el.textContent = ta.value;
        S.diffs.delete(s.env);
        refreshSelInfo();
        markDirty();
      } catch (e) {
        toast("Couldn't save the text", e.message);
      }
    });
    tx.append(ta);
    body.append(tx);
  }
  const L = sec("Layout");
  const r = i.rect || {};
  L.append(row("Size", `<span class="ro">${r.w ?? "–"} × ${r.h ?? "–"}</span>`));
  const pads = ["padding-top", "padding-right", "padding-bottom", "padding-left"].map((k) => px(st[k]));
  const even = pads.every((p) => p === pads[0]);
  const spaceOpts = SPACE.map((n) => ({ label: `${n}`, value: n }));
  L.append(row("Padding", dropdown({ value: even ? pads[0] : "mixed", options: even ? spaceOpts : [{ label: pads.join(" · "), value: "mixed" }, ...spaceOpts], full: true, label: "Padding", onChange: (n) => n !== "mixed" && applyStyle({ padding: `${n}px` }, "padding") })));
  if (/flex|grid/.test(st.display || "")) {
    const g = px(st.gap);
    L.append(row("Gap", dropdown({ value: SPACE.includes(g) ? g : "off", options: SPACE.includes(g) ? spaceOpts : [{ label: `${g} · off system`, value: "off" }, ...spaceOpts], full: true, label: "Gap", onChange: (n) => n !== "off" && applyStyle({ gap: `${n}px` }, "gap") })));
  }
  const rad = px(st["border-radius"]);
  L.append(row("Radius", dropdown({ value: RADII.includes(rad) ? rad : "off", options: [...(RADII.includes(rad) ? [] : [{ label: `${rad} · off system`, value: "off" }]), ...RADII.map((n) => ({ label: `${n}`, value: n }))], full: true, label: "Radius", onChange: (n) => n !== "off" && applyStyle({ "border-radius": `${n}px` }, "radius") })));
  body.append(L);
  const fillTok = tokenOf(FILL, st["background-color"]);
  const F = sec("Fill", `<span class="tokname${fillTok ? "" : " off"}">${esc(fillTok ? fillTok.name : hexOf(st["background-color"]))}</span>`);
  F.append(swatches(FILL, fillTok, (tk) => applyStyle({ "background-color": tk.css }, "fill")));
  body.append(F);
  const inkTok = tokenOf(INK, st.color);
  const T = sec("Text style", `<span class="tokname${inkTok ? "" : " off"}">${esc(inkTok ? inkTok.name : hexOf(st.color))}</span>`);
  T.append(swatches(INK, inkTok, (tk) => applyStyle({ color: tk.css }, "text colour")));
  const fs = px(st["font-size"]);
  T.append(row("Size", dropdown({ value: SIZES.includes(fs) ? fs : "off", options: [...(SIZES.includes(fs) ? [] : [{ label: `${fs} · off the ramp`, value: "off" }]), ...SIZES.map((n) => ({ label: `${n}`, value: n }))], full: true, label: "Font size", onChange: (n) => n !== "off" && applyStyle({ "font-size": `${n}px` }, "size") })));
  const fw = Math.round(parseFloat(st["font-weight"]) || 400);
  T.append(row("Weight", segmented([{ label: "Regular", value: 400 }, { label: "Medium", value: 500 }], fw >= 500 ? 500 : 400, (n) => applyStyle({ "font-weight": String(n) }, "weight"), { full: true, label: "Weight" })));
  body.append(T);
  const off = [];
  if (!fillTok) off.push(`fill ${hexOf(st["background-color"])}`);
  if (!inkTok) off.push(`text ${hexOf(st.color)}`);
  if (!SIZES.includes(fs)) off.push(`${fs}px type`);
  if (!RADII.includes(rad)) off.push(`${rad}px radius`);
  const badPad = [...new Set(pads.filter((p) => !SPACE.includes(p)))];
  if (badPad.length) off.push(`${badPad.join(", ")}px padding`);
  if (off.length) body.append(h(`<div class="isec"><div class="shnote">${IC.info}<div><b>Off the system</b><br><span>${esc(off.join(" · "))}. Pick a token above to bring it back.</span></div></div></div>`));
  const css = OV.get(s.env);
  if (css === undefined) loadOverrides(s.env).then(() => S.sel === s && renderDesign());
  const mine = parseRules(css || "").filter((ru) => norm(ru.selector) === norm(i.selector) || norm(ru.selector) === norm(i.exactSelector));
  const a = h(`<div class="isec"><div style="display:flex;gap:8px;flex-wrap:wrap"><button type="button" class="dbtn sm" data-a="agent">${IC.agent}Ask an agent about this</button>${mine.length ? `<button type="button" class="ghbtn sm" data-a="reset">${IC.restore}Reset this element</button>` : ""}</div></div>`);
  a.querySelector('[data-a="agent"]').onclick = () => fire("ask-agent", {});
  const rs = a.querySelector('[data-a="reset"]');
  if (rs)
    rs.onclick = async () => {
      try {
        let res;
        for (const ru of mine) res = await api(`envs/${s.env}/styles`, { method: "DELETE", body: { selector: ru.selector } });
        OV.set(s.env, res.css);
        for (const x of boardsLive(s.env)) x.setOverrides(res.css);
        S.diffs.delete(s.env);
        requestAnimationFrame(() => (refreshSelInfo(), renderDesign(), markDirty()));
      } catch (e) {
        toast("Couldn't reset", e.message);
      }
    };
  body.append(a);
}

function designAnnotation(body, id) {
  const it = S.items.get(id);
  if (!it) return;
  const kind = { note: "Note", box: "Highlight", arrow: "Arrow" }[it.type];
  const t = sec(kind, `<span class="tokname">${esc((it.author || "You").toUpperCase())} · ${esc(timeAgo(it.updatedAt || it.createdAt).toUpperCase())}</span>`);
  const save = async (patch) => {
    try {
      const next = await api(`canvas/items/${id}`, { method: "PATCH", body: patch });
      S.items.set(id, next);
      sync();
      fire("items-changed");
    } catch (e) {
      toast("Couldn't save that", e.message);
    }
  };
  if (it.type === "note") {
    const ta = h(`<textarea class="afld-ta" aria-label="Note" style="min-height:96px">${esc(it.text)}</textarea>`);
    ta.addEventListener("change", () => save({ text: ta.value }));
    t.append(ta);
    t.append(row("Colour", segmented([{ label: "Warm", value: "warm" }, { label: "Info", value: "info" }, { label: "Plain", value: "plain" }], it.tone || "warm", (v) => save({ tone: v }), { full: true, label: "Colour" })));
    const ed = h(`<button type="button" class="ghbtn sm" style="align-self:flex-start">Edit on the canvas</button>`);
    ed.onclick = () => editNote(id);
    t.append(ed);
  } else {
    const inp = h(`<div class="afld-in"><input aria-label="Label" maxlength="200" value="${esc(it.label || "")}" placeholder="${it.type === "box" ? "What's going on here" : "Label the arrow"}"></div>`);
    const i2 = inp.querySelector("input");
    i2.addEventListener("change", () => save({ label: i2.value }));
    i2.addEventListener("keydown", (e) => e.key === "Enter" && i2.blur());
    t.append(inp);
    if (renderDesign.focusLabel) {
      renderDesign.focusLabel = false;
      setTimeout(() => i2.focus(), 30);
    }
  }
  body.append(t);
  const a = h(`<div class="isec"><div style="display:flex;gap:8px;flex-wrap:wrap"><button type="button" class="dbtn sm" data-a="agent">${IC.agent}Send to an agent</button><button type="button" class="dbtn sm err" data-a="del">${IC.trash}Remove</button></div></div>`);
  a.querySelector('[data-a="agent"]').onclick = () => {
    const near = boardUnder(it);
    if (near) selectBoard(near.id);
    fire("ask-agent", { prompt: it.text || it.label || "" });
  };
  a.querySelector('[data-a="del"]').onclick = () => fire("remove-item", id);
  body.append(a);
}
function boardUnder(it) {
  const r = it.type === "note" ? { x: it.x, y: it.y, w: it.w, h: 120 } : it.type === "box" ? it : null;
  if (!r) return null;
  const cx = r.x + r.w / 2,
    cy = r.y + r.h / 2;
  let best = null,
    bd = Infinity;
  for (const b of itemsOf("board")) {
    const dx = Math.max(b.x - cx, 0, cx - (b.x + b.w)),
      dy = Math.max(b.y - cy, 0, cy - (b.y + b.h));
    const d = Math.hypot(dx, dy);
    if (d < bd) (bd = d), (best = b);
  }
  return best;
}

// ----- notes: every annotation and comment in one feed -----
function renderNotes(body) {
  const env = selEnvId();
  const list = [];
  for (const c of S.comments.filter((c) => !c.parent && (S.showResolved || !c.resolved))) list.push({ kind: "cmt", at: c.createdAt, env: c.env, text: c.text, who: c.author, done: c.resolved, go: () => fire("open-thread", c.id), n: S.comments.filter((r) => r.parent === c.id).length });
  for (const n of itemsOf("note")) list.push({ kind: "note", at: n.createdAt, env: boardUnder(n)?.env, text: n.text || "Empty note", who: n.author, go: () => (selectItem(n.id), focusItem(n.id, { maxZ: 0.8 })) });
  for (const x of itemsOf("box")) list.push({ kind: "box", at: x.createdAt, env: boardUnder(x)?.env, text: x.label || "Highlight", who: x.author, go: () => (selectItem(x.id), focusItem(x.id, { maxZ: 0.8 })) });
  const shown = list.filter((x) => !env || x.env === env).sort((a, b) => String(b.at).localeCompare(String(a.at)));
  const head = h(`<div class="sstate" style="padding-bottom:8px"><span>${env ? `On ${esc(S.envs.get(env)?.name || "")}` : "Everything on the canvas"}</span><span style="flex:1"></span></div>`);
  const tg = h(`<button type="button" class="ghbtn sm">${S.showResolved ? "Hide resolved" : "Show resolved"}</button>`);
  tg.onclick = () => ((S.showResolved = !S.showResolved), markDirty(), renderRight());
  head.append(tg);
  body.append(head);
  if (!shown.length) {
    body.append(h(`<div class="pempty"><b>No notes yet</b>Pin a note (N), draw a highlight around something (B), connect things with an arrow (A) or comment on a board (C). Agents can read all of them.</div>`));
    return;
  }
  const feed = h(`<div class="feed"></div>`);
  for (const x of shown) {
    const icon = x.kind === "cmt" ? IC.cmt : x.kind === "box" ? `<svg class="ic" viewBox="0 0 16 16"><rect x="2.5" y="2.5" width="11" height="11" rx="2" stroke-dasharray="2 2"/></svg>` : `<svg class="ic" viewBox="0 0 16 16"><path d="M3 3.5a1 1 0 0 1 1-1h8a1 1 0 0 1 1 1V10l-3.5 3.5H4a1 1 0 0 1-1-1Z"/></svg>`;
    const f = h(`<div class="fi${x.done ? " done" : ""}" role="button" tabindex="0"><span class="k ${x.kind}">${icon}</span><span class="tx"><p>${esc(x.text)}</p><span>${esc(x.who || "You")} · ${esc(timeAgo(x.at))}${x.env && !env ? ` · ${esc(S.envs.get(x.env)?.name || "")}` : ""}${x.n ? ` · ${x.n} repl${x.n === 1 ? "y" : "ies"}` : ""}${x.done ? " · resolved" : ""}</span></span></div>`);
    f.onclick = x.go;
    f.onkeydown = (e) => e.key === "Enter" && x.go();
    feed.append(f);
  }
  body.append(feed);
}

// ----- chat: Claude-style turns; a request can open a branch for the agent -----
let draft = "";
const STATUS = { queued: ["QUEUED", ""], working: ["WORKING", "info"], done: ["DONE", "ok"], failed: ["FAILED", "err"], cancelled: ["STOPPED", ""] };
const openLogs = new Set();
function renderChat(body) {
  const env = selEnv();
  const ws = S.ws;
  const hs = ws.harnesses || [];
  const agentName = ws.agent?.name || hs[0]?.client || "Agent";
  const thread = h(`<div class="athread" aria-live="polite" style="padding:16px"></div>`);
  thread.append(h(`<div class="ahar"><span class="hdot${hs.length || ws.agent ? " on" : ""}"></span><span>${ws.agent ? `Requests run with <b>${esc(ws.agent.name)}</b>` : hs.length ? `<b>${esc(hs[0].client)}</b> is connected` : "No agent connected — requests wait"}</span><span class="sp"></span><button type="button">${ws.agent || hs.length ? "Settings" : "Connect"}</button></div>`));
  thread.querySelector(".ahar button").onclick = () => fire("connect");
  const fam = env ? new Set([env.id, ...envList().filter((e) => e.parent === env.id).map((e) => e.id)]) : null;
  const tasks = S.tasks.filter((t) => !fam || fam.has(t.env)).slice(-30);
  if (!tasks.length) {
    const sug = h(`<div class="asug"><span class="h">${env ? `Ask for a change to ${esc(env.name)}. ${!isBranch(env) ? "It happens on a new branch, so main only changes when you merge." : "It happens on this branch."}` : "Select a prototype, a board or an element, then ask for a change."}</span></div>`);
    if (env)
      for (const p of ["Make the sidebar rows denser", "Try a warmer surface for the content card", "Add an empty state to this screen"]) {
        const b = h(`<button type="button">${esc(p)}</button>`);
        b.onclick = () => {
          draft = p;
          const ta = $("rFoot").querySelector("textarea");
          if (ta) ((ta.value = p), ta.focus(), ta.dispatchEvent(new Event("input")));
        };
        sug.append(b);
      }
    thread.append(sug);
  }
  for (const t of tasks) thread.append(turnView(t, agentName));
  body.append(thread);
  // composer
  const s = S.sel;
  const onBranch = env && !isBranch(env);
  const comp = h(`<div class="acomp"><div class="abar chips"></div><textarea rows="2" aria-label="Request" placeholder="${env ? `Ask for a change to ${esc(env.name)}` : "Select something on the canvas first"}" ${env ? "" : "disabled"}></textarea><div class="abar">${onBranch ? `<label class="ctog"><button type="button" class="sw" role="switch" aria-checked="${S.chatOnBranch}" aria-label="Work on a new branch"><i></i></button>On a new branch</label>` : ""}<span class="sp"></span><button type="button" class="sendb" aria-label="Send request" disabled>${IC.send}</button></div></div>`);
  const chips = comp.querySelector(".chips");
  if (env) chips.append(h(`<span class="chip"><span class="l">${isBranch(env) ? "⑂ " : ""}${esc(env.name)}</span></span>`));
  if (s?.kind === "board" || s?.kind === "el") chips.append(h(`<span class="chip"><span class="l">${esc(screenName(S.items.get(s.item)))}</span></span>`));
  if (s?.kind === "el" && S.draftSel) {
    const c = h(`<span class="chip" title="${esc(s.info?.selector)}"><span class="l">${esc(s.info?.label || "element")}</span><button type="button" aria-label="Don't attach the selection">${IC.x}</button></span>`);
    c.querySelector("button").onclick = () => ((S.draftSel = false), renderRight());
    chips.append(c);
  }
  chips.hidden = !chips.children.length;
  const sw = comp.querySelector(".sw");
  if (sw) sw.onclick = () => ((S.chatOnBranch = !S.chatOnBranch), sw.setAttribute("aria-checked", String(S.chatOnBranch)));
  const ta = comp.querySelector("textarea");
  const send = comp.querySelector(".sendb");
  ta.value = draft;
  const syncSend = () => (send.disabled = !env || !ta.value.trim());
  ta.addEventListener("input", () => {
    draft = ta.value;
    syncSend();
    ta.style.height = "auto";
    ta.style.height = Math.min(160, ta.scrollHeight) + "px";
  });
  let busy = false;
  const go = async () => {
    const prompt = ta.value.trim();
    if (!prompt || !env || busy) return;
    busy = true;
    send.disabled = true;
    const selection = s?.kind === "el" && S.draftSel && s.info ? { selector: S.scope === "exact" ? s.info.exactSelector : s.info.selector, label: s.info.label, html: s.info.html, text: s.info.text, styles: s.info.styles } : null;
    try {
      const t = await api("tasks", { method: "POST", body: { env: env.id, prompt, selection, branch: !!(onBranch && S.chatOnBranch) } });
      draft = "";
      S.draftSel = true;
      fire("tasks-changed", { created: t });
    } catch (e) {
      toast("Couldn't send the request", e.message);
    } finally {
      busy = false;
    }
  };
  send.onclick = go;
  ta.addEventListener("keydown", (e) => e.key === "Enter" && !e.shiftKey && (e.preventDefault(), go()));
  syncSend();
  $("rFoot").replaceChildren(comp);
  requestAnimationFrame(() => (body.scrollTop = body.scrollHeight));
  if (renderChat.focus) (renderChat.focus = false), ta.focus();
}
function turnView(t, agentName) {
  const env = S.envs.get(t.env);
  const ws = S.ws;
  const w = h(`<div style="display:flex;flex-direction:column;gap:8px"></div>`);
  w.append(h(`<div class="amsg">${esc(t.prompt)}</div>`));
  if (t.selection?.label) w.append(h(`<div class="actx" title="${esc(t.selection.selector || "")}">${esc(t.selection.label)}</div>`));
  const [lab, cls] = STATUS[t.status] || [t.status.toUpperCase(), ""];
  const who = t.claimedBy || (t.runner === "auto" ? ws.agent?.name : null) || agentName;
  const waiting = t.status === "queued" && !ws.agent && !(ws.harnesses || []).length;
  const turn = h(`<div class="turn"><span class="av agent" style="background:var(--bg-primary);color:var(--bg-layer)">${esc(who[0] || "A")}</span><div class="body"></div></div>`);
  const b = turn.querySelector(".body");
  b.append(h(`<div class="st" style="display:flex;align-items:center;gap:8px;font-size:12px;color:var(--text-secondary)"><b style="color:var(--text-primary);font-weight:500">${esc(who)}</b><span class="tagro ${cls}">${lab}</span>${t.status === "working" ? '<span class="dots" aria-hidden="true"><i></i><i></i><i></i></span>' : ""}<span style="flex:1"></span><span>${esc(timeAgo(t.updatedAt))}</span></div>`));
  if (env && isBranch(env)) {
    const tag = h(`<span class="brtag">${IC.fork}${esc(env.name)}</span>`);
    tag.onclick = () => (selectSection(env.id), focusEnv(env.id));
    b.append(tag);
  }
  if (t.reply) b.append(h(`<div class="rep" style="font-size:14px;line-height:1.45;white-space:pre-wrap">${esc(t.reply)}</div>`));
  else if (t.status === "queued") b.append(h(`<div style="font-size:14px;color:var(--text-secondary)">${waiting ? "Waiting for an agent. Connect one, or ask Claude Code to take the next Workshop task." : "Waiting for the agent to pick this up."}</div>`));
  if (t.changed?.length) b.append(h(`<div class="files" style="display:flex;flex-wrap:wrap;gap:4px">${t.changed.slice(0, 6).map((f) => `<span class="tagro">${esc(f)}</span>`).join("")}</div>`));
  const acts = h(`<div style="display:flex;gap:8px;flex-wrap:wrap"></div>`);
  if (waiting) {
    const c = h(`<button type="button" class="dbtn sm">Connect an agent</button>`);
    c.onclick = () => fire("connect");
    acts.append(c);
  }
  if (t.status === "done" && env && isBranch(env) && !env.archived) {
    const rv = h(`<button type="button" class="createbtn sm">Review and merge</button>`);
    rv.onclick = () => fire("review", env.id);
    acts.append(rv);
  }
  if (t.log?.length) {
    const lb = h(`<button type="button" class="ghbtn sm">${openLogs.has(t.id) ? "Hide log" : "Show log"}</button>`);
    lb.onclick = () => (openLogs.has(t.id) ? openLogs.delete(t.id) : openLogs.add(t.id), renderRight());
    acts.append(lb);
  }
  if (t.status === "working" || t.status === "queued") {
    const sb = h(`<button type="button" class="ghbtn sm">${IC.stop}Stop</button>`);
    sb.onclick = async () => (await api(`tasks/${t.id}/cancel`, { method: "POST" }).catch((e) => toast("Couldn't stop it", e.message)), fire("tasks-changed"));
    acts.append(sb);
  }
  if ((t.status === "done" || t.status === "failed") && t.beforeVersion && !(env && isBranch(env))) {
    const ub = h(`<button type="button" class="dbtn sm">${IC.restore}Undo changes</button>`);
    ub.onclick = () => fire("restore-version", { id: t.env, n: t.beforeVersion, label: "the agent's changes" });
    acts.append(ub);
  }
  if (acts.children.length) b.append(acts);
  if (openLogs.has(t.id) && t.log?.length) b.append(h(`<div class="log" style="max-height:180px;overflow:auto;background:var(--bg-base);border:.5px solid var(--border-subtle);border-radius:8px;padding:8px 12px;font:400 12px/1.5 var(--mono);color:var(--text-secondary);white-space:pre-wrap">${t.log.map((l) => `<span class="${l.kind}">${esc(l.text)}</span>`).join("\n")}</div>`));
  w.append(turn);
  return w;
}

// ---------- wiring ----------
function setTab(group, t) {
  for (const x of document.querySelectorAll(`#${group} button`)) {
    x.classList.toggle("on", x.dataset.t === t);
    x.setAttribute("aria-selected", String(x.dataset.t === t));
  }
}
export function initPanels() {
  for (const b of document.querySelectorAll("#lTabs button")) b.addEventListener("click", () => ((S.leftTab = b.dataset.t), setTab("lTabs", S.leftTab), renderLeft()));
  for (const b of document.querySelectorAll("#rTabs button")) b.addEventListener("click", () => ((S.rightTab = b.dataset.t), setTab("rTabs", S.rightTab), renderRight()));
  on("left-tab", (t) => ((S.leftTab = t), setTab("lTabs", t), renderLeft()));
  on("sel", () => {
    renderLeft();
    renderRight();
    const e = selEnvId();
    if (e && isBranch(S.envs.get(e)) && !S.diffs.has(e)) loadDiff(e).then(() => (renderLeft(), selEnvId() === e && renderRight()));
  });
  on("board-ready", (id) => S.sel?.item === id && (renderLeft(), renderRight()));
  on("catalog", () => S.leftTab === "screens" && renderLeft());
  on("env-meta", (id) => {
    OV.delete(id);
    S.diffs.delete(id);
    if (selEnvId() === id) renderRight();
    renderLeft();
    markDirty();
  });
  on("focus-label", () => ((renderDesign.focusLabel = true), S.rightTab !== "design" && ((S.rightTab = "design"), setTab("rTabs", "design")), renderRight()));
  on("ask-agent", ({ prompt } = {}) => {
    S.rightTab = "chat";
    S.draftSel = true;
    if (prompt) draft = prompt;
    setTab("rTabs", "chat");
    renderChat.focus = true;
    renderRight();
  });
}
