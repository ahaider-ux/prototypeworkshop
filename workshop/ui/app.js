// Libra Workshop — boot, live updates, branches, review and merge, and the dialogs.

import { S, on, fire, envList, visibleEnvs, boardsOf, itemsOf, selEnv, selEnvId, isBranch, screenName } from "./state.js";
import { $, qa, h, esc, api, events, toast, IC, menu, modal, closeModal, copyText, timeAgo, segmented } from "./lib.js";
import { initCanvas, sync, fit, focusEnv, focusItem, fitRect, selectSection, selectBoard, clearSel, reloadEnv, markDirty, setMode, importFile, isTyping, boardOf, openThread, placeScreen, isDragging, sectionRect, selectItem } from "./canvas.js";
import { initPanels, renderLeft, renderRight, loadVersions, loadDiff, undoStyle } from "./panels.js";

// ---------- data ----------
async function loadWorkspace() {
  const ws = await api("workspace");
  S.ws = ws;
  S.envs = new Map(ws.envs.map((e) => [e.id, e]));
  S.items = new Map(ws.items.map((i) => [i.id, i]));
  if (S.sel && S.sel.env && !S.envs.has(S.sel.env)) clearSel();
  if (S.sel && S.sel.item && !S.items.has(S.sel.item)) clearSel();
  $("wsName").textContent = ws.name;
  document.title = `${ws.name} · Libra Workshop`;
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
    renderLeft();
    if (S.rightTab !== "design") renderRight();
  } catch {}
}
async function loadComments() {
  S.comments = await api("comments").catch(() => S.comments);
  markDirty();
  renderRight();
}
let lastStatus = new Map();
async function loadTasks() {
  const list = await api("tasks").catch(() => S.tasks);
  for (const t of list) {
    const was = lastStatus.get(t.id);
    if (was && was !== t.status && (t.status === "done" || t.status === "failed")) {
      const env = S.envs.get(t.env);
      toast(t.status === "done" ? `${t.claimedBy || "The agent"} finished` : `${t.claimedBy || "The agent"} couldn't finish`, `${env?.name || t.env}${t.reply ? ` · ${t.reply.slice(0, 120)}` : ""}`, isBranch(env) && t.status === "done" ? { label: "Review and merge", fn: () => openReview(env.id) } : { label: "Show", fn: () => (selectSection(t.env), fire("ask-agent", {})) });
      S.diffs.delete(t.env);
    }
  }
  lastStatus = new Map(list.map((t) => [t.id, t.status]));
  S.tasks = list;
  renderRight();
}
function renderAll() {
  renderWho();
  renderLeft();
  renderRight();
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
    const c = h(`<button type="button" class="av" style="margin-left:-6px;cursor:pointer" aria-label="Connect an agent" data-tip="Connect an agent">${IC.plus}</button>`);
    c.onclick = openConnect;
    w.append(c);
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
  const md = modal(`<div class="md-h"><div class="tt"><h2>Create a branch of ${esc(src.name)}</h2><p>A new section with the same ${boardsOf(id).length || ""} screen${boardsOf(id).length === 1 ? "" : "s"}. Change anything there; ${esc(src.name)} only changes when you merge.</p></div></div><form class="md-b" id="brF"><div class="fld"><span class="lr">What are you trying?</span><div class="afld-in"><input id="brIn" maxlength="120" placeholder="Denser sidebar" autofocus></div></div></form><div class="md-f"><button type="button" class="ghbtn" data-a="x">Cancel</button><button type="button" class="createbtn" data-a="ok">${IC.fork}Create branch</button></div>`);
  md.style.width = "480px";
  let busy = false;
  const ok = async () => {
    if (busy) return;
    busy = true;
    try {
      const env = await api(`envs/${id}/branch`, { method: "POST", body: { name: $("brIn").value.trim() || undefined } });
      copyStorage(id, env.id);
      closeModal();
      await loadWorkspace();
      selectSection(env.id);
      requestAnimationFrame(() => fitRect(boundsOfEnvs([id, env.id])));
      toast(`Branched ${src.name}`, `${env.name} reads ${src.name}'s files until it changes them`);
    } catch (e) {
      busy = false;
      toast("Couldn't create the branch", e.message);
    }
  };
  md.querySelector('[data-a="ok"]').onclick = ok;
  md.querySelector('[data-a="x"]').onclick = closeModal;
  $("brF").onsubmit = (e) => (e.preventDefault(), ok());
}
function boundsOfEnvs(ids) {
  const rs = ids.map(sectionRect).filter(Boolean);
  if (!rs.length) return null;
  return { x0: Math.min(...rs.map((r) => r.x)), y0: Math.min(...rs.map((r) => r.y)), x1: Math.max(...rs.map((r) => r.x + r.w)), y1: Math.max(...rs.map((r) => r.y + r.h)) };
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
  const md = modal(`<div class="md-h"><div class="tt"><h2>Review and merge</h2><p>${esc(env.name)} into ${esc(parent.name)} · ${d.changes.length} change${d.changes.length === 1 ? "" : "s"}${d.conflicts ? ` · ${d.conflicts} conflict${d.conflicts === 1 ? "" : "s"}: ${esc(parent.name)} changed the same thing since the branch was made` : ""}</p></div><button type="button" class="ib32" data-a="x" aria-label="Close">${IC.x}</button></div><div class="md-b" id="rvB"></div><div class="md-f">${d.behind ? `<span style="font-size:12px;color:var(--text-secondary)">${d.behind} change${d.behind === 1 ? "" : "s"} on ${esc(parent.name)} stay as they are.</span>` : ""}<span class="sp"></span><button type="button" class="ghbtn" data-a="x2">Cancel</button><button type="button" class="createbtn" data-a="ok" ${d.changes.length ? "" : "disabled"}>Merge into ${esc(parent.name)}</button></div>`, { wide: true });
  const b = $("rvB");
  if (!d.changes.length) b.append(h(`<div class="pempty" style="padding:0"><b>Nothing to merge yet</b>This branch is the same as ${esc(parent.name)} was when it was made.</div>`));
  const groups = [["setting", "SETTINGS"], ["style", "DESIGN OVERRIDES"], ["file", "FILES"]];
  for (const [kind, title] of groups) {
    const cs = d.changes.filter((c) => c.kind === kind);
    if (!cs.length) continue;
    const g = h(`<div class="rvg"><div class="rvh">${title} · ${cs.length}</div></div>`);
    for (const c of cs) {
      const val = kind === "file" ? (c.conflict ? `Changed here and on ${esc(parent.name)}` : "Changed on the branch") : `<del>${esc(fmt(c.main, c.key))}</del> → <ins>${esc(fmt(c.branch, c.key))}</ins>`;
      const r = h(`<div class="rvr${c.conflict ? " conflict" : ""}"><div style="display:flex;flex-direction:column;gap:4px;min-width:0"><span class="k">${esc(c.label)}</span><span class="v">${val}</span></div><span class="ch"></span></div>`);
      if (c.conflict) {
        take[c.key] = "branch";
        const pick = () =>
          r.querySelector(".ch").replaceChildren(
            segmented([{ label: "Keep branch", value: "branch" }, { label: `Keep ${parent.name.length > 14 ? "main" : parent.name}`, value: "main" }], take[c.key], (v) => {
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
    try {
      const r = await api(`envs/${id}/merge`, { method: "POST", body: { take } });
      closeModal();
      await loadWorkspace();
      selectSection(parent.id);
      focusEnv(parent.id);
      toast(`Merged ${env.name} into ${parent.name}`, `${r.applied} change${r.applied === 1 ? "" : "s"} · the branch is archived · V${r.before.n} has ${parent.name} as it was`, {
        label: "Undo",
        fn: async () => {
          await api(`envs/${parent.id}/versions/${r.before.n}/restore`, { method: "POST" });
          await api(`envs/${id}`, { method: "PATCH", body: { archived: false } });
          await loadWorkspace();
        },
      });
    } catch (e) {
      busy = false;
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
    toast(r.updated ? `Brought in ${r.updated} change${r.updated === 1 ? "" : "s"} from ${S.envs.get(S.envs.get(id).parent)?.name}` : "Already up to date");
  } catch (e) {
    toast("Couldn't update the branch", e.message);
  }
}
function envMenu({ anchor, env: id }) {
  const e = S.envs.get(id);
  if (!e) return;
  const br = isBranch(e);
  menu(anchor, [
    { label: "Create branch", icon: IC.fork, onClick: () => createBranch(id) },
    ...(br && !e.archived ? [{ label: "Review and merge", icon: IC.check, onClick: () => openReview(id) }, { label: `Update from ${S.envs.get(e.parent)?.name || "main"}`, icon: IC.restore, onClick: () => updateFromMain(id) }] : []),
    "-",
    { label: "Place a screen", icon: IC.plus, onClick: () => (selectSection(id), fire("left-tab", "screens")) },
    { label: "Present", icon: IC.play, disabled: !boardsOf(id).length, onClick: () => present(boardsOf(id)[0]?.id) },
    { label: "Share", icon: IC.share, onClick: () => openShare(id) },
    { label: "Rename", icon: IC.board, onClick: () => rename(id) },
    { label: "Copy folder path", icon: IC.folder, onClick: () => copyText(`${S.ws.root}/envs/${id}`) },
    { label: "Make an independent copy", icon: IC.copy, onClick: () => duplicateEnv(id) },
    "-",
    ...(br ? [{ label: e.archived ? "Unarchive branch" : "Archive branch", onClick: () => api(`envs/${id}`, { method: "PATCH", body: { archived: !e.archived } }).then(loadWorkspace) }] : []),
    { label: `Delete ${br ? "branch" : "prototype"}`, icon: IC.trash, danger: true, onClick: () => remove(id) },
  ], { width: 256 });
}
async function duplicateEnv(id, version = null) {
  const src = S.envs.get(id);
  try {
    const env = await api(`envs/${id}/fork`, { method: "POST", body: { version, name: version ? `${src.name} V${version}` : undefined } });
    copyStorage(id, env.id);
    await loadWorkspace();
    selectSection(env.id);
    focusEnv(env.id);
    toast(`Copied as ${env.name}`, "An independent copy, with no branch link back");
  } catch (e) {
    toast("Couldn't copy it", e.message);
  }
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
          selectSection(back.id);
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
    S.diffs.delete(id);
    toast(label ? `Undid ${label}` : `Restored V${n}`, `The state before is saved as V${r.before.n}`, { label: "Undo", fn: () => restoreVersion({ id, n: r.before.n }) });
  } catch (e) {
    toast("Couldn't restore", e.message);
  }
}

// ---------- present: one board fills the window and runs as the app ----------
let presenting = null;
function present(bid) {
  const it = bid && S.items.get(bid);
  if (!it) return toast("Nothing to present", "Place a screen on the canvas first");
  presenting = { bid, mode: S.mode, cam: { ...S.cam } };
  S.presenting = bid;
  selectBoard(bid, { quiet: true });
  $("frame").classList.add("present");
  boardOf(bid)?.el.classList.add("presenting");
  setMode("prototype");
  const env = S.envs.get(it.env);
  const bar = h(`<div class="prsbar float" role="toolbar" aria-label="Presenting"><span style="padding:0 8px 0 12px;font-weight:500;white-space:nowrap">${esc(env.name)} · ${esc(screenName(it))}</span><span class="tagro">${it.w} × ${it.h}</span><span class="vsep" style="width:1px;height:20px;background:var(--border-subtle);margin:0 4px"></span><button type="button" class="ghbtn sm" data-a="tab">${IC.ext}New tab</button><button type="button" class="createbtn sm" data-a="exit">Exit · Esc</button></div>`);
  bar.querySelector('[data-a="tab"]').onclick = () => window.open(`/present/${it.env}/?screen=${encodeURIComponent(it.screen || "")}`, "_blank", "noopener");
  bar.querySelector('[data-a="exit"]').onclick = stopPresent;
  $("frame").append(bar);
  let hideT = 0;
  const show = () => {
    bar.style.opacity = "1";
    bar.style.pointerEvents = "auto";
    clearTimeout(hideT);
    hideT = setTimeout(() => !bar.matches(":hover") && ((bar.style.opacity = "0"), (bar.style.pointerEvents = "none")), 2200);
  };
  const near = (e) => presenting && e.clientY < 64 && show();
  const doc = boardOf(bid)?.frame.contentDocument;
  document.addEventListener("pointermove", near);
  doc?.addEventListener("pointermove", near);
  presenting.cleanup = () => (clearTimeout(hideT), document.removeEventListener("pointermove", near), doc?.removeEventListener("pointermove", near), bar.remove());
  show();
  requestAnimationFrame(() => requestAnimationFrame(() => fitRect({ x0: it.x, y0: it.y, x1: it.x + it.w, y1: it.y + it.h }, { ms: 0, maxZ: 1, pad: 0 })));
}
function stopPresent() {
  if (!presenting) return;
  const p = presenting;
  p.cleanup?.();
  presenting = null;
  S.presenting = null;
  boardOf(p.bid)?.el.classList.remove("presenting");
  $("frame").classList.remove("present");
  setMode(p.mode);
  Object.assign(S.cam, p.cam);
  requestAnimationFrame(() => focusItem(p.bid, { ms: 0, maxZ: 0.6 }));
}
document.addEventListener("keydown", (e) => presenting && e.key === "Escape" && (e.preventDefault(), stopPresent()), true);

// ---------- share ----------
async function openShare(id) {
  const env = S.envs.get(id);
  if (!env) return toast("Select a prototype or branch to share");
  const md = modal(`<div class="md-h"><div class="tt"><h2>Share ${esc(env.name)}</h2><p>People open it as the running app. Links can't change it.</p></div><button type="button" class="ib32" data-a="x" aria-label="Close">${IC.x}</button></div><div class="md-b" id="shB"><div class="pempty" style="padding:0">Loading links</div></div><div class="md-f"><button type="button" class="createbtn" data-a="done">Done</button></div>`);
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
      const r = h(`<div class="lnk"><span class="u" title="${esc(url)}">${esc(url)}</span><span class="tagro">${l.role === "comment" ? "CAN COMMENT" : "CAN VIEW"}</span><button type="button" class="ib24" aria-label="Copy link">${IC.copy}</button><button type="button" class="ghbtn sm" style="color:var(--text-error)">Turn off</button></div>`);
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
  const mcpCmd = `claude mcp add workshop -- ${shq(cli.node || "node")} ${shq(cli.bin || "bin/workshop.js")} mcp --workspace ${shq(ws.root)}`;
  const json = JSON.stringify({ mcpServers: { workshop: { command: cli.node || "node", args: [cli.bin || "bin/workshop.js", "mcp", "--workspace", ws.root] } } }, null, 2);
  const hs = ws.harnesses || [];
  const isClaude = ws.agent && JSON.stringify(ws.agent.command) === JSON.stringify(CLAUDE_AUTO);
  let mode = !ws.agent ? "wait" : isClaude ? "claude" : "custom";
  const md = modal(`<div class="md-h"><div class="tt"><h2>Connect an agent</h2><p>Agents work on the same files the canvas shows. They read your notes and highlights, work on branches, and the boards reload as they go.</p></div><button type="button" class="ib32" data-a="x" aria-label="Close">${IC.x}</button></div>
  <div class="md-b">
    <div class="ahar"><span class="hdot${hs.length ? " on" : ""}"></span><span>${hs.length ? hs.map((x) => `<b>${esc(x.client)}</b> connected ${esc(timeAgo(x.at))}`).join(" · ") : "No agent is connected over MCP right now"}</span></div>
    <div class="fld"><span class="lr">Claude Code<span class="hint">MCP</span></span><span style="color:var(--text-secondary)">Run Claude Code in the workshop folder and it connects by itself. From anywhere else, run this once:</span><div class="code" id="cnMcp">${esc(mcpCmd)}<button type="button" class="ib24" aria-label="Copy command">${IC.copy}</button></div></div>
    <div class="fld"><span class="lr">Any MCP client<span class="hint">stdio</span></span><div class="code" id="cnJson">${esc(json)}<button type="button" class="ib24" aria-label="Copy config">${IC.copy}</button></div></div>
    <div class="fld"><span class="lr">When you ask in Chat</span><div id="cnSeg"></div><div id="cnMore"></div></div>
  </div>
  <div class="md-f"><span class="sp"></span><button type="button" class="ghbtn" data-a="x2">Cancel</button><button type="button" class="createbtn" data-a="save">Save</button></div>`, { wide: true });
  md.querySelector("#cnMcp .ib24").onclick = () => copyText(mcpCmd);
  md.querySelector("#cnJson .ib24").onclick = () => copyText(json);
  const paint = () => {
    $("cnSeg").replaceChildren(segmented([{ label: "Wait for a connected agent", value: "wait" }, { label: "Run Claude Code", value: "claude" }, { label: "Run a command", value: "custom" }], mode, (v) => ((mode = v), paint()), { full: true, label: "When you ask in Chat" }));
    const more = $("cnMore");
    if (mode === "wait") more.innerHTML = `<span style="color:var(--text-secondary)">Requests queue up until an agent takes them with <span class="mono" style="font-size:12px;font-weight:400">take_task</span>.</span>`;
    if (mode === "claude") more.innerHTML = `<span style="color:var(--text-secondary)">Each request runs <span class="mono" style="font-size:12px;font-weight:400">claude -p</span> in its branch's folder with edits allowed, one at a time.</span>`;
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
  const md = modal(`<div class="md-h"><div class="tt"><h2>Import a prototype</h2><p>An HTML file becomes a prototype with its own section, branches and history.</p></div><button type="button" class="ib32" data-a="x" aria-label="Close">${IC.x}</button></div>
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
    try {
      const env = file ? await importFile(file, name) : await api("envs", { method: "POST", body: { html, name, source: { kind: "paste" } } });
      if (!file) toast(`Added ${env.name}`, `Saved to envs/${env.id}/index.html`);
      closeModal();
      await loadWorkspace();
      selectSection(env.id);
      focusEnv(env.id);
    } catch (e) {
      busy = false;
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
  const env = selEnv();
  const items = [
    ...envList().filter((e) => !e.archived).map((e) => ({ label: e.name, k: isBranch(e) ? "Branch" : "Prototype", fn: () => (selectSection(e.id), focusEnv(e.id)) })),
    ...itemsOf("board").map((b) => ({ label: `${S.envs.get(b.env)?.name || b.env} · ${screenName(b)}`, k: "Board", fn: () => (selectBoard(b.id), focusItem(b.id, { maxZ: 0.6 })) })),
    ...(env?.catalog?.screens || []).map((s) => ({ label: `Place ${s.name}`, k: env.name, fn: () => placeScreen(env.id, s.name, S.placeState).then((it) => it && (selectBoard(it.id), focusItem(it.id, { maxZ: 0.6 }))) })),
    ...(env ? [{ label: `Create a branch of ${env.name}`, k: "Action", fn: () => createBranch(env.id) }] : []),
    { label: "Import HTML", k: "Action", fn: openImport },
    { label: "Connect an agent", k: "Action", fn: openConnect },
    { label: "Zoom to fit", k: "Canvas", fn: () => fit() },
    { label: "Show or hide panels", k: "Canvas", fn: toggleUi },
  ];
  palItems = items.filter((x) => !qv || x.label.toLowerCase().includes(qv)).slice(0, 60);
  palIdx = 0;
  const rs = $("palRs");
  rs.replaceChildren();
  if (!palItems.length) rs.append(h(`<div class="none">Nothing matches "${esc(qv)}"</div>`));
  palItems.forEach((x, i) => {
    const b = h(`<button type="button" role="option" class="${i === palIdx ? "on" : ""}">${x.k === "Branch" ? IC.fork : x.k === "Prototype" || x.k === "Board" ? IC.board : IC.chevr}<span class="l">${esc(x.label)}</span><span class="k">${esc(x.k)}</span></button>`);
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

// ---------- the rest ----------
function toggleUi() {
  $("frame").classList.toggle("ui-off");
  markDirty();
}
function setTheme(t) {
  try {
    localStorage.setItem("ws-theme", t);
  } catch {}
  const d = t === "system" ? (matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light") : t;
  document.documentElement.setAttribute("data-ltheme", d);
  document.documentElement.setAttribute("data-ltheme-pref", t);
}
function wsMenu() {
  let pref = "light";
  try {
    pref = localStorage.getItem("ws-theme") || "light";
  } catch {}
  menu($("wsBtn"), [
    { head: S.ws.root },
    { label: "Import HTML", icon: IC.upload, onClick: openImport },
    { label: "Connect an agent", icon: IC.agent, onClick: openConnect },
    { label: "Copy folder path", icon: IC.copy, onClick: () => copyText(S.ws.root) },
    { label: "Rename workspace", icon: IC.board, onClick: renameWorkspace },
    "-",
    { head: "Appearance" },
    ...["light", "dark", "system"].map((t) => ({ label: t[0].toUpperCase() + t.slice(1), checked: pref === t, onClick: () => setTheme(t) })),
  ], { width: 280 });
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

async function onEvent(ev) {
  if (ev.kind === "envs") return loadWorkspace();
  if (ev.kind === "canvas") return loadItems();
  if (ev.kind === "env") {
    if (!S.envs.has(ev.id)) return loadWorkspace();
    try {
      S.envs.set(ev.id, await api(`envs/${ev.id}`));
    } catch {
      return loadWorkspace();
    }
    S.diffs.delete(ev.id);
    for (const e of envList()) if (e.parent === ev.id) S.diffs.delete(e.id);
    reloadEnv(ev.id, ev.files || []);
    renderLeft();
    if (selEnvId() === ev.id) renderRight();
    return;
  }
  if (ev.kind === "tasks") return loadTasks();
  if (ev.kind === "comments") return loadComments();
  if (ev.kind === "versions") return selEnvId() && loadVersions(selEnvId());
  if (ev.kind === "harness") {
    const ws = await api("workspace").catch(() => null);
    if (ws) ((S.ws.harnesses = ws.harnesses), renderWho(), renderRight());
  }
}

async function boot() {
  const hadCam = initCanvas();
  initPanels();
  $("wsBtn").onclick = wsMenu;
  $("wsBtn").onkeydown = (e) => (e.key === "Enter" || e.key === " ") && (e.preventDefault(), wsMenu());
  $("uiToggle").onclick = toggleUi;
  $("shareBtn").onclick = () => openShare(selEnvId() || visibleEnvs()[0]?.id);
  $("presentBtn").onclick = () => present(S.sel?.item && S.items.get(S.sel.item)?.type === "board" ? S.sel.item : boardsOf(selEnvId() || visibleEnvs()[0]?.id)[0]?.id);
  $("cvImport").onclick = openImport;
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
    if (mod && e.key === "\\") return e.preventDefault(), toggleUi();
    if (mod && !e.shiftKey && (e.key === "z" || e.key === "Z") && !isTyping(e.target)) {
      e.preventDefault();
      undoStyle().then((did) => !did && toast("Nothing to undo", "Style edits from the inspector undo here; everything else has its own Undo"));
    }
  });
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
  on("items-changed", () => (renderLeft(), S.rightTab === "comments" && renderRight()));
  on("remove-item", (id) => {
    selectItem(id);
    document.dispatchEvent(new KeyboardEvent("keydown", { key: "Delete", bubbles: true }));
  });
  on("open-thread", (id) => {
    const c = S.comments.find((x) => x.id === id);
    const b = c && ((c.board && S.items.get(c.board)) || boardsOf(c.env)[0]);
    if (b) focusItem(b.id, { maxZ: 0.6 });
    setTimeout(() => openThread(id), 360);
  });
  on("comments-changed", async (d) => {
    await loadComments();
    if (d?.reopen) openThread(d.reopen);
  });
  on("tasks-changed", async (d) => {
    if (d?.created && d.created.env !== selEnvId()) {
      // the request opened a branch: show it next to where it came from
      await loadWorkspace();
      selectSection(d.created.env);
      const e = S.envs.get(d.created.env);
      requestAnimationFrame(() => fitRect(boundsOfEnvs([e?.parent, d.created.env].filter(Boolean))));
      fire("ask-agent", {});
    }
    loadTasks();
  });
  try {
    await loadWorkspace();
  } catch (e) {
    $("frame").append(h(`<div class="winov open"><div class="md" style="width:480px"><div class="md-h"><div class="tt"><h2>The Workshop server isn't answering</h2><p>${esc(e.message)}. Start it with <span class="mono" style="font-size:12px;font-weight:400">npm start</span> in the workshop folder, then reload.</p></div></div></div></div>`));
    return;
  }
  await Promise.all([loadComments(), loadTasks()]);
  for (const e of envList()) if (isBranch(e) && !e.archived) loadDiff(e.id).then(renderLeft);
  if (!hadCam) requestAnimationFrame(() => fit({ ms: 0, maxZ: 0.5 }));
  events(onEvent);
  setInterval(() => api("workspace").then((ws) => {
    const before = JSON.stringify(S.ws?.harnesses?.map((x) => x.client));
    S.ws.harnesses = ws.harnesses;
    if (JSON.stringify(ws.harnesses.map((x) => x.client)) !== before) (renderWho(), renderRight());
  }).catch(() => {}), 20000);
}

boot();
