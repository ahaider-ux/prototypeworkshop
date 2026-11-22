import { test } from "node:test";
import assert from "node:assert/strict";
import { spiral, bezier, rubber } from "../ui/motion.js";

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
