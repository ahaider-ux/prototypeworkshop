import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const UI = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "ui");
const read = (f) => fs.readFileSync(path.join(UI, f), "utf8");

// The canvas owns some short class names (.note, .box, .toast, .pin…) with absolute positioning and
// borders. A list or a piece that reuses one as a modifier inherits all of that, so these get a prefix.
test("ui: list and intro pieces never reuse the canvas's own class names as modifiers", () => {
  const css = read("app.css");
  for (const cls of ["note", "box", "toast", "pin"]) assert.match(css, new RegExp(`(^|\\n)\\.${cls}\\{`), `.${cls} is a global rule`);
  const panels = read("panels.js");
  assert.doesNotMatch(panels, /class="k \$\{x\.kind\}"/, "the notes feed's kind icon must be prefixed (k-box, k-note)");
  assert.match(panels, /class="k k-\$\{x\.kind\}"/);
  assert.match(read("intro.js"), /"p-" \+ c/, "intro pieces are prefixed p-");
});
