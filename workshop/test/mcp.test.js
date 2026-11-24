import { test } from "node:test";
import assert from "node:assert/strict";
import fsp from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import { Store } from "../src/store.js";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const BIN = path.join(HERE, "..", "bin", "workshop.js");
const HTML = "<!doctype html><html><head><title>Board</title></head><body><p class=\"t\">Hi</p></body></html>";

function client(workspace) {
  const p = spawn(process.execPath, [BIN, "mcp", "--workspace", workspace], { stdio: ["pipe", "pipe", "inherit"] });
  let buf = "";
  const waiting = new Map();
  p.stdout.on("data", (d) => {
    buf += d;
    let i;
    while ((i = buf.indexOf("\n")) >= 0) {
      const line = buf.slice(0, i);
      buf = buf.slice(i + 1);
      const msg = JSON.parse(line);
      waiting.get(msg.id)?.(msg);
    }
  });
  let n = 0;
  const call = (method, params) =>
    new Promise((resolve) => {
      const id = ++n;
      waiting.set(id, resolve);
      p.stdin.write(JSON.stringify({ jsonrpc: "2.0", id, method, params }) + "\n");
    });
  return { call, close: () => new Promise((r) => (p.on("close", r), p.stdin.end())) };
}

test("MCP: a harness lists, forks, styles and takes canvas requests", async () => {
  const ws = await fsp.mkdtemp(path.join(os.tmpdir(), "workshop-"));
  const store = await Store.open(ws);
  const env = await store.createEnv({ html: HTML });
  await store.setSelection({ env: env.id, selector: "p.t", label: "p.t" });
  const task = await store.addTask({ env: env.id, prompt: "Make it bigger", selection: { selector: "p.t" } });

  const c = client(ws);
  try {
    const init = await c.call("initialize", { protocolVersion: "2025-06-18", clientInfo: { name: "claude-code", version: "1" }, capabilities: {} });
    assert.equal(init.result.serverInfo.name, "atelier");
    const tools = await c.call("tools/list", {});
    assert.ok(tools.result.tools.length >= 15);
    const tx = (r) => r.result.content[0].text;

    const list = JSON.parse(tx(await c.call("tools/call", { name: "list_environments", arguments: {} })));
    assert.equal(list.environments[0].id, env.id);
    assert.match(tx(await c.call("tools/call", { name: "get_selection", arguments: {} })), /p\.t/);

    const fork = JSON.parse(tx(await c.call("tools/call", { name: "fork_environment", arguments: { env: env.id, name: "Board big" } })));
    assert.equal(fork.parent, env.id);
    await c.call("tools/call", { name: "set_style", arguments: { env: fork.id, selector: "p.t", props: { "font-size": "24px" } } });
    assert.match(await store.getOverrides(fork.id), /font-size: 24px !important/);

    const taken = JSON.parse(tx(await c.call("tools/call", { name: "take_task", arguments: {} })));
    assert.equal(taken.id, task.id);
    assert.match(taken.brief, /Make it bigger/);
    assert.match(taken.brief, /selector: p\.t/);
    await c.call("tools/call", { name: "update_task", arguments: { id: task.id, status: "done", reply: "Made the text 24px." } });
    assert.equal((await store.record("tasks", task.id)).status, "done");
    assert.equal((await store.harnesses())[0].client, "Claude Code");

    const bad = await c.call("tools/call", { name: "read_file", arguments: { env: env.id, path: "../workshop.json" } });
    assert.equal(bad.result.isError, true);
    const big = await c.call("tools/call", { name: "read_file", arguments: { env: env.id, length: 10 } });
    assert.match(tx(big), /more characters/);
  } finally {
    await c.close();
  }
  assert.equal((await store.harnesses()).length, 0, "the heartbeat goes when the harness disconnects");
});

test("MCP: list_canvas keeps each page's notes on that page", async () => {
  const { callTool } = await import("../src/mcp.js");
  const ws = await fsp.mkdtemp(path.join(os.tmpdir(), "workshop-"));
  const store = await Store.open(ws);
  const main = await store.createEnv({ html: HTML });
  const br = await store.branchEnv(main.id, { name: "Try" });
  // a branch's boards sit where main's do, on a page of their own
  await store.addItem({ type: "note", env: main.id, x: 10, y: 10, text: "On main" });
  await store.addItem({ type: "note", env: br.id, x: 10, y: 10, text: "On the branch" });
  const list = async (env) => JSON.parse((await callTool(store, "list_canvas", { env })).content[0].text);
  const onBranch = await list(br.id);
  assert.deepEqual(onBranch.notes.map((n) => n.text), ["On the branch"]);
  assert.ok(onBranch.notes[0].over.length && onBranch.notes[0].over.every((o) => o.env === br.id), "a note is over its own page's boards only");
  assert.deepEqual((await list(main.id)).notes.map((n) => n.text), ["On main"]);
});

test("MCP: agents see the marks drawn on a page", async () => {
  const { callTool } = await import("../src/mcp.js");
  const store = await Store.open(await fsp.mkdtemp(path.join(os.tmpdir(), "workshop-")));
  const env = await store.createEnv({ html: HTML });
  await store.addItem({ type: "ink", env: env.id, x: 10, y: 10, pen: "marker", color: "#e03131", points: [[0, 0], [50, 50]] });
  const out = JSON.parse((await callTool(store, "list_canvas", { env: env.id })).content[0].text);
  assert.equal(out.drawings.length, 1);
  assert.equal(out.drawings[0].pen, "marker");
  assert.ok(out.drawings[0].over.length, "it says which screen the mark is on");
});

test("MCP: recipes run on a branch, and the brief carries the prototype's brief and decisions", async () => {
  const ws = await fsp.mkdtemp(path.join(os.tmpdir(), "workshop-"));
  const store = await Store.open(ws);
  const env = await store.createEnv({ html: HTML });
  await store.updateEnv(env.id, { brief: "Never touch the header." });
  const b = await store.branchEnv(env.id, { name: "Tone" });
  await store.setStyle(b.id, ".t", { color: "red" });
  await store.mergeEnv(b.id, { note: "Warmer headline" });
  const c = client(ws);
  await c.call("initialize", { protocolVersion: "2025-06-18", capabilities: {} });
  const tool = async (name, args) => (await c.call("tools/call", { name, arguments: args })).result.content[0].text;
  const recipes = JSON.parse(await tool("list_recipes", {}));
  const audit = recipes.find((r) => r.name === "State audit");
  assert.equal(audit.production, 1);
  const run = JSON.parse(await tool("run_recipe", { recipe: audit.id, env: env.id }));
  assert.notEqual(run.env, env.id, "a run from main gets its own branch");
  const taken = JSON.parse(await tool("take_task", { id: run.task }));
  assert.match(taken.brief, /Never touch the header/);
  assert.match(taken.brief, /Warmer headline/);
  assert.match(taken.brief, /Recipe: State audit \(version 1\)/);
  assert.match(taken.brief, /empty \(saying what to do next\)/, "the recipe's own instructions are in the brief");
  const info = JSON.parse(await tool("get_environment", { env: run.env }));
  assert.equal(info.brief, "Never touch the header.");
  await c.close();
});

// An agent reads one frame as HTML instead of working through the whole prototype: a drawn frame is
// its file, and a screen is what the canvas drew of it (found by the same key the canvas saves it
// under), as markup without styles, icon paths, pictures or the husks of what the screen hides.
test("MCP: read_frame gives an agent a frame as HTML", async () => {
  const { callTool } = await import("../src/mcp.js");
  const { drawKey } = await import("../ui/drawkey.js");
  const crypto = await import("node:crypto");
  const store = await Store.open(await fsp.mkdtemp(path.join(os.tmpdir(), "workshop-")));
  const env = await store.createEnv({ html: HTML });
  const read = async (args) => (await callTool(store, "read_frame", args)).content[0].text;
  const canvas = JSON.parse((await callTool(store, "list_canvas", { env: env.id })).content[0].text);
  const board = canvas.boards[0];
  assert.equal(board.html, "read_frame", "list_canvas says how to read each board");
  // not drawn yet: it says so, and what to do instead
  assert.match(await read({ board: board.id }), /"html": null[\s\S]*hasn't drawn this screen/);
  // the canvas draws it (the browser saves the drawing under this key)
  const it = (await store.items()).find((i) => i.id === board.id);
  const key = crypto.createHash("sha1").update(drawKey(await store.fingerprint(env.id), it)).digest("hex");
  const pic = "data:image/png;base64," + "A".repeat(4000);
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="10" height="10"><foreignObject width="10" height="10"><html xmlns="http://www.w3.org/1999/xhtml"><head><style>p{color:red}</style></head><body><!-- note --><p class="t">Hi</p><img src="${pic}" /><svg class="ic" viewBox="0 0 16 16"><path d="M1 1L15 15"/></svg><div data-wsp="" style="display:none!important"><span data-wsp="" style="display:none!important"></span></div></body></html></foreignObject></svg>`;
  await store.writeSnapshot(key, Buffer.from(svg));
  const out = await read({ board: board.id });
  assert.match(out, /<p class="t">Hi<\/p>/, "the screen's elements");
  assert.match(out, /<svg class="ic" viewBox="0 0 16 16"><\/svg>/, "icons keep their tag, not their paths");
  assert.match(out, /data:,picture-4kb/, "pictures are a short placeholder");
  assert.ok(!/<style|<!--|data-wsp|A{200}/.test(out), "no styles, comments, hidden husks or picture bytes");
  assert.match(await read({ board: board.id, css: true }), /<style>p\{color:red\}<\/style>/, "css on request");
  // a drawn frame is its own file
  const f = await store.addFrame(env.id, { name: "Step 2", w: 390, h: 844 });
  await store.writeFile(env.id, f.file, "<!doctype html><main>Step two</main>");
  assert.match(await read({ board: f.id }), /"source":"file"[\s\S]*<main>Step two<\/main>/);
  await assert.rejects(callTool(store, "read_frame", { board: "b-nope" }), /No frame b-nope/);
});

// A screen whose look has just changed (an edit, a new branch with a change) has no drawing of the
// new look until the canvas draws it. An agent asking then gets the last drawing of that screen —
// its own, or the one for the page it branched from — and is told it's older.
test("MCP: read_frame falls back to the last drawing of a screen, and says so", async () => {
  const { callTool } = await import("../src/mcp.js");
  const { drawKey } = await import("../ui/drawkey.js");
  const crypto = await import("node:crypto");
  const store = await Store.open(await fsp.mkdtemp(path.join(os.tmpdir(), "workshop-")));
  const main = await store.createEnv({ html: HTML });
  const board = (await store.items()).find((i) => i.type === "board" && i.env === main.id);
  const what = drawKey(await store.fingerprint(main.id), board);
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="10" height="10"><foreignObject width="10" height="10"><html xmlns="http://www.w3.org/1999/xhtml"><body><p class="t">Hi</p></body></html></foreignObject></svg>`;
  await store.writeSnapshot(crypto.createHash("sha1").update(what).digest("hex"), Buffer.from(svg), what);
  const read = async (id) => (await callTool(store, "read_frame", { board: id })).content[0].text;
  assert.ok(!/"note"/.test(await read(board.id)), "the current look: no caveat");
  // the look changes; nothing has drawn the new one yet
  await store.setStyle(main.id, ".t", { color: "red" });
  const after = await read(board.id);
  assert.match(after, /"note":"Drawn before the latest change to this page/);
  assert.match(after, /<p class="t">Hi<\/p>/);
  // a branch that then changes: its screen falls back to what was drawn for the page it came from
  const br = await store.branchEnv(main.id, { name: "Try" });
  await store.setStyle(br.id, ".t", { color: "blue" });
  const bb = (await store.items()).find((i) => i.type === "board" && i.env === br.id);
  const onBranch = await read(bb.id);
  assert.match(onBranch, new RegExp(`"note":"Drawn for ${main.id}, which this page branched from`));
  assert.match(onBranch, /<p class="t">Hi<\/p>/);
});
