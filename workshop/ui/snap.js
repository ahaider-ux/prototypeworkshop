// Turning a prototype page into a drawing: an SVG that holds the page as it looks right now.
//
// Shared by the editor (gfx.js draws live boards with it) and by the prototype pages themselves: the
// runtime in each page imports this module when the editor asks it for a picture, so the background
// pages can load from the other loopback name, in their own browser process, and only the finished
// drawing (text) crosses back. No imports: it runs inside any prototype.

const SETTLE = 2200; // ms after load, at most, for the prototype to go to its screen, state and variants
const SETTLE_MIN = 450; // ...and at least: its own start-up scripts run first
const QUIET = 300; // ms without changes to the page before it counts as settled
const SETTLE_TEXT = 2700; // text edits are re-applied up to ~2.5 s after load

const IMG_CACHE = new Map(); // url → data: url
async function inlineImage(url) {
  if (IMG_CACHE.has(url)) return IMG_CACHE.get(url);
  const p = (async () => {
    try {
      const r = await fetch(url);
      const b = await r.blob();
      // Guard: an SVG snapshot carries its images inline; skip anything huge rather than stall.
      if (!r.ok || b.size > 4 * 1024 * 1024) return null;
      return await new Promise((res) => {
        const fr = new FileReader();
        fr.onload = () => res(String(fr.result));
        fr.onerror = () => res(null);
        fr.readAsDataURL(b);
      });
    } catch {
      return null;
    }
  })();
  IMG_CACHE.set(url, p);
  return p;
}
// An SVG image can't fetch anything, so the clone carries its styles, images and form state inline.
// out: when given, out.svg receives the drawing, so it can be saved
// A drawing is laid out from scratch each time it's decoded, and a design system's CSS can be over a
// megabyte: keep only the rules that match something in the picture. Selectors are tested with their
// interaction states and pseudo-elements taken off (a :hover rule is kept if its element is there).
// :root is tested as the clone's <html>; anything unparseable is kept; @keyframes are dropped (the
// picture is drawn with animations off).
const DYNAMIC = /::?(?:before|after|placeholder|selection|marker|first-line|first-letter|backdrop|file-selector-button|-webkit-[a-z-]+|-moz-[a-z-]+|hover|focus|focus-visible|focus-within|active|visited|link|any-link|target|autofill)(?![\w-])/g;
const ON_COMPOUND = new RegExp(`(?<=[\\w\\])*-])(?:${DYNAMIC.source})`, "g");
// a selector with its interaction states and pseudo-elements taken off, for testing what it styles:
// a state on a compound comes off (a:hover → a); a state standing alone becomes * (:hover → *)
export const bareSelector = (sel) => sel.replace(ON_COMPOUND, "").replace(DYNAMIC, "*").replace(/:root(?![\w-])/g, "html");
function cssFilter(root) {
  const seen = new Map();
  const used = (sel) => {
    if (seen.has(sel)) return seen.get(sel);
    let ok = true;
    // a state inside :not() can't be taken off without turning the rule around: keep it untested
    if (/:not\([^)]*:(?:hover|focus|active|visited|link|target)/.test(sel)) return seen.set(sel, true), true;
    try {
      // the clone is detached, so :root matches nothing in it: its <html> stands in
      const bare = bareSelector(sel);
      // only what's drawn counts: a rule that styles nothing but hidden shells (data-wsp) goes
      const shown = `:is(${bare}):not([data-wsp])`;
      ok = root.matches(shown) || !!root.querySelector(shown);
    } catch {
      ok = true; // a selector this browser can't test is kept
    }
    seen.set(sel, ok);
    return ok;
  };
  const walk = (rules) => {
    let out = "";
    for (const r of rules) {
      if (r.type === 1) {
        if (used(r.selectorText)) out += r.cssText + "\n";
      } else if (r.type === 7) {
        // @keyframes: never painted
      } else if (r.cssRules) {
        const inner = walk(r.cssRules);
        if (inner) out += r.cssText.slice(0, r.cssText.indexOf("{") + 1) + inner + "}\n";
      } else out += r.cssText + "\n";
    }
    return out;
  };
  return walk;
}
export async function drawingOf(doc, w, h) {
  if (!doc?.documentElement) throw new Error("no page");
  const clone = doc.documentElement.cloneNode(true);
  // scrolled boxes show the part you scrolled to (matched before anything is taken out of the clone)
  // (both lists are the root's descendants: the document's own list would include <html> itself,
  // never line up with the clone's, and leave every hidden part in)
  const all = [...doc.documentElement.querySelectorAll("*")];
  const call = [...clone.querySelectorAll("*")];
  // Hidden parts of the page (other screens of a one-page app, closed menus, dialogs) can be most of
  // it: they're left out of the picture, which makes it several times quicker to draw. Never style
  // or SVG parts (icons point at hidden <symbol>s), and never display:contents boxes.
  const prune = [];
  if (all.length === call.length && typeof Element.prototype.checkVisibility === "function") {
    const body = doc.body;
    const SVGE = doc.defaultView?.SVGElement;
    for (let i = 0; i < all.length; i++) {
      const e = all[i];
      if (e === body || !body?.contains(e) || (SVGE && e instanceof SVGE) || /^(STYLE|LINK|META|SCRIPT|TEMPLATE|SLOT|BR|WBR|SOURCE|TRACK)$/.test(e.tagName)) continue;
      if (e.checkVisibility() || doc.defaultView.getComputedStyle(e).display === "contents") continue;
      prune.push(call[i]);
    }
  }
  if (all.length === call.length) {
    let n = 0;
    for (let i = 0; i < all.length && n < 40; i++) {
      const e = all[i];
      if (!e.scrollTop && !e.scrollLeft) continue;
      n++;
      for (const k of call[i].children) k.setAttribute("style", `${k.getAttribute("style") || ""};translate:${-e.scrollLeft}px ${-e.scrollTop}px`);
    }
  }
  for (const n of clone.querySelectorAll("script,noscript,iframe,object,embed,video,audio,.ws-ghost")) n.remove();
  const live = [...doc.querySelectorAll('link[rel~="stylesheet"]')];
  const dead = [...clone.querySelectorAll('link[rel~="stylesheet"]')];
  // Hidden parts are emptied, not removed: the element stays (still hidden) so its siblings keep
  // their places for :first-child, :nth-child and + rules, and only what's inside it goes.
  // Each shell says it's hidden itself, so rules that only style hidden parts can go with them.
  for (const n of prune) {
    n.replaceChildren(); // before the CSS is trimmed to what's left
    n.setAttribute("data-wsp", "");
    n.setAttribute("style", "display:none!important");
  }
  const usedCss = cssFilter(clone);
  live.forEach((l, i) => {
    let css = "";
    try {
      if (!l.disabled && l.sheet) css = usedCss(l.sheet.cssRules);
    } catch {}
    const st = doc.createElement("style");
    st.textContent = css;
    dead[i]?.replaceWith(st);
  });
  // the page's own <style> blocks get the same trim (paired through the matched lists above)
  if (all.length === call.length) {
    for (let i = 0; i < all.length; i++) {
      if (all[i].localName !== "style" || !call[i].isConnected && !clone.contains(call[i])) continue;
      try {
        if (all[i].sheet) call[i].textContent = usedCss(all[i].sheet.cssRules);
      } catch {}
    }
  }
  for (const l of clone.querySelectorAll("link")) l.remove();
  // An SVG image is painted once, at the first frame of every animation: a fade-in would be caught
  // invisible. Show everything as it rests instead.
  const still = doc.createElement("style");
  still.textContent = "*,*::before,*::after{animation:none!important;transition:none!important}";
  (clone.querySelector("head") || clone).append(still);
  // what's typed in fields and which boxes are ticked
  const lf = [...doc.querySelectorAll("input,textarea,select")],
    cf = [...clone.querySelectorAll("input,textarea,select")];
  lf.forEach((f, i) => {
    const c = cf[i];
    if (!c) return;
    if (f.localName === "textarea") c.textContent = f.value;
    else if (f.localName === "select") [...c.options].forEach((o, j) => (o.selected = j === f.selectedIndex) && o.setAttribute("selected", ""));
    else if (/checkbox|radio/.test(f.type)) f.checked ? c.setAttribute("checked", "") : c.removeAttribute("checked");
    else c.setAttribute("value", f.value);
  });
  // canvases inside the page keep their current picture
  const lc = [...doc.querySelectorAll("canvas")],
    cc = [...clone.querySelectorAll("canvas")];
  lc.forEach((c, i) => {
    try {
      const img = doc.createElement("img");
      img.src = c.toDataURL();
      img.setAttribute("style", c.getAttribute("style") || "");
      img.className = c.className;
      img.width = c.width;
      img.height = c.height;
      cc[i]?.replaceWith(img);
    } catch {}
  });
  const imgs = [...clone.querySelectorAll("img[src]")].filter((i) => !/^data:/.test(i.getAttribute("src"))).slice(0, 60);
  await Promise.all(
    imgs.map(async (i) => {
      const abs = new URL(i.getAttribute("src"), doc.baseURI).href;
      const d = await inlineImage(abs);
      if (d) i.setAttribute("src", d);
      else i.removeAttribute("src");
    }),
  );
  for (const i of clone.querySelectorAll("img[srcset]")) i.removeAttribute("srcset");
  // The same icon is often on the page hundreds of times: each copy is written into the drawing once,
  // as a rule its <img>s point to, instead of once per <img> (smaller and about a fifth quicker to decode).
  const pics = new Map();
  for (const i of clone.querySelectorAll('img[src^="data:"]')) {
    const u = i.getAttribute("src");
    if (!pics.has(u)) pics.set(u, pics.size);
    i.removeAttribute("src");
    i.setAttribute("data-wsi", String(pics.get(u)));
  }
  if (pics.size) {
    const st = doc.createElement("style");
    st.textContent = [...pics].map(([u, n]) => `img[data-wsi="${n}"]{content:url("${u.replace(/"/g, "%22")}")}`).join("");
    (clone.querySelector("head") || clone).append(st);
  }
  // A page's own data-* attributes can carry whole pictures (icon sets kept for later): they're never
  // painted, only parsed. Long values are emptied; the attribute stays, in case a selector checks for it.
  for (const el of clone.querySelectorAll("*"))
    for (const at of [...el.attributes]) if (at.name.startsWith("data-") && at.value.length > 256) el.setAttribute(at.name, "");
  const xml = new XMLSerializer().serializeToString(clone);
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}"><foreignObject x="0" y="0" width="${w}" height="${h}">${xml}</foreignObject></svg>`;
  return svg;
}

export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
// two frames, or 120 ms: a hidden page from another site gets no frames at all (the browser pauses them)
const frames = (win) => Promise.race([new Promise((r) => win.requestAnimationFrame(() => win.requestAnimationFrame(r))), sleep(120)]);
// Wait until the page has started up, reached its screen and loaded its fonts, instead of always
// waiting the longest it might need. Text edits are re-applied on a timer, so they still wait.
export async function settle(win, it, textEdits) {
  if (textEdits) return sleep(SETTLE_TEXT);
  const t0 = performance.now();
  await sleep(SETTLE_MIN);
  try {
    await Promise.race([win.document.fonts?.ready, sleep(SETTLE - SETTLE_MIN)]);
  } catch {}
  // ...and until the page stops changing (an intro overlay going away, a list filling in)
  let changed = performance.now();
  let mo = null;
  try {
    mo = new win.MutationObserver(() => (changed = performance.now()));
    mo.observe(win.document, { subtree: true, childList: true, attributes: true, characterData: true });
  } catch {}
  while (performance.now() - t0 < SETTLE) {
    try {
      const rt = win.__workshop;
      const ad = rt?.adapter();
      const there = !it.screen || !ad?.screens?.length || ad.screen === it.screen || !ad.screens.some((x) => x.name === it.screen);
      if (rt && there && performance.now() - changed > QUIET) break;
    } catch {
      break;
    }
    await sleep(80);
  }
  mo?.disconnect();
  try {
    await frames(win);
  } catch {}
  await sleep(120);
}

// Inside a prototype page, on the editor's request: wait for it to settle, take it to the screen and
// state asked for, and hand back the drawing and what the page can show (its screens and states).
export async function snapHere(win, req) {
  const it = { screen: req.screen || null, state: req.state || null };
  await settle(win, it, !!req.textEdits);
  const rt = win.__workshop;
  let ad = null;
  try {
    ad = rt?.adapter?.() || null;
    if (it.screen && ad?.screen && ad.screen !== it.screen && ad.screens?.some((x) => x.name === it.screen)) {
      rt.go(it.screen);
      if (it.state && it.state !== "Default") setTimeout(() => rt.setState(it.state), 400);
      await sleep(it.state ? 1100 : 700);
      ad = rt.adapter();
    }
  } catch {}
  const svg = await drawingOf(win.document, req.w, req.h);
  let catalog = null;
  try {
    // only plain data crosses back
    if (ad) catalog = JSON.parse(JSON.stringify({ name: ad.name, screen: ad.screen, screens: ad.screens, states: ad.states, variants: (ad.variants || []).map((v) => ({ label: v.label, options: v.options })) }));
  } catch {}
  return { svg, catalog };
}
