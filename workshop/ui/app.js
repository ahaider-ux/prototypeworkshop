// Libra Workshop — boot, views, sidebar, modals and live updates.

import { S, on, fire, envList, selEnv } from "./state.js";
import { $, q, qa, h, esc, api, events, toast, IC, menu, closeMenu, modal, closeModal, copyText, timeAgo, fitShell, segmented } from "./lib.js";
import { initCanvas, syncBoards, fit, focusEnv, selectBoard, clearSel, reloadBoard, markDirty, setMode, importFile, isTyping, boardOf, rt } from "./canvas.js";
import { initPanels, renderLeft, renderRight, renderBoards, loadVersions, undoStyle } from "./panels.js";

// ---------- data ----------
async function loadWorkspace() {
  const ws = await api("workspace");
  S.ws = ws;
  S.envs = new Map(ws.envs.map((e) => [e.id, e]));
  if (S.sel && !S.envs.has(S.sel.env)) clearSel();
  $("wsName").textContent = ws.name;
  syncBoards();
  renderAll();
}
async function loadComments() {
  S.comments = await api("comments").catch(() => S.comments);
  markDirty();
  renderBoards();
  if (S.view === "home") renderHome();
}
let lastStatus = new Map();
async function loadTasks() {
  const list = await api("tasks").catch(() => S.tasks);
  for (const t of list) {
    const was = lastStatus.get(t.id);
    if (was && was !== t.status && (t.status === "done" || t.status === "failed")) {
      const env = S.envs.get(t.env);
      toast(t.status === "done" ? `${t.claimedBy || "The agent"} finished` : `${t.claimedBy || "The agent"} couldn't finish`, `${env?.name || t.env}${t.reply ? ` · ${t.reply.slice(0, 120)}` : ""}`, { label: "Show", fn: () => openAgentFor(t.env) });
    }
  }
  lastStatus = new Map(list.map((t) => [t.id, t.status]));
  S.tasks = list;
  const active = list.filter((t) => t.status === "queued" || t.status === "working").length;
  $("nTasks").textContent = active || "";
  if (S.view === "tasks") renderTasks();
  if (S.view === "canvas") renderRight();
}
function openAgentFor(id) {
  go("canvas");
  if (S.envs.has(id)) selectBoard(id);
  fire("ask-agent", {});
}

// ---------- views ----------
function go(view, { push = true } = {}) {
  S.view = view;
  for (const [v, el] of [["home", "vHome"], ["canvas", "vCanvas"], ["tasks", "vTasks"]]) $(el).classList.toggle("on", v === view);
  for (const b of qa(".sidebar [data-view]")) {
    const onv = b.dataset.view === view;
    b.classList.toggle("on", onv);
    if (b.dataset.fill) {
      const img = b.querySelector("img");
      img.src = onv ? b.dataset.fill : b.dataset.out;
      img.setAttribute("style", onv ? b.dataset.fsty : b.dataset.osty);
    }
  }
  if (push && location.pathname !== `/${view}`) history.pushState({ view }, "", `/${view}`);
  renderAll();
  if (view === "canvas") markDirty();
}
window.addEventListener("popstate", () => go(viewFromPath(), { push: false }));
const viewFromPath = () => (/^\/home/.test(location.pathname) ? "home" : /^\/tasks/.test(location.pathname) ? "tasks" : "canvas");

function renderAll() {
  renderCrumb();
  renderSidebarList();
  renderHarness();
  if (S.view === "home") renderHome();
  if (S.view === "tasks") renderTasks();
  if (S.view === "canvas") {
    renderLeft();
    renderRight();
  }
}

function renderCrumb() {
  const c = $("crumbs");
  const sep = `<span class="sep">${IC.chevr}</span>`;
  const ws = esc(S.ws?.name || "Workshop");
  const env = selEnv();
  const parts = [`<button type="button" class="lk" data-go="home">${ws}</button>`];
  if (S.view === "home") parts.push(sep, `<span class="bct">Home</span>`);
  if (S.view === "tasks") parts.push(sep, `<span class="bct">Agent tasks</span>`);
  if (S.view === "canvas") {
    if (env) parts.push(sep, `<button type="button" class="lk" data-go="canvas-all">Canvas</button>`, sep, `<span class="bct" title="${esc(env.name)}">${esc(env.name)}</span>`);
    else parts.push(sep, `<span class="bct">Canvas</span>`);
  }
  c.innerHTML = parts.join("");
  c.querySelector('[data-go="home"]').onclick = () => go("home");
  const ca = c.querySelector('[data-go="canvas-all"]');
  if (ca) ca.onclick = () => (clearSel(), fit());
  const acts = $("crumbActs");
  acts.replaceChildren();
  if (S.view === "canvas") {
    const share = h(`<button type="button" class="dbtn" ${env ? "" : "disabled"}>${IC.share}Share</button>`);
    share.onclick = () => env && openShare(env.id);
    const pres = h(`<button type="button" class="createbtn" ${env || S.envs.size ? "" : "disabled"}>${IC.play}Present</button>`);
    pres.onclick = () => present((env || envList()[0])?.id);
    acts.append(share, pres);
  }
}

function renderSidebarList() {
  const box = $("sbEnvs");
  const envs = envList();
  const ids = new Set(envs.map((e) => e.id));
  box.replaceChildren();
  if (!envs.length) {
    box.append(h(`<div style="padding:4px 8px;font-size:12px;color:var(--text-secondary)">No prototypes yet</div>`));
    return;
  }
  const roots = envs.filter((e) => !e.parent || !ids.has(e.parent));
  const add = (e, sub) => {
    const r = h(`<div class="sb-row${sub ? " sub" : ""}${S.sel?.env === e.id && S.view === "canvas" ? " on" : ""}" role="button" tabindex="0" title="${esc(e.name)}">${sub ? IC.fork : IC.board}<span class="t">${esc(e.name)}</span><button type="button" class="ib24 rmore" aria-label="More for ${esc(e.name)}" aria-haspopup="menu">${IC.more}</button></div>`);
    r.onclick = (ev) => {
      if (ev.target.closest(".rmore")) return;
      go("canvas");
      selectBoard(e.id);
      focusEnv(e.id);
    };
    r.onkeydown = (ev) => ev.key === "Enter" && r.click();
    r.querySelector(".rmore").onclick = (ev) => {
      ev.stopPropagation();
      import("./panels.js").then((m) => m.boardMenu(ev.currentTarget, e.id));
    };
    box.append(r);
    for (const k of envs.filter((x) => x.parent === e.id)) add(k, true);
  };
  for (const e of roots) add(e, false);
}

function renderHarness() {
  const hs = S.ws?.harnesses || [];
  const on = hs.length > 0 || !!S.ws?.agent;
  $("hDot").classList.toggle("on", on);
  $("hLbl").textContent = hs.length ? `${hs[0].client} connected` : S.ws?.agent ? `${S.ws.agent.name} runs requests` : "Connect an agent";
}

// ---------- home ----------
let homeFilter = "all";
function renderHome() {
  const all = envList();
  const ids = new Set(all.map((e) => e.id));
  const isFork = (e) => e.parent && ids.has(e.parent);
  $("hcAll").textContent = all.length;
  $("hcOrig").textContent = all.filter((e) => !isFork(e)).length;
  $("hcForks").textContent = all.filter(isFork).length;
  const list = all.filter((e) => homeFilter === "all" || (homeFilter === "forks" ? isFork(e) : !isFork(e)));
  const g = $("homeGrid");
  g.replaceChildren();
  if (!all.length) {
    g.append(h(`<div class="empty" style="grid-column:1/-1"><b>No prototypes yet</b><span>Import an HTML file, or ask an agent to create one with the create_environment tool.</span><button type="button" class="dbtn" id="homeEmptyImport">${IC.upload}Import HTML</button></div>`));
    $("homeEmptyImport").onclick = () => openImport();
    return;
  }
  if (!list.length) {
    g.append(h(`<div class="empty" style="grid-column:1/-1"><b>${homeFilter === "forks" ? "No forks yet" : "No originals"}</b><span>${homeFilter === "forks" ? "Duplicate a board on the canvas to try a change next to the original." : "Every prototype here is a fork."}</span></div>`));
    return;
  }
  for (const e of list) {
    const parent = isFork(e) ? S.envs.get(e.parent) : null;
    const cmts = S.comments.filter((c) => c.env === e.id && !c.parent && !c.resolved).length;
    const tasks = S.tasks.filter((t) => t.env === e.id).length;
    const card = h(`<button type="button" class="pcard">
      <div class="hd"><span class="tile${parent ? " fork" : ""}">${parent ? IC.fork : IC.board}</span><span class="sp"></span><span class="tagro">${esc(e.theme.toUpperCase())}</span></div>
      <div style="display:flex;flex-direction:column;gap:4px;min-width:0"><h3 title="${esc(e.name)}">${esc(e.name)}</h3><p class="ds">${esc(e.description || (parent ? `A fork of ${parent.name}${e.forkedFrom?.version ? ` from version ${e.forkedFrom.version}` : ""}.` : `An HTML prototype in envs/${e.id}.`))}</p></div>
      <div class="sheet"><span class="k">OPENS ON</span><span class="v">${esc(e.screen || "Its start screen")}</span><span class="k">BOARD</span><span class="v">${e.device.w} × ${e.device.h}</span><span class="k">LINEAGE</span><span class="v">${esc(parent ? `Fork of ${parent.name}` : "Original")}</span><span class="k">OVERRIDES</span><span class="v">${e.overrides ? `${e.overrides} rules` : "None"}</span></div>
      <div class="ft"><span class="c" title="Versions">${IC.version}${e.versions}</span><span class="c" title="Open comments">${IC.cmt}${cmts}</span><span class="c" title="Agent tasks">${IC.agent}${tasks}</span><span class="sp"></span><span class="c">${esc(timeAgo(e.updatedAt).toUpperCase())}</span></div>
    </button>`);
    card.onclick = () => {
      go("canvas");
      selectBoard(e.id);
      focusEnv(e.id);
    };
    g.append(card);
  }
}

// ---------- tasks ----------
function renderTasks() {
  const box = $("tasksList");
  const list = [...S.tasks].reverse();
  if (!list.length) {
    box.innerHTML = `<div class="empty"><b>No requests yet</b><span>Select a board on the canvas and ask an agent to change it, or pin a comment and send it to an agent.</span></div>`;
    return;
  }
  box.replaceChildren(h(`<div class="hr"><span>REQUEST</span><span>PROTOTYPE</span><span>STATUS</span><span>AGENT</span><span>UPDATED</span></div>`));
  const cls = { queued: "", working: "info", done: "ok", failed: "err", cancelled: "" };
  for (const t of list) {
    const env = S.envs.get(t.env);
    const r = h(`<div class="tr" role="button" tabindex="0"><span class="c" title="${esc(t.prompt)}">${esc(t.prompt)}</span><span class="c s">${esc(env?.name || t.env)}</span><span><span class="tagro ${cls[t.status] || ""}">${esc(t.status === "cancelled" ? "STOPPED" : t.status.toUpperCase())}</span></span><span class="c s">${esc(t.claimedBy || (t.status === "queued" ? "Waiting" : "—"))}</span><span class="c m">${esc(timeAgo(t.updatedAt))}</span></div>`);
    r.onclick = () => openAgentFor(t.env);
    r.onkeydown = (e) => e.key === "Enter" && r.click();
    box.append(r);
  }
}

// ---------- actions ----------
async function duplicate(id, version = null) {
  const src = S.envs.get(id);
  if (!src) return;
  try {
    const env = await api(`envs/${id}/fork`, { method: "POST", body: { version, name: version ? `${src.name} V${version}` : undefined } });
    copyStorage(id, env.id);
    await loadWorkspace();
    selectBoard(env.id);
    focusEnv(env.id);
    toast(`Duplicated as ${env.name}`, `envs/${env.id} · its own copy of the files and the app's saved state`);
  } catch (e) {
    toast("Couldn't duplicate", e.message);
  }
}
// A fork also takes the parent's browser state (theme picks, saved lists…), so it opens where the parent was.
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
async function remove(id) {
  const env = S.envs.get(id);
  if (!env) return;
  try {
    const { trash } = await api(`envs/${id}`, { method: "DELETE" });
    if (S.sel?.env === id) clearSel();
    await loadWorkspace();
    toast(`Deleted ${env.name}`, "It's in .workshop/trash until you empty it", {
      label: "Undo",
      fn: async () => {
        try {
          const back = await api("envs/restore", { method: "POST", body: { trash } });
          await loadWorkspace();
          selectBoard(back.id);
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
  const md = modal(`<div class="md-h"><div class="tt"><h2>Rename prototype</h2><p>The folder stays envs/${esc(id)}, so agents and links keep working.</p></div></div><form class="md-b" id="rnF"><div class="fld"><span class="lr">Name</span><div class="afld-in"><input id="rnIn" value="${esc(env.name)}" maxlength="120" autofocus></div></div></form><div class="md-f"><button type="button" class="ghbtn" data-a="x">Cancel</button><button type="button" class="createbtn" data-a="ok">Rename</button></div>`);
  md.style.width = "480px";
  const ok = async () => {
    const v = $("rnIn").value.trim();
    if (!v) return $("rnIn").focus();
    try {
      const next = await api(`envs/${id}`, { method: "PATCH", body: { name: v } });
      S.envs.set(id, next);
      closeModal();
      renderAll();
      markDirty();
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
  const md = modal(`<div class="md-h"><div class="tt"><h2>Save a version of ${esc(env.name)}</h2><p>A snapshot of the whole folder. You can restore it or fork from it later.</p></div></div><form class="md-b" id="svF"><div class="fld"><span class="lr">What changed<span class="hint">Optional</span></span><div class="afld-in"><input id="svIn" placeholder="Version ${n}" maxlength="120" autofocus></div></div></form><div class="md-f"><button type="button" class="ghbtn" data-a="x">Cancel</button><button type="button" class="createbtn" data-a="ok">Save version</button></div>`);
  md.style.width = "480px";
  let busy = false;
  const ok = async () => {
    if (busy) return;
    busy = true;
    try {
      const v = await api(`envs/${id}/versions`, { method: "POST", body: { label: $("svIn").value.trim() } });
      closeModal();
      await loadVersions(id);
      toast(`Saved V${v.n}`, v.label);
    } catch (e) {
      busy = false;
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
    toast(label ? `Undid ${label}` : `Restored V${n}`, `The state before is saved as V${r.before.n}`, { label: "Undo", fn: () => restoreVersion({ id, n: r.before.n }) });
  } catch (e) {
    toast("Couldn't restore", e.message);
  }
}

// ---------- present: the board fills the window and runs as the app ----------
let presenting = null;
function present(id) {
  if (!id || !S.envs.has(id)) return;
  go("canvas");
  presenting = { id, mode: S.mode, cam: { ...S.cam } };
  S.presenting = id;
  selectBoard(id, { quiet: true });
  $("frame").classList.add("present");
  boardOf(id)?.el.classList.add("presenting");
  setMode("prototype");
  const env = S.envs.get(id);
  const bar = h(`<div class="cvtools prsbar" style="top:12px;bottom:auto" role="toolbar" aria-label="Presenting"><span style="padding:0 8px 0 12px;font-weight:500;white-space:nowrap">${esc(env.name)}</span><span class="tagro">${env.device.w} × ${env.device.h}</span><span class="vsep"></span><button type="button" class="ghbtn sm" data-a="tab">${IC.ext}New tab</button><button type="button" class="createbtn sm" data-a="exit">Exit · Esc</button></div>`);
  bar.querySelector('[data-a="tab"]').onclick = () => window.open(`/present/${id}/`, "_blank", "noopener");
  bar.querySelector('[data-a="exit"]').onclick = stopPresent;
  $("cv").append(bar);
  // the bar steps aside so the app's own top bar stays usable; it comes back when the pointer nears the top
  let hideT = 0;
  const show = () => {
    bar.style.opacity = "1";
    bar.style.pointerEvents = "auto";
    clearTimeout(hideT);
    hideT = setTimeout(() => {
      if (!bar.matches(":hover")) {
        bar.style.opacity = "0";
        bar.style.pointerEvents = "none";
      }
    }, 2200);
  };
  bar.style.transition = "opacity 160ms ease";
  const near = (y) => y < 64 && show();
  const onParent = (e) => presenting && near(e.clientY - $("cv").getBoundingClientRect().top);
  const doc = boardOf(id)?.frame.contentDocument;
  const onChild = (e) => presenting && near(e.clientY);
  document.addEventListener("pointermove", onParent);
  doc?.addEventListener("pointermove", onChild);
  presenting.cleanup = () => {
    clearTimeout(hideT);
    document.removeEventListener("pointermove", onParent);
    doc?.removeEventListener("pointermove", onChild);
  };
  show();
  requestAnimationFrame(() => requestAnimationFrame(() => fit([id], { ms: 0, maxZ: 1, pad: 0, toolbar: false })));
}
function stopPresent() {
  if (!presenting) return;
  const p = presenting;
  p.cleanup?.();
  presenting = null;
  S.presenting = null;
  boardOf(p.id)?.el.classList.remove("presenting");
  $("frame").classList.remove("present");
  q(".prsbar")?.remove();
  setMode(p.mode);
  Object.assign(S.cam, p.cam);
  requestAnimationFrame(() => focusEnv(p.id, { ms: 0 }));
}
document.addEventListener("keydown", (e) => {
  if (presenting && e.key === "Escape") {
    e.preventDefault();
    stopPresent();
  }
}, true);

// ---------- share ----------
async function openShare(id) {
  const env = S.envs.get(id);
  const md = modal(`<div class="md-h"><div class="tt"><h2>Share ${esc(env.name)}</h2><p>People open it as the running app. Links can't change the prototype.</p></div><button type="button" class="ib32" data-a="x" aria-label="Close">${IC.x}</button></div><div class="md-b" id="shB"><div class="pempty" style="padding:0">Loading links</div></div><div class="md-f"><button type="button" class="createbtn" data-a="done">Done</button></div>`);
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
    const links = data.links.filter((l) => l.env === id);
    const b = $("shB");
    if (!b) return;
    b.replaceChildren();
    const local = `${location.origin}/present/${id}/`;
    const l1 = h(`<div class="fld"><span class="lr">On this computer</span><div class="lnk"><span class="u">${esc(local)}</span><button type="button" class="ib24" aria-label="Copy link">${IC.copy}</button><button type="button" class="ib24" aria-label="Open">${IC.ext}</button></div></div>`);
    const [c1, o1] = l1.querySelectorAll(".ib24");
    c1.onclick = () => copyText(local);
    o1.onclick = () => window.open(local, "_blank", "noopener");
    b.append(l1);
    const net = h(`<div class="setrow"><div class="tx"><b>Share on your network</b><span>${data.network ? `Others on this network open links at ${esc(data.base || "this computer's address")}` : "Lets people on the same Wi-Fi or office network open share links. Only share links work from other computers."}</span></div><button type="button" class="sw" role="switch" aria-checked="${data.network}" aria-label="Share on your network"><i></i></button></div>`);
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
    const rowc = lf.querySelector("div");
    const dd = segmented([{ label: "Can view", value: "view" }, { label: "Can comment", value: "comment" }], role, (v) => {
      role = v;
      paint();
    }, { label: "Link access" });
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
    rowc.append(dd, mk);
    b.append(lf);
    if (!data.network) b.append(h(`<span style="font-size:12px;color:var(--text-secondary);margin-top:-16px">Turn on network sharing to create links.</span>`));
    const lst = h(`<div></div>`);
    for (const l of links) {
      const url = data.base ? `${data.base}/s/${l.token}` : `/s/${l.token}`;
      const r = h(`<div class="lnk"><span class="u" title="${esc(url)}">${esc(url)}</span><span class="tagro">${l.role === "comment" ? "CAN COMMENT" : "CAN VIEW"}</span><button type="button" class="ib24" aria-label="Copy link">${IC.copy}</button><button type="button" class="ghbtn sm" style="color:var(--text-error)">Turn off</button></div>`);
      r.querySelector(".ib24").onclick = () => copyText(url);
      r.querySelector(".ghbtn").onclick = async () => {
        await api(`shares/${l.id}`, { method: "DELETE" }).catch((e) => toast("Couldn't turn it off", e.message));
        paint();
      };
      lst.append(r);
    }
    if (links.length) b.append(lst);
  };
  paint();
}

// ---------- connect an agent ----------
function shq(s) {
  return /^[\w@%+=:,./-]+$/.test(s) ? s : `'${String(s).replace(/'/g, "'\\''")}'`;
}
function splitCmd(s) {
  const out = [];
  let cur = "",
    qch = null,
    any = false;
  for (const c of s) {
    if (qch) {
      if (c === qch) qch = null;
      else cur += c;
    } else if (c === '"' || c === "'") {
      qch = c;
      any = true;
    } else if (/\s/.test(c)) {
      if (cur || any) out.push(cur);
      cur = "";
      any = false;
    } else cur += c;
  }
  if (cur || any) out.push(cur);
  return out;
}
const CLAUDE_AUTO = ["claude", "-p", "{prompt}", "--permission-mode", "acceptEdits"];
function openConnect() {
  const ws = S.ws;
  const cli = ws.cli || {};
  const mcpCmd = `claude mcp add workshop -- ${shq(cli.node || "node")} ${shq(cli.bin || "bin/workshop.js")} mcp --workspace ${shq(ws.root)}`;
  const json = JSON.stringify({ mcpServers: { workshop: { command: cli.node || "node", args: [cli.bin || "bin/workshop.js", "mcp", "--workspace", ws.root] } } }, null, 2);
  const hs = ws.harnesses || [];
  const isClaude = ws.agent && JSON.stringify(ws.agent.command) === JSON.stringify(CLAUDE_AUTO);
  let mode = !ws.agent ? "wait" : isClaude ? "claude" : "custom";
  const md = modal(`<div class="md-h"><div class="tt"><h2>Connect an agent</h2><p>Agents work on the same files the canvas shows. Ask on the canvas; the agent edits the prototype; the board reloads.</p></div><button type="button" class="ib32" data-a="x" aria-label="Close">${IC.x}</button></div>
  <div class="md-b">
    <div class="ahar"><span class="hdot${hs.length ? " on" : ""}"></span><span>${hs.length ? hs.map((x) => `<b>${esc(x.client)}</b> connected ${esc(timeAgo(x.at))}`).join(" · ") : "No agent is connected over MCP right now"}</span></div>
    <div class="fld"><span class="lr">Claude Code<span class="hint">MCP</span></span><span style="color:var(--text-secondary)">Run this once in a terminal, then ask Claude Code to "take the next Workshop task", or to work on what's selected.</span><div class="code" id="cnMcp">${esc(mcpCmd)}<button type="button" class="ib24" aria-label="Copy command">${IC.copy}</button></div></div>
    <div class="fld"><span class="lr">Any MCP client<span class="hint">stdio</span></span><div class="code" id="cnJson">${esc(json)}<button type="button" class="ib24" aria-label="Copy config">${IC.copy}</button></div></div>
    <div class="fld"><span class="lr">When you ask on the canvas</span><div id="cnSeg"></div><div id="cnMore"></div></div>
  </div>
  <div class="md-f"><span class="sp"></span><button type="button" class="ghbtn" data-a="x2">Cancel</button><button type="button" class="createbtn" data-a="save">Save</button></div>`, { wide: true });
  md.querySelector("#cnMcp .ib24").onclick = () => copyText(mcpCmd);
  md.querySelector("#cnJson .ib24").onclick = () => copyText(json);
  const paint = () => {
    $("cnSeg").replaceChildren(segmented([{ label: "Wait for a connected agent", value: "wait" }, { label: "Run Claude Code", value: "claude" }, { label: "Run a command", value: "custom" }], mode, (v) => ((mode = v), paint()), { full: true, label: "When you ask on the canvas" }));
    const more = $("cnMore");
    if (mode === "wait") more.innerHTML = `<span style="color:var(--text-secondary)">Requests queue up until an agent takes them with <span class="mono" style="font-size:12px;font-weight:400">take_task</span>.</span>`;
    if (mode === "claude") more.innerHTML = `<span style="color:var(--text-secondary)">Each request runs <span class="mono" style="font-size:12px;font-weight:400">claude -p</span> in the prototype's folder with edits allowed, one at a time. A version is saved first.</span>`;
    if (mode === "custom") {
      more.innerHTML = `<div class="afld-in"><input id="cnCmd" placeholder="my-agent --task {prompt}" value="${esc(ws.agent && !isClaude ? ws.agent.command.map(shq).join(" ") : "")}" aria-label="Command"></div><span style="font-size:12px;color:var(--text-secondary)">{prompt} is the full brief, {request} the words typed, {dir} the folder, {file} its index.html. Without {prompt} the brief arrives on stdin.</span>`;
    }
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
  const md = modal(`<div class="md-h"><div class="tt"><h2>Import a prototype</h2><p>An HTML file becomes a folder in envs/ with its own board, versions and history.</p></div><button type="button" class="ib32" data-a="x" aria-label="Close">${IC.x}</button></div>
  <div class="md-b">
    <div class="drop" id="imDrop" tabindex="0" role="button"><b>Drop an HTML file</b><span>or choose one from your computer</span><button type="button" class="dbtn" id="imPick">${IC.upload}Choose file</button></div>
    <div class="fld"><span class="lr">Or paste HTML<span class="hint">A whole document, e.g. an HTML artifact</span></span><textarea class="afld-ta" id="imHtml" style="min-height:120px;font-family:var(--mono);font-size:12px" placeholder="<!doctype html>…"></textarea></div>
    <div class="fld"><span class="lr">Name<span class="hint">Optional — the page title is used otherwise</span></span><div class="afld-in"><input id="imName" maxlength="120"></div></div>
  </div>
  <div class="md-f"><span class="sp"></span><button type="button" class="ghbtn" data-a="x2">Cancel</button><button type="button" class="createbtn" data-a="ok">Import</button></div>`);
  let file = null;
  const drop = $("imDrop");
  const setFile = (f) => {
    file = f;
    drop.querySelector("b").textContent = f.name;
    drop.querySelector("span").textContent = `${Math.round(f.size / 1024)} KB · ready to import`;
  };
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
    if (f) setFile(f);
    else toast("That isn't an HTML file");
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
    try {
      const env = file ? await importFile(file, name) : await api("envs", { method: "POST", body: { html, name, source: { kind: "paste" } } });
      if (!file) toast(`Added ${env.name}`, `Saved to envs/${env.id}/index.html`);
      closeModal();
      go("canvas");
      await loadWorkspace();
      selectBoard(env.id);
      focusEnv(env.id);
    } catch (e) {
      busy = false;
      toast("Couldn't import", e.message);
    }
  };
}

// ---------- search palette ----------
let palItems = [];
let palIdx = 0;
function openPal() {
  $("pal").classList.add("open");
  $("palIn").value = "";
  paintPal();
  setTimeout(() => $("palIn").focus(), 20);
}
function closePal() {
  $("pal").classList.remove("open");
}
function paintPal() {
  const qv = $("palIn").value.trim().toLowerCase();
  const actions = [
    { label: "Import HTML", k: "Action", fn: openImport },
    { label: "Connect an agent", k: "Action", fn: openConnect },
    { label: "Go to Home", k: "View", fn: () => go("home") },
    { label: "Go to Canvas", k: "View", fn: () => go("canvas") },
    { label: "Go to Agent tasks", k: "View", fn: () => go("tasks") },
    { label: "Zoom to fit", k: "Canvas", fn: () => (go("canvas"), fit()) },
    ...(S.sel ? [{ label: `Duplicate ${selEnv()?.name}`, k: "Action", fn: () => duplicate(S.sel.env) }] : []),
  ];
  const envs = envList().map((e) => ({ label: e.name, k: e.parent ? "Fork" : "Prototype", fn: () => (go("canvas"), selectBoard(e.id), focusEnv(e.id)) }));
  palItems = [...envs, ...actions].filter((x) => !qv || x.label.toLowerCase().includes(qv));
  palIdx = 0;
  const rs = $("palRs");
  rs.replaceChildren();
  if (!palItems.length) rs.append(h(`<div class="none">Nothing matches "${esc(qv)}"</div>`));
  palItems.forEach((x, i) => {
    const b = h(`<button type="button" role="option" class="${i === palIdx ? "on" : ""}">${x.k === "Prototype" ? IC.board : x.k === "Fork" ? IC.fork : IC.chevr}<span class="l">${esc(x.label)}</span><span class="k">${esc(x.k)}</span></button>`);
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

// ---------- boot ----------
async function boot() {
  fitShell();
  window.addEventListener("resize", fitShell);
  initCanvas();
  initPanels();
  // sidebar
  for (const b of qa(".sidebar [data-view]")) b.onclick = () => go(b.dataset.view);
  $("sbSearch").onclick = openPal;
  $("sbSearch").onkeydown = (e) => (e.key === "Enter" || e.key === " ") && (e.preventDefault(), openPal());
  $("sbHarness").onclick = openConnect;
  $("tasksConnect").onclick = openConnect;
  $("sbCollapse").onclick = () => {
    $("sidebar").classList.toggle("clpsd");
    $("sbCollapse").setAttribute("aria-label", $("sidebar").classList.contains("clpsd") ? "Expand sidebar" : "Collapse sidebar");
    setTimeout(markDirty, 320);
  };
  const addMenu = (a) => menu(a, [
    { label: "Import HTML file", icon: IC.upload, onClick: openImport },
    { label: "Duplicate selected", icon: IC.fork, kbd: "⌘D", disabled: !S.sel, onClick: () => S.sel && duplicate(S.sel.env) },
    "-",
    { label: "Ask an agent to make one", icon: IC.agent, onClick: openConnect },
  ], { width: 240 });
  $("sbAdd").onclick = () => addMenu($("sbAdd"));
  $("lAdd").onclick = () => addMenu($("lAdd"));
  $("homeImport").onclick = openImport;
  $("cvImport").onclick = openImport;
  $("homeCanvas").onclick = () => go("canvas");
  for (const b of qa("#homeTabs button"))
    b.onclick = () => {
      homeFilter = b.dataset.f;
      qa("#homeTabs button").forEach((x) => (x.classList.toggle("on", x === b), x.setAttribute("aria-selected", String(x === b))));
      renderHome();
    };
  $("wsProj").onclick = () =>
    menu($("wsProj"), [
      { head: S.ws.root },
      { label: "Copy folder path", icon: IC.copy, onClick: () => copyText(S.ws.root) },
      { label: "Rename workspace", icon: IC.board, onClick: renameWorkspace },
    ], { width: 280 });
  $("sbTheme").onclick = () => {
    let pref = "light";
    try {
      pref = localStorage.getItem("ws-theme") || "light";
    } catch {}
    menu($("sbTheme"), ["light", "dark", "system"].map((t) => ({ label: t[0].toUpperCase() + t.slice(1), checked: pref === t, onClick: () => setTheme(t) })), { up: true });
  };
  // palette keys
  $("palIn").oninput = paintPal;
  $("palIn").onkeydown = (e) => {
    if (e.key === "ArrowDown") (e.preventDefault(), setPal(Math.min(palItems.length - 1, palIdx + 1)));
    else if (e.key === "ArrowUp") (e.preventDefault(), setPal(Math.max(0, palIdx - 1)));
    else if (e.key === "Enter") (e.preventDefault(), palItems[palIdx] && (closePal(), palItems[palIdx].fn()));
    else if (e.key === "Escape") (e.preventDefault(), closePal());
  };
  document.addEventListener("pointerdown", (e) => {
    if ($("pal").classList.contains("open") && !$("pal").contains(e.target) && !$("sbSearch").contains(e.target)) closePal();
  });
  document.addEventListener("keydown", (e) => {
    const mod = e.metaKey || e.ctrlKey;
    if (mod && (e.key === "k" || e.key === "K")) {
      e.preventDefault();
      return $("pal").classList.contains("open") ? closePal() : openPal();
    }
    if (mod && !e.shiftKey && (e.key === "z" || e.key === "Z") && !isTyping(e.target) && S.view === "canvas") {
      e.preventDefault();
      undoStyle().then((did) => !did && toast("Nothing to undo", "Style edits from the inspector can be undone here"));
    }
  });
  // bus
  on("duplicate", (id) => duplicate(id));
  on("fork-version", ({ id, n }) => duplicate(id, n));
  on("delete", remove);
  on("rename", rename);
  on("present", present);
  on("exit-present", stopPresent);
  on("share", openShare);
  on("connect", openConnect);
  on("save-version", saveVersion);
  on("restore-version", restoreVersion);
  on("reload-workspace", loadWorkspace);
  on("comments-changed", async (d) => {
    await loadComments();
    if (d?.reopen) import("./canvas.js").then((m) => m.openThread(d.reopen));
  });
  on("tasks-changed", loadTasks);
  on("sel", () => {
    renderCrumb();
    renderSidebarList();
  });
  on("env-meta", (id) => {
    renderCrumb();
    syncBoards();
    if (S.view === "home") renderHome();
  });
  // data
  try {
    await loadWorkspace();
  } catch (e) {
    $("content").append(h(`<div class="winov open" style="position:absolute"><div class="md" style="width:480px"><div class="md-h"><div class="tt"><h2>The Workshop server isn't answering</h2><p>${esc(e.message)}. Start it with <span class="mono" style="font-size:12px;font-weight:400">npm start</span> in the workshop folder, then reload.</p></div></div></div></div>`));
    return;
  }
  await Promise.all([loadComments(), loadTasks()]);
  let hadCam = false;
  try {
    hadCam = !!localStorage.getItem("ws-cam");
  } catch {}
  go(viewFromPath(), { push: false });
  if (!hadCam) requestAnimationFrame(() => fit(undefined, { ms: 0 }));
  events(onEvent, (live) => (S.live = live));
  setInterval(() => api("workspace").then((ws) => {
    const before = JSON.stringify(S.ws?.harnesses?.map((x) => x.client));
    S.ws.harnesses = ws.harnesses;
    if (JSON.stringify(ws.harnesses.map((x) => x.client)) !== before) renderAll();
  }).catch(() => {}), 20000);
}

async function onEvent(ev) {
  if (ev.kind === "envs") return loadWorkspace();
  if (ev.kind === "env") {
    if (!S.envs.has(ev.id)) return loadWorkspace();
    try {
      const env = await api(`envs/${ev.id}`);
      S.envs.set(ev.id, env);
    } catch {
      return loadWorkspace();
    }
    reloadBoard(ev.id, ev.files || []);
    syncBoards();
    renderSidebarList();
    if (S.view === "home") renderHome();
    return;
  }
  if (ev.kind === "tasks") return loadTasks();
  if (ev.kind === "comments") return loadComments();
  if (ev.kind === "versions") {
    if (S.sel) loadVersions(S.sel.env);
    return;
  }
  if (ev.kind === "harness") {
    const ws = await api("workspace").catch(() => null);
    if (ws) {
      S.ws.harnesses = ws.harnesses;
      renderAll();
    }
  }
}

function setTheme(t) {
  try {
    localStorage.setItem("ws-theme", t);
  } catch {}
  const d = t === "system" ? (matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light") : t;
  document.documentElement.setAttribute("data-ltheme", d);
  document.documentElement.setAttribute("data-ltheme-pref", t);
}
function renameWorkspace() {
  const md = modal(`<div class="md-h"><div class="tt"><h2>Rename workspace</h2><p>The folder on disk keeps its name.</p></div></div><form class="md-b" id="rwF"><div class="fld"><span class="lr">Name</span><div class="afld-in"><input id="rwIn" value="${esc(S.ws.name)}" maxlength="120" autofocus></div></div></form><div class="md-f"><button type="button" class="ghbtn" data-a="x">Cancel</button><button type="button" class="createbtn" data-a="ok">Rename</button></div>`);
  md.style.width = "480px";
  const ok = async () => {
    const v = $("rwIn").value.trim();
    if (!v) return;
    await api("workspace", { method: "PATCH", body: { name: v } }).catch((e) => toast("Couldn't rename", e.message));
    closeModal();
    loadWorkspace();
  };
  md.querySelector('[data-a="ok"]').onclick = ok;
  md.querySelector('[data-a="x"]').onclick = closeModal;
  $("rwF").onsubmit = (e) => (e.preventDefault(), ok());
}

boot();
