// One undo history for everything you do on the canvas: moving, resizing, adding and removing
// boards and annotations, and every edit to an element. ⌘Z undoes, ⌘⇧Z redoes.
//
// An entry is {label, undo, redo}. Undoing a removal puts the item back under a new id, so entries
// refer to items through rid(), which follows those replacements.

import { toast } from "./lib.js";

const PAST = [];
const FUTURE = [];
const IDS = new Map(); // old id → the id it came back as
const LIMIT = 200; // Guard: a long session shouldn't hold every edit it ever made

export const rid = (id) => {
  let x = id;
  for (let i = 0; i < 20 && IDS.has(x); i++) x = IDS.get(x);
  return x;
};
export const remap = (from, to) => from && to && from !== to && IDS.set(from, to);

export function record(entry) {
  PAST.push(entry);
  if (PAST.length > LIMIT) PAST.shift();
  FUTURE.length = 0;
}
let busy = false;
async function step(from, to, dir) {
  if (busy) return true;
  const e = from.pop();
  if (!e) return false;
  busy = true;
  try {
    await e[dir]();
    to.push(e);
    toast(`${dir === "undo" ? "Undid" : "Redid"} ${e.label}`);
  } catch (err) {
    toast(`Couldn't ${dir} ${e.label}`, err.message);
  } finally {
    busy = false;
  }
  return true;
}
export const undo = () => step(PAST, FUTURE, "undo");
// undo one particular entry (a toast's Undo button), wherever it now sits in the history
export async function undoEntry(entry) {
  const i = PAST.lastIndexOf(entry);
  if (i < 0 || busy) return false;
  PAST.splice(i, 1);
  PAST.push(entry);
  return undo();
}
export const redo = () => step(FUTURE, PAST, "redo");
export const canUndo = () => PAST.length > 0;
export const canRedo = () => FUTURE.length > 0;
// what undo and redo would do next, newest last (for the shortcuts and for checking)
export const labels = () => ({ undo: PAST.map((e) => e.label), redo: FUTURE.map((e) => e.label) });
