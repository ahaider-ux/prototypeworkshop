// MCP server over stdio (newline-delimited JSON-RPC 2.0), so any coding harness — Claude Code,
// your own agent loop — can work on the same workspace the canvas shows. It reads and writes the
// workspace on disk directly; a running canvas picks every change up through its file watcher.

import fsp from "node:fs/promises";
import path from "node:path";
import readline from "node:readline";
import { Store, StoreError } from "./store.js";
import { taskPrompt } from "./agent.js";
import { screenshot, screenshotAvailable, closeBrowser } from "./screenshot.js";

const VERSION = "0.1.0";
const READ_CAP = 120_000; // Guard: a 5 MB prototype read whole would flood the harness's context

const S = (properties, required = []) => ({ type: "object", properties, required, additionalProperties: false });
const str = (description) => ({ type: "string", description });
const num = (description) => ({ type: "number", description });
const ENV = str("Environment id, as list_environments shows it");

export const TOOLS = [
  { name: "list_environments", description: "Lists the prototypes (environments) in the workspace with their folder, lineage, device, theme, opening screen and how many versions and design overrides each has. Start here.", inputSchema: S({}) },
  { name: "get_environment", description: "Everything about one environment: settings, files, its overrides.css, versions and open comments.", inputSchema: S({ env: ENV }, ["env"]) },
  { name: "get_selection", description: "What the designer has selected on the canvas right now: environment, CSS selector, element HTML, text and computed styles. Use it when they say 'this' or 'here'.", inputSchema: S({}) },
  { name: "read_file", description: "Reads a text file from an environment (default index.html). Large files come back in slices: pass offset and length (characters) to page through.", inputSchema: S({ env: ENV, path: str("Path inside the environment folder, e.g. index.html"), offset: num("Character offset, default 0"), length: num(`Characters to read, default ${READ_CAP}`) }, ["env"]) },
  { name: "write_file", description: "Writes a whole text file in an environment. The canvas reloads that board. Save a version first for big changes.", inputSchema: S({ env: ENV, path: str("Path inside the environment folder"), content: str("The complete new file contents") }, ["env", "path", "content"]) },
  { name: "create_environment", description: "Creates a new environment from a complete HTML document. Returns its id.", inputSchema: S({ name: str("Name shown on the canvas"), html: str("A complete HTML document"), description: str("One line about it") }, ["name", "html"]) },
  { name: "create_branch", description: "Creates a branch of an environment: a new section on the canvas with the same screens, reading the parent's files until it changes them. Try changes there, then the designer reviews and merges. Returns the branch id.", inputSchema: S({ env: ENV, name: str("Branch name, e.g. 'Denser sidebar'") }, ["env"]) },
  { name: "checkout_branch", description: "Copies every file a branch still reads from its parent into the branch's own folder, so you can edit them there directly (take_task does this for you).", inputSchema: S({ env: ENV }, ["env"]) },
  { name: "review_branch", description: "Lists what a branch changed compared with its parent (settings, styles, files) and which changes conflict with changes made on the parent since.", inputSchema: S({ env: ENV }, ["env"]) },
  { name: "merge_branch", description: "Merges a branch into its parent and archives it. Conflicts go to the branch unless listed in keep_main. The parent's state is saved as a version first.", inputSchema: S({ env: ENV, keep_main: { type: "array", items: { type: "string" }, description: "Change keys (from review_branch) where the parent's value should win" } }, ["env"]) },
  { name: "fork_environment", description: "Makes an independent copy of an environment (optionally from a saved version) — no link back to merge. Prefer create_branch for trying changes.", inputSchema: S({ env: ENV, name: str("Name for the copy"), version: num("Version number to copy from (optional)") }, ["env"]) },
  { name: "list_canvas", description: "What is on the canvas: boards (an environment at a screen and state), and the designer's annotations — notes, boxes, arrows and hand-drawn marks — on each environment's page, with the boards each one sits over. Read the annotations as feedback.", inputSchema: S({ env: str("Only boards and annotations for this environment") }) },
  { name: "place_screen", description: "Puts a board for one of an environment's screens on the canvas (screens are listed by get_environment under catalog).", inputSchema: S({ env: ENV, screen: str("Screen name, e.g. Chat"), state: str("Screen state, e.g. Empty (optional)") }, ["env", "screen"]) },
  { name: "add_note", description: "Pins a note on the canvas next to an environment's boards, e.g. to explain a change or ask a question.", inputSchema: S({ env: ENV, text: str("The note"), tone: { type: "string", enum: ["warm", "info", "plain"] } }, ["env", "text"]) },
  { name: "update_environment", description: "Changes an environment's settings: name, description, theme (light/dark/system), opening screen, screen state, board size, or variants (an object of variant label → option).", inputSchema: S({ env: ENV, name: str("New name"), description: str("New description"), theme: { type: "string", enum: ["light", "dark", "system"] }, screen: str("Screen to open on, e.g. Chat"), state: str("Screen state, e.g. Empty"), width: num("Board width in px"), height: num("Board height in px"), variants: { type: "object", additionalProperties: { type: "string" } } }, ["env"]) },
  { name: "set_style", description: "Sets CSS properties for a selector in the environment's overrides.css (rules there win over the prototype's styles). Pass null or '' to remove a property. Prefer the prototype's CSS variables, e.g. var(--text-secondary).", inputSchema: S({ env: ENV, selector: str("CSS selector, e.g. from get_selection"), props: { type: "object", description: "CSS property → value", additionalProperties: { type: ["string", "null"] } } }, ["env", "selector", "props"]) },
  { name: "set_text", description: "Replaces the text of the element(s) a selector matches, applied every time the prototype loads. Pass null to remove the edit.", inputSchema: S({ env: ENV, selector: str("CSS selector"), text: { type: ["string", "null"] } }, ["env", "selector", "text"]) },
  { name: "save_version", description: "Saves a snapshot of an environment's folder that the designer can restore from the canvas.", inputSchema: S({ env: ENV, label: str("What this version is") }, ["env"]) },
  { name: "list_versions", description: "Lists an environment's saved versions, newest first.", inputSchema: S({ env: ENV }, ["env"]) },
  { name: "restore_version", description: "Restores an environment to a saved version (the current state is saved as a version first).", inputSchema: S({ env: ENV, version: num("Version number") }, ["env", "version"]) },
  { name: "screenshot", description: "Renders an environment in a browser and returns a PNG, so you can check your change. Needs Playwright on this computer.", inputSchema: S({ env: ENV, width: num("Viewport width, default the board width"), height: num("Viewport height, default the board height") }, ["env"]) },
  { name: "list_tasks", description: "Lists design requests made on the canvas (status queued, working, done, failed or cancelled).", inputSchema: S({ status: str("Only tasks with this status") }) },
  { name: "take_task", description: "Takes the oldest queued canvas request (or the one with this id), marks it working, saves a version, and returns the full brief: the request, the selected element and how to work. Call update_task when you finish.", inputSchema: S({ id: str("Task id (optional)") }) },
  { name: "update_task", description: "Reports progress on a task: add a log line, set status done or failed, and give the designer a short reply.", inputSchema: S({ id: str("Task id"), status: { type: "string", enum: ["working", "done", "failed"] }, log: str("A progress line to show"), reply: str("One or two sentences for the designer") }, ["id"]) },
  { name: "list_comments", description: "Lists comments pinned on the canvas, with replies. Open ones only unless all is true.", inputSchema: S({ env: str("Only this environment"), all: { type: "boolean" } }) },
  { name: "reply_comment", description: "Replies to a canvas comment.", inputSchema: S({ id: str("Comment id"), text: str("Reply text") }, ["id", "text"]) },
  { name: "resolve_comment", description: "Marks a canvas comment as resolved.", inputSchema: S({ id: str("Comment id") }, ["id"]) },
];

const INSTRUCTIONS = `Atelier holds HTML prototypes ("environments") that a designer arranges on a canvas as boards, one per screen.
Each environment is a folder with index.html; you can edit those files directly or through these tools, and the canvas reloads live.
- list_environments shows ids, folders and branches. get_selection tells you what the designer is pointing at.
- Each branch is a page of its own on the canvas, laid out like its parent. list_canvas shows the designer's notes, boxes, arrows and hand-drawn marks on each page: treat them as feedback on the boards they sit over (screenshot a board to see what a mark circles or crosses out).
- Requests typed on the canvas wait as tasks: take_task, do the work, then update_task with status done and a short reply.
- Try changes on a branch (create_branch); the designer reviews and merges it. A branch reads its parent's files until checkout_branch copies them.
- Visual tweaks belong in overrides.css (set_style); structure and behaviour in index.html. save_version before big edits.`;

function text(t) {
  return { content: [{ type: "text", text: typeof t === "string" ? t : JSON.stringify(t, null, 2) }] };
}

async function serverUrl(store) {
  try {
    const s = JSON.parse(await fsp.readFile(path.join(store.metaDir, "server.json"), "utf8"));
    const url = `http://127.0.0.1:${s.port}`;
    const r = await fetch(`${url}/api/workspace`, { signal: AbortSignal.timeout(1500) });
    if (r.ok) return { url, close: async () => {} };
  } catch {}
  const { startServer } = await import("./server.js");
  const srv = await startServer({ workspace: store.root, port: 0, quiet: true, agent: false });
  return { url: srv.url, close: srv.close };
}

export async function callTool(store, name, a = {}, ctx = {}) {
  const who = ctx.client || "Harness";
  switch (name) {
    case "list_environments": {
      const ws = await store.workspace();
      const envs = await store.listEnvs();
      return text({
        workspace: ws.name,
        root: store.root,
        environments: envs.map((e) => ({ id: e.id, name: e.name, folder: store.envDir(e.id), parent: e.parent, branch: !!e.branch, readsFilesFrom: e.base || null, archived: e.archived, device: e.device, theme: e.theme, screen: e.screen, versions: e.versions, overrides: e.overrides, updatedAt: e.updatedAt })),
      });
    }
    case "get_environment": {
      const env = await store.getEnv(a.env);
      const [files, css, versions, comments] = await Promise.all([store.listFiles(a.env), store.getOverrides(a.env), store.listVersions(a.env), store.records("comments")]);
      return text({ ...env, folder: store.envDir(a.env), files, overridesCss: css, versions: versions.slice(0, 20), comments: comments.filter((c) => c.env === a.env && !c.resolved) });
    }
    case "get_selection": {
      const s = await store.selection();
      return text(s && s.env ? s : "Nothing is selected on the canvas.");
    }
    case "read_file": {
      const buf = await store.readFile(a.env, a.path || "index.html");
      const all = buf.toString("utf8");
      const off = Math.max(0, Math.floor(Number(a.offset) || 0));
      const len = Math.max(1, Math.min(READ_CAP, Math.floor(Number(a.length) || READ_CAP)));
      const part = all.slice(off, off + len);
      const more = off + len < all.length ? `\n\n[… ${all.length - off - len} more characters. Call read_file with offset ${off + len} to continue.]` : "";
      return text(part + more);
    }
    case "write_file":
      return text(await store.writeFile(a.env, a.path, a.content ?? ""));
    case "create_environment": {
      const e = await store.createEnv({ name: a.name, html: a.html, description: a.description || "", author: who, source: { kind: "agent", by: who } });
      return text({ id: e.id, name: e.name, folder: store.envDir(e.id) });
    }
    case "create_branch": {
      const e = await store.branchEnv(a.env, { name: a.name, author: who });
      return text({ id: e.id, name: e.name, folder: store.envDir(e.id), parent: e.parent, note: "The branch reads its parent's files until you edit one or call checkout_branch." });
    }
    case "checkout_branch":
      return text(await store.checkout(a.env));
    case "review_branch":
      return text(await store.diffEnv(a.env));
    case "merge_branch": {
      const take = {};
      for (const k of Array.isArray(a.keep_main) ? a.keep_main : []) take[String(k)] = "main";
      const r = await store.mergeEnv(a.env, { take, author: who });
      return text({ mergedInto: r.parent.id, applied: r.applied, savedBeforeAs: r.before.n, savedAfterAs: r.after.n });
    }
    case "list_canvas": {
      const items = await store.items();
      const boards = items.filter((i) => i.type === "board");
      // Each page (a prototype's main or a branch) is its own canvas, and a branch's boards sit where
      // its parent's do: an annotation is only over the boards of its own page. Older annotations
      // without a page go with whatever they overlap.
      const over = (r) => boards.filter((b) => (!r.env || b.env === r.env) && r.x < b.x + b.w && r.x + (r.w || 1) > b.x && r.y < b.y + b.h && r.y + (r.h || 1) > b.y).map((b) => ({ board: b.id, env: b.env, screen: b.screen }));
      const out = {
        boards: boards.filter((b) => !a.env || b.env === a.env).map((b) => ({ id: b.id, env: b.env, screen: b.screen || "start screen", state: b.state || "Default", x: b.x, y: b.y, w: b.w, h: b.h })),
        notes: items.filter((i) => i.type === "note").map((n) => ({ id: n.id, page: n.env || null, text: n.text, author: n.author, over: over({ ...n, h: 120 }) })),
        boxes: items.filter((i) => i.type === "box").map((x) => ({ id: x.id, page: x.env || null, label: x.label, author: x.author, over: over(x) })),
        arrows: items.filter((i) => i.type === "arrow").map((r) => ({ id: r.id, page: r.env || null, label: r.label, from: r.from, to: r.to })),
        // hand-drawn marks: circles, underlines, crossings-out — look at the screen under them (screenshot)
        drawings: items.filter((i) => i.type === "ink").map((k) => ({ id: k.id, page: k.env || null, pen: k.pen, color: k.color, author: k.author, x: k.x, y: k.y, w: k.w, h: k.h, board: k.board || null, over: over(k) })),
      };
      if (a.env) {
        const mine = (n) => (n.page ? n.page === a.env : n.over.some((o) => o.env === a.env));
        out.notes = out.notes.filter(mine);
        out.boxes = out.boxes.filter(mine);
        out.arrows = out.arrows.filter((r) => r.page === a.env);
        out.drawings = out.drawings.filter(mine);
      }
      return text(out);
    }
    case "place_screen": {
      const b = await store.addBoard(a.env, { screen: String(a.screen), state: a.state ? String(a.state) : null, author: who });
      return text({ board: b.id, x: b.x, y: b.y });
    }
    case "add_note": {
      const bounds = await store.boundsOf(a.env);
      const n = await store.addItem({ type: "note", env: a.env, text: a.text, tone: a.tone || "info", x: bounds ? bounds.x1 + 80 : 0, y: bounds ? bounds.y0 : 0 }, who);
      return text({ note: n.id });
    }
    case "fork_environment": {
      const e = await store.forkEnv(a.env, { name: a.name, version: a.version ?? null, author: who });
      return text({ id: e.id, name: e.name, folder: store.envDir(e.id), parent: e.parent });
    }
    case "update_environment": {
      const patch = {};
      for (const k of ["name", "description", "theme", "screen", "state", "variants"]) if (a[k] !== undefined) patch[k] = a[k];
      if (a.width || a.height) {
        const cur = await store.getEnv(a.env);
        patch.device = { w: a.width || cur.device.w, h: a.height || cur.device.h };
      }
      return text(await store.updateEnv(a.env, patch));
    }
    case "set_style": {
      const r = await store.setStyle(a.env, a.selector, a.props || {});
      return text({ rules: r.rules.length, css: r.css.slice(-4000) });
    }
    case "set_text":
      return text({ patches: await store.setText(a.env, a.selector, a.text ?? null) });
    case "save_version":
      return text(await store.saveVersion(a.env, { label: a.label, author: who }));
    case "list_versions":
      return text(await store.listVersions(a.env));
    case "restore_version": {
      const r = await store.restoreVersion(a.env, Number(a.version), { author: who });
      return text({ restored: Number(a.version), savedCurrentAs: r.before.n });
    }
    case "screenshot": {
      if (!(await screenshotAvailable())) throw new StoreError("no_playwright", "Screenshots need Playwright on this computer: npm i -g playwright && npx playwright install chromium");
      const env = await store.getEnv(a.env);
      const srv = await serverUrl(store);
      try {
        const png = await screenshot(`${srv.url}/env/${env.id}/`, { width: a.width || env.device.w, height: a.height || env.device.h });
        return { content: [{ type: "image", data: png.toString("base64"), mimeType: "image/png" }, { type: "text", text: `${env.name} at ${a.width || env.device.w}×${a.height || env.device.h}` }] };
      } finally {
        await srv.close();
      }
    }
    case "list_tasks": {
      const all = await store.records("tasks");
      return text(all.filter((t) => !a.status || t.status === a.status).map((t) => ({ id: t.id, env: t.env, status: t.status, prompt: t.prompt, selector: t.selection?.selector || null, createdAt: t.createdAt, reply: t.reply })));
    }
    case "take_task": {
      const all = await store.records("tasks");
      const t = a.id ? all.find((x) => x.id === a.id) : all.find((x) => x.status === "queued" && x.runner !== "auto");
      if (!t) return text("No requests are waiting. The designer types them on the canvas, in the Agent panel.");
      if (t.status !== "queued") return text(`Task ${t.id} is already ${t.status}.`);
      const env = await store.getEnv(t.env);
      if (env.base) await store.checkout(t.env); // so you can edit the branch's files in its folder
      const v = await store.saveVersion(t.env, { label: `Before ${who}: ${t.prompt.slice(0, 60)}`, author: who, kind: "auto" });
      await store.updateTask(t.id, { status: "working", claimedBy: who, beforeVersion: v.n, log: `${who} took this request. Saved version ${v.n} first.`, logKind: "note" });
      return text({ id: t.id, env: t.env, brief: taskPrompt(t, env, store.envDir(t.env)) });
    }
    case "update_task": {
      const t = await store.updateTask(a.id, { status: a.status, log: a.log, reply: a.reply, logKind: "out" });
      return text({ id: t.id, status: t.status });
    }
    case "list_comments": {
      const all = await store.records("comments");
      const top = all.filter((c) => !c.parent && (!a.env || c.env === a.env) && (a.all || !c.resolved));
      return text(top.map((c) => ({ ...c, replies: all.filter((r) => r.parent === c.id).map((r) => ({ author: r.author, text: r.text, at: r.createdAt })) })));
    }
    case "reply_comment": {
      const c = await store.record("comments", a.id);
      return text(await store.addComment({ env: c.env, parent: c.id, text: a.text, author: who }));
    }
    case "resolve_comment":
      return text(await store.updateComment(a.id, { resolved: true }));
    default:
      throw new StoreError("unknown_tool", `No tool called ${name}`);
  }
}

export async function runMcp({ workspace, input = process.stdin, output = process.stdout } = {}) {
  const store = await Store.open(workspace);
  const ctx = { client: "Harness" };
  let beat = null;
  const write = (msg) => output.write(JSON.stringify(msg) + "\n");
  const startBeat = () => {
    if (beat) return;
    store.heartbeat(ctx.client).catch(() => {});
    beat = setInterval(() => store.heartbeat(ctx.client).catch(() => {}), 15_000);
    beat.unref?.();
  };
  const stop = async () => {
    if (beat) clearInterval(beat);
    await store.dropHeartbeat();
    await closeBrowser();
  };

  async function handle(msg) {
    const { id, method, params } = msg;
    const reply = (result) => id !== undefined && write({ jsonrpc: "2.0", id, result });
    const error = (code, message) => id !== undefined && write({ jsonrpc: "2.0", id, error: { code, message } });
    try {
      if (method === "initialize") {
        ctx.client = String(params?.clientInfo?.name || "Harness").replace(/[-_]/g, " ").replace(/\b\w/g, (c) => c.toUpperCase()).slice(0, 60);
        if (/claude/i.test(ctx.client) && /code/i.test(ctx.client)) ctx.client = "Claude Code";
        startBeat();
        return reply({ protocolVersion: params?.protocolVersion || "2025-06-18", capabilities: { tools: { listChanged: false } }, serverInfo: { name: "libra-workshop", version: VERSION }, instructions: INSTRUCTIONS });
      }
      if (method === "notifications/initialized" || method?.startsWith("notifications/")) return;
      if (method === "ping") return reply({});
      if (method === "tools/list") return reply({ tools: TOOLS });
      if (method === "tools/call") {
        const name = params?.name;
        if (!TOOLS.some((t) => t.name === name)) return error(-32602, `Unknown tool: ${name}`);
        try {
          return reply(await callTool(store, name, params?.arguments || {}, ctx));
        } catch (e) {
          // Tool failures go back to the model as a result it can read and act on, not as a protocol error.
          return reply({ isError: true, content: [{ type: "text", text: e instanceof StoreError || (e && e.code && e.status) ? e.message : `Failed: ${e.message}` }] });
        }
      }
      if (method === "resources/list") return reply({ resources: [] });
      if (method === "prompts/list") return reply({ prompts: [] });
      return error(-32601, `Method not found: ${method}`);
    } catch (e) {
      return error(-32603, e.message || "Internal error");
    }
  }

  const rl = readline.createInterface({ input, crlfDelay: Infinity });
  const inflight = new Set();
  rl.on("line", (line) => {
    const s = line.trim();
    if (!s) return;
    let msg;
    try {
      msg = JSON.parse(s);
    } catch {
      return write({ jsonrpc: "2.0", id: null, error: { code: -32700, message: "Parse error" } });
    }
    const p = handle(msg).finally(() => inflight.delete(p));
    inflight.add(p);
  });
  await new Promise((resolve) => rl.on("close", resolve));
  await Promise.allSettled([...inflight]);
  await stop();
}
