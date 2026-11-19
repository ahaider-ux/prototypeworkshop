// One state object for the canvas UI, and a tiny event bus between its parts.
//
// The canvas holds items: boards (a prototype environment at one screen), notes, boxes and arrows.
// Each environment's boards form a section; a branch is an environment with a parent, drawn as its
// own section joined to the parent's by a lineage line.

export const S = {
  ws: null, // workspace payload from /api/workspace
  envs: new Map(), // id → env
  items: new Map(), // id → canvas item
  comments: [],
  tasks: [],
  versions: new Map(), // env id → [versions]
  diffs: new Map(), // branch id → review summary
  // what's selected: {kind:"section", env} | {kind:"board", item, env} | {kind:"el", item, env, el, info}
  //                  | {kind:"note"|"box"|"arrow", item}
  sel: null,
  hover: null, // {item, el}
  tool: "move", // move | hand | note | box | arrow | comment
  mode: "design", // design | prototype
  cam: { x: 320, y: 120, z: 0.25 }, // screen = world * z + (x, y)
  leftTab: "branches",
  rightTab: "design",
  scope: "class", // inspector edits: "class" (all matches) or "exact" (this element)
  showArchived: false,
  placeState: "Default",
  chatOnBranch: true,
  draftSel: true,
  presenting: null,
};

const subs = new Map();
export function on(evt, fn) {
  if (!subs.has(evt)) subs.set(evt, new Set());
  subs.get(evt).add(fn);
  return () => subs.get(evt).delete(fn);
}
export function fire(evt, data) {
  for (const fn of subs.get(evt) || []) {
    try {
      fn(data);
    } catch (e) {
      console.error(evt, e);
    }
  }
}

export const envList = () => [...S.envs.values()].sort((a, b) => String(a.created || "").localeCompare(String(b.created || "")) || a.id.localeCompare(b.id));
export const visibleEnvs = () => envList().filter((e) => S.showArchived || !e.archived);
export const boardsOf = (env) => [...S.items.values()].filter((i) => i.type === "board" && i.env === env);
export const itemsOf = (type) => [...S.items.values()].filter((i) => i.type === type);
export const selEnvId = () => S.sel?.env || (S.sel?.item && S.items.get(S.sel.item)?.env) || null;
export const selEnv = () => S.envs.get(selEnvId()) || null;
export const rootOf = (id) => {
  let e = S.envs.get(id);
  for (let i = 0; e && e.parent && S.envs.has(e.parent) && i < 20; i++) e = S.envs.get(e.parent);
  return e || null;
};
export const isBranch = (e) => !!(e && e.parent && S.envs.has(e.parent));
export const screenName = (b) => (b?.screen ? b.screen.replace(/^Settings › /, "Settings · ") : "Start screen");
