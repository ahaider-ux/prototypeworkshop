// Panels around the canvas, as in a design tool.
// Left, a rail of panels: File (the prototype's branches — its pages — and this page's layers),
// Screens (everything the prototype offers, ready to place), Agents (ask for a change; from main it
// happens on a branch), Notes (annotations and comments) and History (versions, merged branches).
// Right: Design (whatever is selected, or the page) and Prototype (how the page runs). The banner
// across the canvas says which page this is and what to do with it.

import { S, on, fire, envList, boardsOf, itemsOf, isBranch, rootOf, familyOf, pageEnv, protoId, pageItems, pageOf, nearestBoard, screenName, plural, pageName, folderLabel } from "./state.js";
import { $, h, esc, api, toast, IC, dropdown, segmented, copyText, timeAgo, clamp } from "./lib.js";
import { rt, selectBoard, selectEl, selectItem, setHover, focusItem, refreshSelInfo, markDirty, placeScreen, editNote, sync, reloadBoard, isVisible, fit, setMode, docOf, winOf, flowOf, parseTranslate, exactSel, removeEl, selIds, toggleSel, alignSel, distributeSel, duplicateSel, removeItems } from "./canvas.js";
import { PENS, INKS, SIZES as INK_SIZES } from "./ink.js";
import { record, rid } from "./history.js";
import { renderRecipes } from "./recipes.js";
import { loadOverrides, cachedOverrides, forgetOverrides, rulesFor, boardsLive, commitRules, resetSelectors, preview, endPreview } from "./styles.js";

// ---------- the colours the inspector offers ----------
// Each prototype's own colour variables, or the colours it uses (paletteOf, below). This list is
// only the stand-in while no page is loaded to read them from.
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

// The colour variables a prototype defines on :root / html / body (and theme selectors), split into
// text colours and fills by their names, so the swatches are the prototype's own design system.
const PALETTES = new WeakMap();
function paletteOf(doc) {
  if (!doc) return { fill: FILL, ink: INK };
  if (PALETTES.has(doc)) return PALETTES.get(doc);
  const names = new Set();
  const walk = (rules, depth = 0) => {
    for (const r of rules || []) {
      if (names.size >= 400 || depth > 3) return;
      if (r.cssRules && !r.style) walk(r.cssRules, depth + 1); // @media, @layer, @supports
      if (!r.style || !/(^|,)\s*(:root|html|body)\b|\[data-theme/.test(r.selectorText || "")) continue;
      for (let k = 0; k < r.style.length; k++) if (r.style[k].startsWith("--")) names.add(r.style[k]);
    }
  };
  for (const sh of doc.styleSheets) {
    try {
      walk(sh.cssRules);
    } catch {} // a stylesheet from another origin can't be read
  }
  const root = doc.defaultView.getComputedStyle(doc.documentElement);
  const probe = doc.createElement("i");
  probe.style.display = "none";
  doc.body?.append(probe);
  const fill = [],
    ink = [];
  for (const n of names) {
    const raw = root.getPropertyValue(n).trim();
    // only plain colours: not sizes, fonts, shadows or gradients
    if (!raw || raw.length > 60 || /^-?[\d.]+(px|rem|em|%|ms|s)?$/.test(raw) || /gradient|url\(|,\s*\d+px/.test(raw)) continue;
    probe.style.color = "";
    probe.style.color = raw;
    if (!probe.style.color) continue;
    const hex = hexOf(doc.defaultView.getComputedStyle(probe).color);
    const t = { name: n.slice(2), css: `var(${n})`, hex: [hex] };
    const nm = n.toLowerCase();
    if (/text|ink|fg|foreground|font-color|icon/.test(nm)) ink.push(t);
    else if (/bg|background|surface|fill|layer|base|card|panel|canvas|shell/.test(nm)) fill.push(t);
    else (ink.push(t), fill.push(t)); // accents, brand, borders: either
  }
  probe.remove();
  if (fill.length + ink.length < 3) {
    // no colour variables: offer the colours the page already uses, most used first
    const count = (m, v) => v && v !== "transparent" && m.set(v, (m.get(v) || 0) + 1);
    const fills = new Map(),
      inks = new Map();
    for (const e of [...doc.querySelectorAll("body, body *")].slice(0, 600)) {
      const cs = doc.defaultView.getComputedStyle(e);
      count(fills, hexOf(cs.backgroundColor));
      if (e.childNodes.length && [...e.childNodes].some((c) => c.nodeType === 3 && c.textContent.trim())) count(inks, hexOf(cs.color));
    }
    const top = (m) => [...m].sort((a, b) => b[1] - a[1]).slice(0, 12).map(([hx]) => ({ name: hx, css: hx.includes("/") ? hx.replace(/\/(\d+)$/, (_, a) => Math.round((a / 100) * 255).toString(16).padStart(2, "0")) : hx, hex: [hx] }));
    fill.push(...top(fills));
    ink.push(...top(inks));
  }
  const out = { fill: [...fill.slice(0, 24), { name: "none", css: "transparent", hex: ["transparent"] }], ink: ink.slice(0, 24) };
  PALETTES.set(doc, out);
  return out;
}
const px = (v) => Math.round(parseFloat(v) || 0);

const diffing = new Map();
const diffFailed = new Map(); // id → when it last failed
export function loadDiff(id) {
  const e = S.envs.get(id);
  if (!isBranch(e) || e.archived || !e.branch) return Promise.resolve(null);
  if (diffing.has(id)) return diffing.get(id);
  // Guard: panels ask for a missing diff while they render, and a failed one re-renders them; without
  // a pause after a failure that would ask again in a loop.
  if (Date.now() - (diffFailed.get(id) || 0) < 10000) return Promise.resolve(null);
  const p = api(`envs/${id}/diff`)
    .then((d) => (S.diffs.set(id, d), diffFailed.delete(id)))
    .catch(() => (S.diffs.delete(id), diffFailed.set(id, Date.now())))
    .then(() => {
      diffing.delete(id);
      markDirty();
      fire("diff", id);
      return S.diffs.get(id) || null;
    });
  diffing.set(id, p);
  return p;
}
export async function loadVersions(id) {
  try {
    S.versions.set(id, await api(`envs/${id}/versions`));
  } catch {
    S.versions.set(id, []);
  }
  if (S.page === id && S.leftTab === "history") renderLeft();
}

// ======================= LEFT PANEL =======================
const LEFT = { screens: "Screens", agents: "Agents", recipes: "Recipes", notes: "Notes", history: "History" };
export function renderLeft() {
  const head = $("lHead"),
    body = $("lBody"),
    foot = $("lFoot");
  for (const b of document.querySelectorAll("#rail [data-t]")) {
    const on = b.dataset.t === S.leftTab;
    b.classList.toggle("on", on);
    b.setAttribute("aria-selected", String(on));
  }
  railBadges();
  const env = pageEnv();
  const st = body.scrollTop;
  foot.replaceChildren();
  body.replaceChildren();
  head.replaceChildren();
  if (!env) return;
  if (S.leftTab === "file") renderFile(head, body);
  else {
    const sub = { screens: `To place on ${pageName(env)}`, agents: agentLine(), recipes: "Shared ways of working", notes: S.notesAll ? `Everywhere in ${rootOf(env.id)?.name || ""}` : `On ${pageName(env)}`, history: `Versions of ${pageName(env)}` }[S.leftTab];
    head.append(h(`<div class="ttl"><b>${LEFT[S.leftTab]}</b><span>${esc(sub)}</span></div>`));
    if (S.leftTab === "screens") renderScreens(body, foot, env);
    else if (S.leftTab === "agents") renderChat(body, foot, env);
    else if (S.leftTab === "recipes") renderRecipes(head, body, env);
    else if (S.leftTab === "notes") renderNotes(head, body, env);
    else renderHistory(head, body, env);
  }
  if (S.leftTab !== "agents") body.scrollTop = st;
}
function railBadges() {
  const set = (t, n) => {
    const b = document.querySelector(`#rail [data-t="${t}"]`);
    if (!b) return;
    let c = b.querySelector(".tct");
    if (!n) return c?.remove();
    if (!c) (c = h(`<span class="tct"></span>`)), b.append(c);
    c.textContent = String(n);
  };
  const fam = new Set(familyOf(protoId()).map((x) => x.env.id));
  set("agents", S.tasks.filter((t) => fam.has(t.env) && (t.status === "queued" || t.status === "working")).length);
  set("notes", S.comments.filter((c) => !c.parent && !c.resolved && c.env === S.page).length);
}
function agentLine() {
  const ws = S.ws;
  const hs = ws?.harnesses || [];
  return hs.length ? `${hs[0].client} is connected` : ws?.agent ? `Requests run with ${ws.agent.name}` : "No agent connected";
}

function pageMeta(e) {
  if (e.archived && e.mergedAt) return { t: "Merged", cls: "" };
  if (e.archived) return { t: "Archived", cls: "" };
  if (!isBranch(e)) return { t: "", cls: "" };
  const d = S.diffs.get(e.id);
  if (!d) return { t: "", cls: "" };
  // the count is enough in a narrow list; the row's tooltip spells it out
  if (d.conflicts) return { t: `${d.conflicts} !`, cls: "cf", title: plural(d.conflicts, "conflict") };
  return { t: d.changes.length ? String(d.changes.length) : "", cls: d.changes.length ? "ch" : "", title: d.changes.length ? plural(d.changes.length, "change") : "No changes yet" };
}

// ----- file: the prototype's branches (its pages) and this page's layers -----
function renderFile(head, body) {
  const env = pageEnv();
  const root = rootOf(env.id);
  const fb = h(`<button type="button" class="file" aria-haspopup="menu" aria-expanded="false"><span class="ttl"><b title="${esc(root.name)}">${esc(root.name)}</b><span>${isBranch(env) ? `Branch · ${esc(env.name)}` : "Main"}</span></span>${IC.chev}</button>`);
  fb.onclick = () => fire("env-menu", { anchor: fb, env: root.id });
  head.append(fb);
  // branches, like pages
  const fam = familyOf(root.id);
  const open = fam.filter((x) => S.showArchived || !x.env.archived);
  const nBr = fam.filter((x) => isBranch(x.env) && !x.env.archived).length;
  const sh = h(`<div class="shd"><span>Branches</span><span class="n">${nBr || ""}</span><span class="sp"></span><button type="button" class="ib24" aria-label="Create a branch of ${esc(pageName(env))}" data-tip="Create branch">${IC.plus}</button></div>`);
  sh.querySelector("button").onclick = () => fire("branch", S.page);
  body.append(sh);
  const list = h(`<div class="pgs" role="listbox" aria-label="Branches"></div>`);
  for (const { env: e, depth } of open) {
    const m = pageMeta(e);
    const main = !isBranch(e);
    const r = h(`<div class="pg${e.id === S.page ? " on" : ""}${e.archived ? " archived" : ""}" role="option" aria-selected="${e.id === S.page}" tabindex="0" style="padding-left:${8 + Math.max(0, depth - 1) * 16}px">${main ? IC.board : IC.fork}<span class="t" title="${esc(e.name)}">${main ? "Main" : esc(e.name)}</span><span class="m ${m.cls}" title="${esc(m.title || "")}">${esc(m.t)}</span><button type="button" class="ib24" aria-label="More for ${esc(main ? "main" : e.name)}" aria-haspopup="menu">${IC.more}</button></div>`);
    r.onclick = (ev) => !ev.target.closest(".ib24") && fire("go", e.id);
    r.onkeydown = (ev) => ev.key === "Enter" && fire("go", e.id);
    r.querySelector(".ib24").onclick = (ev) => (ev.stopPropagation(), fire("env-menu", { anchor: ev.currentTarget, env: e.id }));
    list.append(r);
  }
  body.append(list);
  const archived = fam.filter((x) => x.env.archived).length;
  if (archived) {
    const tg = h(`<button type="button" class="ghbtn sm" style="margin:0 8px 4px;color:var(--text-secondary)">${S.showArchived ? "Hide merged" : `Show merged · ${archived}`}</button>`);
    tg.onclick = () => ((S.showArchived = !S.showArchived), renderLeft());
    body.append(tg);
  }
  body.append(h(`<div class="pdiv"></div>`));
  // layers: this page's frames (open one to reach its live page) and its annotations
  const boards = pageItems("board").sort((a, b) => a.y - b.y || a.x - b.x);
  const anns = [...pageItems("box"), ...pageItems("note"), ...pageItems("arrow"), ...pageItems("ink")];
  body.append(h(`<div class="shd"><span>Layers</span><span class="n">${boards.length + anns.length || ""}</span></div>`));
  const tree = h(`<div class="ltree" role="tree" aria-label="Layers"></div>`);
  const s = S.sel;
  if (s?.kind === "el") EXP.add(s.item);
  for (const b of boards) {
    const d = docOf(b.id);
    const canOpen = true;
    const open = !!d?.body && EXP.has(b.id);
    const r = h(`<div class="lrow frame${selIds().includes(b.id) ? " on" : ""}" role="treeitem" aria-expanded="${open}" tabindex="0" style="padding-left:4px"><span class="tw${canOpen ? (open ? " open" : "") : " none"}">${IC.chevr}</span>${IC.frame}<span class="t">${esc(screenName(b))}${b.state && b.state !== "Default" ? ` · ${esc(b.state)}` : ""}</span></div>`);
    r.querySelector(".tw").onclick = (e) => {
      e.stopPropagation();
      EXP.has(b.id) ? EXP.delete(b.id) : EXP.add(b.id);
      // its landmarks come from the live page: selecting the frame brings it live
      if (!docOf(b.id)?.body) selectBoard(b.id);
      renderLeft();
    };
    r.onclick = (e) => (e.shiftKey ? toggleSel(b.id) : (selectBoard(b.id), !isVisible(b.id) && focusItem(b.id, { maxZ: 0.6 })));
    r.onkeydown = (e) => e.key === "Enter" && r.click();
    tree.append(r);
    if (open) landmarkRows(tree, b.id, d);
  }
  if (anns.length) {
    const kind = { note: ["Note", IC.note], box: ["Highlight", IC.box], arrow: ["Arrow", IC.arrow], ink: ["Drawing", IC.draw] };
    for (const a of anns) {
      const [k, ic] = kind[a.type];
      const label = a.type === "ink" ? `${PENS[a.pen]?.label || "Drawing"}${a.board && S.items.get(a.board) ? ` on ${screenName(S.items.get(a.board))}` : ""}` : a.text || a.label || k;
      const r = h(`<div class="lrow${selIds().includes(a.id) ? " on" : ""}" role="treeitem" tabindex="0" style="padding-left:4px"><span class="tw none"></span>${ic}<span class="t">${esc(label)}</span>${a.type === "ink" ? `<span class="inkchip" style="--ink:${esc(a.color)}"></span>` : ""}</div>`);
      r.onclick = (e) => (e.shiftKey ? toggleSel(a.id) : (selectItem(a.id), a.type !== "arrow" && !isVisible(a.id) && focusItem(a.id, { maxZ: 0.8 })));
      r.onkeydown = (e) => e.key === "Enter" && r.click();
      tree.append(r);
    }
  }
  if (!boards.length && !anns.length) tree.append(h(`<div class="hint2">Nothing on this page yet. Place screens from the Screens panel.</div>`));
  body.append(tree);
  tree.querySelector(".lrow.on")?.scrollIntoView({ block: "nearest" });
}

// landmarks of one live page, folded: the sidebar, the content, panels and sections
const EXP = new Set(); // boards opened in Layers
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
function landmarkRows(box, bid, d) {
  const s = S.sel;
  const mine = s?.kind === "el" && s.item === bid;
  if (mine) for (let el = s.el; el && el !== d.body; el = el.parentElement) OPEN.add(el);
  const near = mine
    ? (() => {
        for (let el = s.el; el && el !== d.body; el = el.parentElement) if (isLandmark(el)) return el;
        return null;
      })()
    : null;
  const add = (n, depth) => {
    const open = OPEN.has(n.el);
    const r = h(`<div class="lrow${near === n.el ? " on" : ""}" role="treeitem" tabindex="0" style="padding-left:${4 + depth * 12}px"><span class="tw${n.kids.length ? (open ? " open" : "") : " none"}">${IC.chevr}</span><span class="t">${esc(lname(n.el))}</span>${n.kids.length ? `<span class="x">${n.kids.length}</span>` : ""}</div>`);
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
  const tree = landmarks(d.body, 0, { n: 300 });
  for (const n of tree) add(n, 1);
  if (!tree.length) box.append(h(`<div class="hint2">No landmarks to list. Click into the board to select elements directly.</div>`));
}

// ----- screens: everything the prototype offers, ready to place on this page -----
function renderScreens(body, foot, env) {
  const cat = env.catalog?.screens?.length ? env.catalog : rootOf(env.id)?.catalog;
  const states = cat?.states?.length ? ["Default", ...cat.states.filter((x) => x !== "Default")] : [];
  if (states.length) {
    const st = h(`<div class="sstate"><span>Show as</span></div>`);
    st.append(dropdown({ value: S.placeState, options: states, full: true, label: "State for new boards", onChange: (v) => ((S.placeState = v), renderLeft()) }));
    body.append(st);
  }
  if (!cat?.screens?.length) {
    body.append(h(`<div class="pempty"><b>${cat ? "This prototype doesn't list its screens" : "Its screens show once a board has loaded"}</b>${cat ? "Pick a board's screen in Design, or describe the screens with window.workshopEnv (see the README)." : "Open a page with a board of it; the Workshop reads the screens, states and flows the prototype offers."}</div>`));
    return;
  }
  const groups = new Map();
  for (const s of cat.screens) {
    if (!groups.has(s.group)) groups.set(s.group, []);
    groups.get(s.group).push(s);
  }
  const placed = (name) => boardsOf(env.id).filter((b) => (b.screen || null) === name && (b.state || "Default") === (S.placeState || "Default"));
  for (const [g, list] of groups) {
    const grp = h(`<div class="sgrp"><div class="sgh"><span>${esc(g)}</span><span class="sp"></span><button type="button">Place all</button></div></div>`);
    grp.querySelector("button").onclick = async () => {
      let n = 0;
      for (const s of list) if (!placed(s.name).length && (await placeScreen(env.id, s.name, S.placeState))) n++;
      toast(n ? `Placed ${plural(n, "screen")}` : "They're all on this page", n ? `${g} · ${pageName(env)}` : "");
      if (n) setTimeout(() => fit(), 80);
    };
    for (const s of list) {
      const n = placed(s.name).length;
      const r = h(`<div class="srow" role="button" tabindex="0" draggable="true" title="${esc(s.name)}">${g === "Flows" ? IC.play : IC.frame}<span class="t">${esc(s.name.replace(/^Settings › /, ""))}</span>${n ? `<span class="tct" title="On this page">${n}</span>` : ""}<button type="button" class="ib24 add" aria-label="Place ${esc(s.name)}">${IC.plus}</button></div>`);
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
  foot.append(h(`<div class="hint2" style="border-top:1px solid var(--border-subtle)">Click a screen to place it, or drag it onto the canvas.</div>`));
}

// ----- notes: every annotation and comment on this page -----
function renderNotes(head, body, env) {
  const tg = segmented([{ label: "This page", value: false }, { label: "All", value: true }], S.notesAll, (v) => ((S.notesAll = v), renderLeft()), { label: "Which notes" });
  head.append(tg);
  const fam = new Set(familyOf(rootOf(env.id)?.id).map((x) => x.env.id));
  const where = (pg) => (S.notesAll ? fam.has(pg) : pg === env.id);
  const list = [];
  for (const c of S.comments.filter((c) => !c.parent && (S.showResolved || !c.resolved) && where(c.env))) list.push({ kind: "cmt", at: c.createdAt, page: c.env, text: c.text, who: c.author, done: c.resolved, go: () => fire("open-thread", c.id), n: S.comments.filter((r) => r.parent === c.id).length });
  for (const n of itemsOf("note").filter((n) => where(pageOf(n)))) list.push({ kind: "note", at: n.createdAt, page: pageOf(n), text: n.text || "Empty note", who: n.author, go: () => fire("go-item", n.id) });
  for (const x of itemsOf("box").filter((x) => where(pageOf(x)))) list.push({ kind: "box", at: x.createdAt, page: pageOf(x), text: x.label || "Highlight", who: x.author, go: () => fire("go-item", x.id) });
  list.sort((a, b) => String(b.at).localeCompare(String(a.at)));
  if (!list.length) body.append(h(`<div class="pempty"><b>No notes ${S.notesAll ? "yet" : "on this page"}</b>Pin a note (N), draw a highlight around something (B), connect things with an arrow (A) or comment on a board (C). Agents read all of them.</div>`));
  else {
    const feed = h(`<div class="feed"></div>`);
    for (const x of list) {
      const icon = x.kind === "cmt" ? IC.cmt : x.kind === "box" ? IC.box : IC.note;
      const f = h(`<div class="fi${x.done ? " done" : ""}" role="button" tabindex="0"><span class="k ${x.kind}">${icon}</span><span class="tx"><p>${esc(x.text)}</p><span>${esc(x.who || "You")} · ${esc(timeAgo(x.at))}${S.notesAll && x.page ? ` · ${esc(pageName(S.envs.get(x.page)))}` : ""}${x.n ? ` · ${plural(x.n, "reply", "replies")}` : ""}${x.done ? " · resolved" : ""}</span></span></div>`);
      f.onclick = x.go;
      f.onkeydown = (e) => e.key === "Enter" && x.go();
      feed.append(f);
    }
    body.append(feed);
  }
  const rs = S.comments.filter((c) => !c.parent && c.resolved && where(c.env)).length;
  if (rs || S.showResolved) {
    const b = h(`<button type="button" class="ghbtn sm" style="margin:8px">${S.showResolved ? "Hide resolved" : `Show resolved · ${rs}`}</button>`);
    b.onclick = () => ((S.showResolved = !S.showResolved), markDirty(), renderLeft());
    body.append(b);
  }
}

// ----- history: versions of this page, and branches merged into the prototype -----
// The brief: what every agent reads first. It belongs to the prototype; its branches read it.
function briefSec(env) {
  const root = rootOf(env.id) || env; // the brief and decisions belong to the prototype
  const L = sec("Brief", root.brief ? `<span class="tct">${root.brief.length > 999 ? `${Math.round(root.brief.length / 1000)}k` : root.brief.length}</span>` : "");
  if (root.id !== env.id) {
    L.append(h(`<span class="lineage">Agents here read the brief of ${esc(root.name)}${root.brief ? `: “${esc(root.brief.slice(0, 120))}${root.brief.length > 120 ? "…" : ""}”` : ". It has none yet."}</span>`));
    return L;
  }
  L.append(h(`<span class="lineage">What every agent reads first: what this is for, the design rules, and what to keep.</span>`));
  const ta = h(`<textarea class="afld-ta" aria-label="Brief" maxlength="20000" style="min-height:88px" placeholder="What it's for and who uses it. Which design system to keep to. What must not change.">${esc(root.brief || "")}</textarea>`);
  ta.addEventListener("blur", async () => {
    if (ta.value !== (root.brief || "")) (await patchEnv(root.id, { brief: ta.value })) && toast("Saved the brief", "Agents read it before every request");
  });
  L.append(ta);
  return L;
}
function decisionsSec(env) {
  const root = rootOf(env.id) || env; // the brief and decisions belong to the prototype
  const ds = (root.decisions || []).slice().reverse();
  if (!ds.length) return null;
  const L = sec("Decisions", `<span class="tct">${ds.length}</span>`);
  L.append(h(`<span class="lineage">Every merge, with why. Agents read the recent ones.</span>`));
  for (const d of ds.slice(0, 20)) {
    const r = h(`<div class="vrow"><span class="tx"><b>${esc(d.branchName)}</b>${d.note ? `<span class="nt">${esc(d.note)}</span>` : ""}<span>${esc(d.author || "You")} · ${esc(timeAgo(d.at))} · ${plural(d.applied || 0, "change")}</span></span></div>`);
    if (d.changes?.length) r.title = d.changes.join("\n");
    L.append(r);
  }
  return L;
}
function renderHistory(head, body, env) {
  const sv = h(`<button type="button" class="dbtn sm">${IC.version}Save</button>`);
  sv.onclick = () => fire("save-version", env.id);
  head.append(sv);
  const vs = S.versions.get(env.id);
  if (!vs) loadVersions(env.id);
  const v = h(`<div class="isec" style="border-bottom:0"></div>`);
  if (vs && !vs.length) v.append(h(`<span class="lineage">No versions yet. Merges and agents save one before they change anything.</span>`));
  for (const x of vs || []) {
    const vr = h(`<div class="vrow"><span class="n">V${x.n}</span><span class="tx"><b title="${esc(x.label)}">${esc(x.label)}</b><span>${esc(x.author || "You")} · ${esc(timeAgo(x.at))}</span></span><span class="va"><button type="button" class="ib24" aria-label="Restore version ${x.n}" data-tip="Restore">${IC.restore}</button><button type="button" class="ib24" aria-label="Copy version ${x.n}" data-tip="Copy as a new prototype">${IC.copy}</button></span></div>`);
    const [rb, fb] = vr.querySelectorAll(".ib24");
    rb.onclick = () => fire("restore-version", { id: env.id, n: x.n });
    fb.onclick = () => fire("fork-version", { id: env.id, n: x.n });
    v.append(vr);
  }
  body.append(v);
  const dec = decisionsSec(env);
  if (dec) body.append(h(`<div class="pdiv"></div>`), dec);
  const merged = familyOf(rootOf(env.id)?.id).map((x) => x.env).filter((e) => e.archived);
  if (merged.length) {
    body.append(h(`<div class="pdiv"></div>`), h(`<div class="shd"><span>Merged and archived</span><span class="n">${merged.length}</span></div>`));
    const list = h(`<div class="pgs"></div>`);
    for (const e of merged) {
      const r = h(`<div class="pg archived" role="button" tabindex="0">${IC.fork}<span class="t">${esc(e.name)}</span><span class="m">${e.mergedAt ? esc(timeAgo(e.mergedAt)) : "Archived"}</span></div>`);
      r.onclick = () => fire("go", e.id);
      list.append(r);
    }
    body.append(list);
  }
}

// ======================= PAGE BANNER =======================
export function renderBanner() {
  const b = $("banner");
  const env = pageEnv();
  b.replaceChildren();
  b.className = "banner";
  if (!env || S.view !== "proto") return markDirty();
  const parent = isBranch(env) ? S.envs.get(env.parent) : null;
  const add = (html, fn) => {
    const x = h(html);
    if (fn) x.onclick = fn;
    b.querySelector(".acts").append(x);
    return x;
  };
  if (env.archived) {
    b.classList.add("branch");
    b.append(h(IC.fork), h(`<b>${esc(env.name)}</b>`), h(`<span class="meta">${env.mergedAt ? `Merged into ${esc(S.envs.get(env.mergedInto)?.name ? pageName(S.envs.get(env.mergedInto)) : "its parent")} · ${esc(timeAgo(env.mergedAt))}` : "Archived"}</span>`), h(`<span class="vsep"></span>`), h(`<span class="acts"></span>`));
    add(`<button type="button" class="dbtn sm">Unarchive</button>`, () => fire("unarchive", env.id));
    if (parent) add(`<button type="button" class="ghbtn sm">Open ${esc(pageName(parent))}</button>`, () => fire("go", parent.id));
  } else if (parent) {
    b.classList.add("branch");
    const d = S.diffs.get(env.id);
    const parts = [`Branch of ${esc(pageName(parent))}`];
    if (d) {
      parts.push(d.changes.length ? `<span class="ch">${plural(d.changes.length, "change")}</span>` : "no changes yet");
      if (d.conflicts) parts.push(`<span class="cf">${plural(d.conflicts, "conflict")}</span>`);
      if (d.behind) parts.push(`${d.behind} behind`);
    }
    b.append(h(IC.fork), h(`<b title="${esc(env.name)}">${esc(env.name)}</b>`), h(`<span class="meta">${parts.join(" · ")}</span>`), h(`<span class="vsep"></span>`), h(`<span class="acts"></span>`));
    const cmp = add(`<button type="button" class="ghbtn sm" aria-pressed="${S.compare}">${IC.compare}${S.compare ? "Hide compare" : `Compare with ${esc(pageName(parent))}`}</button>`, () => fire("compare"));
    cmp.title = `Show ${pageName(parent)}'s screens above this branch's`;
    if (d?.behind) add(`<button type="button" class="dbtn sm">Update from ${esc(pageName(parent))}</button>`, () => fire("update-from-main", env.id));
    const rv = add(`<button type="button" class="createbtn sm">Review and merge</button>`, () => fire("review", env.id));
    rv.disabled = !!d && !d.changes.length;
  } else {
    const kids = envList().filter((e) => e.parent === env.id && !e.archived).length;
    b.append(h(IC.board), h(`<b>Main</b>`), h(`<span class="meta">${esc(env.name)} · ${plural(boardsOf(env.id).length, "screen")}${kids ? ` · ${plural(kids, "open branch", "open branches")}` : ""}</span>`), h(`<span class="vsep"></span>`), h(`<span class="acts"></span>`));
    add(`<button type="button" class="dbtn sm">${IC.fork}Create branch</button>`, () => fire("branch", env.id));
  }
  markDirty();
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
  for (const x of document.querySelectorAll("#rTabs button")) {
    x.classList.toggle("on", x.dataset.t === S.rightTab);
    x.setAttribute("aria-selected", String(x.dataset.t === S.rightTab));
  }
  const st = body.scrollTop;
  const ae = document.activeElement;
  const focusK = body.contains(ae) ? ae.dataset?.k : null;
  body.replaceChildren();
  if (!pageEnv()) return;
  if (S.rightTab === "design") renderDesignInto(body);
  else renderProto(body);
  body.scrollTop = st;
  if (focusK) [...body.querySelectorAll("[data-k]")].find((x) => x.dataset.k === focusK)?.focus();
}
export function renderDesign() {
  if (S.rightTab === "design") renderRight();
}
function renderDesignInto(body) {
  const s = S.sel;
  if (!s) return designPage(body, pageEnv());
  if (s.kind === "multi") return designMulti(body, selIds());
  if (s.kind === "board") return designBoard(body, s.item);
  if (s.kind === "el") return designEl(body, s);
  return designAnnotation(body, s.item);
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

const fmt = (v, key = "") => (v === null || v === undefined || v === "" ? (key.startsWith("variant:") ? "default" : key.startsWith("text:") ? "original text" : "none") : String(v));
function designPage(body, env) {
  const id = env.id;
  const branch = isBranch(env);
  const parent = branch ? S.envs.get(env.parent) : null;
  const t = h(`<div class="isec"><div class="ih"><b>Page</b><span class="tagro${branch ? " info" : ""}">${branch ? "Branch" : "Main"}</span></div><div class="ititle"><div class="afld-in"><input aria-label="Name" value="${esc(env.name)}" maxlength="120"></div><span class="pth">${env.linked ? `<span class="tagro ok" title="Agents and merges edit these files in place">In place</span>` : ""}<span title="${esc(env.folder || "")}">${esc(folderLabel(env))}</span><button type="button" class="ib24" aria-label="Copy folder path" data-tip="Copy path">${IC.copy}</button></span></div></div>`);
  const inp = t.querySelector("input");
  inp.addEventListener("keydown", (e) => (e.key === "Enter" && inp.blur(), e.key === "Escape" && ((inp.value = env.name), inp.blur())));
  inp.addEventListener("blur", async () => {
    const v = inp.value.trim();
    if (v && v !== env.name) await patchEnv(id, { name: v });
    else inp.value = env.name;
  });
  t.querySelector(".ib24").onclick = () => copyText(env.folder || "");
  body.append(t);
  body.append(briefSec(env));
  if (branch) {
    const L = sec("Changes on this branch");
    L.append(h(`<div class="lineage"><span>Branch of <b>${esc(pageName(parent))}</b>, made ${esc(timeAgo(env.branch?.at || env.created))}${env.author ? ` by ${esc(env.author)}` : ""}. It reads ${esc(pageName(parent))}'s files until it changes them.</span></div>`));
    if (env.archived) {
      L.append(h(`<div class="shnote">${IC.info}<div><b>${env.mergedAt ? `Merged into ${esc(pageName(S.envs.get(env.mergedInto)) || "its parent")}` : "Archived"}</b><br><span>${env.mergedAt ? esc(timeAgo(env.mergedAt)) : "Hidden from the branch list."}</span></div></div>`));
      const un = h(`<button type="button" class="dbtn sm" style="align-self:flex-start">Unarchive</button>`);
      un.onclick = () => fire("unarchive", id);
      L.append(un);
    } else {
      const d = S.diffs.get(id);
      if (!d) loadDiff(id);
      L.querySelector(".ih").append(h(`<span class="tct">${d ? d.changes.length : ""}</span>`));
      if (d?.changes.length) {
        const ch = h(`<div class="chg"></div>`);
        for (const c of d.changes.slice(0, 12)) ch.append(h(`<div class="r${c.conflict ? " cf" : ""}"><b>${esc(c.label)}</b><span>${c.kind === "file" ? "Changed on the branch" : `<del>${esc(fmt(c.main, c.key))}</del> → <ins>${esc(fmt(c.branch, c.key))}</ins>`}</span></div>`));
        if (d.changes.length > 12) ch.append(h(`<div class="r"><span>and ${d.changes.length - 12} more</span></div>`));
        L.append(ch);
      } else if (d) L.append(h(`<span class="lineage">Nothing yet. Change a token, a variant, some text or a file here, or ask an agent, and it shows up to review.</span>`));
      const acts = h(`<div style="display:flex;gap:8px;flex-wrap:wrap"></div>`);
      const rv = h(`<button type="button" class="createbtn sm" ${d && d.changes.length ? "" : "disabled"}>Review and merge</button>`);
      rv.onclick = () => fire("review", id);
      const cmp = h(`<button type="button" class="dbtn sm">${IC.compare}${S.compare ? "Hide compare" : "Compare"}</button>`);
      cmp.onclick = () => fire("compare");
      acts.append(rv, cmp);
      if (d?.behind) {
        const up = h(`<button type="button" class="dbtn sm">Update from ${esc(pageName(parent))}</button>`);
        up.onclick = () => fire("update-from-main", id);
        acts.append(up);
      }
      L.append(acts);
    }
    body.append(L);
  } else {
    const kids = envList().filter((e) => e.parent === id && !e.archived);
    const L = sec("Branches", `<span class="tct">${kids.length || ""}</span>`);
    L.append(h(`<span class="lineage">Main only changes when you merge a branch. Try ideas on branches; agents work on them too.</span>`));
    for (const k of kids) {
      const m = pageMeta(k);
      const r = h(`<div class="pg" role="button" tabindex="0" style="margin:0 -8px">${IC.fork}<span class="t">${esc(k.name)}</span><span class="m ${m.cls}">${esc(m.title || m.t)}</span></div>`);
      r.onclick = () => fire("go", k.id);
      L.append(r);
      if (!S.diffs.has(k.id)) loadDiff(k.id);
    }
    const br = h(`<button type="button" class="dbtn sm" style="align-self:flex-start">${IC.fork}Create branch</button>`);
    br.onclick = () => fire("branch", id);
    L.append(br);
    body.append(L);
  }
  const counts = sec("On this page");
  const nNotes = pageItems("note").length + pageItems("box").length + pageItems("arrow").length;
  const nCm = S.comments.filter((c) => !c.parent && !c.resolved && c.env === id).length;
  counts.append(h(`<div class="xyrow"><span class="xy"><i>Screens</i>${boardsOf(id).length}</span><span class="xy"><i>Notes</i>${nNotes + nCm}</span></div>`));
  body.append(counts);
  const del = h(`<div class="isec" style="display:flex;flex-direction:row;flex-wrap:wrap;gap:8px">${branch && !env.archived ? `<button type="button" class="dbtn sm" data-a="arch">Archive</button>` : ""}<button type="button" class="dbtn sm err" data-a="del">${IC.trash}${env.linked ? "Remove from Atelier" : `Delete ${branch ? "branch" : "prototype"}`}</button></div>`);
  del.querySelector('[data-a="del"]').onclick = () => fire("delete", id);
  const ar = del.querySelector('[data-a="arch"]');
  if (ar) ar.onclick = () => fire("archive", id);
  body.append(del);
}

// several boards and annotations: line them up
const AL = (d) => `<svg class="ic" viewBox="0 0 16 16" aria-hidden="true">${d}</svg>`;
const ALIGN = [
  ["left", "Align left · ⌥A", AL('<path d="M2.5 2v12"/><rect x="5" y="4" width="8" height="3" rx=".5"/><rect x="5" y="9" width="5" height="3" rx=".5"/>')],
  ["hcenter", "Align centre · ⌥H", AL('<path d="M8 2v12"/><rect x="3" y="4" width="10" height="3" rx=".5"/><rect x="5" y="9" width="6" height="3" rx=".5"/>')],
  ["right", "Align right · ⌥D", AL('<path d="M13.5 2v12"/><rect x="3" y="4" width="8" height="3" rx=".5"/><rect x="6" y="9" width="5" height="3" rx=".5"/>')],
  ["top", "Align top · ⌥W", AL('<path d="M2 2.5h12"/><rect x="4" y="5" width="3" height="8" rx=".5"/><rect x="9" y="5" width="3" height="5" rx=".5"/>')],
  ["vcenter", "Align middle · ⌥V", AL('<path d="M2 8h12"/><rect x="4" y="3" width="3" height="10" rx=".5"/><rect x="9" y="5" width="3" height="6" rx=".5"/>')],
  ["bottom", "Align bottom · ⌥S", AL('<path d="M2 13.5h12"/><rect x="4" y="3" width="3" height="8" rx=".5"/><rect x="9" y="6" width="3" height="5" rx=".5"/>')],
];
function designMulti(body, ids) {
  const its = ids.map((id) => S.items.get(id)).filter(Boolean);
  const n = (t) => its.filter((i) => i.type === t).length;
  const parts = [n("board") && plural(n("board"), "board"), n("note") && plural(n("note"), "note"), n("box") && plural(n("box"), "highlight"), n("arrow") && plural(n("arrow"), "arrow")].filter(Boolean);
  const t = h(`<div class="isec"><div class="ititle"><span class="nm">${plural(its.length, "item")} selected</span><span class="pth"><span>${esc(parts.join(" · "))}</span></span></div></div>`);
  body.append(t);
  const A = sec("Align");
  const bar = h(`<div class="albar" role="toolbar" aria-label="Align"></div>`);
  for (const [k, tip, ic] of ALIGN) {
    const b = h(`<button type="button" class="ib32" aria-label="${esc(tip)}" data-tip="${esc(tip)}">${ic}</button>`);
    b.onclick = () => alignSel(k);
    bar.append(b);
  }
  A.append(bar);
  const dist = h(`<div style="display:flex;gap:8px;flex-wrap:wrap"><button type="button" class="dbtn sm" data-a="h" ${its.length < 3 ? "disabled" : ""}>Distribute horizontally</button><button type="button" class="dbtn sm" data-a="v" ${its.length < 3 ? "disabled" : ""}>Distribute vertically</button></div>`);
  dist.querySelector('[data-a="h"]').onclick = () => distributeSel("h");
  dist.querySelector('[data-a="v"]').onclick = () => distributeSel("v");
  A.append(dist);
  body.append(A);
  const acts = h(`<div class="isec"><div style="display:flex;gap:8px;flex-wrap:wrap"><button type="button" class="dbtn sm" data-a="dup">${IC.copy}Duplicate</button><button type="button" class="dbtn sm err" data-a="del">${IC.trash}Delete</button></div><span class="lineage">Drag any of them to move them all; arrow keys nudge. Shift-click adds or removes one.</span></div>`);
  acts.querySelector('[data-a="dup"]').onclick = () => duplicateSel();
  acts.querySelector('[data-a="del"]').onclick = () => removeItems(ids);
  body.append(acts);
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
  const t = h(`<div class="isec"><div class="ih"><b>Frame</b><button type="button" class="ib24" aria-label="Open in a new tab" data-tip="Open in a new tab">${IC.ext}</button></div><div class="ititle"><span class="nm">${esc(screenName(b))}</span></div></div>`);
  t.querySelector(".ib24").onclick = () => window.open(`/env/${b.env}/?ws-screen=${encodeURIComponent(b.screen || "")}`, "_blank", "noopener");
  const screens = ad?.screens?.length ? ad.screens : env.catalog?.screens || rootOf(env.id)?.catalog?.screens || [];
  if (screens.length) {
    const opts = [{ label: "Its start screen", value: "" }, ...screens.map((x) => ({ group: x.group, label: x.name.replace("Settings › ", ""), value: x.name }))];
    t.append(row("Screen", dropdown({ value: b.screen || "", options: opts, full: true, label: "Screen", onChange: async (v) => {
      const next = await api(`canvas/items/${bid}`, { method: "PATCH", body: { screen: v || null } }).catch((e) => toast("Couldn't change the screen", e.message));
      if (next) (S.items.set(bid, next), reloadBoard(bid), markDirty(), renderDesign(), renderLeft());
    } })));
  }
  const states = ad?.states?.length ? ad.states : env.catalog?.states || [];
  if (states.length) {
    t.append(row("State", dropdown({ value: b.state || "Default", options: states, full: true, label: "State", onChange: async (v) => {
      const next = await api(`canvas/items/${bid}`, { method: "PATCH", body: { state: v === "Default" ? null : v } }).catch((e) => toast("Couldn't change the state", e.message));
      if (next) (S.items.set(bid, next), reloadBoard(bid), markDirty(), renderDesign(), renderLeft());
    } })));
  }
  body.append(t);
  const L = sec("Layout");
  const cur = DEVICES.find((d) => d.w === b.w && d.h === b.h);
  L.append(row("Size", dropdown({ value: cur ? `${cur.w}x${cur.h}` : "custom", options: [...DEVICES.map((d) => ({ label: d.label, value: `${d.w}x${d.h}` })), ...(cur ? [] : [{ label: `Custom · ${b.w} × ${b.h}`, value: "custom" }])], full: true, label: "Size", onChange: async (v) => {
    if (v === "custom") return;
    const [w, hh] = v.split("x").map(Number);
    const next = await api(`canvas/items/${bid}`, { method: "PATCH", body: { w, h: hh } }).catch((e) => toast("Couldn't resize", e.message));
    if (next) (S.items.set(bid, next), sync(), renderDesign());
  } })));
  L.append(h(`<div class="xyrow"><span class="xy"><i>X</i>${b.x}</span><span class="xy"><i>Y</i>${b.y}</span><span class="xy"><i>W</i>${b.w}</span><span class="xy"><i>H</i>${b.h}</span></div>`));
  body.append(L);
  if (ad?.screen) body.append(h(`<div class="isec"><span class="lineage">Showing ${esc(ad.screen)} now. Turn on Interact (P) to click through it.</span></div>`));
  const acts = h(`<div class="isec"><div style="display:flex;gap:8px;flex-wrap:wrap"><button type="button" class="dbtn sm" data-a="pr">${IC.play}Present</button><button type="button" class="dbtn sm" data-a="dup">${IC.copy}Duplicate</button><button type="button" class="dbtn sm" data-a="agent">${IC.spark}Ask</button></div></div>`);
  acts.querySelector('[data-a="dup"]').onclick = () => placeScreen(b.env, b.screen, b.state).then((it) => it && selectBoard(it.id));
  acts.querySelector('[data-a="pr"]').onclick = () => fire("present", bid);
  acts.querySelector('[data-a="agent"]').onclick = () => fire("ask-agent", {});
  body.append(acts);
}

// ----- prototype: how this page runs -----
function renderProto(body) {
  const env = pageEnv();
  envSettings(body, env);
  const cat = env.catalog?.screens?.length ? env.catalog : rootOf(env.id)?.catalog;
  const flows = (cat?.screens || []).filter((s) => s.group === "Flows");
  if (flows.length) {
    const F = sec("Flows", `<span class="tct">${flows.length}</span>`);
    for (const f of flows) {
      const r = h(`<div class="vrow"><span class="tx"><b>${esc(f.name)}</b><span>Starts the flow from its first step</span></span><span class="va" style="opacity:1;pointer-events:auto"><button type="button" class="ib24" aria-label="Place ${esc(f.name)}" data-tip="Place on the canvas">${IC.plus}</button><button type="button" class="ib24" aria-label="Play ${esc(f.name)}" data-tip="Play in a new tab">${IC.play}</button></span></div>`);
      const [pl, play] = r.querySelectorAll(".ib24");
      pl.onclick = () => placeScreen(env.id, f.name).then((it) => it && (selectBoard(it.id), focusItem(it.id, { maxZ: 0.6 })));
      play.onclick = () => window.open(`/present/${env.id}/?screen=${encodeURIComponent(f.name)}`, "_blank", "noopener");
      F.append(r);
    }
    body.append(F);
  }
  const I = sec("Interact");
  const sw = h(`<div class="setrow"><div class="tx"><span style="font-size:12px;line-height:1.5">Use the prototype on the canvas: clicks and typing go to the page. <b style="font-weight:500">P</b> switches.</span></div><button type="button" class="sw" role="switch" aria-checked="${S.mode === "prototype"}" aria-label="Interact"><i></i></button></div>`);
  sw.querySelector(".sw").onclick = () => setMode(S.mode === "design" ? "prototype" : "design");
  I.append(sw);
  body.append(I);
  const P = sec("Present and share");
  const acts = h(`<div style="display:flex;gap:8px;flex-wrap:wrap"><button type="button" class="dbtn sm" data-a="pr">${IC.play}Present</button><button type="button" class="dbtn sm" data-a="sh">${IC.share}Share</button><button type="button" class="dbtn sm" data-a="tab">${IC.ext}New tab</button></div>`);
  acts.querySelector('[data-a="pr"]').onclick = () => fire("present", S.sel?.kind === "board" ? S.sel.item : pageItems("board")[0]?.id);
  acts.querySelector('[data-a="sh"]').onclick = () => fire("share", env.id);
  acts.querySelector('[data-a="tab"]').onclick = () => window.open(`/present/${env.id}/`, "_blank", "noopener");
  P.append(acts);
  body.append(P);
}

function envSettings(body, env) {
  const cat = env.catalog?.variants?.length ? env.catalog : rootOf(env.id)?.catalog || env.catalog;
  const e1 = sec("Theme and variants");
  e1.append(h(`<span class="lineage" style="margin-top:-4px">Every screen on ${esc(pageName(env))} shows these.${!isBranch(env) ? " To compare one, create a branch and change it there." : ""}</span>`));
  e1.append(row("Theme", segmented([{ label: "Light", value: "light" }, { label: "Dark", value: "dark" }, { label: "System", value: "system" }], env.theme, async (v) => {
    for (const r of boardsLive(env.id)) r.setTheme(v);
    await patchEnv(env.id, { theme: v });
  }, { full: true, label: "Theme" })));
  const live = boardsLive(env.id)[0];
  const variants =
    (() => {
      try {
        return live?.adapter()?.variants || null;
      } catch {
        return null;
      }
    })() ||
    cat?.variants?.map((v) => ({ ...v, value: env.variants?.[v.label] || v.options[0] })) ||
    [];
  for (const x of variants) {
    e1.append(row(x.label, dropdown({ value: env.variants?.[x.label] || x.value, options: x.options, full: true, label: x.label, onChange: async (o) => {
      for (const r of boardsLive(env.id)) r.setVariant(x.label, o);
      await patchEnv(env.id, { variants: { [x.label]: o } });
      setTimeout(renderRight, 60);
    } }), true));
  }
  body.append(e1);
}

// the prototype's colours, as the prototype shows them in its current theme — not the editor's
function swatches(set, current, onPick) {
  const dark = set === FILL || set === INK ? pageEnv()?.theme === "dark" : false; // a prototype's own palette is read in its current theme
  const w = h(`<div class="sws" role="radiogroup"></div>`);
  for (const t of set) {
    const fill = (dark && t.hex[1]) || t.hex[0];
    const b = h(`<button type="button" class="swc${t.name === "none" ? " none" : ""}${current?.name === t.name ? " on" : ""}" role="radio" aria-checked="${current?.name === t.name}" aria-label="${esc(t.name)}" title="${esc(t.name)}" style="${t.name === "none" ? "" : `background:${fill}`}"></button>`);
    b.onclick = () => onPick(t);
    w.append(b);
  }
  return w;
}

// ----- an element, edited like a frame: Position, Layout, Appearance, Typography, Fill, Stroke, Effects -----
const STROKE = [
  { name: "border-subtle", css: "var(--border-subtle, #e9eaea)", hex: ["#e9eaea", "#2a2927"] },
  { name: "border-default", css: "var(--border-default, #c8cbcb)", hex: ["#c8cbcb", "#3a3936"] },
  { name: "text-primary", css: "var(--text-primary, #161a1b)", hex: ["#161a1b", "#ecebe8"] },
  { name: "text-accent", css: "var(--text-accent, #5266ba)", hex: ["#5266ba", "#95a6f2"] },
  { name: "text-error", css: "var(--text-error, #c00c30)", hex: ["#c00c30", "#ff6b85"] },
];
const SHADOWS = [
  { label: "None", value: "none", css: null },
  { label: "Small", value: "sh-sm", css: "var(--sh-sm, 0 1px 2px rgba(22,26,27,.06))" },
  { label: "Medium", value: "sh-md", css: "var(--sh-md, 0 4px 16px rgba(22,26,27,.09))" },
];
const LEADING = [1.2, 1.3, 1.45, 1.5];

// A DialKit-style number bar: the label and the value sit inside it. With a range, the bar fills to
// the value and a click or drag anywhere sets it; without one, dragging scrubs from where it was.
// Type a value (click it, or focus and type), step with the arrow keys (Shift ×10), Esc cancels.
// It previews while you drag or step, and saves when you let go.
function numField(label, value, { onLive, onCommit, onCancel, step = 1, min = -100000, max = 100000, range = null, suffix = "", title = label, k = label, icon = "" } = {}) {
  const v0 = Number.isFinite(+value) ? Math.round(+value * 100) / 100 : 0;
  const w = h(`<label class="nf${range ? " slider" : ""}" title="${esc(title)}">${range ? '<span class="fill"></span><span class="knob"></span>' : ""}<span class="l" aria-hidden="true">${icon || esc(label)}</span><input type="text" inputmode="decimal" spellcheck="false" autocomplete="off" data-k="${esc(k)}" aria-label="${esc(title)}"${range ? ` role="slider" aria-valuemin="${range[0]}" aria-valuemax="${range[1]}"` : ""}><span class="u">${esc(suffix)}</span></label>`);
  const inp = w.querySelector("input");
  const fill = w.querySelector(".fill"),
    knob = w.querySelector(".knob");
  let last = v0;
  let timer = 0;
  const fix = (n) => clamp(Math.round(n / step) * step, range ? range[0] : min, range ? range[1] : max);
  const show = (n) => {
    inp.value = String(n);
    if (range) {
      const pos = (v) => clamp((v - range[0]) / (range[1] - range[0] || 1), 0, 1) * 100;
      const f = pos(n);
      // a range across zero fills from zero, so 0° reads as empty, not half full
      const z = range[0] < 0 && range[1] > 0 ? pos(0) : 0;
      fill.style.left = `${Math.min(z, f)}%`;
      fill.style.width = `${Math.abs(f - z)}%`;
      knob.style.left = `${f}%`;
      inp.setAttribute("aria-valuenow", String(n));
    }
  };
  show(v0);
  const commit = (n) => {
    clearTimeout(timer);
    n = fix(n);
    show(n);
    if (n === last) return;
    last = n;
    onCommit?.(n);
  };
  inp.addEventListener("keydown", (e) => {
    e.stopPropagation();
    if (e.key === "Enter") {
      e.preventDefault();
      const n = parseFloat(inp.value);
      if (Number.isFinite(n)) commit(n);
      else show(last);
    } else if (e.key === "Escape") {
      show(last);
      onCancel?.();
      inp.blur();
    } else if (e.key === "ArrowUp" || e.key === "ArrowDown" || (range && (e.key === "ArrowLeft" || e.key === "ArrowRight") && inp.selectionStart === inp.value.length)) {
      e.preventDefault();
      const up = e.key === "ArrowUp" || e.key === "ArrowRight";
      const n = fix((parseFloat(inp.value) || 0) + (up ? 1 : -1) * step * (e.shiftKey ? 10 : 1));
      show(n);
      onLive?.(n);
      clearTimeout(timer);
      timer = setTimeout(() => commit(n), 450);
    }
  });
  inp.addEventListener("change", () => {
    const n = parseFloat(inp.value);
    if (Number.isFinite(n)) commit(n);
    else show(last);
  });
  inp.addEventListener("focus", () => inp.select());
  // drag on the bar (anywhere but the number itself, which is for typing)
  w.addEventListener("pointerdown", (e) => {
    if (e.target === inp || e.button !== 0) return;
    e.preventDefault();
    const r = w.getBoundingClientRect();
    const x0 = e.clientX,
      base = parseFloat(inp.value) || 0;
    let n = base,
      moved = false;
    const at = (cx) => (range ? fix(range[0] + clamp((cx - r.left) / r.width, 0, 1) * (range[1] - range[0])) : fix(base + Math.round((cx - x0) / 2) * step));
    const mv = (ev) => {
      if (!moved && Math.abs(ev.clientX - x0) < 2 && !range) return;
      moved = true;
      w.classList.add("dragging");
      n = at(ev.clientX);
      show(n);
      onLive?.(n);
    };
    const up = (ev) => {
      removeEventListener("pointermove", mv);
      removeEventListener("pointerup", up);
      w.classList.remove("dragging");
      // a click on a slider jumps there; a click on a plain number starts typing
      if (!moved) {
        if (range) (n = at(ev.clientX)), commit(n);
        else inp.focus();
        return;
      }
      if (n !== base) commit(n);
    };
    addEventListener("pointermove", mv);
    addEventListener("pointerup", up);
  });
  return w;
}
const g2 = (...kids) => {
  const g = h(`<div class="g2"></div>`);
  g.append(...kids);
  return g;
};
function switchRow(text, on, onChange) {
  const r = h(`<div class="setrow"><div class="tx"><span style="font-size:12px;color:var(--text-primary)">${esc(text)}</span></div><button type="button" class="sw" role="switch" aria-checked="${on}" aria-label="${esc(text)}"><i></i></button></div>`);
  r.querySelector(".sw").onclick = () => onChange(!on);
  return r;
}

function designEl(body, s) {
  const i = s.info || {};
  const st = i.styles || {};
  const env = S.envs.get(s.env);
  const id = s.item,
    el = s.el;
  const { fill: FILLS, ink: INKS_ } = paletteOf(el?.ownerDocument);
  const exact = i.exactSelector || exactSel(id, el);
  const sel = S.scope === "exact" ? exact : i.selector || exact;
  const targets = () => {
    if (S.scope === "exact") return [el];
    try {
      const all = [...docOf(id).querySelectorAll(i.selector)];
      return all.length ? all : [el];
    } catch {
      return [el];
    }
  };
  // write a change: to this element, or to all like it; position always to this one
  const set = (props, what, exactOnly = false) => commitRules(s.env, [{ selector: exactOnly ? exact : sel, props }], what);
  const field = (label, value, toProps, what, o = {}) =>
    numField(label, value, {
      ...o,
      k: o.k || label,
      onLive: (n) => preview(o.exactOnly ? [el] : targets(), toProps(n)),
      onCommit: async (n) => {
        const props = toProps(n);
        await set(props, what, o.exactOnly);
        endPreview(o.exactOnly ? [el] : targets(), Object.keys(props));
      },
      onCancel: () => endPreview(o.exactOnly ? [el] : targets(), Object.keys(toProps(value))),
    });
  // header: what it is, where it sits, and what an edit applies to
  const t = h(`<div class="isec"><div class="ititle"><span class="nm">${esc(i.label || el.localName)}</span><span class="pth"><span>${esc(pageName(env))} · ${esc(screenName(S.items.get(id)))}</span></span></div><div class="crumbs"></div></div>`);
  const chain = [];
  for (let x = el; x && x.parentElement && chain.length < 4; x = x.parentElement) chain.unshift(x);
  for (const x of chain) {
    const b = h(`<button type="button" class="${x === el ? "cur" : ""}">${esc(rt(id)?.label(x) || x.localName)}</button>`);
    b.onclick = () => selectEl(id, x);
    b.onpointerenter = () => setHover(id, x);
    b.onpointerleave = () => setHover(null, null);
    t.querySelector(".crumbs").append(b);
  }
  if (i.matches > 1) t.append(segmented([{ label: "This element", value: "exact" }, { label: `All ${i.matches} like it`, value: "class" }], S.scope, (v) => ((S.scope = v), renderDesign(), fire("scope")), { full: true, label: "Apply changes to" }));
  if (env && !isBranch(env)) t.append(h(`<span class="lineage">Changes go straight to main. Create a branch to try them first.</span>`));
  body.append(t);

  const r = i.rect || {};
  const flow = flowOf(id, el);
  const pcs = flow.pcs;
  const pflex = !!pcs && /flex/.test(pcs.display);
  const prow = pflex && !/column/.test(pcs.flexDirection);
  const pcol = pflex && !prow;

  // Position — from where the page puts it, with translate; rotation
  const P = sec("Position", flow.kind !== "free" ? `<span class="tagro" title="Its parent is an auto layout: drag or use the arrow keys to reorder">In auto layout</span>` : "");
  const tr = parseTranslate(st.translate);
  P.append(
    g2(
      field("X", r.x, (n) => ({ translate: `${tr.x + (n - r.x)}px ${tr.y}px` }), "position", { exactOnly: true }),
      field("Y", r.y, (n) => ({ translate: `${tr.x}px ${tr.y + (n - r.y)}px` }), "position", { exactOnly: true }),
    ),
  );
  const rot = parseFloat(st.rotate) || 0;
  P.append(g2(field("", rot, (n) => ({ rotate: n ? `${n}deg` : null }), "rotation", { exactOnly: true, suffix: "°", range: [-180, 180], title: "Rotation", k: "rotation", icon: '<svg class="ic" viewBox="0 0 16 16"><path d="M3 12.5h10M3 12.5 10 4.5M7.5 12.5a4.5 4.5 0 0 0-1.4-3.3"/></svg>' }), h(`<span></span>`)));
  if (tr.x || tr.y) {
    const rb = h(`<button type="button" class="ghbtn sm" style="align-self:flex-start">${IC.restore}Back to its place</button>`);
    rb.onclick = () => set({ translate: null }, "position", true);
    P.append(rb);
  }
  body.append(P);

  // Layout — auto layout (flex), its size (Fixed / Hug / Fill), padding, clip
  const isFlex = /flex/.test(st.display),
    isGrid = /grid/.test(st.display);
  const L = sec(isFlex ? "Auto layout" : isGrid ? "Grid" : "Layout");
  if (isFlex) {
    const rm = h(`<button type="button" class="ib24" aria-label="Remove auto layout" data-tip="Remove auto layout"><svg class="ic" viewBox="0 0 16 16" aria-hidden="true"><path d="M4 8h8"/></svg></button>`);
    rm.onclick = () => set({ display: "block", "flex-direction": null, "flex-wrap": null, gap: null, "align-items": null, "justify-content": null }, "auto layout");
    L.querySelector(".ih").append(rm);
  } else if (!isGrid) {
    const add = h(`<button type="button" class="ib24" aria-label="Add auto layout" data-tip="Add auto layout">${IC.plus}</button>`);
    add.onclick = () => {
      // lay the children out the way they already sit
      const kids = [...el.children].filter((c) => c.getBoundingClientRect().width);
      const a = kids[0]?.getBoundingClientRect(),
        b = kids[1]?.getBoundingClientRect();
      const row = a && b && b.left >= a.right - 1 && Math.abs(b.top - a.top) < a.height;
      set({ display: "flex", "flex-direction": row ? "row" : "column", gap: "8px" }, "auto layout");
    };
    L.querySelector(".ih").append(add);
  }
  if (isFlex) {
    const wrap = /wrap/.test(st["flex-wrap"]) && !/nowrap/.test(st["flex-wrap"]);
    const dir = wrap ? "wrap" : /column/.test(st["flex-direction"]) ? "column" : "row";
    L.append(
      segmented(
        [
          { label: "Horizontal", value: "row" },
          { label: "Vertical", value: "column" },
          { label: "Wrap", value: "wrap" },
        ],
        dir,
        (v) => set(v === "wrap" ? { "flex-direction": "row", "flex-wrap": "wrap" } : { "flex-direction": v, "flex-wrap": "nowrap" }, "direction"),
        { full: true, label: "Direction" },
      ),
    );
    // alignment: a 3×3 grid, main axis along the direction
    const POS = ["flex-start", "center", "flex-end"];
    const at = (v) => (/center/.test(v) ? 1 : /end|right|bottom/.test(v) ? 2 : /start|left|top|normal|stretch/.test(v) ? 0 : -1);
    const jc = at(st["justify-content"]),
      ai = at(st["align-items"]);
    const vertical = dir === "column";
    const grid = h(`<div class="algrid" role="radiogroup" aria-label="Alignment"></div>`);
    for (let y = 0; y < 3; y++)
      for (let x = 0; x < 3; x++) {
        const main = vertical ? y : x,
          cross = vertical ? x : y;
        const on = main === jc && cross === ai;
        const b = h(`<button type="button" role="radio" aria-checked="${on}" class="${on ? "on" : ""}" aria-label="Align ${["top", "middle", "bottom"][y]} ${["left", "centre", "right"][x]}"></button>`);
        b.onclick = () => set({ "justify-content": POS[main], "align-items": POS[cross] }, "alignment");
        grid.append(b);
      }
    const gapV = px(st.gap);
    const spread = /space-between/.test(st["justify-content"]);
    const gapDD = dropdown({ value: spread ? "auto" : SPACE.includes(gapV) ? gapV : "off", options: [{ label: "Auto · space between", value: "auto" }, ...(SPACE.includes(gapV) || spread ? [] : [{ label: `${gapV} · off system`, value: "off" }]), ...SPACE.map((n) => ({ label: `${n}`, value: n }))], full: true, label: "Gap between items", onChange: (n) => n !== "off" && set(n === "auto" ? { "justify-content": "space-between" } : { gap: `${n}px`, ...(spread ? { "justify-content": "flex-start" } : {}) }, "gap") });
    const side = h(`<div style="display:flex;flex-direction:column;gap:8px;min-width:0"></div>`);
    side.append(row("Gap", gapDD, true));
    const lay = h(`<div class="lay"></div>`);
    lay.append(grid, side);
    L.append(lay);
  } else if (isGrid) {
    const gapV = px(st.gap);
    L.append(row("Gap", dropdown({ value: SPACE.includes(gapV) ? gapV : "off", options: [...(SPACE.includes(gapV) ? [] : [{ label: `${gapV} · off system`, value: "off" }]), ...SPACE.map((n) => ({ label: `${n}`, value: n }))], full: true, label: "Gap", onChange: (n) => n !== "off" && set({ gap: `${n}px` }, "gap") })));
  }
  // size, as Fixed, Hug or Fill
  const cs = (() => {
    try {
      return winOf(id).getComputedStyle(el);
    } catch {
      return null;
    }
  })();
  const n0 = (v) => parseFloat(v) || 0;
  const border = !cs || cs.boxSizing === "border-box";
  const padW = border ? 0 : n0(cs.paddingLeft) + n0(cs.paddingRight) + n0(cs.borderLeftWidth) + n0(cs.borderRightWidth);
  const padH = border ? 0 : n0(cs.paddingTop) + n0(cs.paddingBottom) + n0(cs.borderTopWidth) + n0(cs.borderBottomWidth);
  const own = rulesFor(s.env, [i.selector, exact]).flatMap((x) => x.decls);
  const ownVal = (p) => own.filter(([k]) => k === p).map(([, v]) => v).pop();
  const sizing = (axis) => {
    const p = axis === "w" ? "width" : "height";
    const v = ownVal(p);
    if (v === "fit-content") return "hug";
    if (v === "100%" || (v === undefined && ((axis === "w" && prow) || (axis === "h" && pcol)) && n0(st["flex-grow"]) > 0)) return "fill";
    if (v && /px$/.test(v)) return "fixed";
    if (axis === "w" && !pflex && /^(block|flex|grid|table)$/.test(st.display)) return "fill";
    if ((axis === "w" && pcol) || (axis === "h" && prow)) return /stretch|normal/.test(st["align-self"]) && /stretch|normal/.test(pcs?.alignItems || "") ? "fill" : "hug";
    return "hug";
  };
  const sizeProps = (axis, mode) => {
    const main = (axis === "w" && prow) || (axis === "h" && pcol);
    const cross = (axis === "w" && pcol) || (axis === "h" && prow);
    const p = axis === "w" ? "width" : "height";
    const cur = axis === "w" ? r.w - padW : r.h - padH;
    if (mode === "fixed") return { [p]: `${Math.max(0, Math.round(cur))}px`, ...(main ? { flex: "0 0 auto" } : {}) };
    if (mode === "hug") return { [p]: "fit-content", ...(main ? { flex: "0 0 auto" } : {}), ...(cross ? { "align-self": "flex-start" } : {}) };
    if (main) return { flex: "1 1 0", [p]: null, [`min-${p}`]: "0" };
    if (cross) return { "align-self": "stretch", [p]: null };
    return { [p]: "100%" };
  };
  const SIZING = [
    { label: "Fixed", value: "fixed" },
    { label: "Hug", value: "hug" },
    { label: "Fill", value: "fill" },
  ];
  const wh = (axis) => {
    const p = axis === "w" ? "width" : "height";
    const pad = axis === "w" ? padW : padH;
    const main = (axis === "w" && prow) || (axis === "h" && pcol);
    const f = field(axis.toUpperCase(), axis === "w" ? r.w : r.h, (n) => ({ [p]: `${Math.max(0, n - pad)}px`, ...(main ? { flex: "0 0 auto" } : {}) }), "size", { min: 0, title: axis === "w" ? "Width" : "Height" });
    const dd = dropdown({ value: sizing(axis), options: SIZING, label: `${axis === "w" ? "Width" : "Height"} sizing`, onChange: (m) => set(sizeProps(axis, m), "sizing") });
    dd.classList.add("szdd");
    const g = h(`<div class="whr"></div>`);
    g.append(f, dd);
    return g;
  };
  L.append(wh("w"), wh("h"));
  // padding
  const pads = ["padding-top", "padding-right", "padding-bottom", "padding-left"].map((k) => px(st[k]));
  const spaceDD = (v, label, props) => dropdown({ value: SPACE.includes(v) ? v : "off", options: [...(SPACE.includes(v) ? [] : [{ label: v === "mixed" ? "Mixed" : `${v} · off system`, value: "off" }]), ...SPACE.map((n) => ({ label: `${n}`, value: n }))], full: true, label, onChange: (n) => n !== "off" && set(props(n), "padding") });
  const ph = pads[1] === pads[3] ? pads[1] : "mixed",
    pv = pads[0] === pads[2] ? pads[0] : "mixed";
  const padRow = h(`<div class="g2"></div>`);
  padRow.append(row("Sides", spaceDD(ph, "Horizontal padding", (n) => ({ "padding-left": `${n}px`, "padding-right": `${n}px` }))), row("Top · bottom", spaceDD(pv, "Vertical padding", (n) => ({ "padding-top": `${n}px`, "padding-bottom": `${n}px` }))));
  for (const x of padRow.querySelectorAll(".irow")) x.classList.add("stack");
  L.append(padRow);
  L.append(switchRow("Clip content", /hidden|clip/.test(st.overflow), (v) => set({ overflow: v ? "hidden" : null }, "clipping")));
  body.append(L);

  // Appearance
  const A = sec("Appearance");
  const op = Math.round((parseFloat(st.opacity) || 0) * 100);
  const rad = px(st["border-radius"]);
  const radDD = dropdown({ value: RADII.includes(rad) ? rad : "off", options: [...(RADII.includes(rad) ? [] : [{ label: `${rad} · off system`, value: "off" }]), ...RADII.map((n) => ({ label: `${n}`, value: n }))], full: true, label: "Corner radius", onChange: (n) => n !== "off" && set({ "border-radius": `${n}px` }, "radius") });
  const radWrap = h(`<div class="nfdd" title="Corner radius"><span class="l" aria-hidden="true"><svg class="ic" viewBox="0 0 16 16"><path d="M3.5 12.5V8a4.5 4.5 0 0 1 4.5-4.5h4.5"/></svg></span></div>`);
  radWrap.append(radDD);
  A.append(g2(field("", op, (n) => ({ opacity: n >= 100 ? null : String(n / 100) }), "opacity", { range: [0, 100], title: "Opacity", k: "opacity", suffix: "%", icon: '<svg class="ic" viewBox="0 0 16 16"><circle cx="8" cy="8" r="5"/><path d="M8 3a5 5 0 0 1 0 10Z" fill="currentColor"/></svg>' }), radWrap));
  A.append(switchRow("Visible", st.visibility !== "hidden", (v) => set({ visibility: v ? null : "hidden" }, "visibility")));
  body.append(A);

  // Typography — for elements with text
  if (i.text) {
    const T = sec("Typography");
    const fs = px(st["font-size"]);
    T.append(row("Size", dropdown({ value: SIZES.includes(fs) ? fs : "off", options: [...(SIZES.includes(fs) ? [] : [{ label: `${fs} · off the ramp`, value: "off" }]), ...SIZES.map((n) => ({ label: `${n}`, value: n }))], full: true, label: "Font size", onChange: (n) => n !== "off" && set({ "font-size": `${n}px` }, "size") })));
    const fw = Math.round(parseFloat(st["font-weight"]) || 400);
    T.append(row("Weight", segmented([{ label: "Regular", value: 400 }, { label: "Medium", value: 500 }], fw >= 500 ? 500 : 400, (n) => set({ "font-weight": String(n) }, "weight"), { full: true, label: "Weight" })));
    const lhPx = parseFloat(st["line-height"]);
    const lh = fs && Number.isFinite(lhPx) ? Math.round((lhPx / fs) * 100) / 100 : null;
    const lhNear = LEADING.find((x) => lh && Math.abs(x - lh) < 0.03);
    T.append(row("Line height", dropdown({ value: lhNear ?? "off", options: [...(lhNear ? [] : [{ label: lh ? `${lh} · off the ramp` : "Normal", value: "off" }]), ...LEADING.map((n) => ({ label: `${n}`, value: n }))], full: true, label: "Line height", onChange: (n) => n !== "off" && set({ "line-height": String(n) }, "line height") })));
    const ta = /center/.test(st["text-align"]) ? "center" : /right|end/.test(st["text-align"]) ? "right" : "left";
    T.append(row("Align", segmented([{ label: "Left", value: "left" }, { label: "Centre", value: "center" }, { label: "Right", value: "right" }], ta, (v) => set({ "text-align": v }, "alignment"), { full: true, label: "Text align" })));
    const inkTok = tokenOf(INKS_, st.color);
    T.append(h(`<div class="ih"><span class="tokname${inkTok ? "" : " off"}">${esc(inkTok ? inkTok.name : hexOf(st.color))}</span></div>`), swatches(INKS_, inkTok, (tk) => set({ color: tk.css }, "text colour")));
    if (i.editableText) {
      const tx = h(`<textarea class="afld-ta" aria-label="Text" style="min-height:44px">${esc(i.text)}</textarea>`);
      tx.addEventListener("change", async () => {
        try {
          await api(`envs/${s.env}/text`, { method: "PUT", body: { selector: exact, text: tx.value } });
          el.textContent = tx.value;
          S.diffs.delete(s.env);
          refreshSelInfo();
          markDirty();
        } catch (e) {
          toast("Couldn't save the text", e.message);
        }
      });
      T.append(tx);
    }
    body.append(T);
  }

  // Fill
  const fillTok = tokenOf(FILLS, st["background-color"]);
  const F = sec("Fill", `<span class="tokname${fillTok ? "" : " off"}">${esc(fillTok ? fillTok.name : hexOf(st["background-color"]))}</span>`);
  F.append(swatches(FILLS, fillTok, (tk) => set({ "background-color": tk.css }, "fill")));
  body.append(F);

  // Stroke
  const bw = parseFloat(st["border-top-width"]) || 0;
  const hasStroke = bw > 0 && st["border-top-style"] !== "none";
  const stTok = tokenOf(STROKE, st["border-top-color"]);
  const K = sec("Stroke", hasStroke ? `<span class="tokname${stTok ? "" : " off"}">${esc(stTok ? stTok.name : hexOf(st["border-top-color"]))}</span>` : "");
  const WIDTHS = [0, 0.5, 1, 2];
  K.append(row("Width", segmented(WIDTHS.map((n) => ({ label: n ? `${n}` : "None", value: n })), hasStroke ? WIDTHS.find((n) => Math.abs(n - bw) < 0.01) ?? -1 : 0, (n) => set(n ? { "border-style": "solid", "border-width": `${n}px`, ...(hasStroke ? {} : { "border-color": STROKE[1].css }) } : { "border-style": "none", "border-width": null, "border-color": null }, "stroke"), { full: true, label: "Stroke width" })));
  if (hasStroke) K.append(swatches(STROKE, stTok, (tk) => set({ "border-color": tk.css }, "stroke colour")));
  body.append(K);

  // Effects
  const sh = st["box-shadow"];
  const E = sec("Effects");
  E.append(row("Shadow", segmented(SHADOWS.map(({ label, value }) => ({ label, value })), !sh || sh === "none" ? "none" : ownVal("box-shadow")?.includes("--sh-md") ? "sh-md" : ownVal("box-shadow")?.includes("--sh-sm") ? "sh-sm" : "custom", (v) => set({ "box-shadow": SHADOWS.find((x) => x.value === v)?.css ?? "none" }, "shadow"), { full: true, label: "Shadow" })));
  body.append(E);

  // off the system
  const off = [];
  if (!fillTok) off.push(`fill ${hexOf(st["background-color"])}`);
  if (i.text && !tokenOf(INKS_, st.color)) off.push(`text ${hexOf(st.color)}`);
  const fsz = px(st["font-size"]);
  if (i.text && !SIZES.includes(fsz)) off.push(`${fsz}px type`);
  if (!RADII.includes(rad)) off.push(`${rad}px radius`);
  const badPad = [...new Set(pads.filter((p) => !SPACE.includes(p)))];
  if (badPad.length) off.push(`${badPad.join(", ")}px padding`);
  if (off.length) body.append(h(`<div class="isec"><div class="shnote">${IC.info}<div><b>Off the system</b><br><span>${esc(off.join(" · "))}. Pick a token above to bring it back.</span></div></div></div>`));

  // what this page changed on it
  if (cachedOverrides(s.env) === undefined) loadOverrides(s.env).then(() => S.sel === s && renderDesign());
  const mine = rulesFor(s.env, [i.selector, exact]);
  const C = sec("Changes on this element", `<span class="tct">${mine.reduce((n, x) => n + x.decls.length, 0) || ""}</span>`);
  if (!mine.length) C.append(h(`<span class="lineage">None yet. Drag it, resize it from its handles, or change anything above; it's saved in ${esc(pageName(env))}'s overrides.css.</span>`));
  else {
    const ch = h(`<div class="chg"></div>`);
    for (const x of mine) for (const [k, v] of x.decls) ch.append(h(`<div class="r"><b>${esc(k)}</b><span>${esc(v)}</span></div>`));
    C.append(ch);
  }
  const acts = h(`<div style="display:flex;gap:8px;flex-wrap:wrap"><button type="button" class="dbtn sm" data-a="agent">${IC.spark}Ask an agent</button>${mine.length ? `<button type="button" class="dbtn sm" data-a="reset">${IC.restore}Reset</button>` : ""}<button type="button" class="dbtn sm err" data-a="rm">${IC.trash}Remove</button></div>`);
  acts.querySelector('[data-a="agent"]').onclick = () => fire("ask-agent", {});
  acts.querySelector('[data-a="rm"]').onclick = () => removeEl();
  const rs = acts.querySelector('[data-a="reset"]');
  if (rs) rs.onclick = () => resetSelectors(s.env, [i.selector, exact]);
  C.append(acts);
  body.append(C);
}

function designInk(body, it) {
  const id = it.id;
  const save = async (patch, what) => {
    try {
      const prev = Object.fromEntries(Object.keys(patch).map((k) => [k, it[k]]));
      const next = await api(`canvas/items/${id}`, { method: "PATCH", body: patch });
      S.items.set(id, next);
      sync();
      record({ label: what, undo: async () => (S.items.set(rid(id), await api(`canvas/items/${rid(id)}`, { method: "PATCH", body: prev })), sync()), redo: async () => (S.items.set(rid(id), await api(`canvas/items/${rid(id)}`, { method: "PATCH", body: patch })), sync()) });
      renderDesign();
    } catch (e) {
      toast("Couldn't change the drawing", e.message);
    }
  };
  const on = it.board && S.items.get(it.board);
  const t = sec(PENS[it.pen]?.label || "Drawing", `<span class="tokname">${esc(it.author || "You")} · ${esc(timeAgo(it.updatedAt || it.createdAt))}</span>`);
  t.append(h(`<span class="lineage">${on ? `Drawn on ${esc(screenName(on))}; it moves with that screen.` : "Drawn on the canvas."} Agents see it in list_canvas.</span>`));
  const dots = h(`<div class="sws" role="radiogroup" aria-label="Ink"></div>`);
  for (const c of INKS) {
    const b = h(`<button type="button" class="inkdot${it.color === c ? " on" : ""}" style="--ink:${c}" aria-label="Ink ${c}" aria-pressed="${it.color === c}"></button>`);
    b.onclick = () => save({ color: c }, "ink colour");
    dots.append(b);
  }
  t.append(row("Ink", dots, true));
  const base = PENS[it.pen]?.size || 6;
  const cur = INK_SIZES.reduce((a, x) => (Math.abs(x.k * base - it.size) < Math.abs(a.k * base - it.size) ? x : a), INK_SIZES[1]);
  t.append(row("Weight", segmented(INK_SIZES.map((x) => ({ label: x.label, value: x.k })), cur.k, (k) => save({ size: Math.round(base * k * 10) / 10 }, "weight"), { full: true, label: "Weight" })));
  body.append(t);
  const a = h(`<div class="isec"><div style="display:flex;gap:8px;flex-wrap:wrap"><button type="button" class="dbtn sm" data-a="agent">${IC.spark}Ask an agent about this</button><button type="button" class="dbtn sm err" data-a="del">${IC.trash}Remove</button></div></div>`);
  a.querySelector('[data-a="agent"]').onclick = () => {
    if (on) selectBoard(on.id);
    fire("ask-agent", { prompt: `Look at the ${PENS[it.pen]?.label.toLowerCase() || "drawing"} mark I made${on ? ` on ${screenName(on)}` : ""} and fix what it points at.` });
  };
  a.querySelector('[data-a="del"]').onclick = () => removeItems([id]);
  body.append(a);
}

function designAnnotation(body, id) {
  const it = S.items.get(id);
  if (!it) return;
  if (it.type === "ink") return designInk(body, it);
  const kind = { note: "Note", box: "Highlight", arrow: "Arrow" }[it.type];
  const t = sec(kind, `<span class="tokname">${esc(it.author || "You")} · ${esc(timeAgo(it.updatedAt || it.createdAt))}</span>`);
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
  const a = h(`<div class="isec"><div style="display:flex;gap:8px;flex-wrap:wrap"><button type="button" class="dbtn sm" data-a="agent">${IC.spark}Send to an agent</button><button type="button" class="dbtn sm err" data-a="del">${IC.trash}Remove</button></div></div>`);
  a.querySelector('[data-a="agent"]').onclick = () => {
    const near = nearestBoard(it, S.page);
    if (near) selectBoard(near.id);
    fire("ask-agent", { prompt: it.text || it.label || "" });
  };
  a.querySelector('[data-a="del"]').onclick = () => fire("remove-item", id);
  body.append(a);
}

// ----- agents: Claude-style turns; from main, a request opens a branch for the agent -----
let draft = "";
const STATUS = { queued: ["Queued", ""], working: ["Working", "info"], done: ["Done", "ok"], failed: ["Failed", "err"], cancelled: ["Stopped", ""] };
const openLogs = new Set();
function renderChat(body, foot, env) {
  const ws = S.ws;
  const hs = ws.harnesses || [];
  const agentName = ws.agent?.name || hs[0]?.client || "Agent";
  const thread = h(`<div class="athread" aria-live="polite"></div>`);
  thread.append(h(`<div class="ahar"><span class="hdot${hs.length || ws.agent ? " on" : ""}"></span><span>${ws.agent ? `Requests run with <b>${esc(ws.agent.name)}</b>` : hs.length ? `<b>${esc(hs[0].client)}</b> is connected` : "No agent yet — requests wait"}</span><span class="sp"></span><button type="button">${ws.agent || hs.length ? "Settings" : "Connect"}</button></div>`));
  thread.querySelector(".ahar button").onclick = () => fire("connect");
  const fam = new Set(familyOf(rootOf(env.id)?.id).map((x) => x.env.id));
  const tasks = S.tasks.filter((t) => fam.has(t.env)).slice(-30);
  const onMain = !isBranch(env);
  if (!tasks.length) {
    const sug = h(`<div class="asug"><span class="h">Ask for a change to ${esc(pageName(env))}. ${onMain ? "It happens on a new branch, so main only changes when you merge." : "It happens on this branch."} Select a board or an element first to point at it.</span></div>`);
    for (const p of ["Make the sidebar rows denser", "Try a warmer surface for the content card", "Add an empty state to this screen"]) {
      const b = h(`<button type="button">${esc(p)}</button>`);
      b.onclick = () => {
        draft = p;
        const ta = $("lFoot").querySelector("textarea");
        if (ta) (ta.value = p), ta.focus(), ta.dispatchEvent(new Event("input"));
      };
      sug.append(b);
    }
    thread.append(sug);
  }
  for (const t of tasks) thread.append(turnView(t, agentName));
  body.append(thread);
  // composer
  const s = S.sel;
  const comp = h(`<div class="acomp"><div class="abar chips"></div><textarea rows="2" aria-label="Request" placeholder="Ask for a change to ${esc(pageName(env))}"></textarea><div class="abar">${onMain ? `<label class="ctog"><button type="button" class="sw" role="switch" aria-checked="${S.chatOnBranch}" aria-label="Work on a new branch"><i></i></button>On a new branch</label>` : ""}<span class="sp"></span><button type="button" class="sendb" aria-label="Send request" disabled>${IC.send}</button></div></div>`);
  const chips = comp.querySelector(".chips");
  chips.append(h(`<span class="chip"><span class="l">${onMain ? "Main" : `⑂ ${esc(env.name)}`}</span></span>`));
  if (s?.kind === "board" || s?.kind === "el") chips.append(h(`<span class="chip"><span class="l">${esc(screenName(S.items.get(s.item)))}</span></span>`));
  if (s?.kind === "el" && S.draftSel) {
    const c = h(`<span class="chip" title="${esc(s.info?.selector)}"><span class="l">${esc(s.info?.label || "element")}</span><button type="button" aria-label="Don't attach the selection">${IC.x}</button></span>`);
    c.querySelector("button").onclick = () => ((S.draftSel = false), renderLeft());
    chips.append(c);
  }
  const sw = comp.querySelector(".sw");
  if (sw) sw.onclick = () => ((S.chatOnBranch = !S.chatOnBranch), sw.setAttribute("aria-checked", String(S.chatOnBranch)));
  const ta = comp.querySelector("textarea");
  const send = comp.querySelector(".sendb");
  ta.value = draft;
  const syncSend = () => (send.disabled = !ta.value.trim());
  ta.addEventListener("input", () => {
    draft = ta.value;
    syncSend();
    ta.style.height = "auto";
    ta.style.height = Math.min(160, ta.scrollHeight) + "px";
  });
  let busy = false;
  const go = async () => {
    const prompt = ta.value.trim();
    if (!prompt || busy) return;
    busy = true;
    send.disabled = true;
    const selection = s?.kind === "el" && S.draftSel && s.info ? { selector: S.scope === "exact" ? s.info.exactSelector : s.info.selector, label: s.info.label, html: s.info.html, text: s.info.text, styles: s.info.styles } : null;
    try {
      const t = await api("tasks", { method: "POST", body: { env: env.id, prompt, selection, branch: !!(onMain && S.chatOnBranch) } });
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
  foot.replaceChildren(comp);
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
  b.append(h(`<div style="display:flex;align-items:center;gap:8px;font-size:12px;color:var(--text-secondary)"><b style="color:var(--text-primary);font-weight:500">${esc(who)}</b><span class="tagro ${cls}">${lab}</span>${t.status === "working" ? '<span class="dots" aria-hidden="true"><i></i><i></i><i></i></span>' : ""}<span class="sp"></span><span>${esc(timeAgo(t.updatedAt))}</span></div>`));
  if (env) {
    const d = isBranch(env) ? S.diffs.get(env.id) : null;
    const tag = h(`<span class="brtag">${isBranch(env) ? IC.fork : IC.board}${esc(pageName(env))}${d?.changes.length ? ` <span class="n">${d.changes.length}</span>` : ""}</span>`);
    tag.onclick = () => fire("go", env.id);
    b.append(tag);
  }
  if (t.reply) b.append(h(`<div class="rep" style="font-size:12px;line-height:1.5;white-space:pre-wrap">${esc(t.reply)}</div>`));
  else if (t.status === "queued") b.append(h(`<div style="font-size:12px;line-height:1.5;color:var(--text-secondary)">${waiting ? "Waiting for an agent. Connect one, or ask Claude Code to take the next Workshop task." : "Waiting for the agent to pick this up."}</div>`));
  if (t.changed?.length) b.append(h(`<div style="display:flex;flex-wrap:wrap;gap:4px">${t.changed.slice(0, 6).map((f) => `<span class="tagro">${esc(f)}</span>`).join("")}</div>`));
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
    lb.onclick = () => (openLogs.has(t.id) ? openLogs.delete(t.id) : openLogs.add(t.id), renderLeft());
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
  if (openLogs.has(t.id) && t.log?.length) b.append(h(`<div style="max-height:180px;overflow:auto;background:var(--bg-base);border:.5px solid var(--border-subtle);border-radius:8px;padding:8px 12px;font:400 12px/1.5 var(--mono);color:var(--text-secondary);white-space:pre-wrap">${t.log.map((l) => `<span class="${esc(l.kind)}">${esc(l.text)}</span>`).join("\n")}</div>`));
  w.append(turn);
  return w;
}

// ---------- wiring ----------
export function initPanels() {
  for (const b of document.querySelectorAll("#rail [data-t]")) b.addEventListener("click", () => ((S.leftTab = b.dataset.t), $("frame").classList.remove("ui-off"), renderLeft()));
  for (const b of document.querySelectorAll("#rTabs button")) b.addEventListener("click", () => ((S.rightTab = b.dataset.t), renderRight()));
  on("left-tab", (t) => ((S.leftTab = t), renderLeft()));
  on("sel", () => {
    renderLeft();
    renderRight();
  });
  on("board-ready", (id) => {
    if (S.leftTab === "file") renderLeft();
    if (S.sel?.item === id) renderRight();
  });
  on("recipes", () => S.leftTab === "recipes" && renderLeft());
  on("catalog", () => (S.leftTab === "screens" && renderLeft(), S.rightTab === "prototype" && renderRight()));
  on("env-meta", (id) => {
    forgetOverrides(id);
    S.diffs.delete(id);
    if (id === S.page) (renderRight(), renderBanner(), loadDiff(id));
    renderLeft();
    markDirty();
  });
  on("diff", (id) => {
    if (id === S.page) renderBanner();
    if (S.leftTab === "file" || S.leftTab === "agents") renderLeft();
    if (!S.sel && (id === S.page || S.envs.get(id)?.parent === S.page)) renderRight();
  });
  on("styles-changed", () => S.sel?.kind === "el" && renderDesign());
  on("focus-label", () => ((renderDesign.focusLabel = true), (S.rightTab = "design"), renderRight()));
  on("ask-agent", ({ prompt } = {}) => {
    S.leftTab = "agents";
    S.draftSel = true;
    if (prompt) draft = prompt;
    renderChat.focus = true;
    $("frame").classList.remove("ui-off");
    renderLeft();
  });
}
