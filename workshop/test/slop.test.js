import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

// The marks of work done in a hurry, or by many passes on top of each other, as things that can be
// counted. Each is at zero; this keeps it there. When one fails, fix the app, not the list.
const UI = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "ui");
const read = (f) => fs.readFileSync(path.join(UI, f), "utf8");
const JS = fs.readdirSync(UI).filter((f) => f.endsWith(".js"));
const PAGES = ["index.html", "present.html"];

// ---- the words people read: strings in the scripts, text and labels in the pages ----
const copy = [];
for (const f of JS)
  read(f).split("\n").forEach((line, i) => {
    if (/^\s*(\/\/|\*|\/\*)/.test(line)) return;
    for (const m of line.replace(/\/\/ .*$/, "").matchAll(/"((?:[^"\\]|\\.)*)"|'((?:[^'\\]|\\.)*)'|`((?:[^`\\]|\\.)*)`/g)) {
      const s = (m[1] ?? m[2] ?? m[3] ?? "").replace(/\$\{[^}]*\}/g, "§").replace(/<[^>]+>/g, " ").trim();
      if (/[A-Za-z]{3,} [A-Za-z]{2,}/.test(s) || /^[A-Z][a-z]+/.test(s)) copy.push({ at: `${f}:${i + 1}`, s });
    }
  });
for (const f of PAGES) read(f).split("\n").forEach((line, i) => { for (const m of line.matchAll(/>([^<>{}]{3,})<|(?:aria-label|data-tip|placeholder|title)="([^"]+)"/g)) copy.push({ at: `${f}:${i + 1}`, s: (m[1] ?? m[2]).trim() }); });
const words = copy.filter((x) => /[a-z]/.test(x.s) && !/^[a-z0-9_.#\-:/[\]="' ,()>+*~|@%!?&;{}$§]+$/.test(x.s));
const none = (name, re, keep = () => true) => {
  const hits = words.filter((x) => re.test(x.s) && keep(x)).map((x) => `${x.at}  ${x.s.slice(0, 90)}`);
  assert.deepEqual(hits, [], name);
};

test("slop: the copy says things plainly and calls each thing by one name", () => {
  assert.ok(words.length > 400, `read ${words.length} strings`);
  none("a dash used as a pause", /\S [—–] \S/, (x) => !/Libra — Fourth Age|Sample — Reading list/.test(x.s));
  none("three dots typed as ...", /\.\.\./);
  none("filler and sales words", /\b(just|simply|easily|seamless(ly)?|powerful|effortless(ly)?|magic(al)?|supercharge|unlock|delight(ful)?|awesome|amazing|oops|whoops|please|sorry|blazing|robust|leverage|elevate|streamline)\b/i);
  none("exclamation marks", /[A-Za-z]!(\s|$)/);
  none("emoji and decorative symbols", /[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}✨⚡★☆]/u);
  none("buttons that don't say what they do", /^(Get started|Learn more|Submit|OK|Okay|Click here|Continue)$/i);
  none("errors that say nothing", /something went wrong|an error occurred|unexpected error|^error$|^failed$/i);
  none("Main in lower case", /\b(from|on|to|with|into|of|so|and|above|under|beside|open|keep) main\b|\bmain('s| only| stays| changes)\b/i, (x) => /\bmain\b/.test(x.s) && !/main action/.test(x.s));
  none("board, where the app says frame", /\bboards?\b/i, (x) => !/dashboard|keyboard|clipboard|whiteboard|moodboard/i.test(x.s));
  none("names the app no longer uses", /\bWorkshop\b|\bInteract\b|\bPresent\b|\bPress Play\b/, (x) => !/workshop\.js|workshop serve|workshop mcp|workshopEnv|prototypeworkshop/.test(x.s));
  none("not X but Y, more than just", /\bnot (just|only) .* but\b|more than just|isn't just|it's not about/i);
});

// ---- the stylesheet ----
const css = read("app.css").replace(/\/\*[\s\S]*?\*\//g, "");
const rules = [...css.matchAll(/([^{}]+)\{([^{}]*)\}/g)].map((m) => ({ sel: m[1].trim(), body: m[2] }));
const sources = [...JS, ...PAGES, "sample.html"].map(read).join("\n");

test("slop: colours live in tokens, and every token is read", () => {
  const isTokens = (r) => /^(:root|\[data-theme|:root\[|html\[data-theme)/.test(r.sel) || /^\s*--/.test(r.body);
  const written = [];
  for (const r of rules.filter((x) => !isTokens(x)))
    for (const m of r.body.matchAll(/(?:^|;)\s*([a-z-]+)\s*:\s*([^;]*?(#[0-9a-fA-F]{3,8}\b|rgba?\([^)]*\))[^;]*)/g))
      if (!/^--/.test(m[1]) && !/mask/.test(m[1])) written.push(`${r.sel.slice(0, 40)} {${m[1]}: ${m[2].slice(0, 50)}}`); // a mask's black is opacity, not a colour
  assert.deepEqual(written, [], "a colour written into a rule");
  const defined = new Set([...css.matchAll(/(--[\w-]+)\s*:/g)].map((m) => m[1]));
  const all = css + sources;
  const unread = [...defined].filter((d) => !new RegExp(`var\\(${d}\\s*[,)]`).test(all) && !new RegExp(`["'\`]${d}["'\`]|setProperty\\(\\s*["']${d}`).test(all) && !new RegExp(`${d}:\\$\\{|style="[^"]*${d}:`).test(all));
  assert.deepEqual(unread.sort(), [], "tokens nothing reads");
});

test("slop: sizes come from the scale", () => {
  const off = (re, ok, pick = (m) => m[1]) => [...new Set([...css.matchAll(re)].map(pick).filter((v) => !ok.includes(v)))].sort();
  // type: 12, 14, 16, 20, 24, 28, 32 (10 only for the two-letter keyboard hints; the wordmark and the intro's lettering are drawn, not set)
  const type = ["12px", "14px", "16px", "20px", "24px", "28px", "32px"];
  const sized = rules.filter((r) => !/\.wm\b|\.intro|\.ip\b|\.ilock\b/.test(r.sel)).map((r) => r.body).join(";");
  const sizes = [...new Set([...sized.matchAll(/font-size:\s*([\d.]+px)/g), ...sized.matchAll(/font:\s*(?:\d+ )?([\d.]+px)/g)].map((m) => m[1]))].filter((v) => !type.includes(v));
  assert.deepEqual(sizes.sort(), [], "font sizes off the type scale");
  assert.deepEqual(off(/font-weight:\s*(\d+)/g, ["400", "500", "600", "700"]), [], "font weights");
  const radii = [...new Set([...css.matchAll(/border(?:-[a-z]+-[a-z]+)?-radius:\s*([^;}]+)/g)].flatMap((m) => m[1].trim().split(/\s+/)))].filter((v) => !/^(0|1px|2px|4px|6px|8px|10px|12px|16px|20px|24px|99px|50%|23%|inherit|var\(--r-panel\))$/.test(v));
  assert.deepEqual(radii.sort(), [], "corner radii off the scale (23% is the app icon's shape; 1px ends a line)");
});

test("slop: no class is styled that nothing uses, and no part of a look is fixed in a script", () => {
  const dynamic = /^(tool-|p-|u-|mode-|k-)/; // built from a name at run time: tool-${tool}, p-${piece}
  const classes = [...new Set([...css.replace(/url\([^)]*\)/g, "").matchAll(/\.([a-zA-Z][\w-]*)/g)].map((m) => m[1]))]; // a file name in url() is not a class
  const unused = classes.filter((c) => !dynamic.test(c) && !new RegExp(`(^|[^\\w-])${c}([^\\w-]|$)`).test(sources));
  assert.deepEqual(unused.sort(), [], "classes styled but used nowhere");
  // an inline style is for a value that is computed (a width from data, a position): it has a ${…} in it
  const fixed = [];
  for (const f of JS) read(f).split("\n").forEach((l, i) => { for (const m of l.matchAll(/style="([^"]*)"/g)) if (!m[1].includes("${") && !/^\$?$/.test(m[1])) fixed.push(`${f}:${i + 1}  ${m[1].slice(0, 70)}`); });
  assert.ok(fixed.length <= 1, `fixed inline styles:\n${fixed.join("\n")}`); // one: the agent log's box, a scrolling pane with a look of its own
});

// ---- the code ----
test("slop: nothing is left over in the scripts", () => {
  const all = Object.fromEntries(JS.map((f) => [f, read(f)]));
  const noop = [];
  for (const f of JS) for (const m of all[f].matchAll(/function (\w+)\([^)]*\)\s*\{\s*\}/g)) noop.push(`${f} ${m[1]}()`);
  assert.deepEqual(noop, [], "functions that do nothing");
  const marks = [];
  for (const f of JS) all[f].split("\n").forEach((l, i) => /\b(TODO|FIXME|XXX|HACK)\b|console\.(log|debug)\(/.test(l) && marks.push(`${f}:${i + 1}`));
  assert.deepEqual(marks, [], "TODO, FIXME, console.log");
  const unusedImports = [];
  for (const f of JS)
    for (const m of all[f].matchAll(/^import \{([^}]+)\} from/gm))
      for (const name of m[1].split(",").map((x) => x.trim().split(" as ").pop()).filter((n) => n && /^\w+$/.test(n)))
        if (all[f].split(new RegExp(`\\b${name}\\b`)).length - 1 <= 1) unusedImports.push(`${f} ${name}`);
  assert.deepEqual(unusedImports, [], "imports never used");
  // the agent has one icon, and it is not a sparkle
  assert.ok(!/\bspark\b/.test(read("lib.js")), "no sparkle icon");
  assert.ok(!sources.includes("M8 2.5c.4 2.6 1.4 3.6 4 4"), "no sparkle drawn in a page");
});
