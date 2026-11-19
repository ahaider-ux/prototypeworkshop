import { test } from "node:test";
import assert from "node:assert/strict";
import fsp from "node:fs/promises";
import os from "node:os";
import path from "node:path";
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
  const ws = await s.workspace();
  assert.ok(ws.canvas.boards[b.id].x > ws.canvas.boards[a.id].x, "the fork sits to the right of its parent");
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
  await s.moveBoard(a.id, 400, 300);
  const { trash } = await s.deleteEnv(a.id);
  assert.equal((await s.listEnvs()).length, 0);
  const back = await s.restoreEnv(trash);
  assert.equal(back.id, a.id);
  assert.deepEqual((await s.workspace()).canvas.boards[a.id], { x: 400, y: 300 });
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
  await assert.rejects(() => s.moveBoard(a.id, NaN, 0), /off the canvas/);
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
