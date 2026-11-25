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

// The editor's left panel has three tabs that always show their names (Layers, Agent, Activity), so
// nothing opens, closes or shifts when you pick one; each tab's sections are a switch under it. The
// thumb is the selected tab's own box.
test("ui: the left panel is three labelled tabs with sections", () => {
  const html = read("index.html");
  const tabs = [...html.matchAll(/data-g="(\w+)" data-t="\w+" role="tab"[^>]*>.*?<span class="lb">(\w+)<\/span>/g)].map((m) => `${m[1]}:${m[2]}`);
  assert.deepEqual(tabs, ["layers:Layers", "agent:Agent", "activity:Activity"]);
  const css = read("app.css");
  assert.doesNotMatch(css, /\.ltabs \[data-t\] \.lb\{[^}]*width:0/, "labels are never hidden");
  assert.doesNotMatch(css, /--lbw/);
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
test("ui: coming back to the home canvas shows it again, and Connect stays reachable", () => {
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
  const css = read("app.css");
  const flying = /\.ilock\.flying\{letter-spacing:([-.\d]+em)\}/.exec(css)?.[1];
  const header = /\.tlogo b\.wm\{[^}]*letter-spacing:([-.\d]+em)/.exec(css)?.[1];
  assert.ok(flying && flying === header, `the flying word's spacing (${flying}) must be the header's (${header})`);
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
  const level = app.slice(app.indexOf("function homeLevelOf"), app.indexOf("function renderHomeCanvas"));
  for (const run of ["run: openImport", "run: () => openSpaces()", "run: openConnect", "run: () => createBranch(root.id)"]) assert.ok(level.includes(run), `the canvas's placeholder cards do something real: ${run}`);
  assert.match(read("home.js"), /if \(act && !act\.deep\) return act\.run\?\.\(\);/);
  const intro = read("intro.js");
  const page = intro.slice(intro.indexOf("const PAGE"), intro.indexOf("\n", intro.indexOf("const PAGE")));
  assert.match(page, /class="pempty/, "the intro's screen is the empty state");
  assert.ok(!/class="ipg|class="pc"/.test(page), "no made-up page or project cards");
});

// The app opens in light. A browser that had saved Dark or System under the old look kept opening
// dark; the studio-white look starts everyone on light again under a new key, read the same way
// before first paint and by the menu.
test("ui: the app opens in light unless this browser picks otherwise", () => {
  const html = read("index.html");
  assert.match(html, /localStorage\.getItem\("atelier-theme"\)\|\|"light"/);
  const app = read("app.js");
  assert.match(app, /const THEME_KEY = "atelier-theme"/);
  assert.ok(!/"ws-theme"/.test(html + app), "nothing reads the old key");
});

// The pin lands on the ı's stem in whatever font is showing: it's placed from layout (a 1ex
// marker on the letter's baseline), not from a canvas measurement that may use another font.
test("ui: the intro pin is placed from the live font's layout", () => {
  const js = read("intro.js");
  assert.match(js, /export function stemOf\(word, li\)/);
  assert.match(js, /height:1ex;vertical-align:baseline/);
  const place = js.slice(js.indexOf("function dotAt"), js.indexOf("return finished;", js.indexOf("function dotAt")));
  assert.match(place, /stemOf\(word, li\)/);
  assert.match(place, /function placeDot\(now\) \{\s*const \{ cx, cy, size \} = dotAt\(\);/, "the drop and the wait above use the same spot");
  assert.ok(!/measureText|getContext/.test(js), "no canvas measurement");
});

// Every section the seven old tabs held is still there, under one of the three, and the thumb is
// placed from the selected tab's own box (nothing to measure, so nothing to get wrong while hidden).
test("ui: every panel section lives under one of the three tabs", () => {
  const js = read("panels.js");
  const groups = js.slice(js.indexOf("const GROUPS = {"), js.indexOf("const SECTIONS"));
  for (const t of ["file", "screens", "agents", "recipes", "activity", "notes", "history"]) assert.ok(groups.includes(`["${t}",`), t);
  const move = js.slice(js.indexOf("function movePill"), js.indexOf("function movePill") + 500);
  assert.match(move, /if \(!pill \|\| !sel \|\| !bar\.offsetParent\) return;/, "skips while hidden");
  assert.match(move, /sel\.offsetLeft/);
  assert.ok(!/measureLabels/.test(js));
});

// The home is one main area: every level of the canvas and the Activity page render into it, and
// each has a route.
test("ui: the home renders into one main area", () => {
  const app = read("app.js");
  assert.match(app, /if \(home\.querySelector\("\.hside"\)\) return home;/, "the shell is built once");
  assert.match(app, /const homeMain = \(\) => homeShell\(\)\.querySelector\("\.hview"\);/, "views render into the view, under the bar");
  const canvas = app.slice(app.indexOf("function renderHomeCanvas"), app.indexOf("// Esc goes up a level"));
  assert.ok(canvas.includes("homeMain()") && !/\$\("home"\)\.replaceChildren/.test(canvas), "the canvas fills only the main area");
  const act = app.slice(app.indexOf("function renderActivityPage"), app.indexOf("\n}\n", app.indexOf("function renderActivityPage")));
  assert.ok(act.includes("main.replaceChildren") && !/\$\("home"\)\.replaceChildren/.test(act));
});

// The product pictures ship in the app, so they follow the same content rules as live art: no
// people or avatars, no placeholder text, and a pointer only on a control it's acting on.
test("ui: product pictures keep to the content rules", () => {
  const v = read("visuals.js");
  const art = v.slice(v.indexOf("const ART = {"), v.indexOf("// what each guide says"));
  assert.ok(!/class="cav|avatar|lorem|placeholder|John|Jane/i.test(art), "no avatars, people or placeholder text");
  // a pointer is either aimed at a control (data-aim) or a labelled cursor ("You", "Claude")
  const pointers = (art.match(/\$\{pointer\}/g) || []).length;
  const owned = (art.match(/\$\{pointer\}<b class="pv-tag/g) || []).length + (art.match(/cls: "pv-aim"/g) || []).length;
  assert.equal(pointers, owned, "every pointer has a control or a name");
  // each picture says its point in a short headline (Paper-style), and never repeats its guide's title
  for (const m of v.matchAll(/\{ id: "([a-z]+)", title: "([^"]+)"/g)) {
    const pic = art.slice(art.indexOf(`  ${m[1]}: () =>`), art.indexOf("\n\n", art.indexOf(`  ${m[1]}: () =>`)));
    assert.match(pic, /head\("/, `${m[1]} has a headline`);
    assert.ok(!pic.toLowerCase().includes(m[2].toLowerCase()), `${m[1]}'s picture repeats its title`);
  }
  const ids = [...v.matchAll(/\{ id: "([a-z]+)", title:/g)].map((m) => m[1]);
  assert.equal(ids[0], "intro", "the flow starts with the intro step");
  for (const id of ids) assert.ok(art.includes(`  ${id}: () =>`), `${id} has its picture`);
});

// The intro's letters used to rise and overshoot as they typed, and the word changed its spacing as
// it set off for the header, so letters jumped. Typed letters now appear where they stand, the
// spacing is the header's from the start, and the last flash's pin is exactly the lone pin.
test("ui: the intro's letters and pin never jump", () => {
  const css = read("app.css");
  assert.match(css, /\.ilock \.lt\{opacity:0;filter:blur\(3px\)\}/);
  assert.ok(!/\.ilock \.lt(\.on)?\{[^}]*transform/.test(css), "no rise or overshoot on letters");
  const lock = /\.ilock\{[^}]*letter-spacing:([-.\d]+em)/.exec(css)?.[1];
  const flying = /\.ilock\.flying\{letter-spacing:([-.\d]+em)\}/.exec(css)?.[1];
  assert.equal(lock, flying, "the word keeps its spacing when it flies");
  assert.match(css, /\.itile\.f4 \.ibrand \.pinmark\{width:75%;height:75%;--m-b:var\(--text-accent\)/, "the last flash is the lone pin's size and colour");
  assert.ok(!/"hop"/.test(read("intro.js")), "the pin waits above the ı, measured, not at a fixed hop");
});

// The mark has depth everywhere it appears: light, shade, a top rim and a set-in eye, from shared
// gradients; and Atelier has an app icon in the tab.
test("ui: the mark has depth, and the tab has the app icon", () => {
  const html = read("index.html");
  for (const id of ["pm-light", "pm-shade", "pm-rim", "pm-eye"]) assert.ok(html.includes(`id="${id}"`), id);
  for (const src of [html, read("intro.js")]) assert.match(src, /class="pb"[^>]*\/><path class="pl"[^>]*\/><path class="ps"[^>]*\/><path class="pr"/);
  assert.match(html, /<link rel="icon" type="image\/svg\+xml" href="data:image\/svg\+xml,/);
});

// With few prototypes everything is on screen at once, and the group stays centred; coming back
// used to centre the opened card instead, but only sometimes (the canvas's real width arrives after
// mount). Now: everything fits → the group is centred, on mount, on resize and on update; otherwise
// coming back centres the prototype you opened.
test("ui: a canvas that fits stays centred; a bigger one returns to what you opened", () => {
  const home = read("home.js");
  assert.match(home, /const fitsView = \(\) =>/);
  assert.match(home, /if \(backCell && !fitsView\(\)\) \(cam\.x = -backCell\.x \* CW\)/);
  assert.match(home, /if \(fitsView\(\) && !drag && !glide && !leaving\) Object\.assign\(cam, middle\(\)\);/, "on resize");
  assert.match(home, /if \(fitsView\(\)\) Object\.assign\(cam, middle\(\)\);/, "on update");
});

// Navigation works the way a file browser's does. The header's row is Home and the prototypes you
// have open (files as tabs). The home's sidebar stays and holds the places: search (the command
// palette), Home, Guides, Activity, what you opened last, and every project with its branches one
// click away. It is the editor's own floating panel, so home and editor read as one app.
test("ui: the home is an app shell: a sidebar that stays, files as tabs", () => {
  const app = read("app.js");
  const tabs = app.slice(app.indexOf("function renderTabs()"), app.indexOf("function closeTab"));
  assert.match(tabs, /\[\["home", IC\.home, "Home"\]\]/, "Home, then the open prototypes");
  const shell = app.slice(app.indexOf("function homeShell()"), app.indexOf("const homeMain"));
  for (const piece of ['class="hside"', 'class="lhd"', 'class="hsearch"', 'class="pgs hnav"', 'class="pgs hrecent"', 'class="pgs htree"', 'class="htop"', 'class="hview"']) assert.ok(shell.includes(piece), piece);
  assert.match(shell, /\[data-a="search"\]'\)\.onclick = openPal;/, "search opens the command palette");
  const side = app.slice(app.indexOf("function renderSide"), app.indexOf("// Each Learn step offers"));
  assert.match(side, /kid\(IC\.fork, b\.name, branchStatus\(branchFacts\(b\)\)\.tone, \(\) => go\(b\.id\)\);/, "a branch is one click from the sidebar, with where it stands");
  assert.match(side, /\[\.\.\.lastPage\.values\(\)\]\.reverse\(\)/, "what you opened last");
  const show = app.slice(app.indexOf("function showHome()"), app.indexOf("const goSection"));
  assert.ok(show.indexOf("S.homeSection = sec;") < show.indexOf("renderTabs();"));
  const css = read("app.css");
  assert.match(css, /\.hside\{[^}]*border-radius:var\(--r-panel\);background:var\(--glass-bg\)/, "the editor's panel");
  assert.ok(!/\.hdock|\.hdpill|\.hpathbar/.test(css), "no floating bars left over");
  assert.match(css, /\.home\{[^}]*background:var\(--bg-canvas\)/);
  assert.ok(!/\.pv-tag\.agent\{[^}]*--i-orange/.test(css), "agents are ink, as in the app");
});

// The bar over the home's view says where you are and offers what a working app offers: filters
// with counts, a sort, grid or canvas, and the one main action for the level. The grid's cards carry
// rows of facts, not just a picture.
test("ui: the home has a bar with filters, sort and views, and cards with facts", () => {
  const app = read("app.js");
  const top = app.slice(app.indexOf("function renderHomeTop"), app.indexOf("// The home's shell"));
  assert.match(top, /class="hcrumb"/);
  assert.match(top, /for \(const \[k, label, test\] of FILTERS\) tab\(label, lv\.items\.filter\(test\)\.length,/, "filters show their counts");
  assert.match(top, /tab\("Projects", rs\.length,[^\n]*tab\("Guides", FEATURES\.length,/);
  assert.match(top, /dropdown\(\{ value: S\.homeSort \|\| "edited", options: \[\{ label: "Sort by: Last edited"/);
  assert.match(top, /segmented\(\[\{ label: "Grid", value: "grid" \}, \{ label: "Canvas", value: "canvas" \}\]/);
  assert.match(top, /New branch<\/button>`\) : h\(`<button type="button" class="createbtn sm">\$\{IC\.upload\}Import HTML/, "the main action fits the level");
  assert.match(app, /const homeView = \(\) => \(store\.get\("ws-home-view", "grid"\) === "canvas" \? "canvas" : "grid"\);/, "the grid is the default");
  const level = app.slice(app.indexOf("function homeLevelOf"), app.indexOf("function renderHomeCanvas"));
  assert.match(level, /rows: \[\["Started by", b\.author \|\| "Someone"\], \["Started",[^\n]*\["Changes", String\(f\.changes\)\], \["Comments", String\(f\.comments\)\]\]/);
  const browse = read("browse.js");
  assert.match(browse, /class="brow"><span class="k"><\/span><span class="v"><\/span>/);
  assert.match(browse, /c\.querySelector\("\.bhd b"\)\.textContent = a\.title;/, "a guide's title, not a <b> inside its picture");
});

// The Home tab was class "tab home", and ".home" is the home page itself: the tab took the page's
// background, so it looked selected when it wasn't. Its own name now.
test("ui: the Home tab doesn't share the home page's class", () => {
  assert.ok(!/class="tab home/.test(read("app.js")));
  assert.match(read("app.js"), /class="tab tab-home/);
  assert.ok(!/\.tab\.home\b/.test(read("app.css")));
});

// The editor has two states, switched in the header: Design (the canvas) and Prototype (one screen
// as large as the window allows, running as the app, with a bar to move between screens and go
// back). Run in a frame's title and P open Prototype on that frame; there is no separate Present.
test("ui: Design and Prototype are the editor's two states", () => {
  const html = read("index.html");
  assert.ok(!/id="modeSw"/.test(html) && !/id="presentBtn"/.test(html), "one way in: the canvas bar's Prototype mode");
  assert.match(html, /class="tbmodes" role="tablist"[^>]*>.*data-m="edit"[^>]*>.*Edit<\/button>.*data-m="mark"[^>]*>.*Mark up<\/button>.*data-m="proto"[^>]*>.*Prototype<\/button>/);
  const app = read("app.js");
  const fn = app.slice(app.indexOf("function present("), app.indexOf("function stopPresent"));
  assert.match(fn, /data-a="prev"[\s\S]*data-a="pick"[\s\S]*data-a="next"[\s\S]*Back to design/);
  assert.ok(!/hideT|opacity = "0"/.test(fn), "the bar stays put: nothing appears and disappears");
  assert.match(app, /on\("prototype", \(id\) => present\(id\)\);/);
  const cv = read("canvas.js");
  assert.match(cv, /run\.onclick = \(e\) => \(e\.stopPropagation\(\), fire\("prototype", it\.id\)\);/);
  assert.match(cv, /if \(S\.presenting\) return fire\("exit-present"\);/);
  assert.match(cv, /m\.dataset\.m === "proto" \? \$\("interactBtn"\)\.click\(\)/, "the Prototype mode runs the same way in");
  // one name for the action (Run) and one for the state (Prototype): nothing is still called Present
  for (const f of ["panels.js", "canvas.js", "app.js", "index.html"]) assert.ok(!/[>"]Present[<" ]/.test(read(f)), `${f} still offers "Present"`);
  const css = read("app.css");
  assert.ok(!/\.app\.present \.top[,{]/.test(css), "the header stays in Prototype");
});

// The canvas bar is in two rows: what you're doing, then only that mode's tools, each with its name.
// Picking a tool (a click or its key) puts the bar in the tool's mode, so the two never disagree.
test("ui: the canvas bar shows one mode's labelled tools at a time", () => {
  const html = read("index.html");
  const bar = html.slice(html.indexOf('id="tb"'), html.indexOf('<aside class="rp"'));
  const tools = [...bar.matchAll(/<button type="button" class="tbtool[^"]*" data-tool="(\w+)" data-g="(\w+)"[^>]*>.*?<span class="tl">([^<]+)<\/span><\/button>/g)].map((m) => `${m[1]}:${m[2]}:${m[3]}`);
  assert.deepEqual(tools, ["move:edit:Select", "hand:edit:Hand", "frame:edit:Frame", "note:mark:Note", "box:mark:Highlight", "arrow:mark:Arrow", "comment:mark:Comment", "draw:mark:Draw"]);
  assert.equal((bar.match(/data-tool="/g) || []).length, tools.length, "no tool without a name and a mode");
  assert.match(bar, /id="bringBtn"[^>]*data-g="edit"/);
  assert.match(bar, /id="askBtn"/);
  const cv = read("canvas.js");
  assert.match(cv, /const MARK = new Set\(\["note", "box", "arrow", "comment", "draw"\]\);/);
  const fn = cv.slice(cv.indexOf("export function setTool("), cv.indexOf("export function setTool(") + 700);
  assert.match(fn, /const g = MARK\.has\(t\) \? "mark" : "edit";/);
  assert.match(fn, /tb\.dataset\.g = g;/);
  assert.match(fn, /m\.setAttribute\("aria-selected", String\(on\)\)/);
  assert.match(cv, /setTool\(m\.dataset\.m === "mark" \? lastMark : "move"\)/, "Mark up comes back to the tool you last marked with");
  const css = read("app.css");
  assert.match(css, /#tb\[data-g="edit"\] \.tbrow \[data-g="mark"\],#tb\[data-g="mark"\] \.tbrow \[data-g="edit"\]\{display:none\}/);
});

// A guide that explains something and offers nothing to do is a dead end: every step after the intro
// names an action, and the app gives each one a label and something real to run.
test("ui: every Learn step after the intro ends in a real action", () => {
  const v = read("visuals.js");
  const steps = [...v.matchAll(/\{ id: "(\w+)", title:[^\n]*?\}/g)];
  assert.ok(steps.length >= 6);
  const app = read("app.js");
  for (const [line, id] of steps) {
    if (id === "intro") continue;
    const t = line.match(/try: "(\w+)"/)?.[1];
    assert.ok(t, `the ${id} step offers something to try`);
    assert.match(app, new RegExp(`\\b${t}: [^\\n]*\\{ label: [^\\n]*run: `), `the app runs the ${t} action`);
  }
  assert.match(v, /tryB\.textContent = t \? t\.label/, "the button says what it does");
  assert.doesNotMatch(app, /Nothing here yet<\/b>[^`]*<\/div>`\)\);/, "the empty Activity page offers an action");
});

// The header is not a bar: it sits on the same surface as the canvas and the home, with no fill or rule.
test("ui: the header has no solid background or bottom border", () => {
  const css = read("app.css");
  for (const m of css.matchAll(/(^|\n)\.top\{([^}]*)\}/g)) {
    assert.doesNotMatch(m[2], /background:(?!none)/, ".top paints no background");
    assert.doesNotMatch(m[2], /border-bottom/, ".top draws no rule");
  }
  assert.match(css, /\.app\{[^}]*background:var\(--bg-canvas\)/, "the canvas surface runs up behind the header");
});

// No handwriting in the app: notes and hints are set in the interface face like everything else.
test("ui: no handwritten font anywhere in the app", () => {
  const css = read("app.css");
  assert.ok(!/--hand|Shantell|Atelier Hand|cursive/.test(css), "no hand font token, face or fallback");
  assert.ok(!/class="hand"/.test(read("app.js")));
});

// Connecting an AI tool is the header's one call to action (the ink pill) until a tool is connected;
// then it's a quiet status pill.
test("ui: the header asks you to connect your AI tool with a real button", () => {
  assert.match(read("index.html"), /class="createbtn sm agst cta" id="agentBtn"/);
  assert.match(read("app.js"), /\$\("agentBtn"\)\.className = on \? "dbtn sm agst" : "createbtn sm agst cta"/);
});

// Home is a canvas in levels you go into. The space: a block per project, and Guides, each drawn as
// a stack because there's a level inside. Inside a project: Main, each open branch (where it stands,
// its changes and comments, who started it) and a place to start a new one. Inside Guides: the
// guides. Entering Main or a branch opens its frames. The way back up is always there.
test("ui: the home canvas goes deeper, level by level", () => {
  const app = read("app.js");
  const level = app.slice(app.indexOf("function homeLevelOf"), app.indexOf("function renderHomeCanvas"));
  assert.match(level, /cue: "Enter", cls: "hproj", deep: true/, "a project is a block you enter");
  assert.match(level, /title: "Guides",[^\n]*cue: "Enter", deep: true,[^\n]*run: \(\) => goIn\("guides"\)/, "so is Guides");
  assert.match(level, /name: "Main", meta: \["The agreed version"/);
  assert.match(level, /const st = branchStatus\(f\);[\s\S]*meta: \[st\.label, branchCounts\(f\)/, "a branch says where it stands");
  assert.match(level, /title: "New branch"[^\n]*run: \(\) => createBranch\(root\.id\)/);
  assert.match(level, /open: \(it\) => go\(it\.id\)/, "Main or a branch opens its frames");
  assert.match(level, /open: \(it\) => goIn\(it\.id\)/, "a project is entered, not opened");
  assert.match(app, /const inside = \/\^#\\\/in\\\/\(\[\^\/\?#\]\+\)\$\/\.exec\(location\.hash\);/, "each project's level has a route");
  assert.match(app, /top\.querySelector\('\[data-a="up"\]'\)\.onclick = \(\) => \(S\.homeSection === "activity" \? goSection\("home"\) : goIn\(null\)\);/, "the way back up, in the bar");
  assert.match(app, /if \(e\.key !== "Escape" \|\| S\.view !== "home" \|\| !S\.homeIn/, "Esc goes up too");
  assert.ok(!/renderBoard|renderHomeList|renderLearnPage/.test(app), "one home");
  const home = read("home.js");
  assert.match(home, /\$\{it\.deep \? " hdeep" : ""\}/);
  assert.match(home, /list\[idx\]\?\.cue \|\| "Open"/, "the pointer says Enter or Open");
  assert.match(home, /memory\.set\(key, \{ x: -cx \* CW, y: -cy \* CH, id: act \? `action:\$\{act\.title\}` : it\.id \}\);/, "coming back up lands on the block you were in");
  const css = read("app.css");
  assert.match(css, /\.htile\.hdeep\{box-shadow:var\(--sh-card\),0 9px 0 -5px/, "a block with a level inside is a stack");
  assert.match(css, /\.htile\.hdeep\.chosen\{scale:1\.3;opacity:0;/, "entering it, the block grows and dissolves");
  assert.match(css, /@media \(prefers-reduced-motion:reduce\)\{\.htile\.hdeep\.chosen\{scale:none;opacity:1\}\}/);
  for (const t of ["--sh-card-inv:", "--sh-card-inv-hi:"]) assert.equal(css.split(t).length - 1, 2, `${t} has a dark-mode pair`);
  assert.match(read("panels.js"), /You're editing Main[^`]*`\);\s*const br = h\(`<button[^`]*Create a branch<\/button>`\);/);
});

// A frame is editable as it stands, as in Figma: the frame under the pointer and the selected one are
// live, a click on content picks its layer at once (no "first click selects the screen"), and Run
// lives in the frame's title row rather than over the middle of the frame.
test("ui: frames are editable by default, and Run sits in the frame's title", () => {
  const cv = read("canvas.js");
  const plan = cv.slice(cv.indexOf("function planLive()"), cv.indexOf("function planSnapshots()"));
  assert.match(plan, /if \(S\.mode === "design" && \(S\.tool === "move" \|\| S\.tool === "comment"\)\) add\(hoverBoard\);/);
  assert.ok(!/fresh:/.test(cv) && !/d\.fresh/.test(cv), "no first-click-selects-the-screen rule");
  assert.match(cv, /class="blabel"[^`]*<button type="button" class="brun"/, "Run is in the title row");
  assert.ok(!/bplay|drawPlay/.test(cv), "no Play button over the middle of the frame");
  assert.match(cv, /lb\.textContent = m === "prototype" \? "Stop" : "Run"/);
  assert.match(read("index.html"), /<span class="lb">Run<\/span>/);
});

// A frame that finishes loading under a pointer that isn't moving outlines the layer under it then,
// not on the next move: the pointer's last place is kept, and the load handler picks from it.
test("ui: a frame that goes live under a still pointer outlines its layer", () => {
  const cv = read("canvas.js");
  assert.match(cv, /function onMove\(e\) \{\s*const p = local\(e\);\s*lastWorld = toWorld\(p\);\s*lastPtr = p;/);
  const load = cv.slice(cv.indexOf("function onBoardLoad(b)"), cv.indexOf("function onBoardLoad(b)") + 600);
  assert.match(load, /setHover\(b\.id, layerAt\(b\.id, elAt\(b\.id, lastPtr\)\)\)/);
});

// One place for each thing in the editor: branches are listed in the Layers tab only (not again in
// the right panel or in a bar over Main), and Run is in each frame's title, always there, with the
// tool bar offering only Stop while a frame runs. Asking an agent is the tool bar's main action.
test("ui: the editor shows each thing once", () => {
  const panels = read("panels.js");
  const page = panels.slice(panels.indexOf("function designPage"), panels.indexOf("// several boards and annotations"));
  assert.ok(!/sec\("Branches"/.test(page), "the right panel doesn't list branches again");
  assert.ok(!/Review and merge<\/button>/.test(page), "review lives in the branch's bar");
  const banner = panels.slice(panels.indexOf("export function renderBanner"), panels.indexOf("// ======================= RIGHT PANEL"));
  assert.match(banner, /\/\/ Main with nothing branched off it:[^\n]*\n\s*if \(!kids\.length\) return done\(false\);/, "no bar over Main until there are branches to see beside it");
  const mainBar = banner.slice(banner.indexOf("// Main with branches"));
  assert.ok(!/fire\("branch"/.test(mainBar), "creating a branch stays in the Branches list");
  const css = read("app.css");
  assert.match(css, /\.tb #interactBtn:not\(\[aria-pressed="true"\]\)\{display:none\}/);
  assert.match(css, /\.tb #askBtn\{background:var\(--raise-ink\)/);
  assert.match(read("canvas.js"), /run\.classList\.toggle\("on", !it\.ghost && s\.w >= 120\);/, "Run doesn't come and go with the pointer");
});

// The brand is flat: one colour for the mark, no gloss, rim, glow or drop shadow; panels are nearly
// solid with no bright top edge; blue is for selection and links, so switches and badges are ink;
// and nothing blinks or pulses on its own.
test("ui: the brand and chrome are flat and still", () => {
  const css = read("app.css");
  assert.match(css, /\.pinmark \.pl,\.pinmark \.ps,\.pinmark \.pr,\.pinmark \.ei\{display:none\}/);
  assert.ok(!/pinmark[^}]*drop-shadow/.test(css), "no shadow under the mark");
  assert.ok(!/\.tlogo:hover \.pinmark \.eye\{animation/.test(css), "the mark doesn't blink when hovered");
  assert.match(css, /\.hdot\.on\{box-shadow:none\}/, "status lights don't glow");
  assert.match(css, /--glass-a:\.94;--glass-blur:blur\(20px\);/);
  assert.ok(!/--glass-spec:inset 0 1px 0 rgba\(255,255,255,\.85\)/.test(css), "no specular top edge");
  assert.match(css, /--switch-on:#1c1a17;/, "switches are ink, not blue");
  assert.ok(!/hpulse/.test(css), "thumbnails don't pulse while they load");
  assert.ok(!/harrive [0-9]+ms [^;]*var\(--d/.test(css), "home cards don't cascade in");
});

// With a few prototypes the home shows each thing once, in a block that fits a laptop screen; the
// field only repeats once there are enough prototypes to fill it.
test("ui: the home doesn't repeat cards to look full", async () => {
  const home = read("home.js");
  assert.match(home, /wrap = list\.length >= WRAP_MIN;/);
  const { block } = await import("../ui/motion.js");
  for (const n of [5, 8, 9, 14]) assert.ok(Math.max(...block(n).map((c) => c[0])) <= 3, `${n} cards are at most 4 across`);
  assert.equal(block(9).length, 9);
});

// Found by walking the workflow in a browser. A new frame first reports its empty page as loaded;
// taking that for the real one showed, and let you select from, a half-loaded page (a prototype's
// sign-in gate in place of the screen). Only the real page, complete, counts, and nothing is picked
// from a frame before then.
test("ui: a frame is live only once its real page has loaded", () => {
  const cv = read("canvas.js");
  assert.match(cv, /return !!d && d\.readyState === "complete" && d\.URL !== "about:blank";/);
  assert.match(cv, /fr\.addEventListener\("load", \(\) => b\.frame === fr && pageIsIn\(fr\) && onBoardLoad\(b\)\);/);
  assert.match(cv, /if \(!d \|\| !b \|\| !B\.get\(id\)\?\.ready\) return null;/, "nothing to pick until then");
});

// A text edit is an edit like any other: ⌘Z undoes it, the toast's Undo undoes that edit, the
// toast names the page it was saved on, and the view goes back to where it was if it zoomed in.
test("ui: a text edit can be undone and says where it was saved", () => {
  const cv = read("canvas.js");
  const edit = cv.slice(cv.indexOf("function editText"), cv.indexOf("export function editNote"));
  assert.match(edit, /record\(entry\);/);
  assert.match(edit, /fn: \(\) => undoEntry\(entry\)/);
  assert.ok(!edit.includes('"Saved on this branch"'), "not 'this branch' when it's Main");
  assert.match(edit, /`Saved on \$\{where && isBranch\(where\) \? where\.name : "Main"\}`/);
  assert.match(edit, /if \(camBack\) camTo\(camBack, 240\);/);
  assert.match(read("history.js"), /export async function undoEntry\(entry\)/);
});

// Comparing a branch shows one screen with the parent's version, large enough to see the change,
// and hiding it goes back to where you were; toasts sit under the branch's bar, not over it.
test("ui: compare is readable and toasts don't cover the branch bar", () => {
  const app = read("app.js");
  assert.match(app, /requestAnimationFrame\(\(\) => \(S\.compare \? fitPair\(\) : flyTo\(beforeCompare\)\)\);/);
  assert.match(read("canvas.js"), /export function fitPair\(opts\)/);
  const css = read("app.css");
  assert.match(css, /\.has-banner:not\(\.ui-off\) \.toasts\{top:128px\}/);
  assert.match(css, /\.toasts\{right:calc\(var\(--rw\) \+ 8px\);top:52px\}/, "and under the header's switch");
});

// Entering Prototype never shows a blank window: the screen's picture stays up until its page is,
// and only that screen is drawn.
test("ui: Prototype shows the screen's picture while its page loads", () => {
  const css = read("app.css");
  assert.ok(!/\.app\.present \.gfx\{visibility:hidden\}/.test(css) && !/\.app\.present [^{]*,\.app\.present \.gfx\{visibility:hidden/.test(css));
  assert.match(read("canvas.js"), /const list = S\.presenting \? pageBoards\(\)\.filter\(\(it\) => it\.id === S\.presenting\) : pageBoards\(\);/);
});

// The app read cold: neutral greys and one sans everywhere. It's warm paper and a warm ink now, a
// serif for the few big moments, cards that sit a little off square like papers on a desk, and a
// greeting on the home with the mark as a small character whose eye follows the pointer.
test("ui: the app is warm, light and a little analogue", () => {
  const css = read("app.css");
  assert.match(css, /--bg-canvas:#f3f0e9;/, "warm paper, not neutral grey");
  assert.match(css, /--text-primary:#1c1a17;/, "a warm ink");
  assert.ok(!/#121212|#f1f1f0|#fafafa\b/i.test(css), "no cold greys left behind");
  assert.match(css, /--serif:ui-serif,/);
  assert.match(css, /\.md-h h2,\.lrn-t h2,\.hl-h h1,\.pempty b\{font-family:var\(--serif\)/, "the serif is for the big moments");
  assert.ok(!/\.(dbtn|createbtn|ghbtn|tab|pg|irow)[^{]*\{[^}]*var\(--serif\)/.test(css), "never on what you operate");
  assert.match(css, /rotate:var\(--r,0deg\)/);
  assert.match(css, /\.htile\.hot\{z-index:2;scale:1\.02;rotate:0deg;/, "a card straightens under the pointer");
  assert.match(read("home.js"), /el\.style\.setProperty\("--r", `\$\{TILT\[Math\.abs\(idx \* 7 \+ 3\) % TILT\.length\]\}deg`\);/);
  const app = read("app.js");
  const greet = app.slice(app.indexOf("function homeGreeting"), app.indexOf("// Esc goes up a level"));
  assert.match(greet, /greeting\(new Date\(\)\.getHours\(\)\)/);
  assert.match(greet, /waitingLine\(\{ ready, working, projects: rs\.length \}\)/, "it says what's waiting on you");
  assert.match(greet, /matchMedia\("\(prefers-reduced-motion: reduce\)"\)\.matches\) return;/, "the eye stays still under reduced motion");
  assert.match(app, /const SCRIBBLE = outline\(/, "the line under the greeting is drawn by Atelier's own pen");
});

// What makes Atelier itself: an idea is a branch, and a branch is seen beside the original. Any
// page with open branches offers Side by side: each branch's screens in a row under the page's own,
// with the branch's name, where it stands, and Open / Review and merge on the row.
test("ui: a page shows its branches side by side with it", () => {
  const panels = read("panels.js");
  const banner = panels.slice(panels.indexOf("export function renderBanner"), panels.indexOf("// ======================= RIGHT PANEL"));
  assert.match(banner, /const kids = env\.archived \? \[\] : branchesOf\(env\.id\);/);
  assert.match(banner, /class="\$\{isBranch\(env\) \? "ghbtn" : "createbtn"\} sm bside" aria-pressed="\$\{S\.studies\}"/);
  assert.equal((banner.match(/\bside\(\);/g) || []).length, 2, "on Main and on a branch that has branches of its own");
  assert.match(banner, /branchesLine\(\{ open: kids\.length,/);
  const cv = read("canvas.js");
  assert.match(cv, /if \(S\.studies\) for \(const g of studyRows\(pageItems\("board"\), branchesOf\(env\.id\)\.map\(\(k\) => \(\{ id: k\.id, boards: pageItems\("board", k\.id\) \}\)\)\)\) GH\.set\(g\.id, \{ \.\.\.g, type: "board", ghost: true, study: true \}\);/);
  const rows = cv.slice(cv.indexOf("function drawRowTitles"), cv.indexOf("const screenRect"));
  assert.match(rows, /data-a="open">Open<\/button>.*data-a="review">Review and merge<\/button>/);
  assert.match(rows, /fire\("go", id\)/);
  assert.match(rows, /fire\("review", id\)/);
  assert.match(rows, /branchStatus\(f\)/);
  assert.match(rows, /\.hidden = !f\.changes;/, "nothing to review until the branch has changes");
  assert.match(cv, /if \(std\?\.study\) return fire\("go", std\.env\);/, "a double-click on a branch's screen opens the branch");
  const fit = cv.slice(cv.indexOf("export function fitStudies"), cv.indexOf("export const camNow"));
  assert.match(fit, /const r = rectsBounds\(\[b, g\]\);/, "it opens on one screen and the first branch's version of it, not every screen at thumbnail size");
  assert.match(cv, /l\.hidden = s\.w < 64 \|\| !!it\.study;/, "a row has one title, not one per screen");
  const app = read("app.js");
  assert.match(app, /on\("studies", \(show\) => \{/);
  assert.match(app, /S\.studies = sideOn === page;/, "open a branch from its row, come back, and the rows are still there");
  assert.match(app, /S\.studies = false;\n  sideOn = null;/, "going Home puts it away");
  assert.match(read("state.js"), /export const branchesOf = \(id\) => envList\(\)\.filter\(\(e\) => e\.parent === id && isBranch\(e\) && !e\.archived\)\.reverse\(\);/);
});

// Trying an idea several ways is one request: from Main, the Agent composer asks for 1, 2 or 3
// versions. More than one makes a request per version, each on its own branch, and shows the
// branches side by side under Main instead of leaving for one of them.
test("ui: asking for several versions puts each on its own branch, side by side", () => {
  const panels = read("panels.js");
  const chat = panels.slice(panels.indexOf("function renderChat"), panels.indexOf("function turnView"));
  assert.match(chat, /segmented\(\[1, 2, 3\]\.map\(\(n\) => \(\{ value: n, label: String\(n\) \}\)\), versions,/);
  assert.match(chat, /\$\{onMain \? `<label class="ctog">.*<span class="cvers"/, "only from Main: a branch's request stays on the branch");
  assert.match(chat, /const n = onMain \? versions : 1;/);
  assert.match(chat, /for \(const r of versionRequests\(prompt, n\)\.reverse\(\)\) await api\("tasks", \{ method: "POST", body: \{ env: env\.id, prompt: r\.prompt, selection, branch: true, branchName: r\.name \} \}\);/);
  assert.match(chat, /fire\("tasks-changed", \{\}\);\n\s*fire\("versions-started", n\);/, "it stays on Main: no branch is opened in its place");
  assert.match(chat, /aria-checked="\$\{S\.chatOnBranch \|\| versions > 1\}"/, "several versions are several branches");
  const app = read("app.js");
  const on = app.slice(app.indexOf('on("versions-started"'), app.indexOf('on("diff", () => S.view === "home"'));
  assert.match(on, /await loadWorkspace\(\);[\s\S]*fire\("studies", true\);/);
});

// What you grab to resize is an area around the selection (ui/hitareas.js), not the small squares
// drawn on it: the squares take no clicks, the areas carry the cursors, and a frame resizes from
// every side with the opposite side staying where it was.
test("ui: a selection is resized by its areas, not its drawn squares", () => {
  const css = read("app.css");
  assert.match(css, /\.hdl\{[^}]*pointer-events:none/);
  assert.match(css, /\.rz\{position:absolute;pointer-events:auto/);
  assert.match(css, /\.rz\.e,\.rz\.w\{cursor:ew-resize\}\.rz\.n,\.rz\.s\{cursor:ns-resize\}\.rz\.se,\.rz\.nw\{cursor:nwse-resize\}\.rz\.ne,\.rz\.sw\{cursor:nesw-resize\}/);
  // the title row lies over the outside of the top edge: only its name and Run take the pointer,
  // so the top edge resizes from both sides like the other three
  assert.match(css, /\.blabel\{[^}]*pointer-events:none/);
  assert.match(css, /\.blabel \.n,\.blabel \.g,\.blabel \.brun\{pointer-events:auto\}/);
  assert.match(css, /\.rz\{z-index:1\}/);
  assert.match(css, /\.rz\.nw\{border-top-left-radius:10px\}\.rz\.ne\{border-top-right-radius:10px\}\.rz\.se\{border-bottom-right-radius:10px\}\.rz\.sw\{border-bottom-left-radius:10px\}/, "a corner's area is rounded off on the outside");
  const cv = read("canvas.js");
  assert.match(cv, /for \(const k of SIDES\) \{\n\s*const d = h\(`<div class="rz \$\{k\}" data-h="\$\{k\}"><\/div>`\);/);
  assert.match(cv, /const rzOf = S\.tool === "move" && !S\.presenting \? eh \|\| br : null;/, "only with Select, for a layer or a frame");
  assert.match(cv, /const areas = new Map\(resizeAreas\(rzOf\)\.map\(\(a\) => \[a\.k, a\]\)\);/);
  assert.match(cv, /const handle = e\.target\.closest\("\.rz"\);/);
  assert.ok(!/closest\("\.hdl"\)/.test(cv), "the drawn squares are not the target");
  assert.match(cv, /Object\.assign\(it, resizeFrom\(\{ x: drag\.x0, y: drag\.y0, w: drag\.w0, h: drag\.h0 \}, drag\.h, dx \/ z, dy \/ z,/);
  assert.match(cv, /recordMove\(\[\{ id: d\.id, x: d\.x0, y: d\.y0, w: d\.w0, h: d\.h0 \}\], "resize"\);/, "undo puts the place back as well as the size");
});
