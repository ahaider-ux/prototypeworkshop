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
  const homeCanvas = app.slice(app.indexOf("function renderHomeCanvas"), app.indexOf("function renderHome()"));
  for (const run of ["run: openImport", "run: () => openSpaces()", "run: openConnect"]) assert.ok(homeCanvas.includes(run), `the home's empty-state cards do something real: ${run}`);
  const home = read("home.js");
  assert.match(home, /if \(idx < 0\) return actions\[-idx - 1\]\?\.run\?\.\(\)/);
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

// The home is a floating utility that stays and a main area that changes: picking a section
// re-renders only the main area (the utility is built once and updated in place), and every section
// has a route.
test("ui: the home's floating utility stays while its sections swap", () => {
  const app = read("app.js");
  assert.match(app, /const SECTIONS = \["home", "prototypes", "learn", "activity"\]/);
  assert.match(app, /function homeShell\(\) \{[\s\S]*?if \(home\.querySelector\("\.hdock"\)\) return home;/, "built once");
  const canvas = app.slice(app.indexOf("function renderHomeCanvas"), app.indexOf("\n}\n", app.indexOf("function renderHomeCanvas")));
  assert.ok(canvas.includes("homeMain()") && !/\$\("home"\)\.replaceChildren/.test(canvas), "the home canvas fills only the main area");
  for (const f of ["renderLearnPage", "renderActivityPage"]) {
    const body = app.slice(app.indexOf(`function ${f}`), app.indexOf("\n}\n", app.indexOf(`function ${f}`)));
    assert.ok(body.includes("main.replaceChildren"), `${f} replaces only the main area`);
    assert.ok(!/\$\("home"\)\.replaceChildren/.test(body), `${f} leaves the utility alone`);
  }
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

// The home's navigation floats over the work like everything else that floats in Atelier (after
// Libra's floating utility bars): the editor's glass tool bar, its tab thumb, its ink action; no
// docked sidebar beside the canvas, no second agent status (the header has it).
test("ui: the home's navigation is a floating utility, not a docked sidebar", () => {
  const app = read("app.js");
  const shell = app.slice(app.indexOf("function homeShell()"), app.indexOf("const homeMain"));
  assert.ok(shell.includes('class="hdock"') && shell.includes('role="tablist"') && shell.includes('class="vsep"'));
  assert.ok(!/hside|hagent|What's new/.test(shell), "no sidebar, footer links or agent card");
  const css = read("app.css");
  assert.ok(!/\.hside/.test(css), "no sidebar styles left");
  assert.match(css, /\.home\{[^}]*background:var\(--bg-canvas\)/);
  assert.match(css, /\.hdock\{[^}]*border-radius:99px;background:var\(--glass-bg\)/, "glass capsule, like the tool bar");
  assert.match(css, /\.hdpill\{[^}]*background:var\(--raise\)/, "a raised thumb on the selected section");
  assert.match(css, /\.hmain\.hc\{position:absolute;inset:0;/, "the canvas runs edge to edge under it");
  assert.ok(!/\.pv-tag\.agent\{[^}]*--i-orange/.test(css), "agents are ink, as in the app");
});

// The Home tab was class "tab home", and ".home" is the home page itself: the tab took the page's
// background, so it looked selected when it wasn't. Its own name now.
test("ui: the Home tab doesn't share the home page's class", () => {
  assert.ok(!/class="tab home/.test(read("app.js")));
  assert.match(read("app.js"), /class="tab tab-home/);
  assert.ok(!/\.tab\.home\b/.test(read("app.css")));
});

// Present read the board's live page before it existed (boards are pictures until they're played),
// so it threw. It now listens on the page once it loads.
test("ui: Present waits for the board's live page", () => {
  const app = read("app.js");
  const fn = app.slice(app.indexOf("function present("), app.indexOf("function stopPresent"));
  assert.ok(!/boardOf\(bid\)\?\.frame\.contentDocument/.test(fn), "no unguarded frame access");
  assert.match(fn, /boardOf\(bid\)\?\.frame\?\.contentDocument/);
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

// Home is one endless field of real things: your prototypes, placeholders that do what they say, and
// the guides; over each the pointer says what a click does.
test("ui: the home canvas holds prototypes, placeholders and guides, and names each click", () => {
  const app = read("app.js");
  assert.match(app, /if \(S\.homeSection === "home"\) return renderHomeCanvas\(rs\);/);
  const canvas = app.slice(app.indexOf("function renderHomeCanvas"), app.indexOf("\n}\n", app.indexOf("function renderHomeCanvas")));
  assert.match(canvas, /nextActions\(\)/);
  assert.match(canvas, /cue: "Learn", art: \(\) => artEl/);
  for (const cue of ['cue: "Start"', 'cue: "Connect"']) assert.ok(app.includes(cue), cue);
  const home = read("home.js");
  assert.match(home, /const cueOf = \(idx\) => \(idx >= 0 \? "Open"/);
  assert.match(home, /el\.className = "htile hguide"/);
  assert.match(read("app.css"), /\.hcur\.on \.hcl\{[^}]*background:var\(--glass-bg\)/, "the label is glass");
});

// Your own prototypes never read as one of the guides around them: they're on the inverse surface.
test("ui: prototype cards on the home are inverse, unlike guides and placeholders", () => {
  assert.match(read("home.js"), /el\.className = "htile hproj"/);
  const css = read("app.css");
  assert.match(css, /\.htile\.hproj\{background:var\(--raise-ink\);box-shadow:var\(--sh-card-inv\)\}/);
  assert.match(css, /\.htile\.hproj \.hcap b\{color:var\(--on-primary\)\}/);
  for (const t of ["--sh-card-inv:", "--sh-card-inv-hi:"]) assert.equal(css.split(t).length - 1, 2, `${t} has a dark-mode pair`);
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
  assert.match(banner, /b\.hidden = true;\s*return markDirty\(\);/, "no bar over Main");
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
  assert.match(css, /--switch-on:#121212;/);
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
