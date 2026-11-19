// Panels around the canvas: Boards and Layers on the left; Design (the inspector) and Agent on
// the right. The inspector only offers Libra tokens, so a design tweak can't leave the system.

import { S, on, fire, envList, selEnv } from "./state.js";
import { $, h, esc, api, toast, IC, menu, dropdown, segmented, copyText, timeAgo } from "./lib.js";
import { rt, docOf, selectBoard, selectEl, setHover, focusEnv, refreshSelInfo, markDirty, boardOf } from "./canvas.js";

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
const DEVICES = [
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
const tokenOf = (set, rgb) => {
  const hx = hexOf(rgb);
  return set.find((t) => t.hex.includes(hx)) || null;
};
const px = (v) => Math.round(parseFloat(v) || 0);

// ---------- overrides cache (overrides.css per environment) ----------
const OV = new Map();
export async function loadOverrides(id, force = false) {
  if (!force && OV.has(id)) return OV.get(id);
  try {
    const { css } = await api(`envs/${id}/styles`);
    OV.set(id, css);
  } catch {
    OV.set(id, "");
  }
  return OV.get(id);
}
function parseRules(css) {
  const out = [];
  const src = String(css || "").replace(/\/\*[\s\S]*?\*\//g, "");
  const re = /([^{}@][^{}]*)\{([^{}]*)\}/g;
  let m;
  while ((m = re.exec(src))) {
    const decls = m[2]
      .split(";")
      .map((d) => d.trim())
      .filter(Boolean)
      .map((d) => {
        const i = d.indexOf(":");
        return [d.slice(0, i).trim(), d.slice(i + 1).trim().replace(/\s*!important$/, "")];
      });
    out.push({ selector: m[1].trim().replace(/\s+/g, " "), decls });
  }
  return out;
}
const norm = (s) => String(s || "").replace(/\s+/g, " ").replace(/\s*>\s*/g, " > ").trim();

// ---------- undo for inspector edits ----------
const UNDO = [];
async function applyStyle(props, label) {
  const s = S.sel;
  if (!s || s.kind !== "el") return;
  const selector = S.scope === "exact" ? s.info.exactSelector : s.info.selector;
  const rules = parseRules(await loadOverrides(s.env));
  const cur = rules.find((r) => norm(r.selector) === norm(selector));
  const prev = {};
  for (const p of Object.keys(props)) prev[p] = cur?.decls.find(([k]) => k === p)?.[1] ?? null;
  try {
    const r = await api(`envs/${s.env}/styles`, { method: "PATCH", body: { selector, props } });
    OV.set(s.env, r.css);
    rt(s.env)?.setOverrides(r.css);
    UNDO.push({ env: s.env, selector, prev, label });
    if (UNDO.length > 100) UNDO.shift();
  } catch (e) {
    return toast("Couldn't apply that", e.message);
  }
  requestAnimationFrame(() => {
    refreshSelInfo();
    renderDesign();
    markDirty();
  });
}
export async function undoStyle() {
  const u = UNDO.pop();
  if (!u) return false;
  try {
    const r = await api(`envs/${u.env}/styles`, { method: "PATCH", body: { selector: u.selector, props: u.prev } });
    OV.set(u.env, r.css);
    rt(u.env)?.setOverrides(r.css);
    toast(`Undid ${u.label}`);
    requestAnimationFrame(() => {
      refreshSelInfo();
      renderDesign();
      markDirty();
    });
  } catch (e) {
    toast("Couldn't undo", e.message);
  }
  return true;
}

// ---------- left: boards ----------
function commentsFor(id) {
  return S.comments.filter((c) => c.env === id && !c.parent && !c.resolved).length;
}
export function renderBoards() {
  const body = $("lBody");
  if (S.leftTab !== "boards") return;
  const envs = envList();
  if (!envs.length) {
    body.innerHTML = `<div class="pempty"><b>No prototypes yet</b>Import an HTML file, drop one on the canvas, or ask an agent to create one.</div>`;
    return;
  }
  const ids = new Set(envs.map((e) => e.id));
  const kids = new Map();
  for (const e of envs) {
    const p = e.parent && ids.has(e.parent) ? e.parent : null;
    if (!kids.has(p)) kids.set(p, []);
    kids.get(p).push(e);
  }
  const list = h(`<div class="plist" role="tree" aria-label="Boards"></div>`);
  const add = (e, depth) => {
    const n = commentsFor(e.id);
    const row = h(`<div class="prow${S.sel?.env === e.id ? " on" : ""}" role="treeitem" tabindex="0" data-env="${esc(e.id)}" style="padding-left:${8 + depth * 16}px">${depth ? IC.fork : IC.board}<span class="t" title="${esc(e.name)}">${esc(e.name)}</span>${n ? `<span class="tct" title="${n} open comments">${n}</span>` : ""}<button type="button" class="ib24 rmore" aria-label="More for ${esc(e.name)}" aria-haspopup="menu">${IC.more}</button></div>`);
    row.addEventListener("click", (ev) => {
      if (ev.target.closest(".rmore")) return;
      selectBoard(e.id);
      focusEnv(e.id);
    });
    row.addEventListener("keydown", (ev) => {
      if (ev.key === "Enter") row.click();
    });
    row.querySelector(".rmore").addEventListener("click", (ev) => {
      ev.stopPropagation();
      boardMenu(ev.currentTarget, e.id);
    });
    list.append(row);
    for (const k of kids.get(e.id) || []) add(k, depth + 1);
  };
  for (const e of kids.get(null) || []) add(e, 0);
  body.replaceChildren(list);
}
export function boardMenu(anchor, id) {
  const e = S.envs.get(id);
  menu(anchor, [
    { label: "Duplicate", icon: IC.fork, kbd: "⌘D", onClick: () => fire("duplicate", id) },
    { label: "Rename", icon: IC.board, onClick: () => fire("rename", id) },
    { label: "Present", icon: IC.play, onClick: () => fire("present", id) },
    { label: "Share", icon: IC.share, onClick: () => fire("share", id) },
    { label: "Open in a new tab", icon: IC.ext, onClick: () => window.open(`/env/${id}/`, "_blank", "noopener") },
    { label: "Copy folder path", icon: IC.folder, onClick: () => copyText(`${S.ws.root}/envs/${id}`) },
    "-",
    { label: `Delete ${e?.name || "prototype"}`, icon: IC.trash, danger: true, onClick: () => fire("delete", id) },
  ], { align: "left", width: 240 });
}

// ---------- left: layers (the live DOM of the selected board) ----------
function lname(el) {
  const cls = [...el.classList].find((c) => !/^(on|open|active|ws-)/.test(c));
  return el.id ? `#${el.id}` : cls ? `.${cls}` : "";
}
function snippet(el) {
  if (el.children.length > 0) return "";
  return (el.textContent || "").replace(/\s+/g, " ").trim().slice(0, 40);
}
export function renderLayers() {
  const body = $("lBody");
  if (S.leftTab !== "layers") return;
  const s = S.sel;
  const d = s ? docOf(s.env) : null;
  if (!s || !d?.body) {
    body.innerHTML = `<div class="pempty"><b>Select a board</b>Its layers are the live page: click an element on the canvas, or pick one here.</div>`;
    return;
  }
  const rows = [];
  const visible = (el) => {
    const r = el.getBoundingClientRect();
    return r.width > 0 && r.height > 0;
  };
  const kidsOf = (el) => [...el.children].filter((c) => !/^(SCRIPT|STYLE|LINK|META|TEMPLATE|NOSCRIPT)$/.test(c.tagName) && !c.classList.contains("ws-ghost") && visible(c));
  if (s.kind === "el" && s.el.isConnected) {
    const chain = [];
    for (let el = s.el; el && el !== d.body && el !== d.documentElement; el = el.parentElement) chain.unshift(el);
    chain.forEach((el, i) => rows.push({ el, depth: i }));
    for (const c of kidsOf(s.el).slice(0, 60)) rows.push({ el: c, depth: chain.length });
  } else {
    for (const c of kidsOf(d.body).slice(0, 40)) {
      rows.push({ el: c, depth: 0 });
      for (const g of kidsOf(c).slice(0, 12)) rows.push({ el: g, depth: 1 });
    }
  }
  const list = h(`<div class="plist" role="tree" aria-label="Layers"></div>`);
  for (const r of rows) {
    const on = s.kind === "el" && s.el === r.el;
    const row = h(`<div class="lyr${on ? " on" : ""}" role="treeitem" tabindex="0" style="padding-left:${8 + r.depth * 12}px"><span class="tg">${esc(r.el.localName)}</span><span class="t">${esc(lname(r.el))}</span><span class="x">${esc(snippet(r.el))}</span></div>`);
    row.addEventListener("click", () => selectEl(s.env, r.el));
    row.addEventListener("pointerenter", () => setHover(s.env, r.el));
    row.addEventListener("pointerleave", () => setHover(null, null));
    list.append(row);
  }
  if (!rows.length) list.append(h(`<div class="pempty">Nothing visible on this board yet.</div>`));
  body.replaceChildren(list);
  list.querySelector(".lyr.on")?.scrollIntoView({ block: "nearest" });
}
export function renderLeft() {
  if (S.leftTab === "boards") renderBoards();
  else renderLayers();
}

// ---------- right: design ----------
const sec = (title, extra = "") => h(`<div class="isec"><div class="ih"><b>${esc(title)}</b>${extra}</div></div>`);
const row = (k, v, stack = false) => {
  const r = h(`<div class="irow${stack ? " stack" : ""}"><span class="k">${esc(k)}</span><span class="v"></span></div>`);
  if (typeof v === "string") r.querySelector(".v").innerHTML = v;
  else if (v) r.querySelector(".v").append(v);
  return r;
};

export function renderDesign() {
  const body = $("rDesign");
  if (S.rightTab !== "design") return;
  const st = body.scrollTop;
  const s = S.sel;
  body.replaceChildren();
  if (!s) designCanvas(body);
  else if (s.kind === "board") designBoard(body, s.env);
  else designEl(body, s);
  body.scrollTop = st;
}

function designCanvas(body) {
  const ws = S.ws;
  const a = sec("Workspace", `<span class="tct">${S.envs.size}</span>`);
  a.append(h(`<div class="ititle"><span class="nm">${esc(ws.name)}</span><span class="pth"><span title="${esc(ws.root)}">${esc(ws.root)}</span><button type="button" class="ib24" aria-label="Copy folder path">${IC.copy}</button></span></div>`));
  a.querySelector(".ib24").onclick = () => copyText(ws.root);
  a.append(h(`<span style="color:var(--text-secondary)">Every prototype is a folder in <span class="mono" style="font-size:12px;font-weight:400">envs/</span>. Edit the files in any editor or agent and the boards update.</span>`));
  body.append(a);
  const b = sec("Agent");
  const hs = ws.harnesses || [];
  b.append(h(`<div class="ahar"><span class="hdot${hs.length || ws.agent ? " on" : ""}"></span><span>${hs.length ? `<b>${esc(hs[0].client)}</b> is connected` : ws.agent ? `Requests run with <b>${esc(ws.agent.name)}</b>` : "No agent connected"}</span><span class="sp"></span><button type="button">${hs.length || ws.agent ? "Settings" : "Connect"}</button></div>`));
  b.querySelector("button").onclick = () => fire("connect");
  body.append(b);
  const c = sec("Shortcuts");
  c.append(h(`<div class="kbdl"><span>Select</span><kbd>V</kbd><span>Hand</span><kbd>H</kbd><span>Comment</span><kbd>C</kbd><span>Design or Prototype mode</span><kbd>P</kbd><span>Pan</span><kbd>Space</kbd><span>Zoom to fit</span><kbd>⇧1</kbd><span>Duplicate board</span><kbd>⌘D</kbd><span>Select parent</span><kbd>Esc</kbd><span>Edit text</span><kbd>Double-click</kbd><span>Undo a style edit</span><kbd>⌘Z</kbd></div>`));
  body.append(c);
}

async function patchEnv(id, patch) {
  try {
    const next = await api(`envs/${id}`, { method: "PATCH", body: patch });
    S.envs.set(id, next);
    fire("env-meta", id);
    return next;
  } catch (e) {
    toast("Couldn't save that", e.message);
    return null;
  }
}

function designBoard(body, id) {
  const env = S.envs.get(id);
  if (!env) return;
  const r = rt(id);
  const ad = (() => {
    try {
      return r?.adapter() || null;
    } catch {
      return null;
    }
  })();
  // title
  const t = h(`<div class="isec"><div class="ititle"><div class="afld-in"><input aria-label="Name" value="${esc(env.name)}" maxlength="120"></div><span class="pth"><span title="envs/${esc(id)}/index.html">envs/${esc(id)}/index.html</span><button type="button" class="ib24" aria-label="Copy file path" data-tip="Copy path">${IC.copy}</button><button type="button" class="ib24" aria-label="Open in a new tab" data-tip="Open in a new tab">${IC.ext}</button></span></div></div>`);
  const inp = t.querySelector("input");
  const save = async () => {
    const v = inp.value.trim();
    if (v && v !== env.name) await patchEnv(id, { name: v });
    else inp.value = env.name;
  };
  inp.addEventListener("keydown", (e) => {
    if (e.key === "Enter") inp.blur();
    if (e.key === "Escape") {
      inp.value = env.name;
      inp.blur();
    }
  });
  inp.addEventListener("blur", save);
  const [cp, ex] = t.querySelectorAll(".ib24");
  cp.onclick = () => copyText(`${S.ws.root}/envs/${id}/index.html`);
  ex.onclick = () => window.open(`/env/${id}/`, "_blank", "noopener");
  body.append(t);

  // environment
  const e1 = sec("Environment", ad?.name ? `<span class="tagro" title="Screens, states and variants come from the prototype's own tools">${esc(ad.name.toUpperCase())}</span>` : "");
  const cur = DEVICES.find((d) => d.w === env.device.w && d.h === env.device.h);
  const devDD = dropdown({ value: cur ? `${cur.w}x${cur.h}` : "custom", options: [...DEVICES.map((d) => ({ label: d.label, value: `${d.w}x${d.h}` })), ...(cur ? [] : [{ label: `Custom · ${env.device.w} × ${env.device.h}`, value: "custom" }])], full: true, label: "Board size", onChange: (v) => {
    if (v === "custom") return;
    const [w, hh] = v.split("x").map(Number);
    patchEnv(id, { device: { w, h: hh } });
  } });
  e1.append(row("Board", devDD));
  e1.append(row("Theme", segmented([{ label: "Light", value: "light" }, { label: "Dark", value: "dark" }, { label: "System", value: "system" }], env.theme, async (v) => {
    r?.setTheme(v);
    await patchEnv(id, { theme: v });
  }, { full: true, label: "Theme" })));
  if (ad?.screens?.length) {
    const opts = [{ label: "Its own start screen", value: "" }, ...ad.screens.map((x) => ({ group: x.group, label: x.name.replace("Settings › ", ""), value: x.name }))];
    e1.append(row("Opens on", dropdown({ value: env.screen || "", options: opts, full: true, label: "Opens on", onChange: async (v) => {
      if (v) r?.go(v);
      await patchEnv(id, { screen: v || null });
    } })));
    if (ad.screen) e1.append(h(`<span style="font-size:12px;color:var(--text-secondary)">Showing ${esc(ad.screen)} now</span>`));
  }
  if (ad?.states?.length) {
    e1.append(row("State", dropdown({ value: env.state || "Default", options: ad.states, full: true, label: "Screen state", onChange: async (v) => {
      r?.setState(v);
      await patchEnv(id, { state: v === "Default" ? null : v });
    } })));
  }
  body.append(e1);

  // variants
  if (ad?.variants?.length) {
    const v = sec("Variants", `<span class="tct">${ad.variants.length}</span>`);
    for (const x of ad.variants) {
      v.append(row(x.label, dropdown({ value: x.value, options: x.options, full: true, label: x.label, onChange: async (o) => {
        r?.setVariant(x.label, o);
        await patchEnv(id, { variants: { [x.label]: o } });
        setTimeout(() => renderDesign(), 60);
      } }), true));
    }
    v.append(h(`<span style="font-size:12px;color:var(--text-secondary)">Duplicate the board to compare variants side by side.</span>`));
    body.append(v);
  }

  // versions
  const vs = S.versions.get(id) || [];
  const v = sec("Versions", `<span class="tct">${vs.length || ""}</span>`);
  const sv = h(`<button type="button" class="dbtn sm">${IC.version}Save version</button>`);
  v.querySelector(".ih").append(sv);
  sv.onclick = () => fire("save-version", id);
  if (!vs.length) v.append(h(`<span style="color:var(--text-secondary)">No versions yet. Save one before a big change — agents save one before they start.</span>`));
  for (const x of vs.slice(0, 8)) {
    const vr = h(`<div class="vrow"><span class="n">V${x.n}</span><span class="tx"><b title="${esc(x.label)}">${esc(x.label)}</b><span>${esc(x.author || "You")} · ${esc(timeAgo(x.at))}</span></span><span class="va"><button type="button" class="ib24" aria-label="Restore version ${x.n}" data-tip="Restore">${IC.restore}</button><button type="button" class="ib24" aria-label="Fork version ${x.n}" data-tip="Fork from here">${IC.fork}</button></span></div>`);
    const [rb, fb] = vr.querySelectorAll(".ib24");
    rb.onclick = () => fire("restore-version", { id, n: x.n });
    fb.onclick = () => fire("fork-version", { id, n: x.n });
    v.append(vr);
  }
  if (vs.length > 8) v.append(h(`<span style="font-size:12px;color:var(--text-secondary)">${vs.length - 8} older versions in .workshop/versions/${esc(id)}</span>`));
  body.append(v);

  // lineage
  const forks = envList().filter((e) => e.parent === id);
  if (env.parent || forks.length) {
    const l = sec("Lineage");
    if (env.parent) {
      const p = S.envs.get(env.parent);
      const pr = h(`<div class="prow" style="margin:0 -8px">${IC.board}<span class="t">Fork of ${esc(p?.name || env.parent)}${env.forkedFrom?.version ? ` · V${env.forkedFrom.version}` : ""}</span></div>`);
      if (p) pr.onclick = () => (selectBoard(p.id), focusEnv(p.id));
      l.append(pr);
    }
    for (const f of forks) {
      const fr = h(`<div class="prow" style="margin:0 -8px">${IC.fork}<span class="t">${esc(f.name)}</span></div>`);
      fr.onclick = () => (selectBoard(f.id), focusEnv(f.id));
      l.append(fr);
    }
    body.append(l);
  }

  // overrides
  const css = OV.get(id);
  if (css === undefined) loadOverrides(id).then(() => S.sel?.env === id && renderDesign());
  const rules = parseRules(css || "");
  const o = sec("Design overrides", `<span class="tct">${rules.length || ""}</span>`);
  if (!rules.length) o.append(h(`<span style="color:var(--text-secondary)">Select an element on the board to change it with Libra tokens. Changes land in <span class="mono" style="font-size:12px;font-weight:400">overrides.css</span>.</span>`));
  for (const ru of rules.slice(0, 12)) {
    const or = h(`<div class="orule"><code title="${esc(ru.selector)}">${esc(ru.selector)}</code><span>${ru.decls.length}</span><button type="button" class="ib24" aria-label="Remove this rule">${IC.x}</button></div>`);
    or.querySelector("code").onclick = () => {
      const el = (() => {
        try {
          return docOf(id)?.querySelector(ru.selector);
        } catch {
          return null;
        }
      })();
      if (el) selectEl(id, el);
    };
    or.querySelector(".ib24").onclick = async () => {
      try {
        const res = await api(`envs/${id}/styles`, { method: "DELETE", body: { selector: ru.selector } });
        OV.set(id, res.css);
        rt(id)?.setOverrides(res.css);
        renderDesign();
      } catch (e) {
        toast("Couldn't remove the rule", e.message);
      }
    };
    o.append(or);
  }
  body.append(o);

  // actions
  const a = h(`<div class="isec"><div style="display:flex;gap:8px;flex-wrap:wrap"><button type="button" class="dbtn" data-a="dup">${IC.fork}Duplicate</button><button type="button" class="dbtn" data-a="present">${IC.play}Present</button><button type="button" class="dbtn" data-a="agent">${IC.agent}Ask agent</button></div></div>`);
  a.querySelector('[data-a="dup"]').onclick = () => fire("duplicate", id);
  a.querySelector('[data-a="present"]').onclick = () => fire("present", id);
  a.querySelector('[data-a="agent"]').onclick = () => fire("ask-agent", {});
  body.append(a);
  const del = h(`<div class="isec"><button type="button" class="dbtn err" style="align-self:flex-start">${IC.trash}Delete prototype</button></div>`);
  del.querySelector("button").onclick = () => fire("delete", id);
  body.append(del);
  if (!S.versions.has(id)) loadVersions(id);
}

export async function loadVersions(id) {
  try {
    S.versions.set(id, await api(`envs/${id}/versions`));
  } catch {
    S.versions.set(id, []);
  }
  if (S.sel?.env === id && S.sel.kind === "board") renderDesign();
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
  // title + path
  const t = h(`<div class="isec"><div class="ititle"><span class="nm">${esc(i.label || s.el.localName)}</span><span class="pth"><span title="${esc(i.selector)}">${esc(env?.name || s.env)}</span></span></div><div class="crumbs"></div></div>`);
  const chain = [];
  for (let el = s.el; el && el.parentElement && chain.length < 5; el = el.parentElement) chain.unshift(el);
  const cr = t.querySelector(".crumbs");
  for (const el of chain) {
    const b = h(`<button type="button" class="${el === s.el ? "cur" : ""}" title="${esc(rt(s.env)?.label(el) || el.localName)}">${esc(rt(s.env)?.label(el) || el.localName)}</button>`);
    b.onclick = () => selectEl(s.env, el);
    b.onpointerenter = () => setHover(s.env, el);
    b.onpointerleave = () => setHover(null, null);
    cr.append(b);
  }
  if (i.matches > 1) {
    t.append(segmented([{ label: "This element", value: "exact" }, { label: `All ${i.matches} matches`, value: "class" }], S.scope, (v) => {
      S.scope = v;
      renderDesign();
      fire("scope");
    }, { full: true, label: "Apply changes to" }));
  }
  body.append(t);

  // text
  if (i.editableText) {
    const tx = sec("Text");
    const ta = h(`<textarea class="afld-ta" aria-label="Text" style="min-height:44px">${esc(i.text)}</textarea>`);
    ta.addEventListener("change", async () => {
      try {
        await api(`envs/${s.env}/text`, { method: "PUT", body: { selector: i.exactSelector, text: ta.value } });
        s.el.textContent = ta.value;
        refreshSelInfo();
        markDirty();
      } catch (e) {
        toast("Couldn't save the text", e.message);
      }
    });
    tx.append(ta);
    tx.append(h(`<span style="font-size:12px;color:var(--text-secondary)">Or double-click the text on the board.</span>`));
    body.append(tx);
  }

  // layout
  const L = sec("Layout");
  const r = i.rect || {};
  L.append(row("Size", `<span class="ro">${r.w ?? "–"} × ${r.h ?? "–"}</span>`));
  const pads = ["padding-top", "padding-right", "padding-bottom", "padding-left"].map((k) => px(st[k]));
  const even = pads.every((p) => p === pads[0]);
  const padLabel = even ? `${pads[0]}` : pads.join(" · ");
  const spaceOpts = SPACE.map((n) => ({ label: `${n}`, value: n }));
  L.append(row("Padding", dropdown({ value: even ? pads[0] : "mixed", options: even ? spaceOpts : [{ label: padLabel, value: "mixed" }, ...spaceOpts], full: true, label: "Padding", onChange: (n) => n !== "mixed" && applyStyle({ padding: `${n}px` }, "padding") })));
  if (/flex|grid/.test(st.display || "")) {
    const g = px(st.gap);
    L.append(row("Gap", dropdown({ value: SPACE.includes(g) ? g : "off", options: SPACE.includes(g) ? spaceOpts : [{ label: `${g} · off system`, value: "off" }, ...spaceOpts], full: true, label: "Gap", onChange: (n) => n !== "off" && applyStyle({ gap: `${n}px` }, "gap") })));
  }
  const rad = px(st["border-radius"]);
  L.append(row("Radius", dropdown({ value: RADII.includes(rad) ? rad : "off", options: [...(RADII.includes(rad) ? [] : [{ label: `${rad} · off system`, value: "off" }]), ...RADII.map((n) => ({ label: `${n}`, value: n }))], full: true, label: "Radius", onChange: (n) => n !== "off" && applyStyle({ "border-radius": `${n}px` }, "radius") })));
  body.append(L);

  // fill
  const fillTok = tokenOf(FILL, st["background-color"]);
  const F = sec("Fill", `<span class="tokname${fillTok ? "" : " off"}">${esc(fillTok ? fillTok.name : hexOf(st["background-color"]))}</span>`);
  F.append(swatches(FILL, fillTok, (tk) => applyStyle({ "background-color": tk.css }, "fill")));
  body.append(F);

  // type
  const inkTok = tokenOf(INK, st.color);
  const T = sec("Text style", `<span class="tokname${inkTok ? "" : " off"}">${esc(inkTok ? inkTok.name : hexOf(st.color))}</span>`);
  T.append(swatches(INK, inkTok, (tk) => applyStyle({ color: tk.css }, "text colour")));
  const fs = px(st["font-size"]);
  T.append(row("Size", dropdown({ value: SIZES.includes(fs) ? fs : "off", options: [...(SIZES.includes(fs) ? [] : [{ label: `${fs} · off the ramp`, value: "off" }]), ...SIZES.map((n) => ({ label: `${n}`, value: n }))], full: true, label: "Font size", onChange: (n) => n !== "off" && applyStyle({ "font-size": `${n}px` }, "size") })));
  const fw = Math.round(parseFloat(st["font-weight"]) || 400);
  T.append(row("Weight", segmented([{ label: "Regular", value: 400 }, { label: "Medium", value: 500 }], fw >= 500 ? 500 : 400, (n) => applyStyle({ "font-weight": String(n) }, "weight"), { full: true, label: "Weight" })));
  body.append(T);

  // off-system notes
  const off = [];
  if (!fillTok) off.push(`fill ${hexOf(st["background-color"])}`);
  if (!inkTok) off.push(`text ${hexOf(st.color)}`);
  if (!SIZES.includes(fs)) off.push(`${fs}px type`);
  if (!RADII.includes(rad)) off.push(`${rad}px radius`);
  const badPad = [...new Set(pads.filter((p) => !SPACE.includes(p)))];
  if (badPad.length) off.push(`${badPad.join(", ")}px padding`);
  if (off.length) {
    const n = h(`<div class="isec"><div class="shnote">${IC.info}<div><b>Off the system</b><br><span>${esc(off.join(" · "))}. Pick a token above to bring it back.</span></div></div></div>`);
    body.append(n);
  }

  // overrides on this element
  const css = OV.get(s.env);
  if (css === undefined) loadOverrides(s.env).then(() => S.sel === s && renderDesign());
  const mine = parseRules(css || "").filter((ru) => norm(ru.selector) === norm(i.selector) || norm(ru.selector) === norm(i.exactSelector));
  if (mine.length) {
    const O = sec("Overrides here", `<span class="tct">${mine.reduce((n, ru) => n + ru.decls.length, 0)}</span>`);
    for (const ru of mine) for (const [p, val] of ru.decls) O.append(h(`<div class="orule"><code title="${esc(val)}">${esc(p)}: ${esc(val)}</code></div>`));
    const rb = h(`<button type="button" class="ghbtn sm" style="align-self:flex-start">${IC.restore}Reset this element</button>`);
    rb.onclick = async () => {
      try {
        let res;
        for (const ru of mine) res = await api(`envs/${s.env}/styles`, { method: "DELETE", body: { selector: ru.selector } });
        OV.set(s.env, res.css);
        rt(s.env)?.setOverrides(res.css);
        requestAnimationFrame(() => (refreshSelInfo(), renderDesign(), markDirty()));
      } catch (e) {
        toast("Couldn't reset", e.message);
      }
    };
    O.append(rb);
    body.append(O);
  }

  const a = h(`<div class="isec"><button type="button" class="dbtn" style="align-self:flex-start">${IC.agent}Ask an agent about this</button></div>`);
  a.querySelector("button").onclick = () => fire("ask-agent", {});
  body.append(a);
}

// ---------- right: agent ----------
let draft = "";
export function renderAgent() {
  const box = $("rAgent");
  if (S.rightTab !== "agent") return;
  const s = S.sel;
  const env = selEnv();
  const ws = S.ws;
  const hs = ws.harnesses || [];
  const thread = h(`<div class="athread" aria-live="polite"></div>`);
  thread.append(h(`<div class="ahar"><span class="hdot${hs.length || ws.agent ? " on" : ""}"></span><span>${ws.agent ? `Requests run with <b>${esc(ws.agent.name)}</b>` : hs.length ? `<b>${esc(hs[0].client)}</b> is connected` : "No agent connected — requests wait"}</span><span class="sp"></span><button type="button">${ws.agent || hs.length ? "Settings" : "Connect"}</button></div>`));
  thread.querySelector(".ahar button").onclick = () => fire("connect");
  const tasks = S.tasks.filter((t) => !env || t.env === env.id).slice(-30);
  if (!tasks.length) {
    const sug = h(`<div class="asug"><span class="h">${env ? `Ask an agent to change ${esc(env.name)}. It edits the prototype's files, saves a version first, and the board reloads when it's done.` : "Select a board, then ask an agent to change it."}</span></div>`);
    if (env)
      for (const p of ["Make the sidebar denser: 28px rows", "Add an empty state to this screen", "Try a warmer surface for the content card"]) {
        const b = h(`<button type="button">${esc(p)}</button>`);
        b.onclick = () => {
          const ta = box.querySelector("textarea");
          ta.value = p;
          draft = p;
          ta.focus();
          syncSend();
        };
        sug.append(b);
      }
    thread.append(sug);
  }
  for (const t of tasks) thread.append(taskView(t, !env));
  // composer
  const comp = h(`<div class="acomp"><div class="abar chips"></div><textarea rows="2" aria-label="Request" placeholder="${env ? `Ask an agent to change ${esc(env.name)}` : "Select a board first"}" ${env ? "" : "disabled"}></textarea><div class="abar"><span class="sp"></span><button type="button" class="sendb" aria-label="Send request" disabled>${IC.send}</button></div></div>`);
  const chips = comp.querySelector(".chips");
  if (env) chips.append(h(`<span class="chip"><span class="l">${esc(env.name)}</span></span>`));
  if (s?.kind === "el" && S.draftSel) {
    const c = h(`<span class="chip" title="${esc(s.info?.selector)}"><span class="l">${esc(s.info?.label || "element")}</span><button type="button" aria-label="Don't attach the selection">${IC.x}</button></span>`);
    c.querySelector("button").onclick = () => {
      S.draftSel = false;
      renderAgent();
    };
    chips.append(c);
  }
  chips.hidden = !chips.children.length;
  const ta = comp.querySelector("textarea");
  const send = comp.querySelector(".sendb");
  ta.value = draft;
  const syncSend = () => {
    send.disabled = !env || !ta.value.trim();
  };
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
      await api("tasks", { method: "POST", body: { env: env.id, prompt, selection } });
      draft = "";
      S.draftSel = true;
      fire("tasks-changed");
    } catch (e) {
      toast("Couldn't send the request", e.message);
    } finally {
      busy = false;
    }
  };
  send.onclick = go;
  ta.addEventListener("keydown", (e) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      go();
    }
  });
  syncSend();
  box.replaceChildren(thread, comp);
  thread.scrollTop = thread.scrollHeight;
  if (renderAgent.focus) {
    renderAgent.focus = false;
    ta.focus();
  }
}

const STATUS = { queued: ["QUEUED", ""], working: ["WORKING", "info"], done: ["DONE", "ok"], failed: ["FAILED", "err"], cancelled: ["STOPPED", ""] };
const openLogs = new Set();
function taskView(t, showEnv) {
  const env = S.envs.get(t.env);
  const ws = S.ws;
  const w = h(`<div class="arun-wrap" style="display:flex;flex-direction:column;gap:8px"></div>`);
  w.append(h(`<div class="amsg">${esc(t.prompt)}</div>`));
  if (t.selection?.selector || showEnv) w.append(h(`<div class="actx" title="${esc(t.selection?.selector || "")}">${esc([t.selection?.label, showEnv ? env?.name || t.env : null].filter(Boolean).join(" · "))}</div>`));
  const [lab, cls] = STATUS[t.status] || [t.status.toUpperCase(), ""];
  const who = t.claimedBy || (t.runner === "auto" ? ws.agent?.name : null);
  const waiting = t.status === "queued" && !ws.agent && !(ws.harnesses || []).length;
  const run = h(`<div class="arun"><div class="st"><span class="tagro ${cls}">${lab}</span>${who ? `<b>${esc(who)}</b>` : `<span>${t.status === "queued" ? (waiting ? "Waiting for an agent" : "Waiting for the agent to take it") : ""}</span>`}${t.status === "working" ? '<span class="dots" aria-hidden="true"><i></i><i></i><i></i></span>' : ""}<span class="sp"></span><span>${esc(timeAgo(t.updatedAt))}</span></div></div>`);
  if (t.reply) run.append(h(`<div class="rep">${esc(t.reply)}</div>`));
  if (waiting) {
    const c = h(`<div class="acts"><button type="button" class="dbtn sm">Connect an agent</button></div>`);
    c.querySelector("button").onclick = () => fire("connect");
    run.append(c);
  }
  if (t.changed?.length) run.append(h(`<div class="files">${t.changed.slice(0, 8).map((f) => `<span class="tagro">${esc(f)}</span>`).join("")}${t.changed.length > 8 ? `<span class="tagro">+${t.changed.length - 8}</span>` : ""}</div>`));
  const acts = h(`<div class="acts"></div>`);
  if (t.log?.length) {
    const lb = h(`<button type="button" class="ghbtn sm">${openLogs.has(t.id) ? "Hide log" : "Show log"}</button>`);
    lb.onclick = () => {
      openLogs.has(t.id) ? openLogs.delete(t.id) : openLogs.add(t.id);
      renderAgent();
    };
    acts.append(lb);
  }
  if (t.status === "working" || t.status === "queued") {
    const sb = h(`<button type="button" class="ghbtn sm">${IC.stop}Stop</button>`);
    sb.onclick = async () => {
      await api(`tasks/${t.id}/cancel`, { method: "POST" }).catch((e) => toast("Couldn't stop it", e.message));
      fire("tasks-changed");
    };
    acts.append(sb);
  }
  if ((t.status === "done" || t.status === "failed" || t.status === "cancelled") && t.beforeVersion) {
    const ub = h(`<button type="button" class="dbtn sm">${IC.restore}Undo changes</button>`);
    ub.onclick = () => fire("restore-version", { id: t.env, n: t.beforeVersion, label: "the agent's changes" });
    acts.append(ub);
  }
  if (acts.children.length) run.append(acts);
  if (openLogs.has(t.id) && t.log?.length) run.append(h(`<div class="log">${t.log.map((l) => `<span class="${l.kind}">${esc(l.text)}</span>`).join("\n")}</div>`));
  w.append(run);
  return w;
}

export function renderRight() {
  $("rDesign").hidden = S.rightTab !== "design";
  $("rAgent").hidden = S.rightTab !== "agent";
  $("rAgent").style.display = S.rightTab === "agent" ? "flex" : "none";
  if (S.rightTab === "design") renderDesign();
  else renderAgent();
  const active = S.tasks.filter((t) => t.status === "queued" || t.status === "working").length;
  $("rAgentN").textContent = active || "";
}

export function initPanels() {
  for (const b of document.querySelectorAll("#lTabs button"))
    b.addEventListener("click", () => {
      S.leftTab = b.dataset.t;
      for (const x of document.querySelectorAll("#lTabs button")) {
        x.classList.toggle("on", x === b);
        x.setAttribute("aria-selected", String(x === b));
      }
      renderLeft();
    });
  for (const b of document.querySelectorAll("#rTabs button"))
    b.addEventListener("click", () => {
      S.rightTab = b.dataset.t;
      for (const x of document.querySelectorAll("#rTabs button")) {
        x.classList.toggle("on", x === b);
        x.setAttribute("aria-selected", String(x === b));
      }
      renderRight();
    });
  on("sel", () => {
    renderLeft();
    renderRight();
  });
  on("board-ready", (id) => {
    if (S.sel?.env === id) {
      renderLeft();
      renderRight();
    }
  });
  on("env-meta", (id) => {
    OV.delete(id);
    if (S.sel?.env === id) renderRight();
    renderBoards();
  });
  on("ask-agent", ({ prompt } = {}) => {
    S.rightTab = "agent";
    S.draftSel = true;
    if (prompt) draft = prompt;
    for (const x of document.querySelectorAll("#rTabs button")) {
      x.classList.toggle("on", x.dataset.t === "agent");
      x.setAttribute("aria-selected", String(x.dataset.t === "agent"));
    }
    renderAgent.focus = true;
    renderRight();
  });
}
