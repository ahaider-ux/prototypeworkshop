// Atelier — boot, Home and tabs, pages, live updates, branches, review and merge, dialogs.

import { S, on, fire, envList, boardsOf, itemsOf, isBranch, rootOf, roots, familyOf, pageEnv, protoId, pageItems, pageOf, screenName, plural, pageName } from "./state.js";
import { $, qa, h, esc, api, events, toast, IC, menu, modal, closeModal, copyText, timeAgo, segmented, skeleton, loadingToast, pendingButton, initTips } from "./lib.js";
import { setTool, addLink, addPicture, initCanvas, sync, fit, fitOpen, fitPair, camNow, flyTo, focusItem, fitRect, selectBoard, clearSel, reloadEnv, markDirty, setMode, importFile, isTyping, boardOf, openThread, placeScreen, isDragging, selectItem, restoreCam, pageBounds } from "./canvas.js";
import { initPanels, renderLeft, renderRight, renderBanner, loadVersions, loadDiff } from "./panels.js";
import { rulesFor, loadOverrides } from "./styles.js";
import { loadRecipes } from "./recipes.js";
import { playIntro } from "./intro.js";
import { mountHomeCanvas } from "./home.js";
import { branchStatus, branchCounts } from "./boardfacts.js";
import { FEATURES, artEl, openLearn } from "./visuals.js";

const store = {
  get(k, d) {
    try {
      const v = JSON.parse(localStorage.getItem(k) || "null");
      return v ?? d;
    } catch {
      return d;
    }
  },
  set(k, v) {
    try {
      localStorage.setItem(k, JSON.stringify(v));
    } catch {}
  },
};

// ---------- data ----------
// Answers can arrive out of order (a branch created, an agent writing to it a moment later, a second
// load started meanwhile). An older answer must never overwrite a newer one: a load that a newer load
// has overtaken waits for that one instead, and a prototype fetched on its own after a load began keeps
// its fresher record. (A stale record keeps a stale look, and the canvas keeps a stale picture.)
let wsSeq = 0,
  wsLatest = null;
const envFetched = new Map(); // env id → when its own record was last asked for
function loadWorkspace() {
  const seq = ++wsSeq;
  const started = performance.now();
  const run = (async () => {
    const ws = await api("workspace");
    if (seq !== wsSeq) return wsLatest;
    applyWorkspace(ws, started);
  })();
  wsLatest = run;
  return run;
}
function applyWorkspace(ws, started) {
  const prev = S.envs;
  S.ws = ws;
  S.envs = new Map(ws.envs.map((e) => [e.id, (envFetched.get(e.id) || 0) > started && prev.get(e.id) ? prev.get(e.id) : e]));
  S.items = new Map(ws.items.map((i) => [i.id, i]));
  if (S.sel && S.sel.item && !S.items.has(S.sel.item)) clearSel();
  S.tabs = S.tabs.filter((id) => S.envs.has(id) && !isBranch(S.envs.get(id)));
  if (S.view === "proto" && !S.envs.has(S.page)) return applyRoute();
  sync();
  renderAll();
}
let itemsT = 0;
async function loadItems() {
  clearTimeout(itemsT);
  if (isDragging()) return void (itemsT = setTimeout(loadItems, 300)); // never swap items out from under a drag
  try {
    const list = await api("canvas/items");
    S.items = new Map(list.map((i) => [i.id, i]));
    if (S.sel?.item && !S.items.has(S.sel.item)) clearSel();
    sync();
    if (S.view === "home") return renderHome();
    renderLeft();
    renderBanner();
  } catch {}
}
async function loadComments() {
  S.comments = await api("comments").catch(() => S.comments);
  markDirty();
  if (S.view === "proto" && (S.leftTab === "notes" || S.leftTab === "file")) renderLeft();
}
let lastStatus = new Map();
async function loadActivity() {
  try {
    S.activity = await api("activity?limit=300");
  } catch {
    return;
  }
  if (S.view === "proto") renderLeft();
}
async function loadTasks() {
  const list = await api("tasks").catch(() => S.tasks);
  for (const t of list) {
    const was = lastStatus.get(t.id);
    if (was && was !== t.status && (t.status === "done" || t.status === "failed")) {
      const env = S.envs.get(t.env);
      toast(t.status === "done" ? `${t.claimedBy || "The agent"} finished` : `${t.claimedBy || "The agent"} couldn't finish`, `${pageName(env) || t.env}${t.reply ? ` · ${t.reply.slice(0, 120)}` : ""}`, isBranch(env) && t.status === "done" ? { label: "Review and merge", fn: () => openReview(env.id) } : { label: "Show", fn: () => (go(t.env), fire("ask-agent", {})) });
      S.diffs.delete(t.env);
      loadDiff(t.env);
    }
  }
  // a recipe's results only move when a run starts or finishes, not on every log line
  if (list.length !== lastStatus.size || list.some((t) => lastStatus.get(t.id) !== t.status)) loadRecipes();
  lastStatus = new Map(list.map((t) => [t.id, t.status]));
  S.tasks = list;
  if (S.view === "proto") renderLeft();
}
function renderAll() {
  renderTabs();
  renderWho();
  renderAgent();
  if (S.view === "home") return renderHome();
  renderLeft();
  renderRight();
  renderBanner();
  markDirty();
}
function renderWho() {
  const hs = S.ws?.harnesses || [];
  const w = $("who");
  w.replaceChildren(h(`<span class="av" title="You">Y</span>`));
  if (hs.length || S.ws?.agent) {
    const name = hs[0]?.client || S.ws.agent.name;
    w.append(h(`<span class="av agent" title="${esc(name)}${hs.length ? " is connected" : " runs requests"}">${esc(name[0])}<span class="on"></span></span>`));
  } else {
    const c = h(`<button type="button" class="av" style="margin-left:-6px;cursor:pointer" aria-label="Connect your AI tool" data-tip="Connect your AI tool">${IC.plus}</button>`);
    c.onclick = openConnect;
    w.append(c);
  }
}
function renderAgent() {
  const ws = S.ws;
  const hs = ws?.harnesses || [];
  const on = !!(hs.length || ws?.agent);
  // not connected: the one visible call to action in the header; connected: a quiet status pill
  $("agentBtn").className = on ? "dbtn sm agst" : "createbtn sm agst cta";
  $("agentDot").classList.toggle("on", on);
  $("agentTxt").innerHTML = hs.length ? `<b>${esc(hs[0].client)}</b> connected` : ws?.agent ? `Requests run with <b>${esc(ws.agent.name)}</b>` : "Connect your AI tool";
}

// ---------- where you are: Home, or a page of a prototype ----------
// #/ is Home; #/p/<prototype> is its main page; #/p/<prototype>/<branch> one of its branches.
const lastPage = new Map(store.get("ws-last", []));
// the home's sections: one sidebar that stays, and the main area that changes under it
const SECTIONS = ["home", "prototypes", "learn", "activity"];
function parseHash() {
  const m = /^#\/p\/([^/?#]+)(?:\/([^/?#]+))?/.exec(location.hash);
  const dec = (s) => {
    try {
      return decodeURIComponent(s);
    } catch {
      return "";
    }
  };
  if (!m) {
    // #/in/<prototype>: the level inside a project on the home canvas
    const inside = /^#\/in\/([^/?#]+)$/.exec(location.hash);
    if (inside) return { view: "home", section: "home", inside: dec(inside[1]) };
    const sec = /^#\/([a-z]+)$/.exec(location.hash)?.[1];
    return { view: "home", section: SECTIONS.includes(sec) ? sec : "home" };
  }
  return { view: "proto", root: dec(m[1]), page: m[2] ? dec(m[2]) : null };
}
function hashFor(page) {
  const root = rootOf(page);
  if (!root) return "#/";
  return `#/p/${encodeURIComponent(root.id)}${page !== root.id ? `/${encodeURIComponent(page)}` : ""}`;
}
function go(page) {
  const want = page === "home" || !S.envs.has(page) ? "#/" : hashFor(page);
  if (location.hash === want) applyRoute();
  else location.hash = want;
}
function applyRoute() {
  const r = parseHash();
  const root = r.view === "proto" ? S.envs.get(r.root) : null;
  if (!root || isBranch(root)) {
    if (r.view === "proto") history.replaceState(null, "", "#/");
    return showHome();
  }
  const page = r.page && S.envs.has(r.page) && rootOf(r.page)?.id === root.id ? r.page : root.id;
  if (r.page && page !== r.page) history.replaceState(null, "", hashFor(page));
  openPage(page);
}
function showHome() {
  if (presenting) stopPresent();
  S.view = "home";
  S.page = null;
  S.compare = false;
  if (S.sel) clearSel();
  $("home").hidden = false;
  $("work").hidden = true;
  $("frame").classList.add("home-on");
  sync();
  const r = parseHash();
  const sec = r.section || "home";
  const moved = S.homeSection && S.homeSection !== sec;
  S.homeSection = sec;
  // which level of the canvas: the space, inside a project, or inside Guides (#/learn)
  S.homeIn = sec === "learn" ? "guides" : sec === "activity" ? null : r.inside || null;
  renderTabs(); // after the section is known: the row shows where you are
  homeKey = "";
  renderHome(moved);
  const inEnv = S.homeIn && S.envs.get(S.homeIn);
  document.title = `${inEnv ? inEnv.name : S.homeIn === "guides" ? "Guides" : sec === "activity" ? "Activity" : S.ws.name} · Atelier`;
  store.set("ws-route", location.hash && parseHash().view === "home" ? location.hash : "#/");
}
const goSection = (sec) => {
  const want = sec === "home" ? "#/" : `#/${sec}`;
  if (location.hash === want || (want === "#/" && !location.hash)) showHome();
  else location.hash = want;
};
function openPage(page) {
  const changed = S.page !== page || S.view !== "proto";
  const root = rootOf(page);
  S.view = "proto";
  if (!S.tabs.includes(root.id)) (S.tabs.push(root.id), store.set("ws-tabs", S.tabs));
  lastPage.set(root.id, page);
  store.set("ws-last", [...lastPage].slice(-50));
  store.set("ws-route", hashFor(page));
  $("home").hidden = true;
  $("home").replaceChildren(); // its thumbnails are live pages: let them go
  $("work").hidden = false;
  $("frame").classList.remove("home-on");
  if (changed) {
    if (presenting) stopPresent();
    S.page = page;
    S.compare = false;
    if (S.sel) clearSel();
    sync();
    if (!restoreCam(page)) requestAnimationFrame(() => fitOpen({ ms: 0 }));
    loadDiff(page);
    for (const e of envList()) if (e.parent === page) loadDiff(e.id);
  }
  renderAll();
  document.title = `${pageName(pageEnv())} · ${root.name}`;
}
function renderTabs() {
  renderMode();
  const t = $("tabs");
  t.replaceChildren();
  // One row of navigation, always here: the space's three places (Prototypes is the board), then
  // the prototypes you have open. Nothing else navigates.
  const cur = S.view === "home" ? (S.homeSection === "activity" ? "activity" : "home") : null; // every level of the canvas is Home
  for (const [sec, icon, label] of [["home", IC.home, "Home"], ["activity", IC.version, "Activity"]]) {
    const on = cur === sec;
    const tab = h(`<div class="tab tab-home${on ? " on" : ""}" role="tab" tabindex="0" data-s="${sec}" aria-selected="${on}">${icon}<span class="t">${label}</span></div>`);
    tab.onclick = () => goSection(sec);
    tab.onkeydown = (e) => e.key === "Enter" && goSection(sec);
    t.append(tab);
  }
  if (S.tabs.some((id) => S.envs.has(id))) t.append(h(`<span class="tsep" aria-hidden="true"></span>`));
  for (const id of S.tabs) {
    const e = S.envs.get(id);
    if (!e) continue;
    const on = S.view === "proto" && protoId() === id;
    const tab = h(`<div class="tab${on ? " on" : ""}" role="tab" tabindex="0" aria-selected="${on}" title="${esc(e.name)}"><span class="t">${esc(e.name)}</span><button type="button" class="ib24" aria-label="Close ${esc(e.name)}">${IC.x}</button></div>`);
    const open = () => go(S.envs.has(lastPage.get(id)) ? lastPage.get(id) : id);
    tab.onclick = (ev) => !ev.target.closest(".ib24") && open();
    tab.onkeydown = (ev) => ev.key === "Enter" && open();
    tab.querySelector(".ib24").onclick = (ev) => (ev.stopPropagation(), closeTab(id));
    t.append(tab);
  }
}
function closeTab(id) {
  const i = S.tabs.indexOf(id);
  S.tabs = S.tabs.filter((x) => x !== id);
  store.set("ws-tabs", S.tabs);
  if (protoId() === id && S.view === "proto") {
    const next = S.tabs[Math.min(i, S.tabs.length - 1)];
    return go(next ? lastPage.get(next) || next : "home");
  }
  renderTabs();
}

// ---------- Home: what this is, and your prototypes ----------
let homeKey = "";
function lastEdit(rootId) {
  const fam = new Set(familyOf(rootId).map((x) => x.env.id));
  let t = 0;
  const see = (s) => {
    const v = Date.parse(s || "");
    if (Number.isFinite(v) && v > t) t = v;
  };
  for (const x of familyOf(rootId)) see(x.env.created), see(x.env.branch?.at), see(x.env.mergedAt);
  for (const it of S.items.values()) if (fam.has(pageOf(it))) see(it.updatedAt), see(it.createdAt);
  for (const tk of S.tasks) if (fam.has(tk.env)) see(tk.updatedAt);
  return t ? new Date(t).toISOString() : null;
}
// Home is a canvas in levels (ui/home.js is one level's canvas). The space: a block for each
// project, and Guides. Inside a project: Main and its branches, and a place to start a new one.
// Inside Guides: the guides. Entering Main or a branch opens its frames in the editor.
let homeCv = null,
  homeLevel = "";
const firstBoard = (id) => boardsOf(id).slice().sort((a, b) => a.y - b.y || a.x - b.x)[0] || null;
// open comments and notes on a page: what people have said about it
const commentsOn = (id) => S.comments.filter((c) => !c.parent && !c.resolved && c.env === id).length + itemsOf("note").filter((n) => n.env === id).length;
const openBranches = (rootId) => familyOf(rootId).map((x) => x.env).filter((e) => isBranch(e) && !e.archived);
function branchFacts(b) {
  const d = S.diffs.get(b.id);
  if (!d) loadDiff(b.id);
  const tasks = S.tasks.filter((t) => t.env === b.id);
  return { changes: d?.changes.length || 0, conflicts: d?.conflicts || 0, comments: commentsOn(b.id), working: tasks.filter((t) => t.status === "working").length, queued: tasks.filter((t) => t.status === "queued").length };
}
const goIn = (x) => (location.hash = x === "guides" ? "#/learn" : x ? `#/in/${encodeURIComponent(x)}` : "#/");
function homeLevelOf(rs) {
  const root = S.homeIn && S.homeIn !== "guides" ? S.envs.get(S.homeIn) : null;
  if (root && !isBranch(root)) {
    // inside a project: Main, then each branch (newest first), then a new one
    const brs = openBranches(root.id).sort((a, b) => String(b.branch?.at || b.created || "").localeCompare(String(a.branch?.at || a.created || "")));
    const mc = commentsOn(root.id);
    const items = [
      { id: root.id, name: "Main", meta: ["The agreed version", plural(boardsOf(root.id).length, "screen"), branchCounts({ comments: mc })].filter(Boolean).join(" · "), board: firstBoard(root.id), cue: "Open", cls: "hproj" },
      ...brs.map((b) => {
        const f = branchFacts(b);
        return { id: b.id, name: b.name, meta: [branchStatus(f).label, branchCounts(f), `${b.author || "Someone"}, ${timeAgo(b.branch?.at || b.created)}`].filter(Boolean).join(" · "), board: firstBoard(b.id), cue: "Open" };
      }),
    ];
    const actions = [{ title: "New branch", desc: "Try an idea without touching Main", icon: IC.fork, cue: "Branch", run: () => createBranch(root.id) }];
    return { key: `in:${root.id}`, title: root.name, sub: [plural(boardsOf(root.id).length, "screen"), brs.length ? plural(brs.length, "open branch", "open branches") : "no branches yet"].join(" · "), items, actions, open: (it) => go(it.id) };
  }
  if (S.homeIn === "guides") {
    const actions = FEATURES.map((f, i) => ({ title: f.title, desc: f.text, cue: "Learn", art: () => artEl(f.id), run: () => learn(i) }));
    return { key: "guides", title: "Guides", sub: `${FEATURES.length} short guides to what you can do here`, items: [], actions, open: () => {} };
  }
  // the space: a block per project (most recently edited first), Guides, and what to add
  const items = rs
    .map((e) => {
      const brs = openBranches(e.id);
      const ready = brs.filter((b) => branchStatus(branchFacts(b)).tone === "ok").length;
      const edited = lastEdit(e.id);
      return { id: e.id, name: e.name, edited, board: firstBoard(e.id), cue: "Enter", cls: "hproj", deep: true, meta: [plural(boardsOf(e.id).length, "screen"), brs.length ? plural(brs.length, "branch", "branches") : "", ready ? `${ready} ready to review` : ""].filter(Boolean).join(" · ") };
    })
    .sort((a, b) => String(b.edited || "").localeCompare(String(a.edited || "")));
  const actions = [
    { title: "Guides", desc: `${FEATURES.length} short guides to what you can do here`, cue: "Enter", deep: true, art: () => artEl("intro"), run: () => goIn("guides") },
    { title: "Add a prototype", desc: "Import an HTML file or a whole folder", icon: IC.upload, cue: "Start", run: openImport },
    ...(S.ws.spaces ? [{ title: "Connect a folder", desc: "Edit prototypes where they live", icon: IC.folder, cue: "Connect", run: () => openSpaces() }] : []),
    ...(S.ws.harnesses?.length ? [] : [{ title: "Connect your AI tool", desc: "It works on branches; you review", icon: IC.agent, cue: "Connect", run: openConnect }]),
  ];
  return { key: "space", title: "", sub: "", items, actions, open: (it) => goIn(it.id) };
}
function renderHomeCanvas(rs) {
  const el = homeMain();
  // a project that's gone (deleted, or a link to a branch): back to the space
  if (S.homeIn && S.homeIn !== "guides" && !(S.envs.get(S.homeIn) && !isBranch(S.envs.get(S.homeIn)))) {
    S.homeIn = null;
    history.replaceState(null, "", "#/");
  }
  const lv = homeLevelOf(rs);
  if (!homeCv || homeLevel !== lv.key || !el.querySelector(".hcanvas")) {
    homeCv?.destroy();
    el.replaceChildren();
    el.classList.add("hc");
    homeLevel = lv.key;
    homeCv = mountHomeCanvas(el, lv.items, { open: lv.open, actions: lv.actions, key: `${S.ws.home || S.ws.name}|${lv.key}` });
  } else homeCv.update(lv.items, lv.actions);
  // where you are, and the way back up (also Esc); nothing on the first level
  el.querySelector(".hpathbar")?.remove();
  if (lv.key !== "space") {
    const bar = h(`<div class="hpathbar"><button type="button" class="dbtn sm" data-a="up"><span class="flip">${IC.chevr}</span>Home</button><b></b><span class="m"></span></div>`);
    bar.querySelector("b").textContent = lv.title;
    bar.querySelector(".m").textContent = lv.sub;
    bar.querySelector('[data-a="up"]').onclick = () => goIn(null);
    el.append(bar);
  }
}
// Esc goes up a level on the home canvas (unless a dialog or a menu has it)
document.addEventListener("keydown", (e) => {
  if (e.key !== "Escape" || S.view !== "home" || !S.homeIn || S.homeSection === "activity") return;
  if (document.querySelector("#modal.open, .cnmenu") || /^(INPUT|TEXTAREA)$/.test(document.activeElement?.tagName || "")) return;
  goIn(null);
});
// The home is one main area that changes with the section; the header's row navigates between them.
function homeShell() {
  const home = $("home");
  if (!home.querySelector(".hmain")) home.replaceChildren(h(`<div class="hmain" id="homeMain"></div>`));
  return home;
}
const homeMain = () => homeShell().querySelector(".hmain");
// Each Learn step offers the real thing it describes, on the person's own work: the prototype they
// edited last, or the newest open branch for review. A step that can't be done here has no button.
const latestRoot = () => roots().slice().sort((a, b) => (lastEdit(b.id) || "").localeCompare(lastEdit(a.id) || ""))[0] || null;
const latestBranch = () =>
  envList()
    .filter((e) => isBranch(e) && !e.archived && !e.mergedAt)
    .sort((a, b) => (b.branch?.at || b.created || "").localeCompare(a.branch?.at || a.created || ""))[0] || null;
// open a prototype, then act once its canvas is showing (opening goes through the route)
function openThen(id, fn) {
  go(id);
  const t0 = performance.now();
  const wait = () => (S.view === "proto" && S.page === id ? fn() : performance.now() - t0 < 3000 && requestAnimationFrame(wait));
  requestAnimationFrame(wait);
}
function learnActions() {
  const p = latestRoot(),
    b = latestBranch();
  return {
    learn: () => goSection("learn"),
    import: { label: "Import HTML", run: openImport },
    branch: p && { label: "Create a branch", run: () => openThen(p.id, () => createBranch(p.id)) },
    markup: p && { label: "Add a note", run: () => openThen(p.id, () => setTool("note")) },
    agent: { label: S.ws.harnesses?.length ? "See connected tools" : "Connect your AI tool", run: openConnect },
    merge: b && { label: "Review a branch", run: () => openThen(b.id, () => openReview(b.id)) },
    recipes: p && { label: "Open recipes", run: () => openThen(p.id, () => fire("left-tab", "recipes")) },
  };
}
const learn = (i) => openLearn(i, learnActions());
function renderHome(moved = false) {
  if (S.view !== "home") return;
  const rs = roots();
  const key = JSON.stringify([S.homeSection, S.homeIn, S.ws.name, S.ws.home, S.ws.spaces, S.ws.harnesses?.length || 0, S.comments.length, S.tasks.map((t) => t.status).join(), S.activity?.length || 0, [...S.diffs].map(([k, d]) => [k, d.changes.length, d.conflicts]), rs.map((e) => [e.id, e.name, familyOf(e.id).map((x) => [x.env.id, x.env.name, x.env.archived]), boardsOf(e.id).length, boardsOf(e.id)[0]?.screen, lastEdit(e.id)])]);
  if (key === homeKey) return;
  homeKey = key;
  const main = homeMain();
  if (moved && !matchMedia("(prefers-reduced-motion: reduce)").matches) main.animate([{ opacity: 0, filter: "blur(2px)" }, { opacity: 1, filter: "blur(0)" }], { duration: 180, easing: "ease-out" });
  if (S.homeSection === "activity") {
    homeCv?.destroy();
    homeCv = null;
    homeLevel = "";
    main.classList.remove("hc");
    return renderActivityPage(main);
  }
  renderHomeCanvas(rs); // every other route is a level of the canvas
}
// Activity: what people and agents did across the space, newest first
async function renderActivityPage(main) {
  const page = h(`<div class="hl"><header class="hl-h"><h1>Activity</h1><p>What people and agents changed in this space, newest first.</p></header><div class="hl-acts-list"></div></div>`);
  main.replaceChildren(page);
  const list = page.querySelector(".hl-acts-list");
  list.append(h(`<div class="pempty"><b class="shimmer">Loading…</b></div>`));
  let rows = [];
  try {
    rows = await api("activity?limit=80");
  } catch {}
  if (S.homeSection !== "activity" || !page.isConnected) return;
  rows = (Array.isArray(rows) ? rows : rows?.items || []).slice().reverse();
  list.replaceChildren();
  if (!rows.length) {
    const p = latestRoot();
    const em = h(`<div class="pempty"><b>Nothing here yet</b>Branches, merges, notes and agents' updates show up here as they happen.<button type="button" class="dbtn sm"></button></div>`);
    const btn = em.querySelector("button");
    if (p) (btn.innerHTML = `${IC.fork}Create a branch`), (btn.onclick = () => openThen(p.id, () => createBranch(p.id)));
    else (btn.innerHTML = `${IC.upload}Import HTML`), (btn.onclick = openImport);
    return list.append(em);
  }
  for (const e of rows) {
    const env = e.env && S.envs.get(e.env);
    const r = h(`<button type="button" class="hact"><span class="hact-k">${e.by && /claude|agent|codex|cursor/i.test(e.by) ? IC.spark : IC.version}</span><span class="hact-t"><span class="x"></span><span class="m"></span></span><span class="hact-w"></span></button>`);
    r.querySelector(".x").textContent = e.text;
    r.querySelector(".m").textContent = [e.by, env ? pageName(env) : ""].filter(Boolean).join(" · ");
    r.querySelector(".hact-w").textContent = timeAgo(e.at);
    if (env) r.onclick = () => go(env.id);
    else r.disabled = true;
    list.append(r);
  }
}
// ---------- branches ----------
function copyStorage(from, to) {
  try {
    const pre = `ws:${from}:`;
    const real = window.localStorage;
    const keys = [];
    for (let i = 0; i < real.length; i++) {
      const k = real.key(i);
      if (k && k.startsWith(pre)) keys.push(k);
    }
    for (const k of keys) real.setItem(`ws:${to}:${k.slice(pre.length)}`, real.getItem(k));
  } catch {}
}
function createBranch(id) {
  const src = S.envs.get(id);
  if (!src) return;
  const md = modal(`<div class="md-h"><div class="tt"><h2>Create a branch of ${esc(pageName(src))}</h2><p>A new page with the same ${plural(boardsOf(id).length, "screen")}. Change anything there; ${esc(pageName(src))} only changes when you merge.</p></div></div><form class="md-b" id="brF"><div class="fld"><span class="lr">What are you trying?</span><div class="afld-in"><input id="brIn" maxlength="120" placeholder="Denser sidebar" autofocus></div></div></form><div class="md-f"><button type="button" class="ghbtn" data-a="x">Cancel</button><button type="button" class="createbtn" data-a="ok">${IC.fork}Create branch</button></div>`);
  md.style.width = "480px";
  let busy = false;
  const ok = async () => {
    if (busy) return;
    busy = true;
    const undoBusy = pendingButton(md.querySelector('[data-a="ok"]'), "Creating branch…");
    try {
      const env = await api(`envs/${id}/branch`, { method: "POST", body: { name: $("brIn").value.trim() || undefined } });
      copyStorage(id, env.id);
      closeModal();
      await loadWorkspace();
      go(env.id);
      toast(`Created ${env.name}`, `A branch of ${pageName(src)}. It reads ${pageName(src)}'s files until it changes them`);
    } catch (e) {
      busy = false;
      undoBusy();
      toast("Couldn't create the branch", e.message);
    }
  };
  md.querySelector('[data-a="ok"]').onclick = ok;
  md.querySelector('[data-a="x"]').onclick = closeModal;
  $("brF").onsubmit = (e) => (e.preventDefault(), ok());
}
const fmt = (v, key = "") => (v === null || v === undefined || v === "" ? (key.startsWith("variant:") ? "default" : key.startsWith("text:") ? "original text" : "none") : String(v));
async function openReview(id) {
  const env = S.envs.get(id);
  if (!env || !isBranch(env)) return;
  let d;
  try {
    d = await api(`envs/${id}/diff`);
    S.diffs.set(id, d);
  } catch (e) {
    return toast("Couldn't compare the branch", e.message);
  }
  const parent = S.envs.get(env.parent);
  const take = {};
  const md = modal(`<div class="md-h"><div class="tt"><h2>Review and merge</h2><p>${esc(env.name)} into ${esc(pageName(parent))} · ${d.changes.length} change${d.changes.length === 1 ? "" : "s"}${d.conflicts ? ` · ${d.conflicts} conflict${d.conflicts === 1 ? "" : "s"}: ${esc(pageName(parent))} changed the same thing since the branch was made` : ""}</p></div><button type="button" class="ib32" data-a="x" aria-label="Close">${IC.x}</button></div><div class="md-b" id="rvB"></div><div class="rvwhy fld"><label class="lr" for="rvWhy">Why merge this? <span style="color:var(--text-secondary);font-weight:400">· optional, kept in the decision log that agents read</span></label><div class="afld-in"><input id="rvWhy" maxlength="2000" placeholder="The sidebar felt cramped"></div></div><div class="md-f">${d.behind ? `<span style="font-size:12px;color:var(--text-secondary)">${d.behind} change${d.behind === 1 ? "" : "s"} on ${esc(pageName(parent))} stay as they are.</span>` : ""}<span class="sp"></span><button type="button" class="ghbtn" data-a="x2">Cancel</button><button type="button" class="createbtn" data-a="ok" ${d.changes.length ? "" : "disabled"}>Merge into ${esc(pageName(parent))}</button></div>`, { wide: true });
  const b = $("rvB");
  if (!d.changes.length) b.append(h(`<div class="pempty" style="padding:0"><b>Nothing to merge yet</b>This branch is the same as ${esc(pageName(parent))} was when it was made.</div>`));
  const groups = [["setting", "Settings"], ["style", "Design overrides"], ["file", "Files"]];
  for (const [kind, title] of groups) {
    const cs = d.changes.filter((c) => c.kind === kind);
    if (!cs.length) continue;
    const g = h(`<div class="rvg"><div class="rvh">${title} · ${cs.length}</div></div>`);
    for (const c of cs) {
      const val = kind === "file" ? (c.conflict ? `Changed here and on ${esc(pageName(parent))}` : "Changed on the branch") : `<del>${esc(fmt(c.main, c.key))}</del> → <ins>${esc(fmt(c.branch, c.key))}</ins>`;
      const r = h(`<div class="rvr${c.conflict ? " conflict" : ""}"><div style="display:flex;flex-direction:column;gap:4px;min-width:0"><span class="k">${esc(c.label)}</span><span class="v">${val}</span></div><span class="ch"></span></div>`);
      if (c.conflict) {
        take[c.key] = "branch";
        const pick = () =>
          r.querySelector(".ch").replaceChildren(
            segmented([{ label: "Keep branch", value: "branch" }, { label: `Keep ${pageName(parent).length > 14 ? "main" : pageName(parent)}`, value: "main" }], take[c.key], (v) => {
              take[c.key] = v;
              pick();
            }, { label: `Resolve ${c.label}` }),
          );
        pick();
      }
      g.append(r);
    }
    b.append(g);
  }
  md.querySelector('[data-a="x"]').onclick = closeModal;
  md.querySelector('[data-a="x2"]').onclick = closeModal;
  let busy = false;
  md.querySelector('[data-a="ok"]').onclick = async () => {
    if (busy) return;
    busy = true;
    const undoBusy = pendingButton(md.querySelector('[data-a="ok"]'), "Merging…");
    try {
      const r = await api(`envs/${id}/merge`, { method: "POST", body: { take, note: $("rvWhy")?.value.trim() || "" } });
      closeModal();
      await loadWorkspace();
      go(parent.id);
      toast(`Merged ${env.name} into ${pageName(parent)}`, `${plural(r.applied, "change")} · the branch is archived · V${r.before.n} has ${pageName(parent)} as it was`, {
        label: "Undo",
        fn: async () => {
          await api(`envs/${parent.id}/versions/${r.before.n}/restore`, { method: "POST" });
          await api(`envs/${id}`, { method: "PATCH", body: { archived: false } });
          await loadWorkspace();
        },
      });
    } catch (e) {
      busy = false;
      undoBusy();
      toast("Couldn't merge", e.message);
    }
  };
}
async function updateFromMain(id) {
  try {
    const r = await api(`envs/${id}/update-from-main`, { method: "POST" });
    S.diffs.delete(id);
    await loadWorkspace();
    loadDiff(id);
    toast(r.updated ? `Brought in ${plural(r.updated, "change")} from ${pageName(S.envs.get(S.envs.get(id).parent))}` : "Already up to date");
  } catch (e) {
    toast("Couldn't update the branch", e.message);
  }
}
function envMenu({ anchor, env: id }) {
  const e = S.envs.get(id);
  if (!e) return;
  const br = isBranch(e);
  const name = br ? "branch" : "prototype";
  menu(anchor, [
    ...(br ? [{ head: e.name }] : [{ head: e.name }]),
    ...(id !== S.page ? [{ label: br ? "Open branch" : "Open main", icon: br ? IC.fork : IC.board, onClick: () => go(id) }] : []),
    { label: br ? "Create a branch of this" : "Create branch", icon: IC.fork, onClick: () => createBranch(id) },
    ...(br && !e.archived ? [{ label: "Review and merge", icon: IC.check, onClick: () => openReview(id) }, { label: `Update from ${pageName(S.envs.get(e.parent))}`, icon: IC.restore, onClick: () => updateFromMain(id) }] : []),
    "-",
    { label: "Present", icon: IC.play, disabled: !boardsOf(id).length, onClick: () => (go(id), setTimeout(() => present(boardsOf(id)[0]?.id), 120)) },
    { label: "Share", icon: IC.share, onClick: () => openShare(id) },
    { label: "Rename", icon: IC.board, onClick: () => rename(id) },
    { label: "Copy folder path", icon: IC.folder, onClick: () => copyText(e.folder || "") },
    { label: "Make an independent copy", icon: IC.copy, onClick: () => duplicateEnv(id) },
    "-",
    ...(br ? [{ label: e.archived ? "Unarchive branch" : "Archive branch", onClick: () => fire(e.archived ? "unarchive" : "archive", id) }] : [{ label: "Close tab", onClick: () => closeTab(id) }]),
    { label: e.linked ? "Remove from Atelier" : `Delete ${name}`, icon: IC.trash, danger: true, onClick: () => remove(id) },
  ], { width: 256 });
}
async function duplicateEnv(id, version = null) {
  const src = S.envs.get(id);
  try {
    const env = await api(`envs/${id}/fork`, { method: "POST", body: { version, name: version ? `${src.name} V${version}` : undefined } });
    copyStorage(id, env.id);
    await loadWorkspace();
    go(env.id);
    toast(`Copied as ${env.name}`, "An independent prototype in its own tab, with no branch link back");
  } catch (e) {
    toast("Couldn't copy it", e.message);
  }
}
async function remove(id) {
  const env = S.envs.get(id);
  if (!env) return;
  try {
    const parent = isBranch(env) ? env.parent : null;
    const here = S.page === id;
    const { trash } = await api(`envs/${id}`, { method: "DELETE" });
    if (S.sel?.env === id) clearSel();
    if (!parent) (S.tabs = S.tabs.filter((x) => x !== id)), store.set("ws-tabs", S.tabs);
    await loadWorkspace();
    if (here) go(parent || "home");
    toast(env.linked ? `Removed ${env.name}` : `Deleted ${env.name}`, env.linked ? "Its folder and files are untouched. Look for prototypes to bring it back." : "It's in the trash until you empty it", {
      label: "Undo",
      fn: async () => {
        try {
          const back = await api("envs/restore", { method: "POST", body: { trash } });
          await loadWorkspace();
          go(back.id);
        } catch (e) {
          toast("Couldn't restore it", e.message);
        }
      },
    });
  } catch (e) {
    toast("Couldn't delete", e.message);
  }
}
function rename(id) {
  const env = S.envs.get(id);
  if (!env) return;
  const md = modal(`<div class="md-h"><div class="tt"><h2>Rename</h2><p>The folder stays envs/${esc(id)}, so agents and links keep working.</p></div></div><form class="md-b" id="rnF"><div class="fld"><span class="lr">Name</span><div class="afld-in"><input id="rnIn" value="${esc(env.name)}" maxlength="120" autofocus></div></div></form><div class="md-f"><button type="button" class="ghbtn" data-a="x">Cancel</button><button type="button" class="createbtn" data-a="ok">Rename</button></div>`);
  md.style.width = "480px";
  const ok = async () => {
    const v = $("rnIn").value.trim();
    if (!v) return $("rnIn").focus();
    try {
      S.envs.set(id, await api(`envs/${id}`, { method: "PATCH", body: { name: v } }));
      closeModal();
      renderAll();
      if (S.page) document.title = `${pageName(pageEnv())} · ${rootOf(S.page)?.name}`;
    } catch (e) {
      toast("Couldn't rename", e.message);
    }
  };
  md.querySelector('[data-a="ok"]').onclick = ok;
  md.querySelector('[data-a="x"]').onclick = closeModal;
  $("rnF").onsubmit = (e) => (e.preventDefault(), ok());
  setTimeout(() => $("rnIn")?.select(), 40);
}
function saveVersion(id) {
  const env = S.envs.get(id);
  const n = (S.versions.get(id)?.[0]?.n || 0) + 1;
  const md = modal(`<div class="md-h"><div class="tt"><h2>Save a version of ${esc(env.name)}</h2><p>A snapshot of its folder. Restore it or copy from it later.</p></div></div><form class="md-b" id="svF"><div class="fld"><span class="lr">What changed<span class="hint">Optional</span></span><div class="afld-in"><input id="svIn" placeholder="Version ${n}" maxlength="120" autofocus></div></div></form><div class="md-f"><button type="button" class="ghbtn" data-a="x">Cancel</button><button type="button" class="createbtn" data-a="ok">Save version</button></div>`);
  md.style.width = "480px";
  let busy = false;
  const ok = async () => {
    if (busy) return;
    busy = true;
    const undoBusy = pendingButton(md.querySelector('[data-a="ok"]'), "Saving…");
    try {
      const v = await api(`envs/${id}/versions`, { method: "POST", body: { label: $("svIn").value.trim() } });
      closeModal();
      await loadVersions(id);
      toast(`Saved V${v.n}`, v.label);
    } catch (e) {
      busy = false;
      undoBusy();
      toast("Couldn't save the version", e.message);
    }
  };
  md.querySelector('[data-a="ok"]').onclick = ok;
  md.querySelector('[data-a="x"]').onclick = closeModal;
  $("svF").onsubmit = (e) => (e.preventDefault(), ok());
}
async function restoreVersion({ id, n, label }) {
  try {
    const r = await api(`envs/${id}/versions/${n}/restore`, { method: "POST" });
    await loadVersions(id);
    S.diffs.delete(id);
    toast(label ? `Undid ${label}` : `Restored V${n}`, `The state before is saved as V${r.before.n}`, { label: "Undo", fn: () => restoreVersion({ id, n: r.before.n }) });
  } catch (e) {
    toast("Couldn't restore", e.message);
  }
}

// ---------- Prototype: one screen fills the window and you click through it ----------
// The editor has two states. Design is the canvas: every screen side by side, with the panels and
// tools. Prototype is one screen, as large as the window allows, running as the app; the bar under
// it moves between the page's screens and goes back to Design (Esc, or Design in the header).
let presenting = null;
const screensInOrder = () => pageItems("board").slice().sort((a, b) => a.y - b.y || a.x - b.x);
function present(bid) {
  const it = bid && S.items.get(bid);
  if (!it) return toast("Nothing to show yet", "Place a screen on the canvas first");
  if (presenting) return showIn(bid);
  presenting = { bid, mode: S.mode, cam: { ...S.cam } };
  $("frame").classList.add("present");
  setMode("prototype");
  const bar = h(`<div class="prsbar" role="toolbar" aria-label="Prototype"><button type="button" class="ib32 flip" data-a="prev" aria-label="Previous screen" data-tip="Previous screen" data-tip-up>${IC.chevr}</button><button type="button" class="ddtrig" data-a="pick" aria-haspopup="menu"><span class="v"></span>${IC.chev}</button><button type="button" class="ib32" data-a="next" aria-label="Next screen" data-tip="Next screen" data-tip-up>${IC.chevr}</button><span class="vsep"></span><span class="tagro" data-a="size"></span><button type="button" class="ghbtn sm" data-a="tab">${IC.ext}New tab</button><button type="button" class="createbtn sm" data-a="exit">Back to design</button></div>`);
  const step = (d) => {
    const list = screensInOrder();
    const i = list.findIndex((x) => x.id === presenting?.bid);
    if (list.length > 1) showIn(list[(i + d + list.length) % list.length].id);
  };
  bar.querySelector('[data-a="prev"]').onclick = () => step(-1);
  bar.querySelector('[data-a="next"]').onclick = () => step(1);
  bar.querySelector('[data-a="pick"]').onclick = (e) => menu(e.currentTarget, screensInOrder().map((x) => ({ label: screenName(x), checked: x.id === presenting?.bid, onClick: () => showIn(x.id) })));
  bar.querySelector('[data-a="tab"]').onclick = () => {
    const cur = S.items.get(presenting?.bid);
    if (cur) window.open(`/present/${cur.env}/?screen=${encodeURIComponent(cur.screen || "")}`, "_blank", "noopener");
  };
  bar.querySelector('[data-a="exit"]').onclick = stopPresent;
  $("frame").append(bar);
  presenting.bar = bar;
  presenting.cleanup = () => bar.remove();
  showIn(bid);
  renderMode();
}
// put a screen in the window: the one being shown changes, the state stays
function showIn(bid) {
  const it = S.items.get(bid);
  if (!it || !presenting) return;
  boardOf(presenting.bid)?.el.classList.remove("presenting");
  presenting.bid = bid;
  S.presenting = bid;
  markDirty(); // the picture drawn is this screen's
  selectBoard(bid, { quiet: true });
  boardOf(bid)?.el.classList.add("presenting");
  const bar = presenting.bar,
    many = screensInOrder().length > 1;
  bar.querySelector(".v").textContent = screenName(it);
  bar.querySelector('[data-a="size"]').textContent = `${it.w} × ${it.h}`;
  for (const a of ["prev", "next"]) bar.querySelector(`[data-a="${a}"]`).disabled = !many;
  requestAnimationFrame(() => requestAnimationFrame(() => fitRect({ x0: it.x, y0: it.y, x1: it.x + it.w, y1: it.y + it.h }, { ms: 0, maxZ: 1, pad: 12 })));
}
// the header's switch between the two states (only while a prototype is open)
function renderMode() {
  const sw = $("modeSw");
  sw.hidden = S.view !== "proto";
  for (const b of sw.querySelectorAll("[data-m]")) {
    const on = (b.dataset.m === "prototype") === !!presenting;
    b.classList.toggle("on", on);
    b.setAttribute("aria-checked", String(on));
  }
}
function stopPresent() {
  if (!presenting) return;
  const p = presenting;
  p.cleanup?.();
  presenting = null;
  S.presenting = null;
  boardOf(p.bid)?.el.classList.remove("presenting");
  $("frame").classList.remove("present");
  setMode(p.mode === "prototype" ? "design" : p.mode);
  renderMode();
  Object.assign(S.cam, p.cam);
  requestAnimationFrame(() => focusItem(p.bid, { ms: 0, maxZ: 0.6 }));
}
document.addEventListener("keydown", (e) => presenting && e.key === "Escape" && (e.preventDefault(), stopPresent()), true);

// ---------- share ----------
async function openShare(id) {
  const env = S.envs.get(id);
  if (!env) return toast("Open a prototype to share it");
  const md = modal(`<div class="md-h"><div class="tt"><h2>Share ${esc(isBranch(env) ? env.name : rootOf(env.id)?.name || env.name)}</h2><p>People open it as the running app. Links can't change it.</p></div><button type="button" class="ib32" data-a="x" aria-label="Close">${IC.x}</button></div><div class="md-b" id="shB"></div><div class="md-f"><button type="button" class="createbtn" data-a="done">Done</button></div>`);
  $("shB").append(skeleton("Loading links", 2));
  md.querySelector('[data-a="x"]').onclick = closeModal;
  md.querySelector('[data-a="done"]').onclick = closeModal;
  let role = "view";
  const paint = async () => {
    let data;
    try {
      data = await api("shares");
    } catch (e) {
      $("shB").innerHTML = `<div class="shnote err">${IC.info}<div><b>Couldn't load links</b><br><span>${esc(e.message)}</span></div></div>`;
      return;
    }
    const b = $("shB");
    if (!b) return;
    const links = data.links.filter((l) => l.env === id);
    b.replaceChildren();
    const local = `${location.origin}/present/${id}/`;
    const l1 = h(`<div class="fld"><span class="lr">On this computer</span><div class="lnk"><span class="u">${esc(local)}</span><button type="button" class="ib24" aria-label="Copy link">${IC.copy}</button><button type="button" class="ib24" aria-label="Open">${IC.ext}</button></div></div>`);
    const [c1, o1] = l1.querySelectorAll(".ib24");
    c1.onclick = () => copyText(local);
    o1.onclick = () => window.open(local, "_blank", "noopener");
    b.append(l1);
    const net = h(`<div class="setrow"><div class="tx"><b>Share on your network</b><span>${data.network ? `Others on this network open links at ${esc(data.base || "this computer's address")}` : "Lets people on the same network open share links. Only share links work from other computers."}</span></div><button type="button" class="sw" role="switch" aria-checked="${data.network}" aria-label="Share on your network"><i></i></button></div>`);
    net.querySelector(".sw").onclick = async () => {
      try {
        await api("shares/network", { method: "POST", body: { on: !data.network } });
        paint();
      } catch (e) {
        toast("Couldn't change network sharing", e.message);
      }
    };
    b.append(net);
    const lf = h(`<div class="fld"><span class="lr">Links<span class="hint">${links.length ? `${links.length} active` : ""}</span></span><div style="display:flex;gap:8px"></div></div>`);
    const mk = h(`<button type="button" class="dbtn" ${data.network ? "" : "disabled"}>${IC.link}Create link</button>`);
    mk.onclick = async () => {
      try {
        const s = await api("shares", { method: "POST", body: { env: id, role } });
        await paint();
        if (data.base) copyText(`${data.base}/s/${s.token}`);
      } catch (e) {
        toast("Couldn't create the link", e.message);
      }
    };
    lf.querySelector("div").append(segmented([{ label: "Can view", value: "view" }, { label: "Can comment", value: "comment" }], role, (v) => ((role = v), paint()), { label: "Link access" }), mk);
    b.append(lf);
    for (const l of links) {
      const url = data.base ? `${data.base}/s/${l.token}` : `/s/${l.token}`;
      const r = h(`<div class="lnk"><span class="u" title="${esc(url)}">${esc(url)}</span><span class="tagro">${l.role === "comment" ? "Can comment" : "Can view"}</span><button type="button" class="ib24" aria-label="Copy link">${IC.copy}</button><button type="button" class="ghbtn sm" style="color:var(--text-error)">Turn off</button></div>`);
      r.querySelector(".ib24").onclick = () => copyText(url);
      r.querySelector(".ghbtn").onclick = async () => (await api(`shares/${l.id}`, { method: "DELETE" }).catch((e) => toast("Couldn't turn it off", e.message)), paint());
      b.append(r);
    }
  };
  paint();
}

// ---------- connect an agent ----------
const shq = (s) => (/^[\w@%+=:,./-]+$/.test(s) ? s : `'${String(s).replace(/'/g, "'\\''")}'`);
function splitCmd(s) {
  const out = [];
  let cur = "",
    qch = null,
    any = false;
  for (const c of s) {
    if (qch) c === qch ? (qch = null) : (cur += c);
    else if (c === '"' || c === "'") (qch = c), (any = true);
    else if (/\s/.test(c)) ((cur || any) && out.push(cur), (cur = ""), (any = false));
    else cur += c;
  }
  if (cur || any) out.push(cur);
  return out;
}
const CLAUDE_AUTO = ["claude", "-p", "{prompt}", "--permission-mode", "acceptEdits"];
function openConnect() {
  const ws = S.ws;
  const cli = ws.cli || {};
  const node = cli.node || "node",
    bin = cli.bin || "bin/workshop.js",
    root = ws.root;
  const args = [bin, "mcp", "--workspace", root];
  const toml = (v) => JSON.stringify(v); // TOML basic strings take JSON's escapes
  // each AI tool's own way to add an MCP server, filled in for this computer (paths and all)
  const TOOLS = [
    { id: "claude", label: "Claude Code", how: "Run this once in a terminal, then start <b>claude</b>. In this workshop's own folder it connects by itself.", code: `claude mcp add workshop -- ${[node, ...args].map(shq).join(" ")}` },
    { id: "cursor", label: "Cursor", how: "Add this to <b>~/.cursor/mcp.json</b> (or <b>.cursor/mcp.json</b> in your project), then reload Cursor.", code: JSON.stringify({ mcpServers: { workshop: { command: node, args } } }, null, 2) },
    { id: "codex", label: "Codex", how: "Add this to <b>~/.codex/config.toml</b>, then start <b>codex</b>.", code: `[mcp_servers.workshop]\ncommand = ${toml(node)}\nargs = [${args.map(toml).join(", ")}]` },
    { id: "vscode", label: "VS Code", how: "Add this to <b>.vscode/mcp.json</b> in your project, then start the server from the MCP view and use agent mode.", code: JSON.stringify({ servers: { workshop: { type: "stdio", command: node, args } } }, null, 2) },
    { id: "desktop", label: "Claude app", how: "In Claude, open <b>Settings › Developer › Edit Config</b>, add this, then restart Claude.", code: JSON.stringify({ mcpServers: { workshop: { command: node, args } } }, null, 2) },
    { id: "other", label: "Other", how: "Any tool that speaks MCP over stdio can connect with this.", code: JSON.stringify({ mcpServers: { workshop: { command: node, args } } }, null, 2) },
  ];
  let tool = (() => {
    try {
      return localStorage.getItem("atelier-connect-tool") || "claude";
    } catch {
      return "claude";
    }
  })();
  const isClaude = ws.agent && JSON.stringify(ws.agent.command) === JSON.stringify(CLAUDE_AUTO);
  let mode = !ws.agent ? "wait" : isClaude ? "claude" : "custom";
  const md = modal(`<div class="md-h"><div class="tt"><h2>Connect your AI tool</h2><p>Your agent sees the canvas, what you select and your notes, works on a branch, and the screens update as it goes.</p></div><button type="button" class="ib32" data-a="x" aria-label="Close">${IC.x}</button></div>
  <div class="md-b">
    <div class="ahar cn-status"></div>
    <div class="fld"><span class="lr">Your tool</span><div id="cnTool"></div><span class="cn-how" id="cnHow"></span><div class="code" id="cnCode"><span class="cn-c"></span><button type="button" class="ib24" aria-label="Copy" data-tip="Copy">${IC.copy}</button></div><span class="cn-try">Then ask it: <i>“Look at what I've selected in Atelier and make it bolder, on a branch.”</i></span></div>
    <div class="fld"><span class="lr">When you ask from the canvas</span><div id="cnSeg"></div><div id="cnMore"></div></div>
  </div>
  <div class="md-f"><span class="sp"></span><button type="button" class="ghbtn" data-a="x2">Close</button><button type="button" class="createbtn" data-a="save">Save</button></div>`, { wide: true });
  // the status follows the connection live, so you see the moment your tool connects
  const status = md.querySelector(".cn-status");
  let shown = "";
  const paintStatus = () => {
    const hs = S.ws.harnesses || [];
    const key = hs.map((x) => x.client).join();
    if (key === shown && status.childNodes.length) return;
    shown = key;
    status.innerHTML = hs.length ? `<span class="hdot on"></span><span>${hs.map((x) => `<b>${esc(x.client)}</b> is connected`).join(" · ")}</span>` : `<span class="hdot"></span><span class="shimmer">Waiting for your tool to connect…</span>`;
  };
  paintStatus();
  const live = setInterval(() => (md.isConnected ? paintStatus() : clearInterval(live)), 800);
  const paintTool = () => {
    const t = TOOLS.find((x) => x.id === tool) || TOOLS[0];
    $("cnTool").replaceChildren(segmented(TOOLS.map((x) => ({ label: x.label, value: x.id })), t.id, (v) => ((tool = v), (() => { try { localStorage.setItem("atelier-connect-tool", v); } catch {} })(), paintTool()), { full: true, label: "Your tool" }));
    $("cnHow").innerHTML = t.how;
    md.querySelector("#cnCode .cn-c").textContent = t.code;
    md.querySelector("#cnCode .ib24").onclick = () => copyText(t.code);
  };
  paintTool();
  const paint = () => {
    $("cnSeg").replaceChildren(segmented([{ label: "Wait for my tool", value: "wait" }, { label: "Run Claude Code", value: "claude" }, { label: "Run a command", value: "custom" }], mode, (v) => ((mode = v), paint()), { full: true, label: "When you ask from the canvas" }));
    const more = $("cnMore");
    if (mode === "wait") more.innerHTML = `<span class="cn-how">Requests wait for your connected tool, which picks them up with <span class="mono" style="font-size:12px;font-weight:400">take_task</span>.</span>`;
    if (mode === "claude") more.innerHTML = `<span class="cn-how">Each request runs <span class="mono" style="font-size:12px;font-weight:400">claude -p</span> in its branch's folder with edits allowed, one at a time.</span>`;
    if (mode === "custom") more.innerHTML = `<div class="afld-in"><input id="cnCmd" placeholder="my-agent --task {prompt}" value="${esc(ws.agent && !isClaude ? ws.agent.command.map(shq).join(" ") : "")}" aria-label="Command"></div><span style="font-size:12px;color:var(--text-secondary)">{prompt} is the full brief, {request} the words typed, {dir} the folder, {file} its index.html. Without {prompt} the brief arrives on stdin.</span>`;
  };
  paint();
  md.querySelector('[data-a="x"]').onclick = closeModal;
  md.querySelector('[data-a="x2"]').onclick = closeModal;
  md.querySelector('[data-a="save"]').onclick = async () => {
    let agent = null;
    if (mode === "claude") agent = { name: "Claude Code", command: CLAUDE_AUTO };
    if (mode === "custom") {
      const parts = splitCmd($("cnCmd").value.trim());
      if (!parts.length) return $("cnCmd").focus();
      agent = { name: parts[0].split("/").pop(), command: parts };
    }
    try {
      await api("workspace", { method: "PATCH", body: { agent } });
      closeModal();
      await loadWorkspace();
      toast(agent ? `Requests now run with ${agent.name}` : "Requests wait for a connected agent");
    } catch (e) {
      toast("Couldn't save", e.message);
    }
  };
}

// ---------- import ----------
function openImport() {
  const md = modal(`<div class="md-h"><div class="tt"><h2>Import a prototype</h2><p>An HTML file becomes a prototype with its own tab, branches and history.</p></div><button type="button" class="ib32" data-a="x" aria-label="Close">${IC.x}</button></div>
  <div class="md-b">
    <div class="drop" id="imDrop" tabindex="0" role="button"><b>Drop an HTML file</b><span>or choose one from your computer</span><button type="button" class="dbtn" id="imPick">${IC.upload}Choose file</button></div>
    <div class="fld"><span class="lr">Or paste HTML<span class="hint">A whole document, e.g. an HTML artifact</span></span><textarea class="afld-ta" id="imHtml" style="min-height:120px;font-family:var(--mono);font-size:12px" placeholder="<!doctype html>…"></textarea></div>
    <div class="fld"><span class="lr">Name<span class="hint">Optional — the page title is used otherwise</span></span><div class="afld-in"><input id="imName" maxlength="120"></div></div>
  </div>
  <div class="md-f"><span class="sp"></span><button type="button" class="ghbtn" data-a="x2">Cancel</button><button type="button" class="createbtn" data-a="ok">Import</button></div>`);
  let file = null;
  const drop = $("imDrop");
  const setFile = (f) => ((file = f), (drop.querySelector("b").textContent = f.name), (drop.querySelector("span").textContent = `${Math.round(f.size / 1024)} KB · ready to import`));
  $("imPick").onclick = (e) => {
    e.stopPropagation();
    const fi = $("fileIn");
    fi.value = "";
    fi.onchange = () => fi.files[0] && setFile(fi.files[0]);
    fi.click();
  };
  drop.ondragover = (e) => (e.preventDefault(), drop.classList.add("over"));
  drop.ondragleave = () => drop.classList.remove("over");
  drop.ondrop = (e) => {
    e.preventDefault();
    drop.classList.remove("over");
    const f = [...e.dataTransfer.files].find((x) => /\.html?$/i.test(x.name));
    f ? setFile(f) : toast("That isn't an HTML file");
  };
  md.querySelector('[data-a="x"]').onclick = closeModal;
  md.querySelector('[data-a="x2"]').onclick = closeModal;
  let busy = false;
  md.querySelector('[data-a="ok"]').onclick = async () => {
    if (busy) return;
    const name = $("imName").value.trim() || undefined;
    const html = $("imHtml").value;
    if (!file && !html.trim()) return toast("Choose a file or paste some HTML first");
    busy = true;
    const undoBusy = pendingButton(md.querySelector('[data-a="ok"]'), "Importing…");
    try {
      const env = file ? await importFile(file, name) : await api("envs", { method: "POST", body: { html, name, source: { kind: "paste" } } });
      if (!file) toast(`Added ${env.name}`, `Saved to envs/${env.id}/index.html`);
      closeModal();
      await loadWorkspace();
      go(env.id);
    } catch (e) {
      busy = false;
      undoBusy();
      toast("Couldn't import", e.message);
    }
  };
}

// ---------- search ----------
let palItems = [];
let palIdx = 0;
const openPal = () => ($("pal").classList.add("open"), ($("palIn").value = ""), paintPal(), setTimeout(() => $("palIn").focus(), 20));
const closePal = () => $("pal").classList.remove("open");
function paintPal() {
  const qv = $("palIn").value.trim().toLowerCase();
  const env = pageEnv();
  const pid = protoId();
  const items = [
    ...(pid ? familyOf(pid).filter((x) => !x.env.archived).map((x) => ({ label: isBranch(x.env) ? x.env.name : `Main · ${x.env.name}`, k: isBranch(x.env) ? "Branch" : "Main", fn: () => go(x.env.id) })) : []),
    ...roots().filter((e) => e.id !== pid).map((e) => ({ label: e.name, k: "Prototype", fn: () => go(e.id) })),
    ...(env ? pageItems("board").map((b) => ({ label: screenName(b), k: "On this page", fn: () => (selectBoard(b.id), focusItem(b.id, { maxZ: 0.6 })) })) : []),
    ...(env ? (env.catalog?.screens || rootOf(env.id)?.catalog?.screens || []).map((s) => ({ label: `Place ${s.name}`, k: "Screen", fn: () => placeScreen(env.id, s.name, S.placeState).then((it) => it && (selectBoard(it.id), focusItem(it.id, { maxZ: 0.6 }))) })) : []),
    ...(env ? [{ label: `Create a branch of ${pageName(env)}`, k: "Action", fn: () => createBranch(env.id) }] : []),
    ...(env && isBranch(env) && !env.archived ? [{ label: "Review and merge", k: "Action", fn: () => openReview(env.id) }, { label: S.compare ? "Hide compare" : `Compare with ${pageName(S.envs.get(env.parent))}`, k: "Action", fn: () => fire("compare") }] : []),
    { label: "Ask an agent", k: "Action", fn: () => env && fire("ask-agent", {}) },
    { label: "Import HTML", k: "Action", fn: openImport },
    { label: "Connect your AI tool", k: "Action", fn: openConnect },
    { label: "Go home", k: "Action", fn: () => go("home") },
    ...(env ? [{ label: "Zoom to fit", k: "Canvas", fn: () => fit() }, { label: "Show or hide panels", k: "Canvas", fn: toggleUi }] : []),
  ];
  palItems = items.filter((x) => !qv || x.label.toLowerCase().includes(qv)).slice(0, 60);
  palIdx = 0;
  const rs = $("palRs");
  rs.replaceChildren();
  if (!palItems.length) rs.append(h(`<div class="none">Nothing matches "${esc(qv)}"</div>`));
  palItems.forEach((x, i) => {
    const b = h(`<button type="button" role="option" class="${i === palIdx ? "on" : ""}">${x.k === "Branch" ? IC.fork : x.k === "Main" || x.k === "Prototype" ? IC.board : x.k === "On this page" || x.k === "Screen" ? IC.frame : IC.chevr}<span class="l">${esc(x.label)}</span><span class="k">${esc(x.k)}</span></button>`);
    b.onclick = () => (closePal(), x.fn());
    b.onpointerenter = () => setPal(i);
    rs.append(b);
  });
}
function setPal(i) {
  palIdx = i;
  qa("#palRs button").forEach((b, j) => b.classList.toggle("on", j === i));
  qa("#palRs button")[i]?.scrollIntoView({ block: "nearest" });
}

// ---------- keyboard shortcuts ----------
function openShortcuts() {
  const mac = navigator.platform?.startsWith("Mac");
  const K = (k) => (mac ? k : k.replace(/⌘/g, "Ctrl+").replace(/⌥/g, "Alt+").replace(/⇧/g, "Shift+"));
  const groups = [
    ["Tools", [["Select", "V"], ["Hand", "H · Space"], ["Frame", "F"], ["Note", "N"], ["Highlight", "B"], ["Arrow", "A"], ["Comment", "C"], ["Draw", "D"], ["Prototype: click through a screen · back to Design", "P · Esc"], ["Ask an agent", "Toolbar"]]],
    ["Draw", [["Marker · pen · pencil · highlighter", "1 · 2 · 3 · 4"], ["Eraser", "E"], ["Finer · bolder", "[ · ]"], ["Straight line", "hold ⇧"], ["Stop drawing", "Esc · V"]]],
    ["Edit", [["Undo", K("⌘Z")], ["Redo", K("⌘⇧Z")], ["Copy · cut · paste", K("⌘C · ⌘X · ⌘V")], ["Duplicate", K("⌘D")], ["Delete", "Delete"], ["Select all", K("⌘A")], ["Add to the selection", "⇧ click"], ["Select by dragging", "Drag on empty canvas"]]],
    ["Elements", [["Parent · first child", "Esc · Enter"], ["Next · previous", "Tab · ⇧Tab"], ["Move or reorder", "Drag · arrows (⇧ 8 px)"], ["Bring forward · send backward", K("⌘] · ⌘[")], ["Bring to front · send to back", "] · ["], ["Go into a layer · edit its text", "Double-click"], ["Select the deepest layer", K("⌘-click")]]],
    ["Arrange several", [["Align left · centre · right", K("⌥A · ⌥H · ⌥D")], ["Align top · middle · bottom", K("⌥W · ⌥V · ⌥S")], ["Distribute", K("⌥⇧H · ⌥⇧V")], ["Move without snapping", K("hold ⌥")]]],
    ["View", [["Zoom to fit · selection", "⇧1 · ⇧2"], ["Zoom in · out · 100%", K("+ · − · ⌘0")], ["Outlines", K("⌘Y")], ["Rulers", "⇧R"], ["Hide panels", K("⌘\\")], ["Search", K("⌘K")]]],
  ];
  const md = modal(`<div class="md-h"><div class="tt"><h2>Keyboard shortcuts</h2><p>The canvas follows the shortcuts you know from design tools.</p></div><button type="button" class="ib32" data-a="x" aria-label="Close">${IC.x}</button></div><div class="md-b"><div class="kgrid">${groups.map(([g, rows]) => `<div class="kgrp"><div class="rvh">${esc(g)}</div><div class="kbdl">${rows.map(([a, b]) => `<span>${esc(a)}</span><kbd>${esc(b)}</kbd>`).join("")}</div></div>`).join("")}</div></div>`, { wide: true });
  md.querySelector('[data-a="x"]').onclick = closeModal;
}
// the element's CSS, as the browser applies it, plus this page's own rules for it
async function copyCss() {
  const s = S.sel;
  if (s?.kind !== "el") return;
  const st = s.info?.styles || {};
  await loadOverrides(s.env);
  const own = rulesFor(s.env, [s.info?.selector, s.info?.exactSelector]).flatMap((r) => r.decls);
  const keep = ["display", "position", "width", "height", "padding-top", "padding-right", "padding-bottom", "padding-left", "gap", "flex-direction", "align-items", "justify-content", "border-radius", "background-color", "color", "font-size", "font-weight", "line-height", "opacity", "box-shadow"];
  const lines = keep.filter((k) => st[k] && !/^(normal|none|0px|auto|static|rgba\(0, 0, 0, 0\))$/.test(st[k])).map((k) => `  ${k}: ${st[k]};`);
  const text = `${s.info?.exactSelector || s.info?.label} {\n${lines.join("\n")}${own.length ? `\n  /* changed on this page */\n${own.map(([k, v]) => `  ${k}: ${v};`).join("\n")}` : ""}\n}`;
  copyText(text);
}

// ---------- the rest ----------
function toggleUi() {
  $("frame").classList.toggle("ui-off");
  markDirty();
}
// Light unless this browser picks otherwise in the menu. The key changed with the studio-white look so
// a dark or "system" choice saved under the old look starts over on light (index.html reads it too).
const THEME_KEY = "atelier-theme";
function setTheme(t) {
  try {
    localStorage.setItem(THEME_KEY, t);
  } catch {}
  const d = t === "system" ? (matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light") : t;
  document.documentElement.setAttribute("data-ltheme", d);
  document.documentElement.setAttribute("data-ltheme-pref", t);
}
// how see-through the floating panels and bars are, like iOS 27's Liquid Glass setting
const glassPref = () => store.get("ws-glass", "balanced");
function setGlass(v) {
  store.set("ws-glass", v);
  document.documentElement.setAttribute("data-glass", v);
}
function wsMenu() {
  let pref = "light";
  try {
    pref = localStorage.getItem(THEME_KEY) || "light";
  } catch {}
  const others = (spaceList || []).filter((x) => !x.current && !x.missing).slice(0, 6);
  menu($("wsBtn"), [
    { head: "Spaces" },
    { label: S.ws.name, checked: true, onClick: () => go("home") },
    ...others.map((x) => ({ label: x.name, checked: false, onClick: () => switchSpace(x.path) })),
    ...(S.ws.spaces ? [{ label: "Connect a folder…", icon: IC.folder, onClick: openSpaces }, { label: "Look for new prototypes", icon: IC.restore, onClick: findPrototypes }] : []),
    "-",
    { label: "Import HTML", icon: IC.upload, onClick: openImport },
    { label: "Connect your AI tool", icon: IC.agent, onClick: openConnect },
    { label: "Copy folder path", icon: IC.copy, onClick: () => copyText(S.ws.home || S.ws.root) },
    { label: "Rename space", icon: IC.board, onClick: renameWorkspace },
    { label: "Hide panels", kbd: "⌘\\", onClick: toggleUi },
    { label: "Play the intro", onClick: () => playIntro({ force: true }) },
    { label: "Keyboard shortcuts", kbd: "?", onClick: openShortcuts },
    "-",
    { head: "Appearance" },
    ...["light", "dark", "system"].map((t) => ({ label: t[0].toUpperCase() + t.slice(1), checked: pref === t, onClick: () => setTheme(t) })),
    "-",
    { head: "Glass" },
    ...[["clear", "Clear"], ["balanced", "Balanced"], ["frosted", "Frosted"]].map(([v, l]) => ({ label: l, checked: glassPref() === v, onClick: () => setGlass(v) })),
  ], { width: 280 });
}
// ---------- bring in work from elsewhere: Figma files, running apps, pictures ----------
function openBringIn() {
  if (!S.page) return toast("Open a prototype first", "Links and pictures go on a page, next to its screens");
  const md = modal(
    `<div class="md-h"><div class="tt"><h2>Bring in work</h2><p>Put a Figma file, a running app (localhost, a Lovable, v0, Vercel or Bolt preview) or a picture next to your screens. Mark it up, compare, and have an agent build it here.</p></div><button type="button" class="ib32" data-a="x" aria-label="Close">${IC.x}</button></div>
    <form class="md-b" id="biF">
      <div class="fld"><span class="lr">Link<span class="hint">Figma file, app or any web page</span></span><div class="afld-in"><input id="biUrl" type="url" spellcheck="false" placeholder="https://www.figma.com/design/… or http://localhost:3000"></div></div>
      <div class="fld"><span class="lr">Name<span class="hint">Optional</span></span><div class="afld-in"><input id="biName" maxlength="120" placeholder="Checkout, from Figma"></div></div>
      <div class="drop" id="biDrop" tabindex="0" role="button"><b>Or drop a picture</b><span>A screenshot, a Figma export, a moodboard (PNG, JPEG, WebP or GIF)</span><button type="button" class="dbtn" id="biPick">${IC.img}Choose a picture</button></div>
      <span class="lineage">Tip: paste a link or a screenshot straight onto the canvas with ⌘V, or drag one in.</span>
    </form>
    <div class="md-f"><span class="sp"></span><button type="button" class="ghbtn" data-a="x2">Cancel</button><button type="button" class="createbtn" data-a="ok">Add link</button></div>`,
  );
  md.style.width = "560px";
  const pick = (f) => f && (closeModal(), addPicture(f));
  $("biPick").onclick = (e) => {
    e.stopPropagation();
    const fi = $("fileIn");
    fi.value = "";
    const was = fi.accept;
    fi.accept = "image/png,image/jpeg,image/webp,image/gif";
    fi.onchange = () => ((fi.accept = was), pick(fi.files[0]));
    fi.click();
  };
  const drop = $("biDrop");
  drop.ondragover = (e) => (e.preventDefault(), drop.classList.add("over"));
  drop.ondragleave = () => drop.classList.remove("over");
  drop.ondrop = (e) => {
    e.preventDefault();
    drop.classList.remove("over");
    const f = [...e.dataTransfer.files].find((x) => /^image\/(png|jpeg|webp|gif)$/.test(x.type));
    f ? pick(f) : toast("That isn't a picture", "PNG, JPEG, WebP or GIF");
  };
  md.querySelector('[data-a="x"]').onclick = closeModal;
  md.querySelector('[data-a="x2"]').onclick = closeModal;
  const ok = async () => {
    let url = $("biUrl").value.trim();
    if (!url) return toast("Paste a link first", "Or choose a picture");
    if (!/^https?:\/\//i.test(url)) url = (/^(localhost|127\.|\[::1\])/.test(url) ? "http://" : "https://") + url;
    closeModal();
    await addLink(url, $("biName").value.trim() || null);
  };
  md.querySelector('[data-a="ok"]').onclick = ok;
  $("biF").onsubmit = (e) => (e.preventDefault(), ok());
  setTimeout(() => $("biUrl")?.focus(), 30);
}

// ---------- spaces: the folders Atelier works in ----------
let spaceList = null;
async function loadSpaces() {
  if (!S.ws?.spaces) return (spaceList = []);
  try {
    spaceList = (await api("spaces")).spaces;
  } catch {
    spaceList = [];
  }
  return spaceList;
}
async function switchSpace(p) {
  try {
    loadingToast("Opening the space…"); // the page reloads into the new space when it's open
    await api("spaces/switch", { method: "POST", body: { path: p } });
  } catch (e) {
    toast("Couldn't open that space", e.message);
  }
}
async function findPrototypes() {
  const done = loadingToast("Looking for prototypes…");
  try {
    const r = await api("spaces/find", { method: "POST" }).finally(done);
    await loadWorkspace();
    toast(r.added.length ? `Found ${plural(r.added.length, "prototype")}` : "No new prototypes", r.added.length ? r.added.map((x) => x.name).slice(0, 4).join(", ") : r.skipped[0] ? `${r.skipped[0].path}: ${r.skipped[0].why}` : "A prototype is a folder with an index.html, or a .html page");
  } catch (e) {
    toast("Couldn't look for prototypes", e.message);
  }
}
// Connect a folder: browse this computer's folders (the browser can't hand us a path), then open it.
async function openSpaces(start = null) {
  await loadSpaces();
  const md = modal(
    `<div class="md-h"><div class="tt"><h2>Connect a folder</h2><p>Open a project as a space. Its prototypes stay where they are: agents and merges edit the real files, saving a version first. Atelier keeps its own data in a hidden .atelier folder there.</p></div><button type="button" class="ib32" data-a="x" aria-label="Close">${IC.x}</button></div>
    <div class="md-b" style="gap:16px">
      ${spaceList.length > 1 ? `<div class="fld"><span class="lr">Your spaces</span><div class="pgs spl" id="spList" style="margin:0 -8px"></div></div>` : ""}
      <div class="fld"><span class="lr">Folder<span class="hint">Paste a path, or pick one below</span></span><div class="afld-in"><input id="spPath" spellcheck="false" placeholder="/Users/you/Projects/app"></div></div>
      <div class="fbrowse" id="spBrowse" role="listbox" aria-label="Folders"></div>
    </div>
    <div class="md-f"><span class="fhint" id="spHint"></span><span class="sp"></span><button type="button" class="ghbtn" data-a="x2">Cancel</button><button type="button" class="createbtn" data-a="ok">${IC.folder}Connect folder</button></div>`,
    { wide: true },
  );
  const inp = $("spPath");
  const list = $("spBrowse");
  const hint = $("spHint");
  const sl = $("spList");
  if (sl)
    for (const x of spaceList) {
      const r = h(`<div class="pg${x.current ? " on" : ""}" role="button" tabindex="0">${IC.folder}<span class="t" title="${esc(x.path)}">${esc(x.name)}</span><span class="m">${x.current ? "Open" : x.missing ? "Missing" : ""}</span>${x.current ? "" : `<button type="button" class="ib24" aria-label="Remove ${esc(x.name)} from the list" data-tip="Remove from the list">${IC.x}</button>`}</div>`);
      r.onclick = () => !x.current && !x.missing && (closeModal(), switchSpace(x.path));
      r.onkeydown = (ev) => ev.key === "Enter" && r.click();
      const rm = r.querySelector(".ib24");
      if (rm)
        rm.onclick = async (ev) => {
          ev.stopPropagation();
          await api("spaces/forget", { method: "POST", body: { path: x.path } }).catch((e) => toast("Couldn't remove it", e.message));
          r.remove();
        };
      sl.append(r);
    }
  let cur = null;
  const browse = async (p) => {
    let d;
    hint.innerHTML = `<span class="shimmer">Reading the folder…</span>`;
    if (!cur) list.replaceChildren(skeleton("", 6));
    try {
      d = await api(`folders${p ? `?path=${encodeURIComponent(p)}` : ""}`);
    } catch (e) {
      hint.textContent = e.message;
      return;
    }
    cur = d;
    inp.value = d.path;
    list.replaceChildren();
    if (d.parent) {
      const up = h(`<div class="pg" role="option" tabindex="0">${IC.chev.replace("<svg", '<svg style="transform:rotate(90deg)"')}<span class="t">Up to ${esc(d.parent.split(/[\/]/).pop() || d.parent)}</span></div>`);
      up.onclick = () => browse(d.parent);
      up.onkeydown = (ev) => ev.key === "Enter" && up.click();
      list.append(up);
    }
    for (const f of d.dirs) {
      const r = h(`<div class="pg" role="option" tabindex="0">${IC.folder}<span class="t">${esc(f.name)}</span>${f.atelier ? `<span class="tagro info">Space</span>` : f.prototype ? `<span class="tagro ok">Prototype</span>` : ""}${IC.chevr}</div>`);
      r.onclick = () => browse(f.path);
      r.onkeydown = (ev) => ev.key === "Enter" && r.click();
      list.append(r);
    }
    if (!d.dirs.length) list.append(h(`<div class="lineage" style="padding:8px 12px">No folders inside.</div>`));
    const n = d.dirs.filter((f) => f.prototype).length + (d.hasIndex ? 1 : 0) + (d.hasIndex ? 0 : d.pages);
    hint.textContent = d.path === d.home ? "Pick a project folder inside your home folder" : n ? `${plural(n, "prototype")} here or one level down` : "Atelier looks two levels down for index.html files and .html pages";
  };
  let t = null;
  inp.addEventListener("input", () => (clearTimeout(t), (t = setTimeout(() => inp.value.trim().startsWith("/") || /^[a-z]:\\/i.test(inp.value.trim()) || inp.value.trim().startsWith("~") ? browse(inp.value.trim()) : null, 350))));
  inp.addEventListener("keydown", (e) => e.key === "Enter" && md.querySelector('[data-a="ok"]').click());
  browse(start || S.ws.home || null);
  md.querySelector('[data-a="x"]').onclick = closeModal;
  md.querySelector('[data-a="x2"]').onclick = closeModal;
  let busy = false;
  md.querySelector('[data-a="ok"]').onclick = async () => {
    if (busy) return;
    const p = inp.value.trim() || cur?.path;
    if (!p) return;
    busy = true;
    const undoBusy = pendingButton(md.querySelector('[data-a="ok"]'), "Connecting…");
    try {
      const r = await api("spaces", { method: "POST", body: { path: p } });
      closeModal();
      toast(`Connected ${p.split(/[\/]/).pop()}`, r.added.length ? `Found ${plural(r.added.length, "prototype")}: ${r.added.map((x) => x.name).slice(0, 3).join(", ")}${r.added.length > 3 ? "…" : ""}` : r.skipped[0] ? `${r.skipped[0].path}: ${r.skipped[0].why}` : "No prototypes found yet. Import one, or add an index.html and look again.");
    } catch (e) {
      busy = false;
      undoBusy();
      toast("Couldn't connect that folder", e.message);
    }
  };
}

function renameWorkspace() {
  const md = modal(`<div class="md-h"><div class="tt"><h2>Rename space</h2><p>The folder on disk keeps its name.</p></div></div><form class="md-b" id="rwF"><div class="fld"><span class="lr">Name</span><div class="afld-in"><input id="rwIn" value="${esc(S.ws.name)}" maxlength="120" autofocus></div></div></form><div class="md-f"><button type="button" class="ghbtn" data-a="x">Cancel</button><button type="button" class="createbtn" data-a="ok">Rename</button></div>`);
  md.style.width = "480px";
  const ok = async () => {
    const v = $("rwIn").value.trim();
    if (!v) return;
    await api("workspace", { method: "PATCH", body: { name: v } }).catch((e) => toast("Couldn't rename", e.message));
    closeModal();
    homeKey = "";
    loadWorkspace();
  };
  md.querySelector('[data-a="ok"]').onclick = ok;
  md.querySelector('[data-a="x"]').onclick = closeModal;
  $("rwF").onsubmit = (e) => (e.preventDefault(), ok());
}

async function onEvent(ev) {
  if (ev.kind === "space") {
    // another space is open now: start from its Home, without this space's tabs
    store.set("ws-tabs", []);
    store.set("ws-route", "");
    return location.assign("/");
  }
  if (ev.kind === "envs") return loadWorkspace().then(loadRecipes); // a merge or archive changes a recipe's results
  if (ev.kind === "canvas") return loadItems();
  if (ev.kind === "env") {
    if (!S.envs.has(ev.id)) return loadWorkspace();
    try {
      envFetched.set(ev.id, performance.now());
      S.envs.set(ev.id, await api(`envs/${ev.id}`));
    } catch {
      return loadWorkspace();
    }
    S.diffs.delete(ev.id);
    for (const e of envList()) if (e.parent === ev.id) S.diffs.delete(e.id);
    // branches that still read this prototype's files look different now too
    await Promise.all(envList().filter((e) => e.base === ev.id).map(async (e) => (envFetched.set(e.id, performance.now()), S.envs.set(e.id, await api(`envs/${e.id}`).catch(() => e)))));
    reloadEnv(ev.id, ev.files || []);
    for (const e of envList()) if (e.base === ev.id) reloadEnv(e.id, ev.files || []);
    if (S.view === "home") return renderHome();
    const fam = new Set(familyOf(protoId()).map((x) => x.env.id));
    if (fam.has(ev.id)) {
      loadDiff(ev.id);
      for (const e of envList()) if (e.parent === ev.id) loadDiff(e.id);
    }
    renderLeft();
    if (ev.id === S.page) (renderRight(), renderBanner());
    return;
  }
  if (ev.kind === "tasks") return loadTasks();
  if (ev.kind === "recipes") return loadRecipes();
  if (ev.kind === "activity") return loadActivity();
  if (ev.kind === "comments") return loadComments();
  if (ev.kind === "versions") return S.page && loadVersions(S.page);
  if (ev.kind === "harness") {
    const ws = await api("workspace").catch(() => null);
    if (ws) ((S.ws.harnesses = ws.harnesses), renderWho(), renderAgent(), S.view === "proto" && renderLeft());
  }
}

async function patchArchived(id, archived) {
  const e = S.envs.get(id);
  try {
    await api(`envs/${id}`, { method: "PATCH", body: { archived } });
    await loadWorkspace();
    if (archived) toast(`Archived ${e?.name}`, "Find it under Show merged in Branches", { label: "Undo", fn: () => patchArchived(id, false) });
  } catch (er) {
    toast("Couldn't change that", er.message);
  }
}

async function boot() {
  document.documentElement.setAttribute("data-glass", glassPref());
  initCanvas();
  initPanels();
  S.tabs = store.get("ws-tabs", []);
  if (!Array.isArray(S.tabs)) S.tabs = [];
  $("wsBtn").onclick = async () => (spaceList || (await loadSpaces()), wsMenu());
  $("uiShow").onclick = toggleUi;
  $("agentBtn").onclick = openConnect;
  $("askBtn").onclick = () => fire("ask-agent", {});
  $("bringBtn").onclick = () => fire("bring-in");
  on("bring-in", openBringIn);
  $("shareBtn").onclick = () => openShare(S.page);
  // Design and Prototype, in the header; Run (a frame's title, P) opens Prototype on that frame
  for (const b of $("modeSw").querySelectorAll("[data-m]")) b.onclick = () => (b.dataset.m === "design" ? stopPresent() : presenting || $("interactBtn").click());
  on("prototype", (id) => present(id));
  $("cvScreens").onclick = () => fire("left-tab", "screens");
  $("palIn").oninput = paintPal;
  $("palIn").onkeydown = (e) => {
    if (e.key === "ArrowDown") (e.preventDefault(), setPal(Math.min(palItems.length - 1, palIdx + 1)));
    else if (e.key === "ArrowUp") (e.preventDefault(), setPal(Math.max(0, palIdx - 1)));
    else if (e.key === "Enter") (e.preventDefault(), palItems[palIdx] && (closePal(), palItems[palIdx].fn()));
    else if (e.key === "Escape") (e.preventDefault(), closePal());
  };
  document.addEventListener("pointerdown", (e) => $("pal").classList.contains("open") && !$("pal").contains(e.target) && closePal());
  document.addEventListener("keydown", (e) => {
    const mod = e.metaKey || e.ctrlKey;
    if (mod && (e.key === "k" || e.key === "K")) return e.preventDefault(), $("pal").classList.contains("open") ? closePal() : openPal();
    if (S.view !== "proto") return;
    if (mod && e.key === "\\") return e.preventDefault(), toggleUi();
  });
  window.addEventListener("hashchange", applyRoute);
  on("go", go);
  on("go-item", (id) => {
    const it = S.items.get(id);
    if (!it) return;
    const pg = pageOf(it);
    if (pg && pg !== S.page) go(pg);
    setTimeout(() => (selectItem(id), it.type !== "arrow" && focusItem(id, { maxZ: 0.8 })), pg !== S.page ? 360 : 0);
  });
  on("open-proto", async (id) => (await loadWorkspace(), go(id)));
  // Compare: one screen with the parent's version above it, at a size you can see the change;
  // hiding it takes you back to where you were
  let beforeCompare = null;
  on("compare", () => {
    S.compare = !S.compare;
    if (S.compare) beforeCompare = camNow();
    sync();
    renderBanner();
    renderRight();
    requestAnimationFrame(() => (S.compare ? fitPair() : flyTo(beforeCompare)));
  });
  on("diff", () => S.view === "home" && renderHome()); // a branch's counts on the home canvas
  on("archive", (id) => patchArchived(id, true));
  on("unarchive", (id) => patchArchived(id, false));
  on("shortcuts", openShortcuts);
  on("copy-css", copyCss);
  on("branch", createBranch);
  on("review", openReview);
  on("update-from-main", updateFromMain);
  on("env-menu", envMenu);
  on("fork-version", ({ id, n }) => duplicateEnv(id, n));
  on("delete", remove);
  on("rename", rename);
  on("present", present);
  on("exit-present", stopPresent);
  on("share", openShare);
  on("connect", openConnect);
  on("import", openImport);
  on("save-version", saveVersion);
  on("restore-version", restoreVersion);
  on("reload-workspace", loadWorkspace);
  on("items-changed", () => (renderLeft(), renderBanner()));
  on("remove-item", (id) => {
    selectItem(id);
    document.dispatchEvent(new KeyboardEvent("keydown", { key: "Delete", bubbles: true }));
  });
  on("open-thread", (id) => {
    const c = S.comments.find((x) => x.id === id);
    if (!c) return;
    const away = c.env !== S.page;
    if (away) go(c.env);
    setTimeout(() => {
      const b = (c.board && S.items.get(c.board)) || pageItems("board")[0];
      if (b) focusItem(b.id, { maxZ: 0.6 });
      setTimeout(() => openThread(id), 360);
    }, away ? 300 : 0);
  });
  on("comments-changed", async (d) => {
    await loadComments();
    if (d?.reopen) openThread(d.reopen);
  });
  on("tasks-changed", async (d) => {
    if (d?.created && d.created.env !== S.page) {
      // the request opened a branch: go to its page, where the agent will work
      await loadWorkspace();
      go(d.created.env);
      setTimeout(() => fire("ask-agent", {}), 200);
    }
    loadTasks();
  });
  initTips();
  // the first time this browser opens Atelier (or with ?intro): the intro plays while the workspace loads
  playIntro({ force: new URLSearchParams(location.search).has("intro") });
  try {
    await loadWorkspace();
  } catch (e) {
    document.documentElement.removeAttribute("data-intro"); // index.html hid the app for the intro; show the error instead
    $("frame").append(h(`<div class="winov open"><div class="md" style="width:480px"><div class="md-h"><div class="tt"><h2>The Workshop server isn't answering</h2><p>${esc(e.message)}. Start it with <span class="mono" style="font-size:12px;font-weight:400">npm start</span> in the workshop folder, then reload.</p></div></div></div></div>`));
    return;
  }
  await Promise.all([loadComments(), loadTasks(), loadActivity()]); // loading the tasks loads the recipes too
  // a fresh visit picks up where this browser left off
  if (!location.hash || location.hash === "#") {
    const last = store.get("ws-route", "");
    if (typeof last === "string" && last.startsWith("#/p/")) history.replaceState(null, "", last);
  }
  applyRoute();
  events(onEvent);
  setInterval(() => api("workspace").then((ws) => {
    const before = JSON.stringify(S.ws?.harnesses?.map((x) => x.client));
    S.ws.harnesses = ws.harnesses;
    if (JSON.stringify(ws.harnesses.map((x) => x.client)) !== before) (renderWho(), renderAgent(), S.view === "proto" ? renderLeft() : renderHome());
  }).catch(() => {}), 20000);
}

boot();
