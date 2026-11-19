// One state object for the canvas UI, and a tiny event bus between its parts.

export const S = {
  ws: null, // workspace payload from /api/workspace
  envs: new Map(), // id → env
  comments: [],
  tasks: [],
  versions: new Map(), // id → [versions]
  view: "canvas",
  sel: null, // {kind:"board", env} | {kind:"el", env, el, info}
  hover: null, // {env, el}
  tool: "move", // move | hand | comment
  mode: "design", // design | prototype
  cam: { x: 80, y: 80, z: 0.4 }, // screen = world * z + (x, y)
  leftTab: "boards",
  rightTab: "design",
  scope: "class", // inspector edits: "class" (all matches) or "exact" (this element)
  live: false,
  draftSel: true, // attach the selection to the next agent request
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
export const selEnv = () => (S.sel ? S.envs.get(S.sel.env) : null);
