// One state object for the Workshop UI, and a tiny event bus between its parts.
//
// Home lists the prototypes; each opens in a tab, like a file. Inside a prototype every branch is a
// page, as in a design tool: main is the first page, and each branch has a canvas of its own with
// the same screens, ready to change. The canvas shows one page at a time: its boards (the prototype
// at one screen each) and the notes, highlights, arrows and comments made on that page.

export const S = {
  ws: null, // workspace payload from /api/workspace
  envs: new Map(), // id → env
  items: new Map(), // id → canvas item
  comments: [],
  tasks: [],
  recipes: null, // the workspace's recipes with their run stats (null until loaded)
  versions: new Map(), // env id → [versions]
  diffs: new Map(), // branch id → review summary
  view: "home", // "home" | "proto"
  tabs: [], // open prototypes (root env ids), in tab order
  page: null, // the env shown on the canvas: a prototype's main or one of its branches
  compare: false, // show main's screens above the branch's
  // what's selected: {kind:"board", item, env} | {kind:"el", item, env, el, info} | {kind:"note"|"box"|"arrow", item}
  sel: null,
  hover: null, // {item, el}
  tool: "move", // move | hand | note | box | arrow | comment
  mode: "design", // design | prototype ("Interact": the pointer goes to the page)
  cam: { x: 320, y: 120, z: 0.25 }, // screen = world * z + (x, y)
  leftTab: "file", // file | screens | agents | notes | history
  rightTab: "design", // design | prototype
  scope: "exact", // element edits: "exact" (this element) or "class" (all like it, like a component)
  showArchived: false,
  showResolved: false,
  notesAll: false,
  placeState: "Default",
  chatOnBranch: true,
  draftSel: true,
  presenting: null,
  outlines: false,
  rulers: true,
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
export const boardsOf = (env) => [...S.items.values()].filter((i) => i.type === "board" && i.env === env);
export const itemsOf = (type) => [...S.items.values()].filter((i) => i.type === type);
export const isBranch = (e) => !!(e && e.parent && S.envs.has(e.parent));
// what a page is called in the editor: a branch by its name, a prototype's own page "Main"
export const pageName = (e) => (e ? (isBranch(e) ? e.name : "Main") : "");
export const rootOf = (id) => {
  let e = S.envs.get(id);
  for (let i = 0; e && e.parent && S.envs.has(e.parent) && i < 20; i++) e = S.envs.get(e.parent);
  return e || null;
};
export const roots = () => envList().filter((e) => !isBranch(e));
// a prototype and all its branches, main first, each branch after its parent
export function familyOf(rootId) {
  const all = envList().filter((e) => rootOf(e.id)?.id === rootId);
  const out = [];
  const add = (e, depth) => {
    out.push({ env: e, depth });
    for (const k of all.filter((x) => x.parent === e.id)) add(k, depth + 1);
  };
  const r = S.envs.get(rootId);
  if (r) add(r, 0);
  return out;
}
export const pageEnv = () => S.envs.get(S.page) || null;
export const protoId = () => rootOf(S.page)?.id || null;
export const selEnvId = () => S.sel?.env || (S.sel?.item && S.items.get(S.sel.item)?.env) || S.page || null;
export const selEnv = () => S.envs.get(selEnvId()) || null;
export const screenName = (b) => (b?.screen ? b.screen.replace(/^Settings › /, "Settings · ") : "Start screen");
export const plural = (n, one, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

// The page an item belongs to. Boards belong to their prototype; annotations carry the page they
// were made on. Older annotations without one go with the board they sit over.
export function pageOf(it) {
  if (!it) return null;
  if (it.type === "board" || it.env) return it.env || null;
  if (it.type === "arrow") {
    for (const end of [it.from, it.to]) if (end?.item && end.item !== it.id) return pageOf(S.items.get(end.item));
    return null;
  }
  return nearestBoard(it)?.env || null;
}
export function nearestBoard(it, env = null) {
  const r = it.type === "note" ? { x: it.x, y: it.y, w: it.w, h: 120 } : it.type === "box" ? it : null;
  if (!r) return null;
  const cx = r.x + r.w / 2,
    cy = r.y + r.h / 2;
  let best = null,
    bd = Infinity;
  for (const b of itemsOf("board")) {
    if (env && b.env !== env) continue;
    const dx = Math.max(b.x - cx, 0, cx - (b.x + b.w)),
      dy = Math.max(b.y - cy, 0, cy - (b.y + b.h));
    const d = Math.hypot(dx, dy);
    if (d < bd) (bd = d), (best = b);
  }
  return best;
}
export const onPage = (it, page = S.page) => !!it && pageOf(it) === page;
export const pageItems = (type, page = S.page) => itemsOf(type).filter((i) => onPage(i, page));
