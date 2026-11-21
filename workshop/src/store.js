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
import zlib from "node:zlib";
import { parseCss, mergeRule, rulesOf, normSel, checkSelector, OVERRIDES_HEAD } from "./css.js";

export { parseCss, mergeRule, rulesOf } from "./css.js";

export const LIMITS = {
  // Guards: these stop a runaway agent or a bad upload from filling the disk or the browser.
  fileBytes: 64 * 1024 * 1024,
  logBytes: 256 * 1024,
  textPatchChars: 10_000,
  commentChars: 4_000,
  promptChars: 20_000,
  briefChars: 20_000,
  decisions: 200, // the decision log keeps the most recent ones
  recipes: 100,
  versionsPerEnv: 200,
  envs: 500,
  // a linked folder is versioned whole on every agent run and merge, so it has to stay prototype-sized
  linkFiles: 3000,
  linkBytes: 200 * 1024 * 1024,
  scanAdds: 60, // prototypes one "look for prototypes" adds at most
  snapshots: 600, // saved board pictures kept on this computer
  activity: 1500, // activity lines kept
  activityChars: 1200,
  assetBytes: 20 * 1024 * 1024,
  snapshotBytes: 24 * 1024 * 1024,
};

// Atelier's own files for a prototype; for a linked prototype they live in .atelier, never in its folder
const META_FILES = new Set(["env.json", "overrides.css"]);
// Guard: folders that are never part of a prototype and can hold huge trees
const skipEntry = (name) => name.startsWith(".") || name === "node_modules";

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
// Bumped by every write outside .workshop/ (this computer's own records): a prototype's files,
// overrides or settings changed, so its look is worked out again (Store.fingerprint).
let WRITES = 0;
export const noteWrite = () => WRITES++;
async function writeAtomic(file, data) {
  if (!String(file).includes(`${path.sep}.workshop${path.sep}`)) WRITES++;
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

async function listFilesRec(dir, base = dir, out = [], max = 20000) {
  for (const e of await fsp.readdir(dir, { withFileTypes: true })) {
    if (skipEntry(e.name) || out.length >= max) continue;
    const p = path.join(dir, e.name);
    if (e.isDirectory()) await listFilesRec(p, base, out, max);
    else if (e.isFile()) {
      const st = await fsp.stat(p);
      out.push({ path: path.relative(base, p).split(path.sep).join("/"), bytes: st.size, mtime: st.mtimeMs });
    }
  }
  return out;
}

// ---------- the store ----------

const emptyStats = () => ({ runs: 0, merged: 0, open: 0, failed: 0, discarded: 0, byVersion: {} });

// Ready-made recipes a new workspace starts with: the atelier's standing instructions.
const STARTER_RECIPES = [
  {
    name: "Apply my notes",
    description: "Reads every note, highlight, arrow and drawing on this branch's page, and fixes what each one points at.",
    // starts manual: running an agent on its own costs money, so someone switches this on deliberately
    trigger: "manual",
    prompt: [
      "Call list_canvas for this branch's page and read every annotation as a direction from the designer: notes (what they say), highlights (the boxed area), arrows (from what to what) and drawings (a circle means look here, a line under means keep, a cross means remove).",
      "For each one, screenshot the screen under it to see exactly what it marks, then make the change on this branch.",
      "Reply to comment pins you resolved. Don't change anything no annotation asks for.",
      "Finish with one line per annotation: what it asked and what you did.",
    ].join("\n"),
  },
  {
    name: "Polish pass",
    description: "Brings the screens back to the prototype's own design system: tokens, spacing, radii, type and states.",
    trigger: "manual",
    prompt: [
      "Review the screens on this page against the prototype's design system (read its CSS variables first).",
      "Fix values that are off the system: colours that aren't tokens, spacing off the scale, odd radii, type sizes off the ramp, inconsistent control heights.",
      "Make every interactive element show hover, focus-visible, pressed and disabled states.",
      "Use overrides.css for visual fixes. Don't redesign anything. List what you changed and why.",
    ].join("\n"),
  },
  {
    name: "State audit",
    description: "Adds the states a real product needs: empty, loading, error, long text and no results.",
    trigger: "manual",
    prompt: [
      "For every list, table, form and panel on this page's screens, check the states it would need in a real product: empty (saying what to do next), loading, error, one item, many items, very long text, and no search results.",
      "Add the missing ones in the prototype's own style, reachable through its existing state switcher if it has one.",
      "Don't remove anything. Finish with a table of components and the states you added.",
    ].join("\n"),
  },
];

// Pictures uploaded to the canvas: kept in canvas/assets (committed with the workspace), named by
// their content. Not SVG: an SVG can carry script, and these are served from the editor's origin.
const ASSET_RE = /^assets\/[0-9a-f]{24}\.(png|jpg|webp|gif)$/;
function imageKind(buf) {
  if (buf.length > 8 && buf.readUInt32BE(0) === 0x89504e47) return "png";
  if (buf.length > 3 && buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return "jpg";
  if (buf.length > 12 && buf.toString("ascii", 0, 4) === "RIFF" && buf.toString("ascii", 8, 12) === "WEBP") return "webp";
  if (buf.length > 6 && /^GIF8[79]a$/.test(buf.toString("ascii", 0, 6))) return "gif";
  return null;
}

// A frame's page: an .html file inside the prototype, never outside it or in a dot folder.
function frameFile(v) {
  const f = String(v || "").replace(/\\/g, "/").replace(/^\/+/, "");
  if (!/^[a-z0-9][a-z0-9 _./-]{0,160}\.html$/i.test(f) || f.split("/").some((seg) => !seg || seg === ".." || seg.startsWith("."))) throw new StoreError("bad_item", "A frame's page is an .html file in the prototype");
  return f;
}
// The page a new frame starts with: empty, saying what it's for, until someone designs it.
const frameHtml = (name, w, h) => `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${String(name).replace(/[<&>"]/g, "")}</title>
<style>
  html, body { margin: 0; height: 100%; font: 14px/1.5 system-ui, -apple-system, "Segoe UI", sans-serif; background: #fff; color: #6b6b73; }
  .empty { height: 100%; box-sizing: border-box; display: grid; place-items: center; padding: 24px; text-align: center; }
  .empty b { display: block; color: #18181b; font-weight: 600; margin-bottom: 4px; }
</style>
</head>
<body>
<!-- atelier:empty-frame — replace this page with the design (${w} × ${h}) -->
<div class="empty"><div><b>${String(name).replace(/[<&>"]/g, "")}</b>An empty ${w} × ${h} frame. Ask an agent to design it, or edit this file.</div></div>
</body>
</html>
`;

// instructions for an agent: a request typed on the canvas, or a recipe's text
function cleanPrompt(text, emptyMsg) {
  const t = String(text || "").trim();
  if (!t) throw new StoreError("empty", emptyMsg);
  // Guard: a prompt is pasted into an agent's context; a huge one would crowd out the work
  if (t.length > LIMITS.promptChars) throw new StoreError("too_big", "That's too long for an agent to read");
  return t;
}

export class Store {
  constructor(root) {
    this.root = path.resolve(root);
    // The folder a space shows. For a folder connected in place, Atelier keeps its data in
    // <folder>/.atelier and links to the prototypes beside it; otherwise it is the workspace itself.
    this.home = path.basename(this.root) === ".atelier" ? path.dirname(this.root) : this.root;
    this.links = new Map(); // env id → {dir, entry} for prototypes whose files live in the space's folder
    this.fps = new Map(); // env id → what its boards look like, as a hash (see fingerprint)
    this.envsDir = path.join(this.root, "envs");
    this.metaDir = path.join(this.root, ".workshop");
    this.canvasDir = path.join(this.root, "canvas");
    this.recipesDir = path.join(this.root, "recipes");
    this.snapDir = path.join(this.metaDir, "snapshots"); // saved board pictures, this computer only
  }

  static async open(root) {
    const s = new Store(root);
    await fsp.mkdir(s.envsDir, { recursive: true });
    for (const d of ["versions", "trash", "tasks", "comments", "shares", "harness", "snapshots"]) await fsp.mkdir(path.join(s.metaDir, d), { recursive: true });
    await fsp.mkdir(s.canvasDir, { recursive: true });
    if (!(await exists(s.recipesDir))) {
      await fsp.mkdir(s.recipesDir, { recursive: true });
      for (const r of STARTER_RECIPES) await s.addRecipe(r, "Atelier");
    }
    if (!(await exists(s.file("workshop.json")))) {
      await writeJson(s.file("workshop.json"), { name: path.basename(s.home) === "workspace" ? "Prototype workshop" : path.basename(s.home), agent: null });
    }
    // a connected folder's .atelier can be committed to share branches and notes; this computer's
    // own state (versions, trash, tasks) never should be
    if (s.root !== s.home && !(await exists(s.file(".gitignore")))) await writeAtomic(s.file(".gitignore"), "# this computer's own state: versions, trash, tasks, comments\n.workshop/\n");
    await s.migrateBoards();
    for (const id of await s.ids()) s.setLink(id, await readJson(path.join(s.envDir(id), "env.json"), {}));
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

  // ----- what a board looks like, for saved snapshots -----

  // Something on disk changed: every board's look is worked out again when asked (cheap, and a
  // branch's look depends on its parent's files).
  changed() {
    this.fps.clear();
    WRITES++;
  }
  // A hash of everything that decides how an environment's boards look: its files (a branch's
  // inherited ones included), its overrides and its look settings — not its name, notes or history.
  // A branch nobody has changed looks exactly like its parent, so it shares its parent's snapshots.
  async fingerprint(id) {
    const hit = this.fps.get(id);
    if (hit && hit.gen === WRITES) return hit.fp;
    const meta = await readJson(path.join(this.envDir(id), "env.json"), {});
    const files = (await this.listFiles(id)).filter((f) => !META_FILES.has(f.path)).map((f) => `${f.path}:${f.bytes}:${Math.round(f.mtime)}`).sort();
    const look = { theme: meta.theme, variants: meta.variants, patches: meta.patches, device: meta.device, entry: meta.entry || null };
    const fp = crypto.createHash("sha1").update(JSON.stringify([files, await this.getOverrides(id), look])).digest("hex").slice(0, 20);
    this.fps.set(id, { fp, gen: WRITES });
    return fp;
  }
  snapPath(key) {
    // Guard: a snapshot is named by a hash, so a request can only ever name a file in its folder
    if (!/^[0-9a-f]{40}$/.test(String(key))) throw new StoreError("bad_key", "Not a snapshot key");
    return path.join(this.snapDir, `${key}.svg.gz`);
  }
  // A snapshot is the board drawn as an SVG (the page and its styles, with scripts taken out), kept
  // gzipped. The browser can't hand over the pixels of such a drawing, but it redraws the SVG far
  // faster than loading and settling the prototype again.
  async readSnapshot(key) {
    return fsp.readFile(this.snapPath(key)).catch(() => null);
  }
  async writeSnapshot(key, buf) {
    // Guard: only an SVG drawing, and not a huge one (a 5 MB prototype draws to ~1-3 MB)
    if (!Buffer.isBuffer(buf) || buf.length > LIMITS.snapshotBytes || !/^\s*<svg[\s>]/.test(buf.toString("utf8", 0, 200))) throw new StoreError("bad_snapshot", "That isn't a board snapshot");
    await writeAtomic(this.snapPath(key), zlib.gzipSync(buf, { level: 6 }));
    // keep the folder bounded: the least recently written go first
    const names = (await fsp.readdir(this.snapDir).catch(() => [])).filter((n) => n.endsWith(".svg.gz"));
    if (names.length > LIMITS.snapshots) {
      const st = await Promise.all(names.map(async (n) => [n, (await fsp.stat(path.join(this.snapDir, n)).catch(() => null))?.mtimeMs || 0]));
      st.sort((a, b) => a[1] - b[1]);
      for (const [n] of st.slice(0, names.length - LIMITS.snapshots)) await fsp.rm(path.join(this.snapDir, n), { force: true });
    }
    return { key, bytes: buf.length };
  }

  // ----- linked prototypes: files in the space's own folder, edited in place -----

  // Guard: a link stays inside the space's folder, outside Atelier's own data, and off dot folders.
  linkDir(rel) {
    const clean = String(rel || "").replace(/\\/g, "/");
    if (path.isAbsolute(clean) || clean.split("/").some((seg) => seg === ".." || (seg.startsWith(".") && seg !== "."))) throw new StoreError("bad_path", "That folder isn't in this space");
    const p = path.resolve(this.home, clean || ".");
    const inside = (dir) => p === dir || p.startsWith(dir + path.sep);
    const ours = this.root === this.home ? [this.envsDir, this.metaDir, this.canvasDir, this.recipesDir] : [this.root];
    if (!inside(this.home) || ours.some(inside)) throw new StoreError("bad_path", "That folder isn't in this space");
    return p;
  }
  setLink(id, meta) {
    let link = null;
    try {
      if (meta?.link) link = { dir: this.linkDir(meta.link), entry: typeof meta.entry === "string" && /^[^/\\.][^/\\]*\.html?$/i.test(meta.entry) ? meta.entry : null };
    } catch {}
    if (link) this.links.set(id, link);
    else this.links.delete(id);
  }
  filesDir(id) {
    return this.links.get(id)?.dir || this.envDir(id);
  }
  // A linked single-file prototype (a loose page.html) is still "index.html" to everyone else.
  realRel(id, rel) {
    const entry = this.links.get(id)?.entry;
    return entry && rel === "index.html" ? entry : rel;
  }
  // where a file of this environment lives on disk (whether or not it exists yet)
  pathFor(id, rel) {
    const r = this.realRel(id, String(rel || ""));
    return this.safeJoin(META_FILES.has(r) ? this.envDir(id) : this.filesDir(id), r);
  }
  // Copies an environment's files (and Atelier's own) into dest, e.g. for a version or a copy.
  async copyFiles(id, dest, { asIndex = false } = {}) {
    await fsp.mkdir(dest, { recursive: true });
    const link = this.links.get(id);
    if (!link) return fsp.cp(this.envDir(id), dest, { recursive: true });
    // file by file from the listing, which skips dot folders: a page at the top of a connected
    // folder links to the folder that also holds .atelier
    for (const f of await listFilesRec(link.dir, link.dir, [], LIMITS.linkFiles)) {
      const to = path.join(dest, ...f.path.split("/"));
      await fsp.mkdir(path.dirname(to), { recursive: true });
      await fsp.copyFile(path.join(link.dir, ...f.path.split("/")), to);
    }
    for (const f of META_FILES) await fsp.cp(path.join(this.envDir(id), f), path.join(dest, f)).catch(() => {});
    if (asIndex && link.entry && !(await exists(path.join(dest, "index.html")))) await fsp.rename(path.join(dest, link.entry), path.join(dest, "index.html"));
  }

  // Makes a prototype of a folder (or one HTML file in it) in this space, without copying anything.
  async linkEnv(rel, { name = null, entry = null, author = null } = {}) {
    const dir = this.linkDir(rel);
    const file = entry || "index.html";
    if (!/^[^/\\.][^/\\]*\.html?$/i.test(file) || !(await exists(path.join(dir, file)))) throw new StoreError("bad_folder", `${rel || "That folder"} has no ${file}`);
    const files = await listFilesRec(dir, dir, [], LIMITS.linkFiles + 1);
    const bytes = files.reduce((n, f) => n + f.bytes, 0);
    if (files.length > LIMITS.linkFiles || bytes > LIMITS.linkBytes) throw new StoreError("too_big", `${rel || "That folder"} is too big to version (${files.length > LIMITS.linkFiles ? `over ${LIMITS.linkFiles} files` : `${Math.round(bytes / 1048576)} MB`}). Connect the folder that holds just the prototype.`);
    if ((await this.ids()).length >= LIMITS.envs) throw new StoreError("too_many", "This space has as many prototypes as it can hold");
    const html = await fsp.readFile(path.join(dir, file), "utf8");
    const title = String(name || titleOf(html) || (entry ? entry.replace(/\.html?$/i, "") : path.basename(dir))).slice(0, 120);
    const id = await this.uniqueId(title);
    await fsp.mkdir(this.envDir(id), { recursive: true });
    const link = path.relative(this.home, dir).split(path.sep).join("/") || ".";
    await this.writeMeta(id, { ...this.defaults(id), name: title, link, entry: entry || null, source: { kind: "linked", path: link + (entry ? `/${entry}` : "") }, author, created: now() });
    await this.addBoard(id, { author });
    return this.getEnv(id);
  }

  // Looks through the space's folder for prototypes it doesn't show yet: the folder's own
  // index.html, folders with an index.html (two levels down), and loose .html pages.
  async findPrototypes({ author = null } = {}) {
    const have = new Set([...this.links.values()].map((l) => path.join(l.dir, l.entry || "index.html")));
    const own = new Set([this.root, this.envsDir, this.canvasDir, this.recipesDir, this.metaDir]);
    const found = [];
    const look = async (dir, depth) => {
      const entries = await fsp.readdir(dir, { withFileTypes: true }).catch(() => []);
      if (entries.some((e) => e.isFile() && e.name === "index.html")) found.push({ dir, entry: null });
      else if (depth === 0) for (const e of entries) if (e.isFile() && /\.html?$/i.test(e.name) && !skipEntry(e.name)) found.push({ dir, entry: e.name });
      if (depth >= 2) return;
      for (const e of entries) if (e.isDirectory() && !skipEntry(e.name) && !own.has(path.join(dir, e.name))) await look(path.join(dir, e.name), depth + 1);
    };
    await look(this.home, 0);
    const added = [];
    const skipped = [];
    for (const f of found) {
      if (have.has(path.join(f.dir, f.entry || "index.html"))) continue;
      const rel = path.relative(this.home, f.dir).split(path.sep).join("/") || ".";
      if (added.length >= LIMITS.scanAdds) {
        skipped.push({ path: rel, why: "Too many at once" });
        continue;
      }
      try {
        added.push(await this.linkEnv(rel, { entry: f.entry, author }));
      } catch (e) {
        skipped.push({ path: rel + (f.entry ? `/${f.entry}` : ""), why: e.message });
      }
    }
    return { added, skipped };
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

  // ----- activity: what people and agents did, so everyone working here knows -----
  // One line per event in .workshop/activity.jsonl. People see it in the Activity panel; agents
  // read it before they start (get_activity, and the brief) and add to it (post_update), so two
  // agents on one prototype know about each other.
  async log({ kind, text, env = null, by = null, ref = null }) {
    const e = { at: now(), kind: String(kind || "update").slice(0, 24), text: String(text || "").trim().slice(0, LIMITS.activityChars), env: env ? String(env).slice(0, 64) : null, by: by ? String(by).slice(0, 80) : null, ref: ref ? String(ref).slice(0, 80) : null };
    if (!e.text) return null;
    const file = path.join(this.metaDir, "activity.jsonl");
    try {
      await fsp.appendFile(file, JSON.stringify(e) + "\n");
      // Guard: the log keeps the recent past, not everything forever
      const st = await fsp.stat(file);
      if (st.size > 2 * 1024 * 1024) {
        const lines = (await fsp.readFile(file, "utf8")).trim().split("\n");
        await writeAtomic(file, lines.slice(-LIMITS.activity).join("\n") + "\n");
      }
    } catch {}
    return e;
  }
  // newest last; env narrows it to one prototype and its branches
  async activity({ since = null, env = null, limit = 100 } = {}) {
    let lines = [];
    try {
      lines = (await fsp.readFile(path.join(this.metaDir, "activity.jsonl"), "utf8")).trim().split("\n");
    } catch {}
    let out = [];
    for (const l of lines.slice(-2000)) {
      try {
        const e = JSON.parse(l);
        if (e?.at) out.push(e);
      } catch {}
    }
    if (since) out = out.filter((e) => e.at > String(since));
    if (env) {
      const fam = await this.familyIds(env);
      out = out.filter((e) => !e.env || fam.has(e.env));
    }
    return out.slice(-Math.max(1, Math.min(500, Number(limit) || 100)));
  }
  // a prototype and all its branches, from any one of them
  async familyIds(env) {
    const chain = await this.ancestors(env).catch(() => []);
    const root = chain[chain.length - 1]?.id || env;
    const all = await this.ids();
    const metas = await Promise.all(all.map((id) => this.meta(id).then((m) => [id, m])));
    const fam = new Set([root]);
    for (let grew = true; grew; ) {
      grew = false;
      for (const [id, m] of metas) if (m?.parent && fam.has(m.parent) && !fam.has(id)) (fam.add(id), (grew = true));
    }
    return fam;
  }

  // ----- canvas assets: pictures dropped on the canvas -----
  async saveAsset(buf) {
    // Guard: a screenshot or export, not a video or an archive
    if (!Buffer.isBuffer(buf) || !buf.length || buf.length > LIMITS.assetBytes) throw new StoreError("too_big", "Pictures up to 20 MB can go on the canvas");
    const ext = imageKind(buf);
    if (!ext) throw new StoreError("bad_image", "That isn't a PNG, JPEG, WebP or GIF picture");
    const src = `assets/${crypto.createHash("sha1").update(buf).digest("hex").slice(0, 24)}.${ext}`;
    const file = path.join(this.canvasDir, src);
    if (!(await exists(file))) await writeAtomic(file, buf);
    return { src, bytes: buf.length };
  }
  assetPath(src) {
    if (!ASSET_RE.test(String(src))) throw new StoreError("bad_path", "Not a canvas picture");
    return path.join(this.canvasDir, src);
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
      // a frame shows its own page (file) of the prototype instead of one of its screens
      const file = p.file === undefined ? prev.file ?? null : p.file === null ? null : frameFile(p.file);
      return { ...at, env: e.id, screen: str(p.screen, 120, prev.screen ?? null), state: str(p.state, 60, prev.state ?? null), file, name: str(p.name, 120, prev.name ?? null), w: num(p.w, 120, 4096, prev.w ?? e.device.w), h: num(p.h, 120, 4096, prev.h ?? e.device.h) };
    }
    if (type === "note") {
      const tone = p.tone ?? prev.tone ?? "warm";
      if (!["warm", "info", "plain"].includes(tone)) throw new StoreError("bad_item", "A note is warm, info or plain");
      return { ...at, env: page, w: num(p.w, 120, 800, prev.w ?? 240), text: str(p.text, LIMITS.commentChars, prev.text ?? ""), tone };
    }
    if (type === "web") {
      // a live link: a Figma file, a running app (localhost, a preview deploy), any web page
      const url = p.url === undefined ? prev.url : String(p.url || "").trim().slice(0, 2000);
      let u;
      try {
        u = new URL(url);
      } catch {}
      // Guard: only web pages; a javascript: or file: link would run or read things it shouldn't
      if (!u || !/^https?:$/.test(u.protocol)) throw new StoreError("bad_item", "A link needs a full web address, starting with https:// or http://");
      return { ...at, env: page, url: u.href, name: str(p.name, 120, prev.name ?? null), w: num(p.w, 160, 4096, prev.w ?? 1280), h: num(p.h, 120, 4096, prev.h ?? 800) };
    }
    if (type === "image") {
      const src = p.src === undefined ? prev.src : String(p.src || "");
      // Guard: an image is one of this canvas's own uploads, never a path elsewhere
      if (!ASSET_RE.test(src)) throw new StoreError("bad_item", "An image is a picture uploaded to the canvas");
      return { ...at, env: page, src, name: str(p.name, 120, prev.name ?? null), w: num(p.w, 16, 8192, prev.w ?? 640), h: num(p.h, 16, 8192, prev.h ?? 480) };
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
    throw new StoreError("bad_item", "Boards, notes, boxes, arrows, drawings, links and pictures go on the canvas");
  }

  async addItem(p, author = null) {
    const type = String(p?.type || "");
    if ((await this.items()).length >= 2000) throw new StoreError("too_many", "This canvas holds as much as it can");
    const prefix = { board: "b", note: "n", box: "x", arrow: "a", ink: "k", web: "w", image: "m" }[type] || "i";
    const it = { id: newId(prefix), type, ...(await this.cleanItem(type, p)), author, createdAt: now() };
    return this.putItem(it);
  }

  async updateItem(id, patch, by = null) {
    const it = await this.item(id);
    const next = { ...it, ...(await this.cleanItem(it.type, patch || {}, it)), updatedAt: now() };
    const out = await this.putItem(next);
    // a note's first words are worth telling everyone; later edits aren't
    if (it.type === "note" && !String(it.text || "").trim() && String(next.text || "").trim()) await this.log({ kind: "note", text: `Noted: ${next.text.slice(0, 300)}`, env: next.env, by: by || it.author, ref: id });
    return out;
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

  // A new frame: an empty page of the prototype (frames/<name>.html) at any size, for people or
  // agents to design. On a branch it's the branch's own file, so merging brings it over.
  async addFrame(env, { name = "Frame", w = 1440, h = 900, x, y, author = null } = {}) {
    const e = await this.getEnv(env);
    const title = String(name || "Frame").trim().slice(0, 120) || "Frame";
    const have = new Set((await this.listFiles(e.id)).map((f) => f.path));
    let file = `frames/${slug(title)}.html`;
    for (let i = 2; have.has(file) && i < 1000; i++) file = `frames/${slug(title)}-${i}.html`;
    const W = Math.round(Number(w)) || 1440,
      H = Math.round(Number(h)) || 900;
    await this.writeFile(e.id, file, frameHtml(title, W, H));
    let at = {};
    if (Number.isFinite(Number(x)) && Number.isFinite(Number(y))) at = { x: Math.round(x), y: Math.round(y) };
    else {
      const b = await this.boundsOf(e.id);
      if (b) at = { x: b.x1 + 120, y: b.y0 };
    }
    const it = await this.addItem({ type: "board", env: e.id, file, name: title, w: W, h: H, ...at }, author);
    await this.log({ kind: "frame", text: `Drew the frame "${title}" (${W} × ${H})`, env: e.id, by: author, ref: it.id });
    return it;
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
    return { ...meta, updatedAt: new Date(updated).toISOString(), bytes: st.size, versions: (await this.listVersions(id)).length, overrides: rulesOf(overrides).length, ownIndex: index === this.pathFor(id, "index.html"), folder: this.filesDir(id), linked: this.links.has(id), look: await this.fingerprint(id) };
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
    this.changed();
    const { versions, overrides, updatedAt, bytes, ownIndex, folder, linked, look, ...keep } = meta;
    await writeJson(path.join(this.envDir(id), "env.json"), { ...keep, id });
    this.setLink(id, keep);
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
    // the brief every agent reads first: what this prototype is, its rules, what to keep
    if (typeof p.brief === "string") env.brief = p.brief.slice(0, LIMITS.briefChars);
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
    if (p.archived) await this.cancelWaiting(id, "The branch was archived");
    return this.getEnv(id);
  }

  async forkEnv(id, { name, version = null, author = null } = {}) {
    const src = await this.getEnv(id);
    const from = version === null || version === undefined ? null : path.join(this.versionDir(id, version), "files");
    if (from && !(await exists(from))) throw new StoreError("not_found", `No version ${version} of ${id}`, 404);
    let title = String(name || `${src.name} copy`).slice(0, 120);
    if (!name) {
      // "X copy", then "X copy 2", "X copy 3" — two boards never share a name
      const names = new Set((await this.listEnvs()).map((e) => e.name));
      for (let i = 2; names.has(title) && i < 1000; i++) title = `${src.name} copy ${i}`;
    }
    const nid = await this.uniqueId(title);
    // a copy is always the copy's own: files come into its folder, and it isn't linked
    if (from) await fsp.cp(from, this.envDir(nid), { recursive: true });
    else await this.copyFiles(id, this.envDir(nid), { asIndex: true });
    const entry = this.links.get(id)?.entry;
    if (from && entry && !(await exists(path.join(this.envDir(nid), "index.html")))) await fsp.rename(path.join(this.envDir(nid), entry), path.join(this.envDir(nid), "index.html")).catch(() => {});
    const meta = { ...this.defaults(nid), ...(await readJson(path.join(this.envDir(nid), "env.json"), {})) };
    await this.writeMeta(nid, { ...meta, id: nid, link: null, entry: null, name: title, description: "", parent: id, branch: null, archived: false, forkedFrom: { env: id, version: version ?? null, at: now() }, created: now(), author });
    await this.copyBoards(id, nid, author);
    return this.getEnv(nid);
  }

  // The same screens for `to`, in the same places: a branch is its own page, laid out like its parent.
  async copyBoards(from, to, author = null) {
    const src = (await this.items()).filter((i) => i.type === "board" && i.env === from);
    if (!src.length) return [await this.addBoard(to, { author, x: 0, y: 0 })];
    const out = [];
    for (const b of src) out.push(await this.addItem({ type: "board", env: to, screen: b.screen, state: b.state, file: b.file ?? null, name: b.name ?? null, x: b.x, y: b.y, w: b.w, h: b.h }, author));
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
    await this.log({ kind: "branch", text: `Branched "${title}" from ${src.parent ? `"${src.name}"` : "main"}`, env: nid, by: author });
    return this.getEnv(nid);
  }

  // Gives a branch its own copy of every file, so an editor or agent can open them in its folder.
  async checkout(id) {
    this.changed();
    const env = await this.getEnv(id);
    let n = 0;
    for (const f of await this.listFiles(id)) {
      if (!f.inherited) continue;
      await writeAtomic(this.pathFor(id, f.path), await this.readFile(id, f.path));
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

  async mergeEnv(id, { take = {}, author = null, note = "" } = {}) {
    this.changed();
    const env = await this.getEnv(id);
    const d = await this.diffEnv(id);
    const before = await this.saveVersion(d.parent, { label: `Before merging ${env.name}`, author, kind: "auto" });
    const meta = await this.getEnv(d.parent);
    const styles = new Map();
    const kept = [];
    for (const c of d.changes) {
      if (c.conflict && take[c.key] === "main") continue;
      kept.push(c.label);
      if (c.kind === "setting") applySetting(meta, c.key, c.branch);
      if (c.kind === "style") {
        const [sel, prop] = c.key.split("|");
        if (!styles.has(sel)) styles.set(sel, {});
        styles.get(sel)[prop] = c.branch;
      }
      if (c.kind === "file") await writeAtomic(this.pathFor(d.parent, c.key), await this.readFile(id, c.key)); // a linked prototype's real file
    }
    // what was decided, kept with the prototype so people and agents can read the reasoning later
    const applied = kept.length;
    meta.decisions = [...(meta.decisions || []), { at: now(), branch: id, branchName: env.name, author, note: String(note || "").slice(0, 2000), changes: kept.slice(0, 40), applied }].slice(-LIMITS.decisions);
    await this.writeMeta(d.parent, meta);
    for (const [sel, props] of styles) await this.setStyle(d.parent, sel, props);
    const after = await this.saveVersion(d.parent, { label: `Merged ${env.name}`, author, kind: "manual" });
    const fresh = await this.getEnv(id);
    Object.assign(fresh, { archived: true, mergedAt: now(), mergedInto: d.parent });
    await this.writeMeta(id, fresh);
    await this.cancelWaiting(id, "The branch was merged");
    await this.log({ kind: "merge", text: `Merged "${env.name}": ${applied} change${applied === 1 ? "" : "s"}${note ? `. Why: ${String(note).slice(0, 300)}` : ""}`, env: d.parent, by: author, ref: id });
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
    this.changed();
    await this.getEnv(id);
    // Guard: a branch without its own copy reads its files from here; deleting it would break the branch.
    const users = (await this.listEnvs()).filter((e) => e.base === id);
    if (users.length) throw new StoreError("in_use", `${users.map((e) => e.name).join(", ")} still use${users.length === 1 ? "s" : ""} this prototype's files. Delete or merge ${users.length === 1 ? "that branch" : "those branches"} first.`, 409);
    const key = `${id}--${Date.now().toString(36)}`;
    // for a linked prototype only Atelier's own data goes to the trash; its folder stays where it is
    await fsp.rename(this.envDir(id), path.join(this.metaDir, "trash", key));
    this.links.delete(id);
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
    this.setLink(id, await readJson(path.join(this.envDir(id), "env.json"), {}));
    if (info.boards?.length) for (const b of info.boards) await this.putItem({ ...b, env: id });
    else await this.addBoard(id);
    return this.getEnv(id);
  }

  // ----- files -----

  // A file of this environment, or — for a branch that hasn't changed it — of its base.
  async resolveFile(id, rel, seen = new Set()) {
    const p = this.pathFor(id, rel);
    const st = await fsp.stat(p).catch(() => null);
    if (st && st.isFile()) return p;
    // Guard: base chains are short and can't loop
    if (seen.has(id) || seen.size > 8) return null;
    seen.add(id);
    const meta = await readJson(path.join(this.envDir(id), "env.json"), {});
    return meta.base && ID_RE.test(meta.base) ? this.resolveFile(meta.base, rel, seen) : null;
  }

  async listFiles(id, seen = new Set()) {
    let own = (await listFilesRec(this.filesDir(id)).catch(() => [])).map((f) => ({ ...f, inherited: null }));
    const link = this.links.get(id);
    if (link) {
      // Atelier's own files come from .atelier; a single-page prototype's page is its index.html
      own = own.filter((f) => !META_FILES.has(f.path) && !(link.entry && f.path === "index.html")).map((f) => (f.path === link.entry ? { ...f, path: "index.html" } : f));
      for (const m of META_FILES) {
        const st = await fsp.stat(path.join(this.envDir(id), m)).catch(() => null);
        if (st) own.push({ path: m, bytes: st.size, mtime: st.mtimeMs, inherited: null });
      }
    }
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
    this.changed();
    await this.getEnv(id);
    const buf = Buffer.isBuffer(content) ? content : Buffer.from(String(content));
    if (buf.length > LIMITS.fileBytes) throw new StoreError("too_big", "That file is too big");
    const p = this.pathFor(id, rel);
    const isMeta = p === path.join(this.envDir(id), "env.json");
    if (isMeta) JSON.parse(buf.toString("utf8")); // a broken env.json would hide the environment
    await writeAtomic(p, buf);
    if (isMeta) this.setLink(id, JSON.parse(buf.toString("utf8")));
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
    this.changed();
    const env = await this.getEnv(id);
    const cur = (await this.getOverrides(id)) || OVERRIDES_HEAD(env.name);
    const next = mergeRule(cur, selector, props);
    await writeAtomic(path.join(this.envDir(id), "overrides.css"), next);
    return { css: next, rules: rulesOf(next) };
  }

  // Several rules in one write, so a drag that touches many elements (reordering siblings) lands
  // whole or not at all, and undoes in one step.
  async setStyles(id, rules) {
    this.changed();
    // Guard: one request edits at most this many rules, so a runaway client can't grind the file.
    if (!Array.isArray(rules) || !rules.length || rules.length > 100) throw new StoreError("bad_rules", "Send between 1 and 100 rules");
    const env = await this.getEnv(id);
    let next = (await this.getOverrides(id)) || OVERRIDES_HEAD(env.name);
    for (const r of rules) next = mergeRule(next, r?.selector, r?.props || {});
    await writeAtomic(path.join(this.envDir(id), "overrides.css"), next);
    return { css: next, rules: rulesOf(next) };
  }

  async clearStyles(id, selector) {
    this.changed();
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
    await this.copyFiles(id, path.join(dir, "files"));
    const meta = { n, label: String(label || `Version ${n}`).slice(0, 120), author, kind, at: now(), bytes: await dirSize(path.join(dir, "files")) };
    await writeJson(path.join(dir, "version.json"), meta);
    return meta;
  }

  async restoreVersion(id, n, { author = null } = {}) {
    this.changed();
    const dir = path.join(this.versionDir(id, n), "files");
    if (!(await exists(dir))) throw new StoreError("not_found", `No version ${n} of ${id}`, 404);
    const before = await this.saveVersion(id, { label: `Before restoring version ${n}`, author, kind: "auto" });
    if (this.links.has(id)) {
      // A linked folder is someone's real project: put back every file the version had, but never
      // swap or empty the folder (files added since stay, and are in the version saved just now).
      for (const f of await listFilesRec(dir)) {
        const target = META_FILES.has(f.path) ? path.join(this.envDir(id), f.path) : this.safeJoin(this.filesDir(id), f.path);
        await writeAtomic(target, await fsp.readFile(path.join(dir, ...f.path.split("/"))));
      }
      this.setLink(id, await readJson(path.join(this.envDir(id), "env.json"), {}));
      return { env: await this.getEnv(id), before };
    }
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

  // one JSON file per record in a folder: local records live in .workshop/<kind>, recipes in recipes/
  async readAll(dir) {
    const files = (await fsp.readdir(dir).catch(() => [])).filter((f) => f.endsWith(".json"));
    const out = (await Promise.all(files.map((f) => readJson(path.join(dir, f), null)))).filter(Boolean);
    return out.sort((a, b) => String(a.createdAt || "").localeCompare(String(b.createdAt || "")));
  }
  async readOne(dir, id, what) {
    const r = await readJson(path.join(dir, `${assertRecord(id)}.json`), null);
    if (!r) throw new StoreError("not_found", `No ${what} ${id}`, 404);
    return r;
  }
  async writeOne(dir, r) {
    await writeJson(path.join(dir, `${assertRecord(r.id)}.json`), r);
    return r;
  }

  records(kind) {
    return this.readAll(path.join(this.metaDir, kind));
  }
  record(kind, id) {
    return this.readOne(path.join(this.metaDir, kind), id, kind.replace(/s$/, ""));
  }
  putRecord(kind, r) {
    return this.writeOne(path.join(this.metaDir, kind), r);
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

  async addTask({ env, prompt, selection = null, author = "You", runner = "harness", recipe = null }) {
    await this.getEnv(env);
    const p = cleanPrompt(prompt, "Say what the agent should change");
    const sel = selection && typeof selection === "object" ? { selector: String(selection.selector || "").slice(0, LIMITS.selectorChars), label: String(selection.label || "").slice(0, 120), html: String(selection.html || "").slice(0, 4000), text: String(selection.text || "").slice(0, 600), styles: selection.styles && typeof selection.styles === "object" ? selection.styles : null } : null;
    const rec = recipe && typeof recipe === "object" && typeof recipe.id === "string" ? { id: assertRecord(recipe.id), n: Number.isInteger(recipe.n) ? recipe.n : null, name: String(recipe.name || "").slice(0, 120) } : null;
    const t = await this.putRecord("tasks", { id: newId("t"), env, prompt: p, selection: sel, recipe: rec, author: String(author).slice(0, 80), runner, status: "queued", log: [], reply: null, claimedBy: null, beforeVersion: null, changed: [], createdAt: now(), updatedAt: now() });
    await this.log({ kind: "request", text: rec ? `Ran the recipe "${rec.name}"` : `Asked: ${p.slice(0, 240)}`, env, by: t.author, ref: t.id });
    return t;
  }

  // A branch that's merged or archived is finished: requests still waiting on it would only run an
  // agent on a page nobody looks at. (One already working is left to finish or be stopped.)
  async cancelWaiting(env, why) {
    for (const t of await this.records("tasks")) if (t.env === env && t.status === "queued") await this.updateTask(t.id, { status: "cancelled", log: why, logKind: "note" });
  }

  async updateTask(id, patch) {
    const t = await this.record("tasks", id);
    const STATUS = new Set(["queued", "working", "done", "failed", "cancelled"]);
    const was = t.status;
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
    const saved = await this.putRecord("tasks", t);
    if (t.status !== was && (t.status === "working" || t.status === "done" || t.status === "failed")) {
      const what = t.recipe?.name ? `the recipe "${t.recipe.name}"` : `"${t.prompt.slice(0, 120)}"`;
      const text = t.status === "working" ? `Started on ${what}` : t.status === "done" ? `Finished ${what}${t.reply ? `: ${t.reply.slice(0, 400)}` : ""}` : `Couldn't finish ${what}${t.reply ? `: ${t.reply.slice(0, 300)}` : ""}`;
      await this.log({ kind: t.status === "working" ? "start" : t.status, text, env: t.env, by: t.claimedBy || "Agent", ref: t.id });
    }
    return saved;
  }

  // ----- recipes: shared, versioned ways of working that agents run on a branch -----
  // One file each in workspace/recipes/, committed with the workspace, so the whole team shares them.
  // A recipe is specific (one kind of job), shared (anyone can run it), and scrutinised (its runs
  // are counted and its instructions are versioned: testing, production, retired).

  async listRecipes() {
    const all = (await this.readAll(this.recipesDir)).filter((r) => r.id && Array.isArray(r.versions));
    return all.sort((a, b) => (a.order ?? 1e9) - (b.order ?? 1e9)); // stable: ties keep creation order
  }
  getRecipe(id) {
    return this.readOne(this.recipesDir, id, "recipe");
  }
  putRecipe(r) {
    return this.writeOne(this.recipesDir, r);
  }
  async addRecipe({ name, description = "", prompt, trigger = "manual" }, author = "You") {
    // Guard: recipes are shared instructions, not a dumping ground; a hundred is plenty for a team.
    const existing = await this.listRecipes();
    if (existing.length >= LIMITS.recipes) throw new StoreError("too_many", "This workspace has as many recipes as it can hold");
    const nm = String(name || "").trim().slice(0, 80);
    if (!nm) throw new StoreError("empty", "Give the recipe a name");
    return this.putRecipe({ id: newId("r"), name: nm, description: String(description).slice(0, 400), trigger: trigger === "on-notes" ? "on-notes" : "manual", order: Math.max(-1, ...existing.map((r) => r.order ?? -1)) + 1, versions: [{ n: 1, prompt: cleanPrompt(prompt, "Write the recipe's instructions"), status: "production", at: now(), author, note: "First version" }], createdAt: now(), author });
  }
  async updateRecipe(id, patch = {}) {
    const r = await this.getRecipe(id);
    if (typeof patch.name === "string" && patch.name.trim()) r.name = patch.name.trim().slice(0, 80);
    if (typeof patch.description === "string") r.description = patch.description.slice(0, 400);
    if (patch.trigger === "manual" || patch.trigger === "on-notes") r.trigger = patch.trigger;
    r.updatedAt = now();
    return this.putRecipe(r);
  }
  // a new version starts in testing; production keeps running until someone promotes it
  async addRecipeVersion(id, { prompt, note = "", author = "You" }) {
    const r = await this.getRecipe(id);
    const n = Math.max(0, ...r.versions.map((v) => v.n)) + 1;
    r.versions = [...r.versions, { n, prompt: cleanPrompt(prompt, "Write the recipe's instructions"), status: "testing", at: now(), author, note: String(note).slice(0, 200) }].slice(-50);
    r.updatedAt = now();
    return this.putRecipe(r);
  }
  async promoteRecipeVersion(id, n) {
    const r = await this.getRecipe(id);
    const v = r.versions.find((x) => x.n === Number(n));
    if (!v) throw new StoreError("not_found", "That version doesn't exist", 404);
    for (const x of r.versions) if (x.status === "production") x.status = "retired";
    v.status = "production";
    r.updatedAt = now();
    return this.putRecipe(r);
  }
  async deleteRecipe(id) {
    await this.getRecipe(id);
    await fsp.rm(path.join(this.recipesDir, `${assertRecord(id)}.json`), { force: true });
  }
  recipeVersion(r, n = null) {
    return (n !== null && r.versions.find((v) => v.n === Number(n))) || r.versions.find((v) => v.status === "production") || r.versions[r.versions.length - 1];
  }
  // run a recipe: from main it works on a new branch (a shadow run you review and merge); on a branch, there
  async runRecipe(id, env, { version = null, author = "You", runner = "harness" } = {}) {
    const r = await this.getRecipe(id);
    const v = this.recipeVersion(r, version);
    const e = await this.getEnv(env);
    const target = e.parent ? e.id : (await this.branchEnv(e.id, { name: r.name, author })).id;
    const busy = (await this.records("tasks")).find((t) => t.env === target && t.recipe?.id === r.id && (t.status === "queued" || t.status === "working"));
    if (busy) return { task: busy, env: target, already: true };
    const task = await this.addTask({ env: target, prompt: `${r.name}${v.status === "testing" ? ` (testing v${v.n})` : ""}`, author, runner, recipe: { id: r.id, n: v.n, name: r.name } });
    return { task, env: target, already: false };
  }
  // how a recipe is doing: runs, and what became of their branches
  // recipes: the recipes to report on (every one gets an entry, with zeros when it never ran)
  async recipeStats(recipes = null) {
    const tasks = (await this.records("tasks")).filter((t) => t.recipe?.id);
    const ids = [...new Set(tasks.map((t) => t.env))];
    const metas = await Promise.all(ids.map((id) => this.meta(id)));
    const envs = new Map(ids.map((id, i) => [id, metas[i]]));
    const out = {};
    for (const r of recipes || []) out[r.id] = emptyStats();
    for (const t of tasks) {
      const s = (out[t.recipe.id] ||= emptyStats());
      const e = envs.get(t.env);
      // the branch decides: merged, thrown away, or still open; a run that never finished on a live branch failed
      const outcome = e?.mergedAt ? "merged" : !e || e.archived ? "discarded" : t.status === "failed" || t.status === "cancelled" ? "failed" : "open";
      s.runs++;
      s[outcome]++;
      const bv = (s.byVersion[t.recipe.n] ||= { runs: 0, merged: 0 });
      bv.runs++;
      if (outcome === "merged") bv.merged++;
    }
    return out;
  }
  // what an agent reads before working on a page: the prototype's brief, its recent decisions, and
  // the recipe's instructions when the task came from one
  // Never throws: missing context means a plainer brief, not a failed task.
  async contextFor(envId, task = null) {
    try {
      const chain = await this.ancestors(envId);
      const brief = chain.find((e) => e.brief)?.brief || "";
      const decisions = (chain[chain.length - 1]?.decisions || []).slice(-10);
      let recipe = null;
      const r = task?.recipe?.id ? await this.getRecipe(task.recipe.id).catch(() => null) : null;
      if (r) {
        const v = this.recipeVersion(r, task.recipe.n);
        recipe = { name: r.name, n: v.n, prompt: v.prompt };
      }
      const activity = (await this.activity({ env: envId, limit: 40 })).filter((e) => e.ref !== task?.id).slice(-10);
      return { brief, decisions, recipe, activity, entry: this.pathFor(envId, "index.html"), overrides: path.join(this.envDir(envId), "overrides.css") };
    } catch {
      return { brief: "", decisions: [], recipe: null };
    }
  }
  // an environment's saved settings only (env.json), without the file checks getEnv makes
  async meta(id) {
    return readJson(path.join(this.envDir(id), "env.json"), null);
  }
  // this environment, its parent, and so on up to its prototype
  async ancestors(id) {
    const chain = [];
    // Guard: a hand-edited env.json could point parents in a circle
    for (let cur = id; cur && chain.length < 16 && !chain.some((e) => e.id === cur); ) {
      const m = await this.meta(cur);
      if (!m) break;
      chain.push({ ...m, id: cur });
      cur = m.parent;
    }
    return chain;
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
