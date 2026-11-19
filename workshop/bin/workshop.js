#!/usr/bin/env node
// workshop — the command line for Libra Workshop.
//   workshop serve                       open the canvas at http://127.0.0.1:4600
//   workshop mcp                         MCP server on stdio, for Claude Code or your own harness
//   workshop list | import | fork | version | restore | screenshot | tasks | selection | agent
// Every command takes --workspace <dir> (default: ./workspace next to this app, or $WORKSHOP_DIR).

import path from "node:path";
import fsp from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { Store, StoreError } from "../src/store.js";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const argv = process.argv.slice(2);
const flags = {};
const args = [];
for (let i = 0; i < argv.length; i++) {
  const a = argv[i];
  if (a.startsWith("--")) {
    const [k, v] = a.slice(2).split("=");
    if (v !== undefined) flags[k] = v;
    else if (argv[i + 1] && !argv[i + 1].startsWith("--")) flags[k] = argv[++i];
    else flags[k] = true;
  } else args.push(a);
}
const cmd = args.shift() || "help";
const workspace = path.resolve(flags.workspace || process.env.WORKSHOP_DIR || path.join(HERE, "..", "workspace"));

const HELP = `Libra Workshop

  workshop serve [--port 4600] [--no-agent]     Open the canvas in your browser at http://127.0.0.1:<port>
  workshop mcp                                   MCP server on stdio (add it to Claude Code: see README)
  workshop list                                  Environments in the workspace
  workshop import <file.html | folder> [--name]  Add a prototype
  workshop fork <env> [--name] [--version N]     Copy an environment
  workshop version <env> [--label]               Save a version
  workshop restore <env> <N>                     Restore a version (the current state is saved first)
  workshop screenshot <env> [--out file.png]     Render a board to PNG (needs Playwright)
  workshop tasks                                 Requests made on the canvas
  workshop selection                             What is selected on the canvas
  workshop agent <command…> | --off              Run canvas requests with a local agent, e.g.
                                                 workshop agent claude -p {prompt} --permission-mode acceptEdits

  --workspace <dir>  defaults to ${path.relative(process.cwd(), path.join(HERE, "..", "workspace")) || "."} (or $WORKSHOP_DIR)`;

const out = (x) => process.stdout.write((typeof x === "string" ? x : JSON.stringify(x, null, 2)) + "\n");

async function main() {
  if (cmd === "help" || flags.help) return out(HELP);
  if (cmd === "mcp") {
    const { runMcp } = await import("../src/mcp.js");
    return runMcp({ workspace });
  }
  if (cmd === "serve") {
    const { startServer } = await import("../src/server.js");
    const port = flags.port === undefined ? 4600 : Number(flags.port);
    const srv = await startServer({ workspace, port, agent: !flags["no-agent"] });
    out(`Libra Workshop is running at ${srv.url}\nWorkspace: ${workspace}\nPress Ctrl+C to stop.`);
    const stop = async () => {
      await srv.close();
      process.exit(0);
    };
    process.on("SIGINT", stop);
    process.on("SIGTERM", stop);
    return;
  }
  const store = await Store.open(workspace);
  switch (cmd) {
    case "list": {
      const envs = await store.listEnvs();
      if (!envs.length) return out("No environments yet. Add one with: workshop import <file.html>");
      for (const e of envs) out(`${e.id.padEnd(28)} ${e.name}${e.parent ? `  (fork of ${e.parent})` : ""}  · ${e.device.w}×${e.device.h} · ${e.theme} · ${e.versions} versions`);
      return;
    }
    case "import": {
      if (!args[0]) throw new StoreError("usage", "Usage: workshop import <file.html | folder> [--name <name>]");
      const e = await store.importPath(args[0], { name: flags.name, author: "CLI" });
      return out(`Added ${e.name} as ${e.id}`);
    }
    case "fork": {
      if (!args[0]) throw new StoreError("usage", "Usage: workshop fork <env> [--name <name>] [--version N]");
      const e = await store.forkEnv(args[0], { name: flags.name, version: flags.version ? Number(flags.version) : null, author: "CLI" });
      return out(`Forked ${args[0]} into ${e.id}`);
    }
    case "version": {
      if (!args[0]) throw new StoreError("usage", "Usage: workshop version <env> [--label <label>]");
      const v = await store.saveVersion(args[0], { label: flags.label, author: "CLI" });
      return out(`Saved version ${v.n} of ${args[0]}`);
    }
    case "restore": {
      if (!args[0] || !args[1]) throw new StoreError("usage", "Usage: workshop restore <env> <version>");
      const r = await store.restoreVersion(args[0], Number(args[1]), { author: "CLI" });
      return out(`Restored ${args[0]} to version ${args[1]} (saved the previous state as version ${r.before.n})`);
    }
    case "screenshot": {
      if (!args[0]) throw new StoreError("usage", "Usage: workshop screenshot <env> [--out file.png]");
      const { callTool } = await import("../src/mcp.js");
      const r = await callTool(store, "screenshot", { env: args[0], width: flags.width ? Number(flags.width) : undefined, height: flags.height ? Number(flags.height) : undefined });
      const img = r.content.find((c) => c.type === "image");
      const file = path.resolve(flags.out || `${args[0]}.png`);
      await fsp.writeFile(file, Buffer.from(img.data, "base64"));
      const { closeBrowser } = await import("../src/screenshot.js");
      await closeBrowser();
      return out(`Saved ${file}`);
    }
    case "tasks": {
      const list = await store.records("tasks");
      if (!list.length) return out("No requests yet.");
      for (const t of list) out(`${t.id}  ${t.status.padEnd(9)} ${t.env.padEnd(24)} ${t.prompt.slice(0, 80)}`);
      return;
    }
    case "selection":
      return out((await store.selection()) || "Nothing is selected on the canvas.");
    case "agent": {
      if (flags.off) {
        await store.updateWorkspace({ agent: null });
        return out("Canvas requests now wait for a harness (take_task over MCP).");
      }
      const command = argv.slice(argv.indexOf("agent") + 1).filter((a, i, all) => !(a === "--workspace" || all[i - 1] === "--workspace" || a.startsWith("--workspace=")));
      if (!command.length) {
        const ws = await store.workspace();
        return out(ws.agent ? `Canvas requests run with: ${ws.agent.command.join(" ")}` : "No agent set. Requests wait for a harness. Set one with: workshop agent claude -p {prompt} --permission-mode acceptEdits");
      }
      await store.updateWorkspace({ agent: { name: /claude/.test(command[0]) ? "Claude Code" : path.basename(command[0]), command } });
      return out(`Canvas requests will run with: ${command.join(" ")}`);
    }
    default:
      out(HELP);
      process.exitCode = 1;
  }
}

main().catch((e) => {
  process.stderr.write((e instanceof StoreError ? e.message : e.stack || String(e)) + "\n");
  process.exitCode = 1;
});
