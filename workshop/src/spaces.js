// Spaces: the folders Atelier works in, remembered for this computer.
//
// A space is any folder. An Atelier workspace (a folder with workshop.json) keeps its data in
// itself. Any other folder — someone's own project — is connected in place: Atelier keeps its data
// in <folder>/.atelier and links to the prototypes it finds there, so agents and merges edit the
// project's real files (saving a version first).
//
// The list lives in ~/.atelier/spaces.json (or $ATELIER_HOME/spaces.json). The CLI and the MCP
// server open the current space when no --workspace is given.

import fs from "node:fs";
import fsp from "node:fs/promises";
import os from "node:os";
import path from "node:path";

const MAX_SPACES = 50; // Guard: the switcher is a menu, not a file index

export class SpaceError extends Error {
  constructor(message, status = 400) {
    super(message);
    this.code = "bad_space";
    this.status = status;
  }
}

export const spacesFile = () => path.join(process.env.ATELIER_HOME || path.join(os.homedir(), ".atelier"), "spaces.json");

export async function readSpaces(file) {
  let j = {};
  try {
    j = JSON.parse(await fsp.readFile(file, "utf8"));
  } catch {}
  const spaces = (Array.isArray(j.spaces) ? j.spaces : []).filter((s) => s && typeof s.path === "string" && path.isAbsolute(s.path)).slice(0, MAX_SPACES);
  return { current: typeof j.current === "string" && path.isAbsolute(j.current) ? j.current : null, spaces };
}

async function writeSpaces(file, data) {
  await fsp.mkdir(path.dirname(file), { recursive: true });
  const tmp = `${file}.${process.pid}.tmp`;
  await fsp.writeFile(tmp, JSON.stringify(data, null, 2) + "\n");
  await fsp.rename(tmp, file);
}

// remembers a space (most recent first) and, unless told otherwise, makes it the current one
export async function rememberSpace(file, folder, { name = null, current = true } = {}) {
  const d = await readSpaces(file);
  const prev = d.spaces.find((s) => s.path === folder);
  d.spaces = [{ path: folder, name: name || prev?.name || path.basename(folder), at: new Date().toISOString() }, ...d.spaces.filter((s) => s.path !== folder)].slice(0, MAX_SPACES);
  if (current) d.current = folder;
  await writeSpaces(file, d);
  return d;
}

export async function forgetSpace(file, folder) {
  const d = await readSpaces(file);
  d.spaces = d.spaces.filter((s) => s.path !== folder);
  if (d.current === folder) d.current = d.spaces[0]?.path || null;
  await writeSpaces(file, d);
  return d;
}

// The folder a person picked, checked. Guard: never the whole disk or the home folder itself —
// Atelier would write .atelier there and look through everything for prototypes.
export async function checkFolder(p) {
  const raw = String(p || "").trim().replace(/^~(?=$|[\\/])/, os.homedir());
  if (!raw || !path.isAbsolute(raw)) throw new SpaceError("Give the folder's full path, e.g. /Users/you/Projects/app");
  const abs = path.resolve(raw);
  const st = await fsp.stat(abs).catch(() => null);
  if (!st || !st.isDirectory()) throw new SpaceError(`There's no folder at ${abs}`, 404);
  if (abs === path.parse(abs).root || abs === os.homedir()) throw new SpaceError("Pick a project folder, not the whole disk or your home folder");
  return abs;
}

// where Atelier keeps a folder's data, and the folder the space shows
export function spaceRoots(folder) {
  if (path.basename(folder) === ".atelier") return { root: folder, home: path.dirname(folder) };
  if (fs.existsSync(path.join(folder, "workshop.json"))) return { root: folder, home: folder };
  return { root: path.join(folder, ".atelier"), home: folder };
}

// Subfolders of one folder, for picking a space from the browser (the editor can't read paths
// from the system file picker). Only names and whether a folder holds a prototype — no contents.
export async function listFolder(p) {
  const raw = String(p || "").trim().replace(/^~(?=$|[\\/])/, os.homedir());
  const abs = raw && path.isAbsolute(raw) ? path.resolve(raw) : os.homedir();
  const entries = await fsp.readdir(abs, { withFileTypes: true }).catch(() => null);
  if (!entries) throw new SpaceError(`Can't open ${abs}`, 404);
  const dirs = [];
  let pages = 0;
  for (const e of entries) {
    if (e.isFile() && /\.html?$/i.test(e.name)) pages++;
    if (!e.isDirectory() || e.name.startsWith(".") || e.name === "node_modules") continue;
    const full = path.join(abs, e.name);
    const kids = await fsp.readdir(full).catch(() => []);
    dirs.push({ name: e.name, path: full, prototype: kids.includes("index.html"), atelier: kids.includes(".atelier") || kids.includes("workshop.json") });
    if (dirs.length >= 500) break; // Guard: a huge folder still answers quickly
  }
  dirs.sort((a, b) => a.name.localeCompare(b.name));
  const parent = path.dirname(abs);
  return { path: abs, parent: parent === abs ? null : parent, home: os.homedir(), pages, hasIndex: entries.some((e) => e.isFile() && e.name === "index.html"), dirs };
}
