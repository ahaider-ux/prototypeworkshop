// Style edits on a page: every change — from the inspector, a drag on the canvas, a nudge — is a CSS
// rule in that page's overrides.css, so it shows in every board, in Present and in share links, and
// shows up in Review and merge. While a drag is under way the change is previewed inline; it is
// written once, on release, and each write can be undone.

import { S, fire, boardsOf } from "./state.js";
import { api, toast } from "./lib.js";
import { rt, refreshSelInfo, markDirty } from "./canvas.js";

const OV = new Map(); // env id → overrides.css text
export async function loadOverrides(id, force = false) {
  if (!force && OV.has(id)) return OV.get(id);
  try {
    OV.set(id, (await api(`envs/${id}/styles`)).css);
  } catch {
    OV.set(id, "");
  }
  return OV.get(id);
}
export const cachedOverrides = (id) => OV.get(id);
export const forgetOverrides = (id) => OV.delete(id);
export function parseRules(css) {
  const out = [];
  const re = /([^{}@][^{}]*)\{([^{}]*)\}/g;
  let m;
  const src = String(css || "").replace(/\/\*[\s\S]*?\*\//g, "");
  while ((m = re.exec(src)))
    out.push({
      selector: m[1].trim().replace(/\s+/g, " "),
      decls: m[2]
        .split(";")
        .map((d) => d.trim())
        .filter(Boolean)
        .map((d) => [d.slice(0, d.indexOf(":")).trim(), d.slice(d.indexOf(":") + 1).trim().replace(/\s*!important$/, "")]),
    });
  return out;
}
export const norm = (s) => String(s || "").replace(/\s+/g, " ").replace(/\s*>\s*/g, " > ").trim();
export const boardsLive = (env) => boardsOf(env).map((b) => rt(b.id)).filter(Boolean);
// the rules overrides.css has for these selectors
export function rulesFor(env, selectors) {
  const want = new Set(selectors.filter(Boolean).map(norm));
  return parseRules(OV.get(env) || "").filter((r) => want.has(norm(r.selector)));
}

// ---------- writing ----------
const UNDO = [];
let writing = Promise.resolve();
// rules: [{selector, props: {prop: value | null}}]
export function commitRules(env, rules, label) {
  rules = rules.filter((r) => r.selector && Object.keys(r.props || {}).length);
  if (!env || !rules.length) return Promise.resolve(false);
  // one write at a time, in order, so quick nudges never land out of sequence
  const run = async () => {
    const cur = parseRules(await loadOverrides(env));
    const prev = rules.map((r) => {
      const had = cur.find((x) => norm(x.selector) === norm(r.selector));
      return { selector: r.selector, props: Object.fromEntries(Object.keys(r.props).map((p) => [p, had?.decls.find(([k]) => k === p)?.[1] ?? null])) };
    });
    try {
      const res = await api(`envs/${env}/styles`, { method: "PATCH", body: { rules } });
      OV.set(env, res.css);
      for (const x of boardsLive(env)) x.setOverrides(res.css);
      UNDO.push({ env, rules: prev, label });
      if (UNDO.length > 100) UNDO.shift();
      S.diffs.delete(env);
      settle();
      return true;
    } catch (e) {
      toast(`Couldn't change the ${label}`, e.message);
      return false;
    }
  };
  writing = writing.then(run, run);
  return writing;
}
function settle() {
  requestAnimationFrame(() => {
    refreshSelInfo();
    markDirty();
    fire("styles-changed");
  });
}
export async function undoStyle() {
  const u = UNDO.pop();
  if (!u) return false;
  try {
    const res = await api(`envs/${u.env}/styles`, { method: "PATCH", body: { rules: u.rules } });
    OV.set(u.env, res.css);
    for (const x of boardsLive(u.env)) x.setOverrides(res.css);
    S.diffs.delete(u.env);
    toast(`Undid ${u.label}`);
    settle();
  } catch (e) {
    toast("Couldn't undo", e.message);
  }
  return true;
}
export async function resetSelectors(env, selectors) {
  const mine = rulesFor(env, selectors);
  if (!mine.length) return false;
  // undo puts back exactly what was there
  return commitRules(env, mine.map((r) => ({ selector: r.selector, props: Object.fromEntries(r.decls.map(([k]) => [k, null])) })), "reset");
}

// ---------- previews while dragging ----------
// Inline !important beats the !important rules in overrides.css, so the preview always shows.
export function preview(els, props) {
  for (const el of els)
    for (const [k, v] of Object.entries(props)) {
      try {
        if (v === null || v === undefined) el.style.removeProperty(k);
        else el.style.setProperty(k, v, "important");
      } catch {}
    }
}
export function endPreview(els, keys) {
  for (const el of els)
    for (const k of keys) {
      try {
        el.style.removeProperty(k);
      } catch {}
    }
}
