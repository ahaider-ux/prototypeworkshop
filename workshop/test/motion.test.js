import { test } from "node:test";
import assert from "node:assert/strict";
import { spiral, block, bezier, rubber, fitIn } from "../ui/motion.js";

test("motion: the home spiral visits every cell around the centre once, nearest first", () => {
  const cells = spiral(25);
  assert.deepEqual(cells.slice(0, 3), [[0, 0], [1, 0], [1, 1]]);
  assert.equal(new Set(cells.map((c) => c.join())).size, 25, "no cell twice");
  // the first 9 are the 3 × 3 block, the first 25 the 5 × 5 block
  assert.ok(cells.slice(0, 9).every(([x, y]) => Math.abs(x) <= 1 && Math.abs(y) <= 1));
  assert.ok(cells.every(([x, y]) => Math.abs(x) <= 2 && Math.abs(y) <= 2));
});

// A wrong coefficient once made the glide curve swing past its target and back (the camera jumped
// 0 → 455 → 0 px and landed hundreds of pixels off). The curve must start at 0, end at 1, never go
// backwards or beyond, and match the shape it is named for.
test("motion: cubic-bezier easing is monotonic, bounded and matches the curve", () => {
  const e = bezier([0.32, 0.72, 0, 1]);
  assert.equal(e(0), 0);
  assert.ok(Math.abs(e(1) - 1) < 1e-6);
  let prev = 0;
  for (let i = 1; i <= 100; i++) {
    const y = e(i / 100);
    assert.ok(y >= prev - 1e-9 && y <= 1 + 1e-9, `at ${i / 100}: ${y}`);
    prev = y;
  }
  // a linear curve is the identity, and ease-in-out is symmetric
  const lin = bezier([0, 0, 1, 1]);
  for (const x of [0.1, 0.37, 0.8]) assert.ok(Math.abs(lin(x) - x) < 1e-4);
  const io = bezier([0.42, 0, 0.58, 1]);
  assert.ok(Math.abs(io(0.5) - 0.5) < 1e-4);
  assert.ok(Math.abs(io(0.2) + io(0.8) - 1) < 1e-3);
});

test("motion: the rubber band gives less the further it is pulled, and never more than the view", () => {
  const a = rubber(100, 1000),
    b = rubber(1000, 1000),
    c = rubber(100000, 1000);
  assert.ok(a > 0 && a < 100);
  assert.ok(b > a && b < 1000);
  assert.ok(c < 1000);
  assert.equal(rubber(-100, 1000), -a);
});

// A card's picture: a wide page fills it from the top, a phone sits whole in the middle. A board
// with a missing, zero or absurd size must still get a sane rectangle, never NaN.
test("motion: a screen's picture fits its card", () => {
  const wide = fitIn(1440, 900, 304, 190);
  assert.equal(wide.cover, true);
  assert.equal(wide.y, 0);
  assert.ok(wide.w >= 304 - 0.01 && wide.h >= 190 - 0.01, "fills the area");
  const phone = fitIn(390, 844, 304, 190);
  assert.equal(phone.cover, false);
  assert.ok(phone.h < 190 && phone.x > 0 && phone.y > 0, "whole, with a margin");
  assert.ok(Math.abs(phone.x * 2 + phone.w - 304) < 0.01, "centred");
  for (const [w, h] of [[0, 0], [undefined, 900], [1440, 0], [NaN, NaN], [-5, 10], [Infinity, 1]]) {
    const r = fitIn(w, h, 304, 190);
    assert.ok([r.x, r.y, r.w, r.h].every(Number.isFinite) && r.w > 0 && r.h > 0, `${w}x${h} → ${JSON.stringify(r)}`);
  }
});

test("motion: a few prototypes sit in one row, then two, in reading order", () => {
  assert.deepEqual(block(1), [[0, 0]]);
  assert.deepEqual(block(3), [[0, 0], [1, 0], [2, 0]]);
  assert.deepEqual(block(4), [[0, 0], [1, 0], [0, 1], [1, 1]]);
  assert.deepEqual(block(7).at(-1), [2, 1]);
  assert.equal(new Set(block(7).map((c) => c.join())).size, 7, "no cell twice");
});

test("readableZoom: zooms in only when text is too small to edit", async () => {
  const { readableZoom } = await import("../ui/motion.js");
  assert.equal(readableZoom(1, 14), null, "readable already");
  assert.equal(readableZoom(0.14, 2.24), 0.875, "16px text at 14% zooms to show it at 14px");
  assert.equal(readableZoom(0.5, 0.5, 4), 4, "never past the max");
  assert.equal(readableZoom(0, 5), null);
  assert.equal(readableZoom(1, NaN), null);
});
