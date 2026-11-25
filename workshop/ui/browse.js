// Home as a grid: the same level the canvas shows (ui/app.js homeLevelOf), laid out as neat cards
// you can scan, filter and sort. A card is a picture, a name with where it stands, and a few rows of
// facts (who, when, how much changed), the way a file browser shows files.
//
// Pictures come from the canvas's own pipeline (gfx.js): drawings made by the prototype pages in
// their own process, never live pages here.

import { h, IC, rmo } from "./lib.js";
import * as G from "./gfx.js";
import { thumbJob } from "./canvas.js";
import { fitIn } from "./motion.js";

const PIC = { w: 288, h: 180 };
const TONE = { ok: " ok", warn: " warn", busy: " info" };

// items: [{ id, name, board, cue, cls, tag: { label, tone }, rows: [[label, value]] }]
// actions: [{ title, desc, icon, art, run }] — placeholder cards (an icon) and guide cards (art).
// open(item) opens one. head: an element shown above the cards (a greeting, or the level's title).
export function renderGrid(host, { items, actions, open, head }) {
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

  const page = h(`<div class="bpage"><div class="bgrid"></div></div>`);
  if (head) page.prepend(head);
  const grid = page.querySelector(".bgrid");
  for (const it of items) {
    const c = h(`<button type="button" class="bcard${it.cls === "hproj" ? " main" : ""}"><span class="bth"><canvas aria-hidden="true"></canvas></span><span class="bhd"><b></b><span class="tagro"></span></span><span class="brows"></span></button>`);
    pics.push([c.querySelector("canvas"), it.board]);
    c.querySelector("b").textContent = it.name;
    const tag = c.querySelector(".tagro");
    if (it.tag?.label) (tag.textContent = it.tag.label), (tag.className = `tagro${TONE[it.tag.tone] || ""}`);
    else tag.remove();
    const rows = c.querySelector(".brows");
    for (const [k, v] of it.rows || []) {
      const r = h(`<span class="brow"><span class="k"></span><span class="v"></span></span>`);
      r.querySelector(".k").textContent = k;
      r.querySelector(".v").textContent = v;
      rows.append(r);
    }
    c.setAttribute("aria-label", `${it.cue || "Open"} ${it.name}`);
    c.onclick = () => open(it);
    grid.append(c);
  }
  for (const a of actions) {
    const c = h(`<button type="button" class="bcard ${a.art ? "guide" : "new"}"><span class="bth none"></span><span class="bhd"><b></b></span><span class="bdesc"></span></button>`);
    c.querySelector(".bth").append(a.art ? a.art() : h(`<span class="hplus">${a.icon || IC.plus}</span>`));
    c.querySelector(".bhd b").textContent = a.title; // not a <b> inside the picture
    c.querySelector(".bdesc").textContent = a.desc || "";
    c.onclick = () => a.run?.();
    grid.append(c);
  }
  if (!items.length && !actions.length) grid.append(h(`<div class="pempty"><b>Nothing here</b>Nothing matches this filter. Choose All to see everything.</div>`));

  host.replaceChildren(page);
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
