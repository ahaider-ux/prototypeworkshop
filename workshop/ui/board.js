// Home: the team's board. Every prototype with its branches laid out beside it, so what's being
// tried, by whom, and where each attempt stands is visible at a glance: Main (the agreed version),
// then each open branch (who started it, how many changes and comments, whether it's ready to
// review), then a place to start a new one. Under them, what happened lately.
//
// Pictures come from the canvas's own pipeline (gfx.js): drawings made by the prototype pages in
// their own process, never live pages here.

import { h, esc, IC, timeAgo, rmo } from "./lib.js";
import { S, isBranch, familyOf, boardsOf, itemsOf, plural } from "./state.js";
import * as G from "./gfx.js";
import { thumbJob } from "./canvas.js";
import { fitIn } from "./motion.js";
import { branchStatus, branchCounts } from "./boardfacts.js";

const PIC = { w: 264, h: 165 };
const AGENT = (by) => !!by && by !== "You" && !/^(cli|recipe trigger)$/i.test(by);
const firstBoard = (id) => boardsOf(id).slice().sort((a, b) => a.y - b.y || a.x - b.x)[0] || null;
// open comments and notes on a page: what people have said about it
const commentsOn = (id) => S.comments.filter((c) => !c.parent && !c.resolved && c.env === id).length + itemsOf("note").filter((n) => n.env === id).length;

// ctx: { go(id), branch(id), importHtml(), connect(), section(name), lastEdit(id), loadDiff(id), spaces }
export function renderBoard(main, roots, ctx) {
  const res = Math.min(2, window.devicePixelRatio || 1);
  const pics = []; // [canvas, board]
  const draw = (cv, board) => {
    const got = board ? G.bitmapFor(board) : null;
    const th = cv.parentElement;
    th.classList.toggle("waiting", !!board && !got);
    th.classList.toggle("none", !board);
    if (!got) return;
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
  };
  const pic = (board) => {
    const th = h(`<span class="hb-th"><canvas aria-hidden="true"></canvas></span>`);
    pics.push([th.firstChild, board]);
    return th;
  };

  const page = h(`<div class="hl hboard"><header class="hb-h"><div class="tt"><h1></h1><p>Your team's prototypes. Branch one to try an idea, comment on it, and merge what works into Main.</p></div><div class="hacts">${ctx.spaces ? `<button type="button" class="dbtn" data-a="sp">${IC.folder}Connect a folder</button>` : ""}<button type="button" class="createbtn" data-a="im">${IC.upload}Import HTML</button></div></header><div class="hb-list"></div></div>`);
  page.querySelector("h1").textContent = S.ws.name || "Prototypes";
  page.querySelector('[data-a="im"]').onclick = ctx.importHtml;
  const sp = page.querySelector('[data-a="sp"]');
  if (sp) sp.onclick = ctx.connect;
  const list = page.querySelector(".hb-list");

  const sorted = roots.slice().sort((a, b) => String(ctx.lastEdit(b.id) || "").localeCompare(String(ctx.lastEdit(a.id) || "")));
  for (const root of sorted) {
    const fam = familyOf(root.id).map((x) => x.env);
    const open = fam.filter((e) => isBranch(e) && !e.archived).sort((a, b) => String(b.branch?.at || b.created || "").localeCompare(String(a.branch?.at || a.created || "")));
    const merged = fam.filter((e) => isBranch(e) && e.archived && e.mergedAt).length;
    const edited = ctx.lastEdit(root.id);
    const sec = h(`<section class="hb-p"><div class="hb-ph"><b></b><span class="m"></span><span class="sp"></span><button type="button" class="dbtn sm" data-a="br">${IC.fork}New branch</button></div><div class="hb-row"></div></section>`);
    sec.querySelector("b").textContent = root.name;
    sec.querySelector(".m").textContent = [plural(boardsOf(root.id).length, "screen"), open.length ? plural(open.length, "open branch", "open branches") : "", merged ? `${merged} merged` : "", edited ? `edited ${timeAgo(edited)}` : ""].filter(Boolean).join(" · ");
    sec.querySelector('[data-a="br"]').onclick = () => ctx.branch(root.id);
    const row = sec.querySelector(".hb-row");

    // Main: the agreed version
    const mc = commentsOn(root.id);
    const m = h(`<button type="button" class="hb-card main"><span class="hb-cap"><span class="hb-k">${IC.board}<b>Main</b></span><span class="hb-m"></span></span></button>`);
    m.prepend(pic(firstBoard(root.id)));
    m.querySelector(".hb-m").textContent = ["The agreed version", branchCounts({ comments: mc })].filter(Boolean).join(" · ");
    m.setAttribute("aria-label", `Open ${root.name}, Main`);
    m.onclick = () => ctx.go(root.id);
    row.append(m);

    // its branches: each attempt, newest first
    for (const b of open) {
      row.append(h(`<span class="hb-fork" aria-hidden="true"></span>`));
      const by = b.author || "Someone";
      const c = h(`<button type="button" class="hb-card"><span class="hb-cap"><span class="hb-k">${IC.fork}<b></b></span><span class="hb-m"></span><span class="hb-s"><span class="av${AGENT(by) ? " agent" : ""}"></span><span class="who"></span><span class="tagro"></span></span></span></button>`);
      c.prepend(pic(firstBoard(b.id)));
      c.querySelector("b").textContent = b.name;
      c.querySelector(".av").textContent = by[0].toUpperCase();
      c.querySelector(".who").textContent = `${by} · ${timeAgo(b.branch?.at || b.created)}`;
      c.setAttribute("aria-label", `Open branch ${b.name}`);
      c.onclick = () => ctx.go(b.id);
      const fill = () => {
        const d = S.diffs.get(b.id);
        const tasks = S.tasks.filter((t) => t.env === b.id);
        const facts = { changes: d?.changes.length || 0, conflicts: d?.conflicts || 0, comments: commentsOn(b.id), working: tasks.filter((t) => t.status === "working").length, queued: tasks.filter((t) => t.status === "queued").length };
        const st = branchStatus(facts);
        c.querySelector(".hb-m").textContent = branchCounts(facts) || "Nothing changed yet";
        const tag = c.querySelector(".tagro");
        tag.textContent = st.label;
        tag.className = `tagro${st.tone === "ok" ? " ok" : st.tone === "warn" ? " warn" : st.tone === "busy" ? " info" : ""}`;
      };
      fill();
      if (!S.diffs.has(b.id)) ctx.loadDiff(b.id)?.then?.(() => c.isConnected && fill());
      row.append(c);
    }

    // a new attempt
    row.append(h(`<span class="hb-fork" aria-hidden="true"></span>`));
    const nb = h(`<button type="button" class="hb-card new"><span class="hb-th none"><span class="hplus">${IC.fork}</span></span><span class="hb-cap"><span class="hb-k"><b>New branch</b></span><span class="hb-m">Try an idea without touching Main</span></span></button>`);
    nb.onclick = () => ctx.branch(root.id);
    row.append(nb);
    list.append(sec);
  }
  if (!roots.length) {
    const em = h(`<div class="pempty"><b>No prototypes here yet</b>Import an HTML file${ctx.spaces ? ", or connect a project folder," : ""} and it becomes a prototype your team can branch, comment on and merge.<button type="button" class="createbtn sm">${IC.upload}Import HTML</button></div>`);
    em.querySelector("button").onclick = ctx.importHtml;
    list.append(em);
  }

  // what happened lately, across the space
  const acts = (S.activity || []).slice(-6).reverse();
  if (acts.length) {
    const sec = h(`<section class="hb-act"><div class="hb-ph"><b>Latest</b><span class="sp"></span><button type="button" class="ghbtn sm" data-a="all">All activity${IC.chevr}</button></div><div class="hb-feed"></div></section>`);
    sec.querySelector('[data-a="all"]').onclick = () => ctx.section("activity");
    const feed = sec.querySelector(".hb-feed");
    for (const e of acts) {
      const env = e.env && S.envs.get(e.env);
      const r = h(`<button type="button" class="hact"><span class="av${AGENT(e.by) ? " agent" : ""}"></span><span class="hact-t"><span class="x"></span><span class="m"></span></span><span class="hact-w"></span></button>`);
      r.querySelector(".av").textContent = (e.by || "S")[0].toUpperCase();
      r.querySelector(".x").textContent = e.text;
      r.querySelector(".m").textContent = [e.by, env ? (isBranch(env) ? env.name : "Main") : ""].filter(Boolean).join(" · ");
      r.querySelector(".hact-w").textContent = timeAgo(e.at);
      if (env) r.onclick = () => ctx.go(env.id);
      else r.disabled = true;
      feed.append(r);
    }
    page.append(sec);
  }

  main.replaceChildren(page);
  for (const [cv, board] of pics) draw(cv, board);
  const jobs = pics.filter(([, b]) => b && !G.hasFresh(b)).map(([, b]) => thumbJob(b));
  if (jobs.length) G.want(jobs);
  const off = G.onBitmap((k) => {
    for (const [cv, board] of pics)
      if (board && G.keyOf(board) === k && cv.isConnected) {
        const was = cv.parentElement.classList.contains("waiting");
        draw(cv, board);
        if (was && !rmo()) cv.animate([{ opacity: 0 }, { opacity: 1 }], { duration: 200, easing: "ease-out" });
      }
  });
  return { destroy: off };
}
