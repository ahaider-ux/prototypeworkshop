// The workspace on disk. Every prototype ("environment") is a folder under envs/ with an
// index.html, so people, the canvas and coding agents all work on the same plain files.
//
//   workspace/
//     workshop.json            name, canvas layout, agent command
//     envs/<id>/index.html     the prototype itself
//     envs/<id>/env.json       name, lineage, device, theme, opening screen, variants, text edits
//     envs/<id>/overrides.css  design tweaks from the inspector and agents (wins over the prototype)
//     canvas/<id>.json         what sits on the canvas: boards (a prototype at a screen), notes, boxes, arrows
//     .workshop/               versions, trash, tasks, comments, shares, selection, harness heartbeats
//
// A branch is an environment whose env.json names a `base`: files it doesn't have yet come from the
// base, so creating one is instant. It remembers what its parent looked like when it was made, so
// Review and merge can show both sides' changes and the conflicts.
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
    this.canvasDir = path.join(this.root, "canvas");
  }

  static async open(root) {
    const s = new Store(root);
    await fsp.mkdir(s.envsDir, { recursive: true });
    for (const d of ["versions", "trash", "tasks", "comments", "shares", "harness"]) await fsp.mkdir(path.join(s.metaDir, d), { recursive: true });
    await fsp.mkdir(s.canvasDir, { recursive: true });
    if (!(await exists(s.file("workshop.json")))) {
      await writeJson(s.file("workshop.json"), { name: path.basename(s.root) === "workspace" ? "Prototype workshop" : path.basename(s.root), agent: null });
    }
    await s.migrateBoards();
    return s;
  }

  // Workspaces from before canvas items kept one spot per environment in workshop.json.
  async migrateBoards() {
    const w = await readJson(this.file("workshop.json"), {});
    const old = w.canvas?.boards;
    if (!old) return;
    const have = new Set((await this.items()).filter((i) => i.type === "board").map((i) => i.env));
    for (const [env, pos] of Object.entries(old)) {
      if (have.has(env) || !ID_RE.test(env) || !(await exists(this.envDir(env)))) continue;
      const m = await readJson(path.join(this.envDir(env), "env.json"), {});
      const d = m.device || { w: 1728, h: 1117 };
      await this.putItem({ id: newId("b"), type: "board", env, screen: null, state: null, x: Math.round(pos.x || 0), y: Math.round(pos.y || 0), w: d.w, h: d.h, createdAt: now() });
    }
    delete w.canvas;
    await writeJson(this.file("workshop.json"), w);
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
    return { name: w.name || "Prototype workshop", agent: w.agent || null, root: this.root };
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

  // ----- canvas items: boards, notes, boxes, arrows (one file each, so writers never collide) -----

  async items() {
    const out = [];
    for (const f of await fsp.readdir(this.canvasDir).catch(() => [])) {
      if (!f.endsWith(".json")) continue;
      const it = await readJson(path.join(this.canvasDir, f), null);
      if (it && it.id && it.type) out.push(it);
    }
    return out.sort((a, b) => String(a.createdAt || "").localeCompare(String(b.createdAt || "")) || a.id.localeCompare(b.id));
  }

  async item(id) {
    const it = await readJson(path.join(this.canvasDir, `${assertRecord(id)}.json`), null);
    if (!it) throw new StoreError("not_found", "That's no longer on the canvas", 404);
    return it;
  }

  async putItem(it) {
    await writeJson(path.join(this.canvasDir, `${assertRecord(it.id)}.json`), it);
    return it;
  }

  // Guard: canvas items come from the page and from agents; every field is checked and bounded.
  async cleanItem(type, p, prev = {}) {
    const num = (v, lo, hi, d) => {
      if (v === undefined) return d;
      const n = Math.round(Number(v));
      if (!Number.isFinite(n) || n < lo || n > hi) throw new StoreError("bad_item", "That size or position is off the canvas");
      return n;
    };
    const str = (v, max, d = "") => (v === undefined ? d : v === null ? null : String(v).slice(0, max));
    const at = { x: num(p.x, -1e6, 1e6, prev.x ?? 0), y: num(p.y, -1e6, 1e6, prev.y ?? 0) };
    // notes, highlights and arrows belong to one page: a prototype's main or one of its branches
    const page = p.env === undefined ? prev.env ?? null : p.env === null ? null : assertId(String(p.env));
    if (type === "board") {
      const env = p.env ?? prev.env;
      const e = await this.getEnv(env);
      return { ...at, env: e.id, screen: str(p.screen, 120, prev.screen ?? null), state: str(p.state, 60, prev.state ?? null), w: num(p.w, 240, 4096, prev.w ?? e.device.w), h: num(p.h, 240, 4096, prev.h ?? e.device.h) };
    }
    if (type === "note") {
      const tone = p.tone ?? prev.tone ?? "warm";
      if (!["warm", "info", "plain"].includes(tone)) throw new StoreError("bad_item", "A note is warm, info or plain");
      return { ...at, env: page, w: num(p.w, 120, 800, prev.w ?? 240), text: str(p.text, LIMITS.commentChars, prev.text ?? ""), tone };
    }
    if (type === "box") return { ...at, env: page, w: num(p.w, 8, 20000, prev.w ?? 320), h: num(p.h, 8, 20000, prev.h ?? 200), label: str(p.label, 200, prev.label ?? "") };
    if (type === "arrow") {
      const end = (e, d) => {
        if (e === undefined) return d;
        if (e && typeof e === "object" && typeof e.item === "string") return { item: assertRecord(e.item) };
        if (e && typeof e === "object") return { x: num(e.x, -1e6, 1e6, 0), y: num(e.y, -1e6, 1e6, 0) };
        throw new StoreError("bad_item", "An arrow end is a point or an item");
      };
      return { env: page, from: end(p.from, prev.from ?? { x: 0, y: 0 }), to: end(p.to, prev.to ?? { x: 100, y: 0 }), label: str(p.label, 200, prev.label ?? "") };
    }
    if (type === "ink") {
      // a hand-drawn mark: points relative to (x, y), each [x, y, pressure 0–1]
      const raw = p.points === undefined ? prev.points : p.points;
      // Guard: a stroke is a few hundred points; this caps a runaway one before it reaches the file.
      if (!Array.isArray(raw) || raw.length < 1 || raw.length > 4000) throw new StoreError("bad_item", "A drawing needs between 1 and 4000 points");
      const points = raw.map((q) => {
        const [qx, qy, qp = 0.5] = Array.isArray(q) ? q : [];
        if (![qx, qy, qp].every((v) => Number.isFinite(Number(v))) || Math.abs(qx) > 20000 || Math.abs(qy) > 20000) throw new StoreError("bad_item", "A drawing's points are off the canvas");
        return [Math.round(qx * 10) / 10, Math.round(qy * 10) / 10, Math.round(Math.min(1, Math.max(0, qp)) * 100) / 100];
      });
      const pen = p.pen ?? prev.pen ?? "marker";
      if (!["marker", "pen", "pencil", "highlighter"].includes(pen)) throw new StoreError("bad_item", "A drawing is made with a marker, pen, pencil or highlighter");
      const color = String(p.color ?? prev.color ?? "#e03131");
      if (!/^#[0-9a-f]{6}$/i.test(color)) throw new StoreError("bad_item", "A drawing's colour is a hex colour like #e03131");
      const size = num(p.size, 1, 80, prev.size ?? 6);
      const board = p.board === undefined ? prev.board ?? null : p.board === null ? null : assertRecord(String(p.board));
      const xs = points.map((q) => q[0]),
        ys = points.map((q) => q[1]);
      // its box, for selecting, aligning and telling agents what it marks
      const w = Math.max(1, Math.round(Math.max(...xs) - Math.min(0, ...xs))),
        h = Math.max(1, Math.round(Math.max(...ys) - Math.min(0, ...ys)));
      return { ...at, env: page, board, pen, color: color.toLowerCase(), size, points, w, h };
    }
    throw new StoreError("bad_item", "Boards, notes, boxes, arrows and drawings go on the canvas");
  }

  async addItem(p, author = null) {
    const type = String(p?.type || "");
    if ((await this.items()).length >= 2000) throw new StoreError("too_many", "This canvas holds as much as it can");
    const prefix = { board: "b", note: "n", box: "x", arrow: "a", ink: "k" }[type] || "i";
    const it = { id: newId(prefix), type, ...(await this.cleanItem(type, p)), author, createdAt: now() };
    return this.putItem(it);
  }

  async updateItem(id, patch) {
    const it = await this.item(id);
    const next = { ...it, ...(await this.cleanItem(it.type, patch || {}, it)), updatedAt: now() };
    return this.putItem(next);
  }

  async deleteItem(id) {
    const it = await this.item(id);
    await fsp.rm(path.join(this.canvasDir, `${it.id}.json`), { force: true });
    // arrows pinned to it would point at nothing
    for (const a of await this.items()) if (a.type === "arrow" && (a.from?.item === it.id || a.to?.item === it.id)) await fsp.rm(path.join(this.canvasDir, `${a.id}.json`), { force: true });
    return it;
  }

  // Where things sit: each page (a prototype's main, or one of its branches) is its own canvas, and
  // its boards form a row from the origin.
  static BOARD_GAP = 120;

  async boundsOf(env, items) {
    const bs = (items || (await this.items())).filter((i) => i.type === "board" && (!env || i.env === env));
    if (!bs.length) return null;
    return { x0: Math.min(...bs.map((b) => b.x)), y0: Math.min(...bs.map((b) => b.y)), x1: Math.max(...bs.map((b) => b.x + b.w)), y1: Math.max(...bs.map((b) => b.y + b.h)), boards: bs };
  }

  async addBoard(env, { screen = null, state = null, author = null, x, y } = {}) {
    const e = await this.getEnv(env);
    const items = await this.items();
    const mine = await this.boundsOf(env, items);
    let px, py;
    if (x !== undefined && y !== undefined) (px = x), (py = y);
    else if (mine) {
      const last = mine.boards.reduce((a, b) => (b.x + b.w > a.x + a.w ? b : a));
      px = last.x + last.w + Store.BOARD_GAP;
      py = last.y;
    } else {
      px = 0;
      py = 0;
    }
    return this.addItem({ type: "board", env, screen, state, x: px, y: py, w: e.device.w, h: e.device.h }, author);
  }

  // ----- environments -----

  async ids() {
    const out = [];
    for (const e of await fsp.readdir(this.envsDir, { withFileTypes: true })) {
      if (e.isDirectory() && ID_RE.test(e.name) && ((await exists(path.join(this.envsDir, e.name, "index.html"))) || (await exists(path.join(this.envsDir, e.name, "env.json"))))) out.push(e.name);
    }
    return out.sort();
  }

  defaults(id) {
    return { id, name: id, description: "", parent: null, base: null, branch: null, forkedFrom: null, archived: false, mergedAt: null, source: null, created: null, author: null, device: { w: 1728, h: 1117 }, theme: "light", screen: null, state: null, variants: {}, patches: [], catalog: null };
  }

  async getEnv(id) {
    const dir = this.envDir(id);
    const index = await this.resolveFile(id, "index.html");
    if (!index) throw new StoreError("not_found", `No environment called ${id}`, 404);
    const meta = { ...this.defaults(id), ...(await readJson(path.join(dir, "env.json"), {})), id };
    const st = await fsp.stat(index);
    let updated = st.mtimeMs;
    for (const f of ["env.json", "overrides.css"]) {
      try {
        updated = Math.max(updated, (await fsp.stat(path.join(dir, f))).mtimeMs);
      } catch {}
    }
    const overrides = await this.getOverrides(id);
    return { ...meta, updatedAt: new Date(updated).toISOString(), bytes: st.size, versions: (await this.listVersions(id)).length, overrides: rulesOf(overrides).length, ownIndex: index === path.join(dir, "index.html") };
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
    const { versions, overrides, updatedAt, bytes, ownIndex, ...keep } = meta;
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
    await this.addBoard(id, { author });
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
    await this.addBoard(id, { author });
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
    if ("archived" in p) env.archived = !!p.archived;
    if (p.catalog && typeof p.catalog === "object") {
      // what the prototype offers (screens, states, variants), remembered so the Screens panel and agents can list them
      const c = p.catalog;
      const s = (v, n) => String(v ?? "").slice(0, n);
      const next = {
        adapter: s(c.adapter, 60),
        screens: (Array.isArray(c.screens) ? c.screens : []).slice(0, 200).map((x) => ({ group: s(x?.group, 60), name: s(x?.name, 120) })).filter((x) => x.name),
        states: (Array.isArray(c.states) ? c.states : []).slice(0, 20).map((x) => s(x, 60)),
        variants: (Array.isArray(c.variants) ? c.variants : []).slice(0, 60).map((x) => ({ label: s(x?.label, 120), options: (Array.isArray(x?.options) ? x.options : []).slice(0, 20).map((o) => s(o, 120)) })),
      };
      // Guard: a page read before it was ready lists no screens; that never replaces a catalog we know
      if (next.screens.length || !env.catalog?.screens?.length) env.catalog = next;
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
    await this.writeMeta(nid, { ...meta, id: nid, name: title, description: "", parent: id, branch: null, archived: false, forkedFrom: { env: id, version: version ?? null, at: now() }, created: now(), author });
    await this.copyBoards(id, nid, author);
    return this.getEnv(nid);
  }

  // The same screens for `to`, in the same places: a branch is its own page, laid out like its parent.
  async copyBoards(from, to, author = null) {
    const src = (await this.items()).filter((i) => i.type === "board" && i.env === from);
    if (!src.length) return [await this.addBoard(to, { author, x: 0, y: 0 })];
    const out = [];
    for (const b of src) out.push(await this.addItem({ type: "board", env: to, screen: b.screen, state: b.state, x: b.x, y: b.y, w: b.w, h: b.h }, author));
    return out;
  }

  // ----- branches -----

  async fileHashes(id) {
    const out = {};
    for (const f of await this.listFiles(id)) {
      if (f.path === "env.json" || f.path === "overrides.css") continue;
      out[f.path] = crypto.createHash("sha1").update(await this.readFile(id, f.path)).digest("hex");
    }
    return out;
  }

  async snapshotOf(id) {
    const env = await this.getEnv(id);
    return { settings: flatSettings(env), styles: cssMap(await this.getOverrides(id)), files: await this.fileHashes(id), at: now() };
  }

  async branchEnv(id, { name, author = null } = {}) {
    const src = await this.getEnv(id);
    let title = String(name || `${src.name} branch`).trim().slice(0, 120);
    const names = new Set((await this.listEnvs()).map((e) => e.name));
    for (let i = 2; names.has(title) && i < 1000; i++) title = `${String(name || `${src.name} branch`).trim().slice(0, 110)} ${i}`;
    const nid = await this.uniqueId(title);
    await fsp.mkdir(this.envDir(nid), { recursive: true });
    const css = await this.getOverrides(id);
    if (css) await writeAtomic(path.join(this.envDir(nid), "overrides.css"), css);
    const keep = ["theme", "screen", "state", "variants", "patches", "device", "catalog", "source"];
    const meta = { ...this.defaults(nid) };
    for (const k of keep) meta[k] = src[k];
    Object.assign(meta, { name: title, description: "", parent: id, base: id, branch: { from: id, at: now(), snapshot: await this.snapshotOf(id) }, created: now(), author });
    await this.writeMeta(nid, meta);
    await this.copyBoards(id, nid, author);
    return this.getEnv(nid);
  }

  // Gives a branch its own copy of every file, so an editor or agent can open them in its folder.
  async checkout(id) {
    const env = await this.getEnv(id);
    let n = 0;
    for (const f of await this.listFiles(id)) {
      if (!f.inherited) continue;
      await writeAtomic(path.join(this.envDir(id), ...f.path.split("/")), await this.readFile(id, f.path));
      n++;
    }
    if (env.base) {
      env.base = null;
      await this.writeMeta(id, env);
    }
    return { copied: n };
  }

  async diffEnv(id) {
    const env = await this.getEnv(id);
    if (!env.parent || !env.branch) throw new StoreError("not_branch", `${env.name} isn't a branch`);
    const parent = await this.getEnv(env.parent);
    const snap = env.branch.snapshot || { settings: {}, styles: {}, files: {} };
    const changes = [];
    let behind = 0;
    const cmp = (kind, B, P, S, label) => {
      for (const k of new Set([...Object.keys(B), ...Object.keys(S), ...Object.keys(P)])) {
        const b = B[k] ?? null,
          p = P[k] ?? null,
          s0 = S[k] ?? null;
        if (b !== s0) changes.push({ kind, key: k, label: label(k), base: s0, main: p, branch: b, conflict: p !== s0 && p !== b });
        else if (p !== s0) behind++;
      }
    };
    cmp("setting", flatSettings(env), flatSettings(parent), snap.settings || {}, settingLabel);
    cmp("style", cssMap(await this.getOverrides(id)), cssMap(await this.getOverrides(parent.id)), snap.styles || {}, (k) => k.replace("|", " · "));
    const own = (await this.listFiles(id)).filter((f) => !f.inherited && f.path !== "env.json" && f.path !== "overrides.css");
    const mainFiles = await this.fileHashes(parent.id);
    for (const f of own) {
      const hb = crypto.createHash("sha1").update(await this.readFile(id, f.path)).digest("hex");
      const hs = snap.files?.[f.path] ?? null;
      const hp = mainFiles[f.path] ?? null;
      if (hb !== hs) changes.push({ kind: "file", key: f.path, label: f.path, conflict: hp !== hs && hp !== hb });
    }
    for (const [f, hp] of Object.entries(mainFiles)) if ((snap.files?.[f] ?? null) !== hp && !own.some((o) => o.path === f)) behind++;
    return { branch: id, parent: parent.id, parentName: parent.name, changes, behind, conflicts: changes.filter((c) => c.conflict).length };
  }

  async mergeEnv(id, { take = {}, author = null } = {}) {
    const env = await this.getEnv(id);
    const d = await this.diffEnv(id);
    const before = await this.saveVersion(d.parent, { label: `Before merging ${env.name}`, author, kind: "auto" });
    const meta = await this.getEnv(d.parent);
    const styles = new Map();
    let applied = 0;
    for (const c of d.changes) {
      if (c.conflict && take[c.key] === "main") continue;
      applied++;
      if (c.kind === "setting") applySetting(meta, c.key, c.branch);
      if (c.kind === "style") {
        const [sel, prop] = c.key.split("|");
        if (!styles.has(sel)) styles.set(sel, {});
        styles.get(sel)[prop] = c.branch;
      }
      if (c.kind === "file") await writeAtomic(path.join(this.envDir(d.parent), ...c.key.split("/")), await this.readFile(id, c.key));
    }
    await this.writeMeta(d.parent, meta);
    for (const [sel, props] of styles) await this.setStyle(d.parent, sel, props);
    const after = await this.saveVersion(d.parent, { label: `Merged ${env.name}`, author, kind: "manual" });
    const fresh = await this.getEnv(id);
    Object.assign(fresh, { archived: true, mergedAt: now(), mergedInto: d.parent });
    await this.writeMeta(id, fresh);
    return { parent: await this.getEnv(d.parent), before, after, applied };
  }

  // Takes main's changes that the branch hasn't touched itself.
  async updateFromMain(id, { author = null } = {}) {
    const env = await this.getEnv(id);
    if (!env.parent || !env.branch) throw new StoreError("not_branch", `${env.name} isn't a branch`);
    const parent = await this.getEnv(env.parent);
    const snap = env.branch.snapshot || { settings: {}, styles: {} };
    const B = flatSettings(env),
      P = flatSettings(parent),
      S = snap.settings || {};
    let n = 0;
    for (const k of new Set([...Object.keys(P), ...Object.keys(S)])) {
      if ((P[k] ?? null) !== (S[k] ?? null) && (B[k] ?? null) === (S[k] ?? null)) (applySetting(env, k, P[k] ?? null), n++);
    }
    const Bs = cssMap(await this.getOverrides(id)),
      Ps = cssMap(await this.getOverrides(parent.id)),
      Ss = snap.styles || {};
    const styles = new Map();
    for (const k of new Set([...Object.keys(Ps), ...Object.keys(Ss)])) {
      if ((Ps[k] ?? null) !== (Ss[k] ?? null) && (Bs[k] ?? null) === (Ss[k] ?? null)) {
        const [sel, prop] = k.split("|");
        if (!styles.has(sel)) styles.set(sel, {});
        styles.get(sel)[prop] = Ps[k] ?? null;
        n++;
      }
    }
    env.branch = { ...env.branch, snapshot: await this.snapshotOf(parent.id), updatedFromMain: now() };
    await this.writeMeta(id, env);
    for (const [sel, props] of styles) await this.setStyle(id, sel, props);
    if (n) await this.saveVersion(id, { label: `Updated from ${parent.name}`, author, kind: "auto" });
    return { updated: n, env: await this.getEnv(id) };
  }

  async deleteEnv(id) {
    await this.getEnv(id);
    // Guard: a branch without its own copy reads its files from here; deleting it would break the branch.
    const users = (await this.listEnvs()).filter((e) => e.base === id);
    if (users.length) throw new StoreError("in_use", `${users.map((e) => e.name).join(", ")} still use${users.length === 1 ? "s" : ""} this prototype's files. Delete or merge ${users.length === 1 ? "that branch" : "those branches"} first.`, 409);
    const key = `${id}--${Date.now().toString(36)}`;
    await fsp.rename(this.envDir(id), path.join(this.metaDir, "trash", key));
    const boards = (await this.items()).filter((i) => i.env === id);
    for (const b of boards) await fsp.rm(path.join(this.canvasDir, `${b.id}.json`), { force: true });
    await writeJson(path.join(this.metaDir, "trash", `${key}.json`), { id, boards, at: now() });
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
    if (info.boards?.length) for (const b of info.boards) await this.putItem({ ...b, env: id });
    else await this.addBoard(id);
    return this.getEnv(id);
  }

  // ----- files -----

  // A file of this environment, or — for a branch that hasn't changed it — of its base.
  async resolveFile(id, rel, seen = new Set()) {
    const p = this.safeJoin(this.envDir(id), rel);
    const st = await fsp.stat(p).catch(() => null);
    if (st && st.isFile()) return p;
    // Guard: base chains are short and can't loop
    if (seen.has(id) || seen.size > 8) return null;
    seen.add(id);
    const meta = await readJson(path.join(this.envDir(id), "env.json"), {});
    return meta.base && ID_RE.test(meta.base) ? this.resolveFile(meta.base, rel, seen) : null;
  }

  async listFiles(id, seen = new Set()) {
    const own = (await listFilesRec(this.envDir(id)).catch(() => [])).map((f) => ({ ...f, inherited: null }));
    if (seen.has(id) || seen.size > 8) return own;
    seen.add(id);
    const meta = await readJson(path.join(this.envDir(id), "env.json"), {});
    if (!meta.base || !ID_RE.test(meta.base)) return own;
    const mine = new Set(own.map((f) => f.path));
    for (const f of await this.listFiles(meta.base, seen)) if (!mine.has(f.path) && f.path !== "env.json" && f.path !== "overrides.css") own.push({ ...f, inherited: f.inherited || meta.base });
    return own;
  }

  async readFile(id, rel) {
    const p = await this.resolveFile(id, rel);
    if (!p) throw new StoreError("not_found", `No file ${rel} in ${id}`, 404);
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

  // Several rules in one write, so a drag that touches many elements (reordering siblings) lands
  // whole or not at all, and undoes in one step.
  async setStyles(id, rules) {
    // Guard: one request edits at most this many rules, so a runaway client can't grind the file.
    if (!Array.isArray(rules) || !rules.length || rules.length > 100) throw new StoreError("bad_rules", "Send between 1 and 100 rules");
    const env = await this.getEnv(id);
    let next = (await this.getOverrides(id)) || OVERRIDES_HEAD(env.name);
    for (const r of rules) next = mergeRule(next, r?.selector, r?.props || {});
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

  async addComment({ env, board = null, x, y, selector = null, text, author = "You", parent = null }) {
    await this.getEnv(env);
    const t = String(text || "").trim();
    if (!t) throw new StoreError("empty", "Write a comment first");
    if (t.length > LIMITS.commentChars) throw new StoreError("too_big", "That comment is too long");
    const fx = Number(x),
      fy = Number(y);
    if (!parent && !(Number.isFinite(fx) && Number.isFinite(fy))) throw new StoreError("bad_position", "A comment needs a spot on the board");
    const id = newId("c");
    return this.putRecord("comments", { id, env, board: board ? assertRecord(String(board)) : null, x: parent ? null : Math.round(fx), y: parent ? null : Math.round(fy), selector: selector ? checkSelector(selector) : null, text: t, author: String(author).slice(0, 80), parent, resolved: false, createdAt: now() });
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

// ---------- flat views of settings and styles, so two sides can be compared key by key ----------

export function flatSettings(env) {
  const out = { theme: env.theme || "light", screen: env.screen ?? null, state: env.state ?? null, device: `${env.device?.w || 1728}×${env.device?.h || 1117}` };
  for (const [k, v] of Object.entries(env.variants || {})) out[`variant:${k}`] = v;
  for (const p of env.patches || []) if (p.type === "text") out[`text:${p.selector}`] = p.text;
  return out;
}

export function cssMap(css) {
  const out = {};
  for (const r of rulesOf(css || "")) for (const [p, v] of r.decls) out[`${normSel(r.selector)}|${p}`] = v;
  return out;
}

export function settingLabel(k) {
  if (k === "theme") return "Theme";
  if (k === "screen") return "Opens on";
  if (k === "state") return "Screen state";
  if (k === "device") return "Board size";
  if (k.startsWith("variant:")) return k.slice(8);
  if (k.startsWith("text:")) return `Text of ${k.slice(5)}`;
  return k;
}

export function applySetting(meta, k, v) {
  if (k === "theme") meta.theme = v || "light";
  else if (k === "screen") meta.screen = v ?? null;
  else if (k === "state") meta.state = v ?? null;
  else if (k === "device") {
    const m = /^(\d+)×(\d+)$/.exec(String(v || ""));
    if (m) meta.device = { w: +m[1], h: +m[2] };
  } else if (k.startsWith("variant:")) {
    meta.variants = { ...(meta.variants || {}) };
    if (v === null) delete meta.variants[k.slice(8)];
    else meta.variants[k.slice(8)] = v;
  } else if (k.startsWith("text:")) {
    const sel = k.slice(5);
    meta.patches = (meta.patches || []).filter((p) => !(p.type === "text" && p.selector === sel));
    if (v !== null) meta.patches.push({ type: "text", selector: sel, text: v });
  }
}
