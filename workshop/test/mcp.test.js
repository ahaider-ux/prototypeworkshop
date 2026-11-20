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
    assert.equal(init.result.serverInfo.name, "libra-workshop");
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
