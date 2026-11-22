import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const UI = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "ui");
const read = (f) => fs.readFileSync(path.join(UI, f), "utf8");

// The canvas owns some short class names (.note, .box, .toast, .pin…) with absolute positioning and
// borders. A list or a piece that reuses one as a modifier inherits all of that, so these get a prefix.
test("ui: list and intro pieces never reuse the canvas's own class names as modifiers", () => {
  const css = read("app.css");
  for (const cls of ["note", "box", "toast", "pin"]) assert.match(css, new RegExp(`(^|\\n)\\.${cls}\\{`), `.${cls} is a global rule`);
  const panels = read("panels.js");
  assert.doesNotMatch(panels, /class="k \$\{x\.kind\}"/, "the notes feed's kind icon must be prefixed (k-box, k-note)");
  assert.match(panels, /class="k k-\$\{x\.kind\}"/);
  assert.match(read("intro.js"), /"p-" \+ c/, "intro pieces are prefixed p-");
});

// A prototype page loading behind the intro takes the main thread for 50–100 ms at a time and the
// intro stutters. Every frame that loads a page goes through loadPage/pagesFree, which hold while
// the intro plays; only resets to about:blank may set src directly.
test("ui: prototype pages load through the intro's gate", () => {
  for (const f of ["app.js", "canvas.js", "gfx.js"]) {
    const src = read(f);
    const direct = [...src.matchAll(/\b(?:fr|f|frame|b\.frame|e\.frame)\.src\s*=\s*([^;\n]+)/g)].map((m) => m[1].trim()).filter((v) => v !== '"about:blank"' && v !== "src" && !v.startsWith("apart === src")); // the pool sets its own frame after pagesFree()
    assert.deepEqual(direct, [], `${f} sets a frame's src without loadPage: ${direct.join(", ")}`);
  }
  assert.match(read("gfx.js"), /await pagesFree\(\)/, "the background pool waits for the intro");
  const intro = read("intro.js");
  assert.match(intro, /holdPages\(\)/);
  assert.equal((intro.match(/releasePages\(\)/g) || []).length, 2, "both endings (landing and skip) release the pages");
});

// Saved drawings: the CSS kept is what matches the picture, tested with states taken off. Taking
// them off must never change what a selector means (".a > .b" once became ".a >* .b" and dropped
// rules the page needed).
test("snap: selectors lose their states, never their meaning", async () => {
  const { bareSelector } = await import("../ui/snap.js");
  const cases = {
    ".a > .b": ".a > .b",
    ".a + .b ~ .c": ".a + .b ~ .c",
    "a:hover": "a",
    ".x::before": ".x",
    ".nav li:hover > a": ".nav li > a",
    ".a:hover::after": ".a",
    "[x]:focus-visible": "[x]",
    ":hover": "*",
    ".a > :focus-visible": ".a > *",
    ":root .t": "html .t",
    ".l:nth-child(2n):hover": ".l:nth-child(2n)",
  };
  for (const [sel, want] of Object.entries(cases)) assert.equal(bareSelector(sel), want, sel);
});

// Hidden parts of a page are left out of its drawing, matched element for element between the page
// and its copy. The page's list must be its root's descendants like the copy's: document-wide it
// includes <html> itself, the two never line up and nothing was ever left out.
test("snap: the page and its copy are matched from the same root", () => {
  const src = read("snap.js");
  assert.match(src, /const all = \[\.\.\.doc\.documentElement\.querySelectorAll\("\*"\)\]/);
  assert.doesNotMatch(src, /const all = \[\.\.\.doc\.querySelectorAll\("\*"\)\]/);
});

// A tooltip drawn as ::after inside its button is still laid out when invisible: it made the panels
// scroll sideways (and so shift when something in them took focus) and was clipped at panel edges.
// Tooltips are one floating element (initTips in lib.js).
test("ui: tooltips float outside the panels", () => {
  const css = read("app.css");
  assert.doesNotMatch(css, /\[data-tip\][^{]*::after/, "no tooltip drawn inside its control");
  assert.match(read("lib.js"), /export function initTips\(\)/);
  assert.match(read("app.js"), /initTips\(\)/);
});

// The active tab's label opened by animating max-width to 96px: the real label is narrower, so it
// raced open and sat still before snapping shut, while the pill moved on its own path. Labels open
// to their measured width and the pill is placed from the tabs' real geometry.
test("ui: the tab row moves on one path", () => {
  const css = read("app.css");
  assert.match(css, /\.ltabs \[data-t\]\[aria-selected="true"\] \.lb\{width:var\(--lbw/);
  assert.doesNotMatch(css, /\.ltabs \[data-t\]\[aria-selected="true"\] \.lb\{max-width/);
  const panels = read("panels.js");
  assert.doesNotMatch(panels, /ICON = small \? 30 : 32/, "the pill is placed from computed geometry, not constants");
  assert.match(panels, /if \(at === pillAt\) return/, "a re-render never snaps the pill");
});
