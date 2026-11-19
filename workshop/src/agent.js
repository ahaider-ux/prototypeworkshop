// Runs canvas requests through a coding agent on this computer.
//
// workshop.json can name a command, for example Claude Code in headless mode:
//   "agent": { "name": "Claude Code", "command": ["claude", "-p", "{prompt}", "--permission-mode", "acceptEdits"] }
// Each request runs in the environment's folder, one at a time. A version is saved first,
// so any agent change can be rolled back from the canvas. Without a command, requests wait
// for a harness that takes them over MCP (take_task).

import { spawn } from "node:child_process";
import fsp from "node:fs/promises";
import path from "node:path";

const TIMEOUT_MS = 20 * 60 * 1000; // Guard: an agent that hangs is stopped after 20 minutes
const FLUSH_MS = 400;

export function taskPrompt(task, env, dir) {
  const sel = task.selection;
  const lines = [
    `You are editing an HTML prototype in Libra Workshop: "${env.name}".`,
    `Folder: ${dir}`,
    `Entry file: ${path.join(dir, "index.html")}`,
    "",
    `Request from the designer: ${task.prompt}`,
  ];
  if (sel && sel.selector) {
    lines.push("", "They selected this element on the canvas:", `- selector: ${sel.selector}`);
    if (sel.label) lines.push(`- element: ${sel.label}`);
    if (sel.text) lines.push(`- text: ${sel.text.slice(0, 300)}`);
    if (sel.html) lines.push("- html:", sel.html.slice(0, 2000));
  }
  lines.push(
    "",
    "How to work:",
    "- Change files in this folder only.",
    "- For visual tweaks, add rules to overrides.css (it loads after the prototype's styles). For structure or behaviour, edit index.html.",
    "- Keep to the design system already in the file: reuse its CSS variables (for Libra: --text-primary, --text-secondary, --bg-base, --bg-input, --bg-hover, --border-subtle, --text-accent; radii 4/6/8/12/16; spacing 2/4/6/8/12/16/24/32/40).",
    "- Never remove the prototype's existing features.",
    "- Finish with one or two plain sentences saying what you changed.",
  );
  return lines.join("\n");
}

async function snapshot(dir) {
  const out = new Map();
  const walk = async (d) => {
    for (const e of await fsp.readdir(d, { withFileTypes: true }).catch(() => [])) {
      const p = path.join(d, e.name);
      if (e.isDirectory()) await walk(p);
      else if (e.isFile()) {
        const st = await fsp.stat(p).catch(() => null);
        if (st) out.set(path.relative(dir, p).split(path.sep).join("/"), `${st.size}:${st.mtimeMs}`);
      }
    }
  };
  await walk(dir);
  return out;
}

export class AgentRunner {
  constructor(store, emit) {
    this.store = store;
    this.emit = emit;
    this.current = null;
    this.child = null;
  }

  kick() {
    if (this.current) return;
    this.next().catch(() => {
      this.current = null;
    });
  }

  cancel(id) {
    if (this.current === id && this.child) {
      try {
        this.child.kill("SIGTERM");
      } catch {}
    }
  }

  async next() {
    const ws = await this.store.workspace();
    if (!ws.agent || !Array.isArray(ws.agent.command) || !ws.agent.command.length) return;
    const tasks = await this.store.records("tasks");
    const task = tasks.find((t) => t.status === "queued" && t.runner === "auto");
    if (!task) return;
    this.current = task.id;
    try {
      await this.run(task, ws.agent);
    } finally {
      this.current = null;
      this.child = null;
      setTimeout(() => this.kick(), 50);
    }
  }

  async run(task, agent) {
    const s = this.store;
    let env;
    try {
      env = await s.getEnv(task.env);
    } catch {
      await s.updateTask(task.id, { status: "failed", log: "That environment no longer exists", logKind: "err" });
      this.emit({ kind: "tasks" });
      return;
    }
    const dir = s.envDir(task.env);
    if (env.base) await s.checkout(task.env); // the agent edits real files in this folder
    const before = await s.saveVersion(task.env, { label: `Before agent: ${task.prompt.slice(0, 60)}`, author: agent.name, kind: "auto" });
    await s.updateTask(task.id, { status: "working", claimedBy: agent.name, beforeVersion: before.n, log: `${agent.name} started. Saved version ${before.n} first.`, logKind: "note" });
    this.emit({ kind: "tasks" });
    const files0 = await snapshot(dir);
    const prompt = taskPrompt(task, env, dir);
    const fill = (a) => a.replace(/\{prompt\}/g, prompt).replace(/\{request\}/g, task.prompt).replace(/\{env\}/g, task.env).replace(/\{dir\}/g, dir).replace(/\{file\}/g, path.join(dir, "index.html"));
    const args = agent.command.map(fill);
    const viaStdin = !agent.command.some((a) => /\{prompt\}|\{request\}/.test(a));
    let out = "";
    let buf = "";
    let bufKind = "out";
    let timer = null;
    const flush = async () => {
      timer = null;
      if (!buf) return;
      const text = buf;
      buf = "";
      await s.updateTask(task.id, { log: text, logKind: bufKind }).catch(() => {});
      this.emit({ kind: "tasks" });
    };
    const push = (kind, chunk) => {
      const t = chunk.toString("utf8");
      if (kind === "out") out = (out + t).slice(-20000);
      if (bufKind !== kind && buf) flush();
      bufKind = kind;
      buf += t;
      if (!timer) timer = setTimeout(flush, FLUSH_MS);
    };
    const code = await new Promise((resolve) => {
      let child;
      try {
        child = spawn(args[0], args.slice(1), { cwd: dir, env: { ...process.env, WORKSHOP_ENV: task.env, WORKSHOP_DIR: dir, WORKSHOP_TASK: task.id }, stdio: [viaStdin ? "pipe" : "ignore", "pipe", "pipe"] });
      } catch (e) {
        push("err", `Couldn't start ${args[0]}: ${e.message}\n`);
        return resolve(-1);
      }
      this.child = child;
      const kill = setTimeout(() => {
        push("err", "Stopped after 20 minutes.\n");
        try {
          child.kill("SIGTERM");
        } catch {}
      }, TIMEOUT_MS);
      if (viaStdin) {
        child.stdin.on("error", () => {});
        child.stdin.end(prompt);
      }
      child.stdout.on("data", (d) => push("out", d));
      child.stderr.on("data", (d) => push("err", d));
      child.on("error", (e) => {
        push("err", `Couldn't start ${args[0]}: ${e.message}\n`);
      });
      child.on("close", (c, sig) => {
        clearTimeout(kill);
        resolve(sig ? -2 : c);
      });
    });
    if (timer) clearTimeout(timer);
    await flush();
    const files1 = await snapshot(dir);
    const changed = [];
    for (const [k, v] of files1) if (files0.get(k) !== v) changed.push(k);
    for (const k of files0.keys()) if (!files1.has(k)) changed.push(k);
    const latest = await s.record("tasks", task.id);
    if (latest.status === "cancelled") {
      await s.updateTask(task.id, { changed });
    } else {
      const reply = out.trim().split(/\n{2,}/).slice(-1)[0]?.slice(0, 2000) || (code === 0 ? "Done." : "");
      await s.updateTask(task.id, { status: code === 0 ? "done" : "failed", reply: code === 0 ? reply : `The agent stopped with an error (exit ${code}).`, changed });
    }
    this.emit({ kind: "tasks" });
    this.emit({ kind: "env", id: task.env, files: changed });
  }
}
