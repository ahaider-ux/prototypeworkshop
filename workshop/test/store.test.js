import { test } from "node:test";
import assert from "node:assert/strict";
import fsp from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import zlib from "node:zlib";
import { Store, mergeRule, rulesOf, parseCss, slug } from "../src/store.js";

const tmp = () => fsp.mkdtemp(path.join(os.tmpdir(), "workshop-"));
const HTML = "<!doctype html><html><head><title>Sample app</title></head><body><main class=\"m\"><button class=\"b on\">Go</button></main></body></html>";

test("creates, lists and forks an environment with its lineage and canvas spot", async () => {
  const s = await Store.open(await tmp());
  const a = await s.createEnv({ html: HTML });
  assert.equal(a.id, "sample-app");
  assert.equal(a.name, "Sample app");
  await s.writeFile(a.id, "assets/note.txt", "hello");
  const b = await s.forkEnv(a.id, { name: "Sample app dark" });
  assert.equal(b.parent, a.id);
  assert.equal(b.id, "sample-app-dark");
  assert.equal((await s.readFile(b.id, "assets/note.txt")).toString(), "hello");
  const items = await s.items();
  const ba = items.find((i) => i.env === a.id),
    bb = items.find((i) => i.env === b.id);
  assert.deepEqual([bb.x, bb.y], [ba.x, ba.y], "the copy is its own page, laid out like its parent");
  assert.equal((await s.listEnvs()).length, 2);
});

test("ids are unique and safe", async () => {
  const s = await Store.open(await tmp());
  assert.equal(slug("Libra — Fourth Age!"), "libra-fourth-age");
  const a = await s.createEnv({ name: "Same", html: HTML });
  const b = await s.createEnv({ name: "Same", html: HTML });
  assert.notEqual(a.id, b.id);
  await assert.rejects(() => s.getEnv("../etc"), /Not an environment id/);
});

test("file paths can't leave the environment folder", async () => {
  const s = await Store.open(await tmp());
  const a = await s.createEnv({ html: HTML });
  for (const bad of ["../workshop.json", "a/../../x", "/../../etc/passwd", ".hidden"]) {
    await assert.rejects(() => s.readFile(a.id, bad), /isn't allowed/, bad);
    await assert.rejects(() => s.writeFile(a.id, bad, "x"), /isn't allowed/, bad);
  }
});

test("overrides merge by selector and keep other rules and comments", () => {
  let css = "/* head */\n.a {\n  color: red !important;\n}\n@media (max-width: 10px) { .a { color: blue } }\n";
  css = mergeRule(css, ".a", { padding: "8px" });
  css = mergeRule(css, ".b > .c", { "border-radius": "var(--r, 8px)" });
  css = mergeRule(css, ".a", { color: null });
  const rules = rulesOf(css);
  assert.deepEqual(rules.map((r) => r.selector), [".a", ".b > .c"]);
  assert.deepEqual(rules[0].decls, [["padding", "8px !important"]]);
  assert.match(css, /\/\* head \*\//);
  assert.match(css, /@media/);
  assert.throws(() => mergeRule(css, ".a{}", { color: "red" }), /selector/);
  assert.throws(() => mergeRule(css, ".a", { color: "red;} body{display:none" }), /value/);
  assert.throws(() => mergeRule(css, ".a", { "co lor": "red" }), /property/);
  assert.equal(parseCss("").length, 0);
});

test("versions snapshot the folder and restore saves the current state first", async () => {
  const s = await Store.open(await tmp());
  const a = await s.createEnv({ html: HTML });
  const v1 = await s.saveVersion(a.id, { label: "First" });
  await s.writeFile(a.id, "index.html", HTML.replace("Go", "Stop"));
  await s.setStyle(a.id, ".m", { gap: "8px" });
  const r = await s.restoreVersion(a.id, v1.n);
  assert.match((await s.readFile(a.id, "index.html")).toString(), />Go</);
  assert.equal(r.before.n, 2);
  const list = await s.listVersions(a.id);
  assert.deepEqual(list.map((v) => v.n), [2, 1]);
  const f = await s.forkEnv(a.id, { version: 2, name: "From two" });
  assert.match((await s.readFile(f.id, "index.html")).toString(), />Stop</);
  assert.equal(f.forkedFrom.version, 2);
});

test("delete goes to the trash and comes back", async () => {
  const s = await Store.open(await tmp());
  const a = await s.createEnv({ html: HTML });
  const b0 = (await s.items())[0];
  await s.updateItem(b0.id, { x: 400, y: 300 });
  await s.addBoard(a.id, { screen: "Chat" });
  const { trash } = await s.deleteEnv(a.id);
  assert.equal((await s.listEnvs()).length, 0);
  assert.equal((await s.items()).length, 0, "its boards leave the canvas with it");
  const back = await s.restoreEnv(trash);
  assert.equal(back.id, a.id);
  const bs = await s.items();
  assert.equal(bs.length, 2);
  assert.ok(bs.some((b) => b.x === 400 && b.y === 300));
});

test("settings are validated", async () => {
  const s = await Store.open(await tmp());
  const a = await s.createEnv({ html: HTML });
  const e = await s.updateEnv(a.id, { theme: "dark", screen: "Chat", device: { w: 1440, h: 900 }, variants: { Sidebar: "V2" } });
  assert.equal(e.theme, "dark");
  assert.deepEqual(e.device, { w: 1440, h: 900 });
  assert.deepEqual(e.variants, { Sidebar: "V2" });
  await assert.rejects(() => s.updateEnv(a.id, { theme: "neon" }), /Theme/);
  await assert.rejects(() => s.updateEnv(a.id, { device: { w: 10, h: 10 } }), /between/);
  const b0 = (await s.items())[0];
  await assert.rejects(() => s.updateItem(b0.id, { x: NaN }), /off the canvas/);
});

test("tasks, comments and shares are one file each", async () => {
  const s = await Store.open(await tmp());
  const a = await s.createEnv({ html: HTML });
  const t = await s.addTask({ env: a.id, prompt: "Make it denser", selection: { selector: ".m", html: "<main>" } });
  await s.updateTask(t.id, { status: "working", log: "x".repeat(30000) });
  for (let i = 0; i < 20; i++) await s.updateTask(t.id, { log: "y".repeat(20000) });
  const t2 = await s.record("tasks", t.id);
  assert.ok(JSON.stringify(t2.log).length <= 256 * 1024 + 20000, "the log stays bounded");
  const c = await s.addComment({ env: a.id, x: 10, y: 20, text: "Tighter here" });
  await s.addComment({ env: a.id, parent: c.id, text: "Done" });
  assert.equal((await s.records("comments")).length, 2);
  await s.deleteComment(c.id);
  assert.equal((await s.records("comments")).length, 0);
  const sh = await s.addShare({ env: a.id, role: "comment" });
  assert.equal((await s.shareByToken(sh.token)).env, a.id);
  await s.revokeShare(sh.id);
  assert.equal(await s.shareByToken(sh.token), null);
  await assert.rejects(() => s.addShare({ env: a.id, role: "edit" }), /view or comment/);
});

test("a branch is instant: it reads its parent's files until it changes them", async () => {
  const s = await Store.open(await tmp());
  const a = await s.createEnv({ html: HTML });
  await s.writeFile(a.id, "assets/app.js", "console.log(1)");
  await s.addBoard(a.id, { screen: "Chat" });
  const b = await s.branchEnv(a.id, { name: "Dense" });
  assert.equal(b.base, a.id);
  assert.equal(b.parent, a.id);
  assert.equal(b.ownIndex, false, "no copy of index.html was made");
  assert.match((await s.readFile(b.id, "index.html")).toString(), />Go</);
  const files = await s.listFiles(b.id);
  assert.equal(files.find((f) => f.path === "assets/app.js").inherited, a.id);
  const boards = (await s.items()).filter((i) => i.env === b.id);
  assert.deepEqual(boards.map((x) => x.screen).sort(), ["Chat", null].sort(), "the branch gets the same screens");
  await assert.rejects(() => s.deleteEnv(a.id), /still uses/);
  const co = await s.checkout(b.id);
  assert.equal(co.copied, 2);
  assert.equal((await s.getEnv(b.id)).base, null);
});

test("review and merge: both sides' changes, conflicts, and the merge itself", async () => {
  const s = await Store.open(await tmp());
  const a = await s.createEnv({ html: HTML });
  await s.setStyle(a.id, ".m", { gap: "8px" });
  const b = await s.branchEnv(a.id, { name: "Dark" });
  await s.updateEnv(b.id, { theme: "dark", variants: { Sidebar: "V1" } });
  await s.setStyle(b.id, ".m", { gap: "12px" });
  await s.setStyle(b.id, ".b", { color: "var(--text-accent, #5266ba)" });
  await s.writeFile(b.id, "index.html", HTML.replace("Go", "Start"));
  // main moves on too: the same gap changed both ways is a conflict
  await s.setStyle(a.id, ".m", { gap: "16px" });
  await s.updateEnv(a.id, { screen: "Chat" });
  const d = await s.diffEnv(b.id);
  const byKey = Object.fromEntries(d.changes.map((c) => [c.key, c]));
  assert.equal(byKey.theme.branch, "dark");
  assert.equal(byKey["variant:Sidebar"].branch, "V1");
  assert.equal(byKey[".m|gap"].conflict, true);
  assert.equal(byKey[".b|color"].conflict, false);
  assert.equal(byKey["index.html"].kind, "file");
  assert.equal(d.conflicts, 1);
  assert.equal(d.behind, 1, "main's new opening screen is waiting to come in");
  const r = await s.mergeEnv(b.id, { take: { ".m|gap": "main" } });
  const main = await s.getEnv(a.id);
  assert.equal(main.theme, "dark");
  assert.equal(main.variants.Sidebar, "V1");
  assert.equal(main.screen, "Chat", "main's own change stays");
  const css = await s.getOverrides(a.id);
  assert.match(css, /gap: 16px/);
  assert.match(css, /--text-accent/);
  assert.match((await s.readFile(a.id, "index.html")).toString(), />Start</);
  assert.equal((await s.getEnv(b.id)).archived, true);
  assert.deepEqual((await s.listVersions(a.id)).map((v) => v.label).slice(0, 2), ["Merged Dark", "Before merging Dark"]);
  assert.equal(r.applied, 4);
});

test("update from main takes what the branch didn't touch", async () => {
  const s = await Store.open(await tmp());
  const a = await s.createEnv({ html: HTML });
  const b = await s.branchEnv(a.id, {});
  await s.updateEnv(b.id, { theme: "dark" });
  await s.updateEnv(a.id, { theme: "light", screen: "Review" });
  await s.setStyle(a.id, ".m", { padding: "16px" });
  const u = await s.updateFromMain(b.id);
  const br = await s.getEnv(b.id);
  assert.equal(u.updated, 2);
  assert.equal(br.screen, "Review");
  assert.equal(br.theme, "dark", "the branch keeps its own theme");
  assert.match(await s.getOverrides(b.id), /padding: 16px/);
  assert.equal((await s.diffEnv(b.id)).behind, 0);
});

test("canvas items are checked and arrows go with what they point at", async () => {
  const s = await Store.open(await tmp());
  const a = await s.createEnv({ html: HTML });
  const n = await s.addItem({ type: "note", env: a.id, x: 10, y: 20, text: "Too tight" });
  assert.equal(n.env, a.id, "a note belongs to a page");
  const x = await s.addItem({ type: "box", x: 0, y: 0, w: 300, h: 120, label: "1" });
  const ar = await s.addItem({ type: "arrow", from: { item: n.id }, to: { x: 400, y: 50 } });
  assert.equal(ar.from.item, n.id);
  await assert.rejects(() => s.addItem({ type: "note", x: Infinity, y: 0 }), /off the canvas/);
  await assert.rejects(() => s.addItem({ type: "sticker" }), /go on the canvas/);
  await assert.rejects(() => s.addItem({ type: "board", env: "nope", x: 0, y: 0 }), /No environment/);
  await s.updateItem(x.id, { label: "Spacing" });
  assert.equal((await s.item(x.id)).label, "Spacing");
  await s.deleteItem(n.id);
  assert.deepEqual((await s.items()).map((i) => i.type).sort(), ["board", "box"], "the arrow pinned to the note went with it");
  void a;
});

test("old workspaces move their boards onto the canvas", async () => {
  const dir = await tmp();
  const s0 = await Store.open(dir);
  const a = await s0.createEnv({ html: HTML });
  for (const it of await s0.items()) await s0.deleteItem(it.id);
  await fsp.writeFile(path.join(dir, "workshop.json"), JSON.stringify({ name: "Old", canvas: { boards: { [a.id]: { x: 40, y: 80 } } } }));
  const s = await Store.open(dir);
  const items = await s.items();
  assert.equal(items.length, 1);
  assert.equal(items[0].x, 40);
  assert.equal(JSON.parse(await fsp.readFile(path.join(dir, "workshop.json"), "utf8")).canvas, undefined);
});

test("several style rules land in one write, or none do", async () => {
  const s = await Store.open(await tmp());
  const e = await s.createEnv({ html: HTML });
  const r = await s.setStyles(e.id, [
    { selector: "li:nth-of-type(1)", props: { order: "1" } },
    { selector: "li:nth-of-type(2)", props: { order: "0" } },
  ]);
  assert.match(r.css, /li:nth-of-type\(1\) \{[^}]*order: 1 !important/);
  assert.match(r.css, /li:nth-of-type\(2\) \{[^}]*order: 0 !important/);
  // a bad rule anywhere in the batch leaves the file as it was
  await assert.rejects(s.setStyles(e.id, [{ selector: "p", props: { color: "red" } }, { selector: "p", props: { "bad prop": "x" } }]));
  assert.equal(await s.getOverrides(e.id), r.css);
  await assert.rejects(s.setStyles(e.id, []), /between 1 and 100/);
});

test("an empty screen list never replaces a known one", async () => {
  const s = await Store.open(await tmp());
  const e = await s.createEnv({ html: HTML });
  await s.updateEnv(e.id, { catalog: { adapter: "Tools", screens: [{ group: "App", name: "Inbox" }], states: [], variants: [] } });
  const after = await s.updateEnv(e.id, { catalog: { adapter: "", screens: [], states: [], variants: [] } });
  assert.deepEqual(after.catalog.screens.map((x) => x.name), ["Inbox"]);
});

test("a drawing is checked, kept relative to its spot, and measured", async () => {
  const s = await Store.open(await tmp());
  const e = await s.createEnv({ html: HTML });
  const k = await s.addItem({ type: "ink", env: e.id, x: 100, y: 50, pen: "marker", color: "#E03131", size: 8, points: [[0, 0, 0.5], [40, 10], [80, 30, 2]] });
  assert.equal(k.id[0], "k");
  assert.deepEqual([k.w, k.h, k.color, k.points[2][2]], [80, 30, "#e03131", 1], "box from the points, colour normalised, pressure capped");
  await assert.rejects(s.addItem({ type: "ink", env: e.id, points: [[0, 0]], color: "red" }), /hex colour/);
  await assert.rejects(s.addItem({ type: "ink", env: e.id, points: [[0, 0]], pen: "crayon" }), /marker, pen, pencil or highlighter/);
  await assert.rejects(s.addItem({ type: "ink", env: e.id, points: Array.from({ length: 4001 }, () => [0, 0]) }), /4000/);
  const moved = await s.updateItem(k.id, { x: 300 });
  assert.deepEqual([moved.x, moved.points.length], [300, 3], "moving a drawing moves its spot, not its points");
});

test("recipes: a new workspace has starters, versions go testing → production, runs are counted", async () => {
  const s = await Store.open(await tmp());
  const list = await s.listRecipes();
  assert.deepEqual(list.map((r) => r.name), ["Apply my notes", "Polish pass", "State audit"]);
  assert.ok(list.every((r) => r.trigger === "manual"), "nothing runs an agent on its own until someone switches it on");
  const polish = list.find((r) => r.name === "Polish pass");
  const v2 = await s.addRecipeVersion(polish.id, { prompt: "Tighter polish", note: "shorter" });
  assert.equal(v2.versions[1].status, "testing");
  assert.equal(s.recipeVersion(v2).n, 1, "production keeps running until a new version is promoted");
  const p = await s.promoteRecipeVersion(polish.id, 2);
  assert.deepEqual(p.versions.map((v) => v.status), ["retired", "production"]);
  await assert.rejects(() => s.addRecipeVersion(polish.id, { prompt: "  " }), /instructions/);
  await assert.rejects(() => s.getRecipe("../x"), /id/i);

  const a = await s.createEnv({ html: HTML });
  const run = await s.runRecipe(polish.id, a.id);
  assert.notEqual(run.env, a.id, "from main, a recipe runs on a new branch (a shadow run)");
  assert.equal((await s.getEnv(run.env)).parent, a.id);
  assert.deepEqual(run.task.recipe, { id: polish.id, n: 2, name: "Polish pass" });
  const again = await s.runRecipe(polish.id, run.env);
  assert.equal(again.already, true, "a recipe already waiting on that branch isn't queued twice");
  await s.mergeEnv(run.env, {});
  assert.equal((await s.record("tasks", run.task.id)).status, "cancelled", "a run still waiting on a merged branch is called off");
  const run2 = await s.runRecipe(polish.id, a.id, { version: 1 });
  await s.updateEnv(run2.env, { archived: true });
  assert.equal((await s.record("tasks", run2.task.id)).status, "cancelled", "and on an archived one");
  const all = await s.recipeStats(await s.listRecipes());
  assert.equal(all[list[2].id].runs, 0, "a recipe that never ran still has an entry");
  const st = all[polish.id];
  assert.equal(st.runs, 2);
  assert.equal(st.merged, 1);
  assert.equal(st.discarded, 1);
  assert.deepEqual(st.byVersion, { 1: { runs: 1, merged: 0 }, 2: { runs: 1, merged: 1 } });
});

test("a merge is logged as a decision, and agents read the brief and recent decisions", async () => {
  const s = await Store.open(await tmp());
  const a = await s.createEnv({ html: HTML });
  await s.updateEnv(a.id, { brief: "Keep the sidebar. Use tokens only." });
  const b = await s.branchEnv(a.id, { name: "Quieter buttons" });
  await s.setStyle(b.id, ".b", { opacity: "0.8" });
  await s.mergeEnv(b.id, { note: "Primary actions were too loud", author: "Ada" });
  const main = await s.getEnv(a.id);
  assert.equal(main.decisions.length, 1);
  assert.equal(main.decisions[0].branchName, "Quieter buttons");
  assert.equal(main.decisions[0].note, "Primary actions were too loud");
  assert.deepEqual(main.decisions[0].changes, [".b · opacity"]);
  const c = await s.branchEnv(a.id, { name: "Next" });
  const ctx = await s.contextFor(c.id);
  assert.equal(ctx.brief, "Keep the sidebar. Use tokens only.", "a branch reads its prototype's brief");
  assert.equal(ctx.decisions[0].note, "Primary actions were too loud");
  const { taskPrompt } = await import("../src/agent.js");
  const text = taskPrompt({ prompt: "Do it" }, c, "/x", ctx);
  assert.match(text, /Keep the sidebar/);
  assert.match(text, /Primary actions were too loud/);
});

test("a connected folder: prototypes are found and edited in place, Atelier's data stays in .atelier", async () => {
  const home = await tmp();
  await fsp.mkdir(path.join(home, "app", "img"), { recursive: true });
  await fsp.writeFile(path.join(home, "app", "index.html"), HTML.replace("Sample app", "Real app"));
  await fsp.writeFile(path.join(home, "app", "img", "a.svg"), "<svg/>");
  await fsp.mkdir(path.join(home, "app", "node_modules", "x"), { recursive: true });
  await fsp.writeFile(path.join(home, "app", "node_modules", "x", "big.js"), "x");
  await fsp.writeFile(path.join(home, "pricing.html"), HTML.replace("Sample app", "Pricing page"));
  await fsp.mkdir(path.join(home, ".git"), { recursive: true });
  await fsp.writeFile(path.join(home, ".git", "index.html"), HTML);
  const s = await Store.open(path.join(home, ".atelier"));
  assert.equal(s.home, home);
  assert.match(await fsp.readFile(path.join(home, ".atelier", ".gitignore"), "utf8"), /^\.workshop\/$/m, "this computer's state is never committed with .atelier");
  const { added } = await s.findPrototypes();
  assert.deepEqual(added.map((e) => e.name).sort(), ["Pricing page", "Real app"], "folders with an index.html and loose pages, never dot folders");
  assert.equal((await s.findPrototypes()).added.length, 0, "looking again adds nothing twice");
  const app = added.find((e) => e.name === "Real app");
  assert.equal(app.folder, path.join(home, "app"));
  assert.ok(app.linked);
  const files = (await s.listFiles(app.id)).map((f) => f.path).sort();
  assert.deepEqual(files, ["env.json", "img/a.svg", "index.html"], "node_modules is never listed");
  assert.ok(!(await fsp.stat(path.join(home, "app", "env.json")).catch(() => null)), "Atelier's settings never land in the real folder");

  // a branch reads the real files, and merging writes them back in place
  const b = await s.branchEnv(app.id, { name: "Copy edit" });
  await s.writeFile(b.id, "index.html", HTML.replace("Go", "Start"));
  assert.match(await fsp.readFile(path.join(home, "app", "index.html"), "utf8"), />Go</, "the branch leaves the real file alone");
  await s.setStyle(b.id, ".b", { color: "red" });
  await s.mergeEnv(b.id, {});
  assert.match(await fsp.readFile(path.join(home, "app", "index.html"), "utf8"), />Start</);
  assert.ok(!(await fsp.stat(path.join(home, "app", "overrides.css")).catch(() => null)), "style overrides stay Atelier's");

  // versions restore the real files; deleting the prototype never touches the folder
  const v = (await s.listVersions(app.id)).find((x) => /^Before merging/.test(x.label));
  await s.restoreVersion(app.id, v.n);
  assert.match(await fsp.readFile(path.join(home, "app", "index.html"), "utf8"), />Go</);
  await s.deleteEnv(b.id);
  await s.deleteEnv(app.id);
  assert.ok(await fsp.stat(path.join(home, "app", "index.html")));

  // a loose page is index.html to everyone, and a copy is its own
  const page = added.find((e) => e.name === "Pricing page");
  assert.match((await s.readFile(page.id, "index.html")).toString(), /Pricing page/);
  const copy = await s.forkEnv(page.id, { name: "Pricing copy" });
  assert.equal(copy.linked, false);
  assert.match((await s.readFile(copy.id, "index.html")).toString(), /Pricing page/);

  // Guard: links stay inside the space and out of Atelier's own folder
  await assert.rejects(() => s.linkEnv("../elsewhere"), /isn't in this space/);
  await assert.rejects(() => s.linkEnv(".atelier"), /isn't in this space/);
  // and reopening the space remembers the links
  const again = await Store.open(path.join(home, ".atelier"));
  assert.equal((await again.getEnv(page.id)).folder, home);
});

test("a board's look: shared by a branch nobody changed, new when anything it shows changes", async () => {
  const s = await Store.open(await tmp());
  const a = await s.createEnv({ html: HTML });
  const main = await s.fingerprint(a.id);
  const b = await s.branchEnv(a.id, { name: "Same" });
  assert.equal(await s.fingerprint(b.id), main, "an untouched branch reuses its parent's snapshots");
  await s.updateEnv(b.id, { name: "Renamed", brief: "Notes don't change how it looks" });
  assert.equal(await s.fingerprint(b.id), main);
  await s.setStyle(b.id, ".b", { color: "red" });
  assert.notEqual(await s.fingerprint(b.id), main, "a style change is a new look");
  await s.writeFile(a.id, "index.html", HTML.replace("Go", "Start"));
  assert.notEqual(await s.fingerprint(a.id), main, "so is a file change");
  // snapshots: only SVG drawings, named by a hash
  const key = "f".repeat(40);
  await s.writeSnapshot(key, Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"></svg>'));
  assert.match(zlib.gunzipSync(await s.readSnapshot(key)).toString(), /^<svg/);
  await assert.rejects(() => s.writeSnapshot(key, Buffer.from("<script>")), /board snapshot/);
  await assert.rejects(() => s.writeSnapshot("../x", Buffer.from("<svg></svg>")), /snapshot key/);
});

test("frames: an empty page of the prototype at any size, carried by branches and merges", async () => {
  const s = await Store.open(await tmp());
  const a = await s.createEnv({ html: HTML });
  const f = await s.addFrame(a.id, { name: "Onboarding step 2", w: 390, h: 844, x: 0, y: 0 });
  assert.equal(f.file, "frames/onboarding-step-2.html");
  assert.deepEqual([f.w, f.h, f.name], [390, 844, "Onboarding step 2"]);
  assert.match((await s.readFile(a.id, f.file)).toString(), /atelier:empty-frame/);
  const g = await s.addFrame(a.id, { name: "Onboarding step 2" });
  assert.equal(g.file, "frames/onboarding-step-2-2.html", "two frames never share a page");
  // a branch gets the frame on its page, designs it, and the merge brings the page over
  const b = await s.branchEnv(a.id, { name: "Design it" });
  const bf = (await s.items()).find((i) => i.env === b.id && i.file === f.file);
  assert.equal(bf.name, "Onboarding step 2");
  await s.writeFile(b.id, f.file, "<!doctype html><title>Step 2</title><p>Designed</p>");
  await s.mergeEnv(b.id, {});
  assert.match((await s.readFile(a.id, f.file)).toString(), /Designed/);
  // Guard: a frame's page stays an .html file inside the prototype
  for (const bad of ["../x.html", "frames/.hidden.html", "frames/x.js", "/etc/passwd"]) await assert.rejects(() => s.updateItem(f.id, { file: bad }), /frame's page/);
});
