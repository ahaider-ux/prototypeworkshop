// Small pure helpers for motion (no DOM, so they're tested in Node): the spiral the home canvas lays
// prototypes out on, cubic-bezier easing, and the rubber band past an edge.

// a square spiral from the centre: (0,0), (1,0), (1,1), (0,1), (-1,1), …
export function spiral(n) {
  const out = [[0, 0]];
  let x = 0,
    y = 0;
  for (let ring = 1; out.length < n; ring++) {
    x++;
    out.push([x, y]);
    for (; y < ring && out.length < n; ) out.push([x, ++y]);
    for (; x > -ring && out.length < n; ) out.push([--x, y]);
    for (; y > -ring && out.length < n; ) out.push([x, --y]);
    for (; x < ring && out.length < n; ) out.push([++x, y]);
  }
  return out.slice(0, n);
}
// a few cells in reading order, in as few rows as reads well: up to 3 in one row, then two rows
export function block(n) {
  const cols = n <= 3 ? n : Math.ceil(n / 2);
  return Array.from({ length: n }, (_, i) => [i % cols, Math.floor(i / cols)]);
}
// cubic-bezier easing (x → y), solved with a few Newton steps
export function bezier([x1, y1, x2, y2]) {
  // coefficients of B(t) = ((a·t + b)·t + c)·t for control points p1, p2 (p0 = 0, p3 = 1)
  const c = (p1, p2) => {
    const cc = 3 * p1,
      bb = 3 * (p2 - p1) - cc;
    return [cc, bb, 1 - cc - bb];
  };
  const [cx, bx, ax] = c(x1, x2),
    [cy, by, ay] = c(y1, y2);
  const X = (t) => ((ax * t + bx) * t + cx) * t,
    Y = (t) => ((ay * t + by) * t + cy) * t,
    dX = (t) => (3 * ax * t + 2 * bx) * t + cx;
  return (x) => {
    let t = x;
    for (let i = 0; i < 6; i++) {
      const d = dX(t);
      if (Math.abs(d) < 1e-6) break;
      t -= (X(t) - x) / d;
    }
    return Y(Math.max(0, Math.min(1, t)));
  };
}
// rubber band past an edge: the further you pull, the less it gives (as iOS does)
export const rubber = (over, dim) => (1 - 1 / ((Math.abs(over) * 0.55) / dim + 1)) * dim * Math.sign(over);
// a thumbnail's size on the home canvas: the screen's own shape, wide screens a fixed width and
// tall ones a fixed height, so phones read as phones next to desktop pages. Odd or missing sizes
// fall back to a desktop shape; extreme shapes are clamped so nothing becomes a sliver.
export function tileSize(w, h, wide = 320, tall = 296) {
  let r = w > 0 && h > 0 && Number.isFinite(w / h) ? w / h : 1.6;
  r = Math.max(0.42, Math.min(2.4, r));
  return r >= 1 ? { w: wide, h: Math.round(wide / r) } : { w: Math.round(tall * r), h: tall };
}

