import { test } from "node:test";
import assert from "node:assert/strict";
import { resizeAreas, resizeFrom, EDGE, CORNER, SIDES } from "../ui/hitareas.js";

const by = (areas) => Object.fromEntries(areas.map((a) => [a.k, a]));
const has = (a, x, y) => x >= a.x && x < a.x + a.w && y >= a.y && y < a.y + a.h;
const hit = (areas, x, y) => [...areas].reverse().find((a) => has(a, x, y))?.k || null; // corners are on top

// The targets are areas, not the small squares drawn at the corners: an edge resizes along its
// whole length, a corner's area is bigger than an edge band is thick, and the middle is for moving.
test("hit areas: edges resize along their whole length, corners both ways, the middle moves", () => {
  const r = { x: 100, y: 100, w: 400, h: 300 };
  const a = resizeAreas(r);
  assert.deepEqual(a.map((x) => x.k), SIDES);
  // anywhere along an edge, on either side of the outline
  assert.equal(hit(a, 150, 100), "n");
  assert.equal(hit(a, 450, 97), "n");
  assert.equal(hit(a, 450, 103), "n");
  assert.equal(hit(a, 499, 250), "e");
  assert.equal(hit(a, 503, 380), "e");
  assert.equal(hit(a, 300, 398), "s");
  assert.equal(hit(a, 97, 120), "w");
  // corners: on the corner, and a little outside it
  assert.equal(hit(a, 100, 100), "nw");
  assert.equal(hit(a, 92, 92), "nw");
  assert.equal(hit(a, 505, 405), "se");
  assert.equal(hit(a, 500, 95), "ne");
  assert.equal(hit(a, 95, 400), "sw");
  // the middle, and well outside, are nobody's
  assert.equal(hit(a, 300, 250), null);
  assert.equal(hit(a, 106, 250), null, "just inside an edge is already the inside");
  assert.equal(hit(a, 520, 250), null);
  const m = by(a);
  assert.equal(m.n.h, EDGE);
  assert.equal(m.e.w, EDGE);
  assert.ok(m.se.w > EDGE && m.se.h > EDGE, "a corner is easier to hit than an edge");
  assert.equal(m.se.w, CORNER);
  assert.ok(m.se.x + m.se.w - (r.x + r.w) > r.x + r.w - m.se.x, "and is set outward");
});

// On something small the areas move outside it instead of being taken away, and never reach past a
// quarter of its size: it can still be resized from every side, and still be moved.
test("hit areas: a small layer keeps all eight, and its middle", () => {
  for (const [w, h] of [[10, 10], [24, 6], [3, 40], [1, 1]]) {
    const r = { x: 200, y: 200, w, h };
    const a = resizeAreas(r);
    assert.equal(a.length, 8, `${w}×${h}`);
    assert.ok(a.every((x) => x.w > 0 && x.h > 0), `${w}×${h}: every area has a size`);
    assert.equal(hit(a, 200 + w / 2, 200 + h / 2), null, `${w}×${h}: the middle moves it`);
    for (const x of a) {
      const inX = Math.max(0, Math.min(x.x + x.w, r.x + r.w) - Math.max(x.x, r.x));
      const inY = Math.max(0, Math.min(x.y + x.h, r.y + r.h) - Math.max(x.y, r.y));
      if (x.k.includes("e") || x.k.includes("w")) assert.ok(inX <= w / 4 + 1e-9, `${w}×${h} ${x.k} reaches ${inX} in`);
      if (x.k.includes("n") || x.k.includes("s")) assert.ok(inY <= h / 4 + 1e-9, `${w}×${h} ${x.k} reaches ${inY} in`);
    }
    // each is still reachable from outside
    assert.equal(hit(a, 200 + w / 2, 197), "n");
    assert.equal(hit(a, 200 + w + 3, 200 + h / 2), "e");
    assert.equal(hit(a, 200 + w + 4, 200 + h + 4), "se");
    assert.equal(hit(a, 196, 196), "nw");
  }
});

test("hit areas: only the sides asked for, and nothing for a rect without a size", () => {
  assert.deepEqual(resizeAreas({ x: 0, y: 0, w: 100, h: 100 }, ["e", "se"]).map((a) => a.k), ["e", "se"]);
  assert.deepEqual(resizeAreas(null), []);
  assert.deepEqual(resizeAreas({ x: 0, y: 0, w: 0, h: 10 }), []);
  assert.deepEqual(resizeAreas({ x: NaN, y: 0, w: 10, h: 10 }), []);
});

// A frame resizes from any side or corner, and the opposite side stays where it was.
test("hit areas: resizing from a side keeps the opposite side in place", () => {
  const s = { x: 100, y: 50, w: 800, h: 600 };
  const o = { lo: 120, hi: 4096, snap: 8 };
  assert.deepEqual(resizeFrom(s, "e", 40, 999, o), { x: 100, y: 50, w: 840, h: 600 });
  assert.deepEqual(resizeFrom(s, "s", 999, -40, o), { x: 100, y: 50, w: 800, h: 560 });
  assert.deepEqual(resizeFrom(s, "w", 40, 0, o), { x: 140, y: 50, w: 760, h: 600 });
  assert.deepEqual(resizeFrom(s, "n", 0, -80, o), { x: 100, y: -30, w: 800, h: 680 });
  assert.deepEqual(resizeFrom(s, "nw", -40, -40, o), { x: 60, y: 10, w: 840, h: 640 });
  assert.deepEqual(resizeFrom(s, "se", 16, 24, o), { x: 100, y: 50, w: 816, h: 624 });
  // the right and bottom never move when dragging the left and top, even at the limits
  const tiny = resizeFrom(s, "nw", 5000, 5000, o);
  assert.deepEqual(tiny, { x: 780, y: 530, w: 120, h: 120 });
  assert.equal(tiny.x + tiny.w, s.x + s.w);
  assert.equal(tiny.y + tiny.h, s.y + s.h);
  assert.equal(resizeFrom(s, "w", -99999, 0, o).w, 4096);
  // a picture keeps its proportions from a corner, not from a side
  assert.deepEqual(resizeFrom({ x: 0, y: 0, w: 400, h: 200 }, "se", 100, 0, { lo: 16, ratio: true }), { x: 0, y: 0, w: 500, h: 250 });
  assert.deepEqual(resizeFrom({ x: 0, y: 0, w: 400, h: 200 }, "nw", -100, 0, { lo: 16, ratio: true }), { x: -100, y: -50, w: 500, h: 250 });
  assert.deepEqual(resizeFrom({ x: 0, y: 0, w: 400, h: 200 }, "e", 100, 0, { lo: 16, ratio: true }), { x: 0, y: 0, w: 500, h: 200 });
  assert.deepEqual(resizeFrom(s, "e", NaN, 0, o), s);
});

// Two faults a review of design tools' hover areas marks down: areas that overlap (which one you
// get there is an accident), and a corner that is harder to hit than an edge.
test("hit areas: no two areas overlap, and a corner is never smaller than an edge is thick", () => {
  for (const [w, h] of [[400, 300], [60, 40], [20, 20], [10, 10], [24, 6], [3, 40], [1, 1]]) {
    const a = resizeAreas({ x: 50, y: 50, w, h });
    for (let i = 0; i < a.length; i++)
      for (let j = i + 1; j < a.length; j++) {
        const ox = Math.min(a[i].x + a[i].w, a[j].x + a[j].w) - Math.max(a[i].x, a[j].x);
        const oy = Math.min(a[i].y + a[i].h, a[j].y + a[j].h) - Math.max(a[i].y, a[j].y);
        assert.ok(!(ox > 1e-9 && oy > 1e-9), `${w}×${h}: ${a[i].k} overlaps ${a[j].k}`);
      }
    const m = by(a);
    for (const c of ["nw", "ne", "se", "sw"]) assert.ok(m[c].w >= m.e.w && m[c].h >= m.n.h, `${w}×${h}: ${c} is at least as big as an edge is thick`);
    // the four edges are alike, and so are the four corners
    assert.equal(m.n.h, m.s.h);
    assert.equal(m.e.w, m.w.w);
    assert.deepEqual([m.nw.w, m.nw.h], [m.se.w, m.se.h]);
    assert.deepEqual([m.ne.w, m.ne.h], [m.sw.w, m.sw.h]);
  }
});
