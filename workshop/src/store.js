// The workspace on disk. Every prototype ("environment") is a folder under envs/ with an
// index.html, so people, the canvas and coding agents all work on the same plain files.
//
//   workspace/
//     workshop.json            name, canvas layout, agent command
//     envs/<id>/index.html     the prototype itself
//     envs/<id>/env.json       name, lineage, device, theme, opening screen, variants, text edits
//     envs/<id>/overrides.css  design tweaks from the inspector and agents (wins over the prototype)
//     .workshop/               versions, trash, tasks, comments, shares, selection, harness heartbeats
//
// Shared state that two processes write (the server and an MCP harness) is kept one file per
// record, so they never overwrite each other's work.

import fs from "node:fs";
import fsp from "node:fs/promises";
import path from "node:path";
import crypto from "node:crypto";
import { parseCss, mergeRule, rulesOf, normSel, checkSelector, OVERRIDES_HEAD } from "./css.js";

export { parseCss, mergeRule, rulesOf } from "./css.js";

export const LIMITS = {
  // Guards: these stop a runaway agent or a bad upload from filling the disk or the browser.
  fileBytes: 64 * 1024 * 1024,
  logBytes: 256 * 1024,
  textPatchChars: 10_000,
  commentChars: 4_000,
  promptChars: 20_000,
  versionsPerEnv: 200,
  envs: 500,
};

const ID_RE = /^[a-z0-9][a-z0-9-]{0,63}$/;
const RECORD_RE = /^[a-z0-9][a-z0-9-]{0,80}$/;
const THEMES = new Set(["light", "dark", "system"]);

export class StoreError extends Error {
  constructor(code, message, status = 400) {
    super(message);
    this.code = code;
    this.status = status;
  }
}

export function slug(name) {
  const s = String(name || "")
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 48);
  return s || "prototype";
}

export function assertId(id) {
  if (typeof id !== "string" || !ID_RE.test(id)) throw new StoreError("bad_id", `Not an environment id: ${String(id).slice(0, 80)}`);
  return id;
}

function assertRecord(id) {
  if (typeof id !== "string" || !RECORD_RE.test(id)) throw new StoreError("bad_id", "Not a record id");
  return id;
}

export function newId(prefix) {
  return `${prefix}-${Date.now().toString(36)}-${crypto.randomBytes(3).toString("hex")}`;
}

const now = () => new Date().toISOString();

async function exists(p) {
  try {
    await fsp.access(p);
    return true;
  } catch {
    return false;
  }
}

async function readJson(file, fallback) {
  try {
    return JSON.parse(await fsp.readFile(file, "utf8"));
  } catch {
    return fallback;
  }
}

// Atomic write: a reader (the other process, the watcher) never sees half a file.
async function writeAtomic(file, data) {
  await fsp.mkdir(path.dirname(file), { recursive: true });
  const tmp = `${file}.${process.pid}.${crypto.randomBytes(3).toString("hex")}.tmp`;
  await fsp.writeFile(tmp, data);
  await fsp.rename(tmp, file);
}

const writeJson = (file, value) => writeAtomic(file, JSON.stringify(value, null, 2) + "\n");

async function dirSize(dir) {
  let total = 0;
  for (const e of await fsp.readdir(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) total += await dirSize(p);
    else if (e.isFile()) total += (await fsp.stat(p)).size;
  }
  return total;
}

async function listFilesRec(dir, base = dir, out = []) {
  for (const e of await fsp.readdir(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) await listFilesRec(p, base, out);
    else if (e.isFile()) {
      const st = await fsp.stat(p);
      out.push({ path: path.relative(base, p).split(path.sep).join("/"), bytes: st.size, mtime: st.mtimeMs });
    }
  }
  return out;
}

// ---------- the store ----------

export class Store {
  constructor(root) {
    this.root = path.resolve(root);
    this.envsDir = path.join(this.root, "envs");
    this.metaDir = path.join(this.root, ".workshop");
  }

  static async open(root) {
    const s = new Store(root);
    await fsp.mkdir(s.envsDir, { recursive: true });
    for (const d of ["versions", "trash", "tasks", "comments", "shares", "harness"]) await fsp.mkdir(path.join(s.metaDir, d), { recursive: true });
    if (!(await exists(s.file("workshop.json")))) {
      await writeJson(s.file("workshop.json"), { name: path.basename(s.root) === "workspace" ? "Prototype workshop" : path.basename(s.root), canvas: { boards: {} }, agent: null });
    }
    return s;
  }

  file(...rel) {
    return path.join(this.root, ...rel);
  }

  envDir(id) {
    return path.join(this.envsDir, assertId(id));
  }

  // Guard: every path from a request or an agent is resolved inside its environment folder,
  // so "../" can never reach the rest of the disk.
  safeJoin(base, rel) {
    const clean = String(rel || "").replace(/\\/g, "/").replace(/^\/+/, "");
    if (!clean || clean.split("/").some((seg) => seg === ".." || seg.startsWith("."))) throw new StoreError("bad_path", "That path isn't allowed");
    const p = path.resolve(base, clean);
    if (p !== base && !p.startsWith(base + path.sep)) throw new StoreError("bad_path", "That path isn't allowed");
    return p;
  }

  // ----- workspace -----

  async workspace() {
    const w = await readJson(this.file("workshop.json"), {});
    return { name: w.name || "Prototype workshop", canvas: w.canvas || { boards: {} }, agent: w.agent || null, root: this.root };
  }

  async updateWorkspace(patch) {
    const w = await readJson(this.file("workshop.json"), {});
    if (typeof patch.name === "string" && patch.name.trim()) w.name = patch.name.trim().slice(0, 120);
    if ("agent" in patch) {
      const a = patch.agent;
      if (a === null) w.agent = null;
      else if (a && Array.isArray(a.command) && a.command.length && a.command.every((x) => typeof x === "string" && x.length < 2000)) {
        w.agent = { name: String(a.name || a.command[0]).slice(0, 60), command: a.command.slice(0, 40) };
      } else throw new StoreError("bad_agent", "An agent needs a command: a list of strings");
    }
    await writeJson(this.file("workshop.json"), w);
    return this.workspace();
  }

  async moveBoard(id, x, y) {
    assertId(id);
    const w = await readJson(this.file("workshop.json"), {});
    w.canvas = w.canvas || { boards: {} };
    w.canvas.boards = w.canvas.boards || {};
    const fx = Number(x),
      fy = Number(y);
    if (!Number.isFinite(fx) || !Number.isFinite(fy) || Math.abs(fx) > 1e6 || Math.abs(fy) > 1e6) throw new StoreError("bad_position", "That position is off the canvas");
    w.canvas.boards[id] = { x: Math.round(fx), y: Math.round(fy) };
    await writeJson(this.file("workshop.json"), w);
    return w.canvas.boards[id];
  }

  // ----- environments -----

  async ids() {
    const out = [];
    for (const e of await fsp.readdir(this.envsDir, { withFileTypes: true })) {
      if (e.isDirectory() && ID_RE.test(e.name) && (await exists(path.join(this.envsDir, e.name, "index.html")))) out.push(e.name);
    }
    return out.sort();
  }

  defaults(id) {
    return { id, name: id, description: "", parent: null, forkedFrom: null, source: null, created: null, author: null, device: { w: 1728, h: 1117 }, theme: "light", screen: null, state: null, variants: {}, patches: [] };
  }

  async getEnv(id) {
    const dir = this.envDir(id);
    if (!(await exists(path.join(dir, "index.html")))) throw new StoreError("not_found", `No environment called ${id}`, 404);
    const meta = { ...this.defaults(id), ...(await readJson(path.join(dir, "env.json"), {})), id };
    const st = await fsp.stat(path.join(dir, "index.html"));
    let updated = st.mtimeMs;
    for (const f of ["env.json", "overrides.css"]) {
      try {
        updated = Math.max(updated, (await fsp.stat(path.join(dir, f))).mtimeMs);
      } catch {}
    }
    const overrides = await this.getOverrides(id);
    return { ...meta, updatedAt: new Date(updated).toISOString(), bytes: st.size, versions: (await this.listVersions(id)).length, overrides: rulesOf(overrides).length };
  }

  async listEnvs() {
    const out = [];
    for (const id of await this.ids()) {
      try {
        out.push(await this.getEnv(id));
      } catch {}
    }
    return out;
  }

  async uniqueId(name) {
    const base = slug(name);
    const taken = new Set(await this.ids());
    for (const e of await fsp.readdir(this.envsDir).catch(() => [])) taken.add(e);
    if (!taken.has(base)) return base;
    for (let i = 2; i < 1000; i++) if (!taken.has(`${base}-${i}`)) return `${base}-${i}`;
    throw new StoreError("too_many", "Too many environments with that name");
  }

  async writeMeta(id, meta) {
    const { versions, overrides, updatedAt, bytes, ...keep } = meta;
    await writeJson(path.join(this.envDir(id), "env.json"), { ...keep, id });
  }

  async createEnv({ name, html, description = "", source = null, author = null, files = {} }) {
    if (typeof html !== "string" || !html.length) throw new StoreError("bad_html", "A new environment needs some HTML");
    if (Buffer.byteLength(html) > LIMITS.fileBytes) throw new StoreError("too_big", "That HTML file is too big");
    if ((await this.ids()).length >= LIMITS.envs) throw new StoreError("too_many", "This workspace has as many environments as it can hold");
    const title = String(name || titleOf(html) || "Untitled prototype").trim().slice(0, 120);
    const id = await this.uniqueId(title);
    const dir = this.envDir(id);
    await fsp.mkdir(dir, { recursive: true });
    await writeAtomic(path.join(dir, "index.html"), html);
    for (const [rel, content] of Object.entries(files)) {
      const p = this.safeJoin(dir, rel);
      await writeAtomic(p, content);
    }
    await this.writeMeta(id, { ...this.defaults(id), name: title, description: String(description).slice(0, 400), source, author, created: now() });
    await this.placeBoard(id);
    return this.getEnv(id);
  }

  async importPath(src, { name, author } = {}) {
    const abs = path.resolve(src);
    const st = await fsp.stat(abs).catch(() => null);
    if (!st) throw new StoreError("not_found", `Nothing at ${src}`, 404);
    if (st.isFile()) {
      const html = await fsp.readFile(abs, "utf8");
      return this.createEnv({ name: name || titleOf(html) || path.basename(abs, path.extname(abs)), html, author, source: { kind: "file", path: path.basename(abs) } });
    }
    if (!(await exists(path.join(abs, "index.html")))) throw new StoreError("bad_folder", "That folder has no index.html");
    const html = await fsp.readFile(path.join(abs, "index.html"), "utf8");
    const title = name || titleOf(html) || path.basename(abs);
    const id = await this.uniqueId(title);
    const dir = this.envDir(id);
    await fsp.cp(abs, dir, { recursive: true, filter: (p) => !path.basename(p).startsWith(".") || p === abs });
    const prev = await readJson(path.join(dir, "env.json"), {});
    await this.writeMeta(id, { ...this.defaults(id), ...prev, id, name: String(title).slice(0, 120), author: author || prev.author || null, created: now(), source: prev.source || { kind: "folder", path: path.basename(abs) } });
    await this.placeBoard(id);
    return this.getEnv(id);
  }

  async updateEnv(id, patch) {
    const env = await this.getEnv(id);
    const p = patch || {};
    if (typeof p.name === "string" && p.name.trim()) env.name = p.name.trim().slice(0, 120);
    if (typeof p.description === "string") env.description = p.description.slice(0, 400);
    if (p.device) {
      const w = Math.round(Number(p.device.w)),
        h = Math.round(Number(p.device.h));
      // Guard: a board is a real browser viewport; keep it between a small phone and a big monitor.
      if (!(w >= 240 && w <= 4096 && h >= 240 && h <= 4096)) throw new StoreError("bad_device", "Boards are between 240 and 4096 pixels on each side");
      env.device = { w, h };
    }
    if ("theme" in p) {
      if (!THEMES.has(p.theme)) throw new StoreError("bad_theme", "Theme is light, dark or system");
      env.theme = p.theme;
    }
    if ("screen" in p) env.screen = p.screen === null ? null : String(p.screen).slice(0, 120);
    if ("state" in p) env.state = p.state === null ? null : String(p.state).slice(0, 60);
    if (p.variants && typeof p.variants === "object") {
      const v = { ...(env.variants || {}) };
      for (const [k, val] of Object.entries(p.variants).slice(0, 60)) {
        const key = String(k).slice(0, 120);
        if (val === null) delete v[key];
        else v[key] = String(val).slice(0, 120);
      }
      env.variants = v;
    }
    await this.writeMeta(id, env);
    return this.getEnv(id);
  }

  async forkEnv(id, { name, version = null, author = null } = {}) {
    const src = await this.getEnv(id);
    const from = version === null || version === undefined ? this.envDir(id) : path.join(this.versionDir(id, version), "files");
    if (!(await exists(from))) throw new StoreError("not_found", `No version ${version} of ${id}`, 404);
    let title = String(name || `${src.name} copy`).slice(0, 120);
    if (!name) {
      // "X copy", then "X copy 2", "X copy 3" — two boards never share a name
      const names = new Set((await this.listEnvs()).map((e) => e.name));
      for (let i = 2; names.has(title) && i < 1000; i++) title = `${src.name} copy ${i}`;
    }
    const nid = await this.uniqueId(title);
    await fsp.cp(from, this.envDir(nid), { recursive: true });
    const meta = { ...this.defaults(nid), ...(await readJson(path.join(this.envDir(nid), "env.json"), {})) };
    await this.writeMeta(nid, { ...meta, id: nid, name: title, description: "", parent: id, forkedFrom: { env: id, version: version ?? null, at: now() }, created: now(), author });
    const pos = (await this.workspace()).canvas.boards[id];
    if (pos) await this.placeBoard(nid, { near: { ...pos, w: src.device.w, h: src.device.h } });
    else await this.placeBoard(nid);
    return this.getEnv(nid);
  }

  // Finds a free spot: to the right of `near`, else after the right-most board.
  async placeBoard(id, { near } = {}) {
    const w = await readJson(this.file("workshop.json"), {});
    w.canvas = w.canvas || { boards: {} };
    const boards = (w.canvas.boards = w.canvas.boards || {});
    if (boards[id] && !near) return boards[id];
    const gap = 160;
    const rects = [];
    for (const [bid, b] of Object.entries(boards)) {
      if (bid === id) continue;
      const m = await readJson(path.join(this.envsDir, bid, "env.json"), {});
      const d = m.device || { w: 1728, h: 1117 };
      rects.push({ x: b.x, y: b.y, w: d.w, h: d.h });
    }
    const me = await readJson(path.join(this.envDir(id), "env.json"), {});
    const md = me.device || { w: 1728, h: 1117 };
    const hit = (x, y) => rects.some((r) => x < r.x + r.w + gap && x + md.w + gap > r.x && y < r.y + r.h + gap && y + md.h + gap > r.y);
    let x, y;
    if (near) {
      x = near.x + near.w + gap;
      y = near.y;
      let guard = 0;
      while (hit(x, y) && guard++ < 200) y += md.h + gap + 80;
    } else if (rects.length) {
      x = Math.max(...rects.map((r) => r.x + r.w)) + gap;
      y = Math.min(...rects.map((r) => r.y));
    } else {
      x = 0;
      y = 0;
    }
    boards[id] = { x: Math.round(x), y: Math.round(y) };
    await writeJson(this.file("workshop.json"), w);
    return boards[id];
  }

  async deleteEnv(id) {
    await this.getEnv(id);
    const key = `${id}--${Date.now().toString(36)}`;
    await fsp.rename(this.envDir(id), path.join(this.metaDir, "trash", key));
    const w = await readJson(this.file("workshop.json"), {});
    const pos = w.canvas?.boards?.[id] || null;
    if (pos) {
      delete w.canvas.boards[id];
      await writeJson(this.file("workshop.json"), w);
    }
    await writeJson(path.join(this.metaDir, "trash", `${key}.json`), { id, pos, at: now() });
    return { trash: key };
  }

  async restoreEnv(trashKey) {
    const key = String(trashKey || "");
    if (!/^[a-z0-9-]+--[a-z0-9]+$/.test(key)) throw new StoreError("bad_id", "Not a deleted environment");
    const info = await readJson(path.join(this.metaDir, "trash", `${key}.json`), null);
    if (!info) throw new StoreError("not_found", "That environment is no longer in the trash", 404);
    const id = (await exists(this.envDir(info.id))) ? await this.uniqueId(info.id) : info.id;
    await fsp.rename(path.join(this.metaDir, "trash", key), this.envDir(id));
    await fsp.rm(path.join(this.metaDir, "trash", `${key}.json`), { force: true });
    if (info.pos) await this.moveBoard(id, info.pos.x, info.pos.y);
    else await this.placeBoard(id);
    return this.getEnv(id);
  }

  // ----- files -----

  async listFiles(id) {
    await this.getEnv(id);
    return listFilesRec(this.envDir(id));
  }

  async readFile(id, rel) {
    const p = this.safeJoin(this.envDir(id), rel);
    const st = await fsp.stat(p).catch(() => null);
    if (!st || !st.isFile()) throw new StoreError("not_found", `No file ${rel} in ${id}`, 404);
    return fsp.readFile(p);
  }

  async writeFile(id, rel, content) {
    await this.getEnv(id);
    const buf = Buffer.isBuffer(content) ? content : Buffer.from(String(content));
    if (buf.length > LIMITS.fileBytes) throw new StoreError("too_big", "That file is too big");
    const p = this.safeJoin(this.envDir(id), rel);
    if (path.relative(this.envDir(id), p) === "env.json") JSON.parse(buf.toString("utf8")); // a broken env.json would hide the environment
    await writeAtomic(p, buf);
    return { path: rel, bytes: buf.length };
  }

  // ----- overrides & text edits -----

  async getOverrides(id) {
    try {
      return await fsp.readFile(path.join(this.envDir(id), "overrides.css"), "utf8");
    } catch {
      return "";
    }
  }

  async setStyle(id, selector, props) {
    const env = await this.getEnv(id);
    const cur = (await this.getOverrides(id)) || OVERRIDES_HEAD(env.name);
    const next = mergeRule(cur, selector, props);
    await writeAtomic(path.join(this.envDir(id), "overrides.css"), next);
    return { css: next, rules: rulesOf(next) };
  }

  async clearStyles(id, selector) {
    const css = await this.getOverrides(id);
    const keep = parseCss(css).filter((c) => !(c.kind === "rule" && (!selector || normSel(c.selector) === normSel(checkSelector(selector)))));
    const next = keep.map((c) => c.text).join("").replace(/\n{3,}/g, "\n\n").trimEnd() + "\n";
    await writeAtomic(path.join(this.envDir(id), "overrides.css"), next);
    return { css: next, rules: rulesOf(next) };
  }

  async setText(id, selector, text) {
    const env = await this.getEnv(id);
    const sel = checkSelector(selector);
    const t = String(text ?? "");
    if (t.length > LIMITS.textPatchChars) throw new StoreError("too_big", "That text is too long");
    const patches = (env.patches || []).filter((p) => !(p.type === "text" && normSel(p.selector) === normSel(sel)));
    if (text !== null) patches.push({ type: "text", selector: sel, text: t });
    env.patches = patches.slice(-500);
    await this.writeMeta(id, env);
    return env.patches;
  }

  // ----- versions: whole-folder snapshots, so any edit (human, inspector or agent) can be undone -----

  versionDir(id, n) {
    const k = Number(n);
    if (!Number.isInteger(k) || k < 1 || k > 100000) throw new StoreError("bad_version", "Not a version number");
    return path.join(this.metaDir, "versions", assertId(id), String(k));
  }

  async listVersions(id) {
    const dir = path.join(this.metaDir, "versions", assertId(id));
    const out = [];
    for (const name of await fsp.readdir(dir).catch(() => [])) {
      if (!/^\d+$/.test(name)) continue;
      const meta = await readJson(path.join(dir, name, "version.json"), null);
      if (meta) out.push(meta);
    }
    return out.sort((a, b) => b.n - a.n);
  }

  async saveVersion(id, { label = "", author = null, kind = "manual" } = {}) {
    await this.getEnv(id);
    const list = await this.listVersions(id);
    if (list.length >= LIMITS.versionsPerEnv) {
      // keep the newest; the oldest automatic snapshot goes first
      const drop = [...list].reverse().find((v) => v.kind !== "manual") || list[list.length - 1];
      await fsp.rm(this.versionDir(id, drop.n), { recursive: true, force: true });
    }
    const n = (list[0]?.n || 0) + 1;
    const dir = this.versionDir(id, n);
    await fsp.mkdir(dir, { recursive: true });
    await fsp.cp(this.envDir(id), path.join(dir, "files"), { recursive: true });
    const meta = { n, label: String(label || `Version ${n}`).slice(0, 120), author, kind, at: now(), bytes: await dirSize(path.join(dir, "files")) };
    await writeJson(path.join(dir, "version.json"), meta);
    return meta;
  }

  async restoreVersion(id, n, { author = null } = {}) {
    const dir = path.join(this.versionDir(id, n), "files");
    if (!(await exists(dir))) throw new StoreError("not_found", `No version ${n} of ${id}`, 404);
    const before = await this.saveVersion(id, { label: `Before restoring version ${n}`, author, kind: "auto" });
    const target = this.envDir(id);
    const tmp = `${target}.restore-${crypto.randomBytes(3).toString("hex")}`;
    await fsp.cp(dir, tmp, { recursive: true });
    const old = `${target}.old-${crypto.randomBytes(3).toString("hex")}`;
    await fsp.rename(target, old);
    await fsp.rename(tmp, target);
    await fsp.rm(old, { recursive: true, force: true });
    return { env: await this.getEnv(id), before };
  }

  // ----- records shared with harnesses: comments, tasks, shares, selection, heartbeats -----

  async records(kind) {
    const dir = path.join(this.metaDir, kind);
    const out = [];
    for (const f of await fsp.readdir(dir).catch(() => [])) {
      if (!f.endsWith(".json")) continue;
      const r = await readJson(path.join(dir, f), null);
      if (r) out.push(r);
    }
    return out.sort((a, b) => String(a.createdAt || "").localeCompare(String(b.createdAt || "")));
  }

  async record(kind, id) {
    const r = await readJson(path.join(this.metaDir, kind, `${assertRecord(id)}.json`), null);
    if (!r) throw new StoreError("not_found", `No ${kind.replace(/s$/, "")} ${id}`, 404);
    return r;
  }

  async putRecord(kind, r) {
    await writeJson(path.join(this.metaDir, kind, `${assertRecord(r.id)}.json`), r);
    return r;
  }

  async addComment({ env, x, y, selector = null, text, author = "You", parent = null }) {
    await this.getEnv(env);
    const t = String(text || "").trim();
    if (!t) throw new StoreError("empty", "Write a comment first");
    if (t.length > LIMITS.commentChars) throw new StoreError("too_big", "That comment is too long");
    const fx = Number(x),
      fy = Number(y);
    if (!parent && !(Number.isFinite(fx) && Number.isFinite(fy))) throw new StoreError("bad_position", "A comment needs a spot on the board");
    const id = newId("c");
    return this.putRecord("comments", { id, env, x: parent ? null : Math.round(fx), y: parent ? null : Math.round(fy), selector: selector ? checkSelector(selector) : null, text: t, author: String(author).slice(0, 80), parent, resolved: false, createdAt: now() });
  }

  async updateComment(id, patch) {
    const c = await this.record("comments", id);
    if ("resolved" in patch) c.resolved = !!patch.resolved;
    if (typeof patch.text === "string" && patch.text.trim()) c.text = patch.text.trim().slice(0, LIMITS.commentChars);
    c.updatedAt = now();
    return this.putRecord("comments", c);
  }

  async deleteComment(id) {
    const c = await this.record("comments", id);
    await fsp.rm(path.join(this.metaDir, "comments", `${c.id}.json`), { force: true });
    for (const r of await this.records("comments")) if (r.parent === c.id) await fsp.rm(path.join(this.metaDir, "comments", `${r.id}.json`), { force: true });
    return c;
  }

  async addTask({ env, prompt, selection = null, author = "You", runner = "harness" }) {
    await this.getEnv(env);
    const p = String(prompt || "").trim();
    if (!p) throw new StoreError("empty", "Say what the agent should change");
    if (p.length > LIMITS.promptChars) throw new StoreError("too_big", "That request is too long");
    const sel = selection && typeof selection === "object" ? { selector: String(selection.selector || "").slice(0, LIMITS.selectorChars), label: String(selection.label || "").slice(0, 120), html: String(selection.html || "").slice(0, 4000), text: String(selection.text || "").slice(0, 600), styles: selection.styles && typeof selection.styles === "object" ? selection.styles : null } : null;
    return this.putRecord("tasks", { id: newId("t"), env, prompt: p, selection: sel, author: String(author).slice(0, 80), runner, status: "queued", log: [], reply: null, claimedBy: null, beforeVersion: null, changed: [], createdAt: now(), updatedAt: now() });
  }

  async updateTask(id, patch) {
    const t = await this.record("tasks", id);
    const STATUS = new Set(["queued", "working", "done", "failed", "cancelled"]);
    if (patch.status && STATUS.has(patch.status)) t.status = patch.status;
    if (typeof patch.reply === "string") t.reply = patch.reply.slice(0, 8000);
    if (typeof patch.claimedBy === "string") t.claimedBy = patch.claimedBy.slice(0, 80);
    if (Number.isInteger(patch.beforeVersion)) t.beforeVersion = patch.beforeVersion;
    if (Array.isArray(patch.changed)) t.changed = patch.changed.slice(0, 200).map(String);
    if (typeof patch.log === "string" && patch.log) {
      t.log.push({ at: now(), kind: patch.logKind === "err" ? "err" : patch.logKind === "note" ? "note" : "out", text: patch.log.slice(0, 20000) });
      // Guard: a chatty agent can't grow the task file without bound — the oldest lines go.
      while (JSON.stringify(t.log).length > LIMITS.logBytes && t.log.length > 1) t.log.shift();
    }
    t.updatedAt = now();
    return this.putRecord("tasks", t);
  }

  async addShare({ env, role = "view", author = "You" }) {
    await this.getEnv(env);
    if (!["view", "comment"].includes(role)) throw new StoreError("bad_role", "Links can view or comment");
    const token = crypto.randomBytes(18).toString("base64url").toLowerCase().replace(/[^a-z0-9]/g, "").slice(0, 24);
    return this.putRecord("shares", { id: `s-${token}`, token, env, role, author: String(author).slice(0, 80), revoked: false, createdAt: now() });
  }

  async shareByToken(token) {
    if (typeof token !== "string" || !/^[a-z0-9]{8,40}$/.test(token)) return null;
    const r = await readJson(path.join(this.metaDir, "shares", `s-${token}.json`), null);
    return r && !r.revoked ? r : null;
  }

  async revokeShare(id) {
    const r = await this.record("shares", id);
    r.revoked = true;
    r.revokedAt = now();
    return this.putRecord("shares", r);
  }

  async selection() {
    return readJson(path.join(this.metaDir, "selection.json"), null);
  }

  async setSelection(sel) {
    if (sel === null) {
      await fsp.rm(path.join(this.metaDir, "selection.json"), { force: true });
      return null;
    }
    const s = { ...sel, at: now() };
    if (s.env) assertId(s.env);
    if (JSON.stringify(s).length > 64 * 1024) throw new StoreError("too_big", "That selection is too large");
    await writeJson(path.join(this.metaDir, "selection.json"), s);
    return s;
  }

  async heartbeat(client) {
    const r = { id: `h-${process.pid}`, client: String(client || "harness").slice(0, 80), pid: process.pid, at: now() };
    await writeJson(path.join(this.metaDir, "harness", `${r.id}.json`), r);
    return r;
  }

  async harnesses() {
    const list = await this.records("harness");
    const fresh = Date.now() - 45_000;
    return list.filter((h) => Date.parse(h.at) > fresh);
  }

  async dropHeartbeat() {
    try {
      fs.rmSync(path.join(this.metaDir, "harness", `h-${process.pid}.json`), { force: true });
    } catch {}
  }
}

export function titleOf(html) {
  const m = /<title[^>]*>([^<]{1,200})<\/title>/i.exec(String(html || ""));
  return m ? m[1].replace(/\s+/g, " ").trim() : "";
}
