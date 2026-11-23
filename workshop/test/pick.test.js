import { test } from "node:test";
import assert from "node:assert/strict";
import { pickLayer } from "../ui/pick.js";

// a tiny fake DOM: { name, kids } → nodes with parentElement and children
function tree(spec, parent = null) {
  const n = { name: spec.name, parentElement: parent, children: [], wrap: !!spec.wrap };
  n.children = (spec.kids || []).map((k) => tree(k, n));
  return n;
}
const find = (n, name) => (n.name === name ? n : n.children.map((c) => find(c, name)).find(Boolean));
// body > app (wrapper) > shell (wrapper) > [ sidebar > [nav > link], content > [card > [title, button], card2] ]
const body = tree({ name: "body", kids: [{ name: "app", wrap: true, kids: [{ name: "shell", wrap: true, kids: [
  { name: "sidebar", kids: [{ name: "nav", kids: [{ name: "link" }] }] },
  { name: "content", kids: [{ name: "card", kids: [{ name: "title" }, { name: "button" }] }, { name: "card2" }] },
] }] }] });
// a wrapper has one child the same size as itself
const same = (a) => a.wrap;
const pick = (at, opts = {}) => pickLayer(find(body, at), { root: body, same, ...opts })?.name;

test("pick: the first click selects the top-level layer, skipping same-size wrappers", () => {
  assert.equal(pick("button"), "shell", "app is a wrapper around shell; shell has two children, so it's the layer");
});

test("pick: a click selects beside the current layer; a double-click goes one level deeper", () => {
  const shell = find(body, "shell"), content = find(body, "content"), card = find(body, "card");
  assert.equal(pick("button", { current: shell, deeper: true }), "content");
  assert.equal(pick("button", { current: content, deeper: true }), "card");
  assert.equal(pick("button", { current: card, deeper: true }), "button");
  // a single click with card selected, on its sibling card2: card2 (same level)
  assert.equal(pick("card2", { current: card }), "card2");
  // a single click with card selected, on the sidebar's link: out of content, the sidebar (content's level)
  assert.equal(pick("link", { current: card }), "sidebar");
  // on a leaf, a double-click keeps it (that edits its text)
  assert.equal(pick("button", { current: find(body, "button"), deeper: true }), "button");
});

test("pick: Cmd-click selects the deepest layer; outside the page selects nothing", () => {
  assert.equal(pick("title", { deep: true }), "title");
  assert.equal(pickLayer(body, { root: body, same }), null);
  assert.equal(pickLayer(null, { root: body, same }), null);
});
