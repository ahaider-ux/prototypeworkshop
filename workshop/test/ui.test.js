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

// Found clicking through branching and merging:
// - the activity feed's list was .acts, the same name as the banner's button row, which then stacked
//   its buttons in a column and hung "Review and merge" off the banner;
// - --lw/--rw lived on the stage, so the toasts (outside it) got none and sat over the top-left corner;
// - a field inside .afld-in drew its own ring inside the wrapper's: two rings.
test("ui: branch banner, toast placement and field focus", () => {
  const css = read("app.css");
  assert.doesNotMatch(css, /(^|\n)\.acts\{[^}]*flex-direction:column/, "no bare .acts column rule");
  assert.match(read("panels.js"), /class="actfeed"/);
  assert.match(css, /\.app\{--lw:\d+px;--rw:\d+px\}/, "panel widths are set on the whole app");
  assert.match(css, /\.afld-in input:focus-visible\{box-shadow:none\}/);
});

// An older workspace answer must never overwrite a newer one (it keeps a stale look and picture).
test("ui: workspace loads are order-safe", () => {
  const app = read("app.js");
  assert.match(app, /if \(seq !== wsSeq\) return wsLatest;/);
  assert.match(app, /envFetched\.get\(e\.id\) \|\| 0\) > started/);
});

// On a phone the home bar's two pills used to fight for the width: the left one shrank to a stub
// and the right one ran off the screen. Below 700px the bar keeps the name, the view switch and an
// icon-only Import (Connect a folder is in the space menu).
// Opening a prototype fades the bar out on #home; a fresh canvas must clear that, or the bar stays
// invisible when you come back.
test("ui: the home bar fits a phone, and coming back shows it again", () => {
  const css = read("app.css");
  const phone = css.match(/@media \(max-width:700px\)\{\.hbar[^\n]*/)?.[0] || "";
  assert.match(phone, /\.hcount,\.hbr \.dbtn\{display:none\}/);
  assert.match(phone, /\.hbr \.createbtn\{[^}]*font-size:0/);
  assert.match(read("app.js"), /label: "Connect a folder…"/, "Connect stays reachable from the space menu");
  const home = read("home.js");
  const mount = home.slice(home.indexOf("export function mountHomeCanvas"));
  assert.ok(mount.indexOf('host.classList.remove("hleaving")') < mount.indexOf("host.append(root)"), "mount clears the leaving state first");
  assert.match(home.slice(home.indexOf("destroy()")), /host\.classList\.remove\("hleaving"\)/);
});

// The slab is the logo's typeface. Titles, the home bar and empty states once used it too, which
// made the app read heavy; the app's own type is the interface sans, and only the wordmark is slab.
test("ui: the logo font is for the wordmark only", () => {
  const uses = read("app.css").split("\n").filter((l) => l.includes("var(--display)")).map((l) => l.slice(0, l.indexOf("{")));
  assert.deepEqual(uses.sort(), [".ilock", ".tlogo b.wm"]);
  for (const f of ["app.js", "panels.js", "canvas.js", "home.js", "lib.js"]) assert.ok(!read(f).includes("--display"), `${f} sets the logo font`);
});

// The comment peek greys its header's meta text with ".pinpeek .ph span", which outranked the
// avatar's own colour: an agent's "C" went grey on black and all but vanished.
test("ui: a comment peek's avatar keeps its letter colour", () => {
  const css = read("app.css");
  assert.ok(!/\.pinpeek \.ph span\{/.test(css), "the meta-text rule must not reach the avatar span");
  assert.match(css, /\.pinpeek \.ph span:not\(\.cav\)\{color:var\(--text-secondary\)\}/);
});

// The intro's ending: the pin was the i's dot, so as it flies into the header the word takes a real
// "i" and the header's spacing (it used to land dotless and gain its dot at the swap), and the
// flight eases in and out (an ease-out alone covered half the way in the first frames: a jump).
test("ui: the intro lands letter for letter on the header logo", () => {
  const js = read("intro.js");
  const land = js.slice(js.indexOf("const landInHeader"), js.indexOf("const onKey"));
  assert.match(land, /li\.textContent = "i"/);
  assert.match(land, /classList\.add\("flying"\)/);
  assert.ok(land.indexOf('li.textContent = "i"') < land.indexOf("getBoundingClientRect"), "swap before measuring");
  assert.match(land, /cubic-bezier\(\.65,0,\.25,1\)/);
  assert.match(read("app.css"), /\.ilock\.flying\{letter-spacing:-\.01em\}/);
  assert.match(read("app.css"), /\.tlogo b\.wm\{[^}]*letter-spacing:-\.01em/, "the header's spacing it must match");
});

// The intro is product-led but restrained: the first version was a wall of ~20 app parts at once
// and read as generated. It tells one story with a few large pieces, and has no rainbow ink tray
// or copied side panel.
test("ui: the intro's scene stays focused", () => {
  const js = read("intro.js");
  const pieces = js.slice(js.indexOf("const PIECES = () => ["), js.indexOf("];", js.indexOf("const PIECES = () => [")));
  const n = (pieces.match(/^\s*\["/gm) || []).length;
  assert.ok(n > 0 && n <= 8, `${n} pieces on screen at once`);
  for (const busy of ["inktray", "ltabs", "rcard", "ccomp", "note warm"]) assert.ok(!pieces.includes(busy), `the scene brings back "${busy}"`);
});

// The ending: the pin fades as the word sets off for the header, and the header's own pin appears
// only once the word is in place (it used to fly along and hop, which read as fussy).
test("ui: the intro's pin steps aside while the word lands", () => {
  const js = read("intro.js");
  const land = js.slice(js.indexOf("const landInHeader"), js.indexOf("const onKey"));
  assert.match(land, /mk\.animate\(\[\{ opacity: 1/);
  assert.match(land, /classList\.add\("pinin"\)/);
  assert.ok(land.indexOf('classList.remove("landing")') < land.indexOf('classList.add("pinin")'), "the header pin appears as the word is set");
  assert.match(read("app.css"), /\.tlogo\.pinin \.pinmark\{animation:i-pinin/);
});

// Made-up apps once filled the canvas and the intro, with no real buttons behind them. Cards are
// only real prototypes; a spare place is an empty-state card whose click does the real thing, and
// the intro's screen is Atelier's own empty state, not a fake design.
test("ui: nothing made up stands in for a prototype", () => {
  const app = read("app.js");
  const homeCanvas = app.slice(app.indexOf("function renderHomeCanvas"), app.indexOf("function renderHome()"));
  for (const run of ["run: openImport", "run: () => openSpaces()", "run: openConnect"]) assert.ok(homeCanvas.includes(run), `the home's empty-state cards do something real: ${run}`);
  const home = read("home.js");
  assert.match(home, /if \(idx < 0\) return actions\[-idx - 1\]\?\.run\?\.\(\)/);
  const intro = read("intro.js");
  const page = intro.slice(intro.indexOf("const PAGE"), intro.indexOf("\n", intro.indexOf("const PAGE")));
  assert.match(page, /class="pempty/, "the intro's screen is the empty state");
  assert.ok(!/class="ipg|class="pc"/.test(page), "no made-up page or project cards");
});
