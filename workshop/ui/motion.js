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
// a few cells in reading order, in as few rows as reads well: up to 3 in one row, then two rows,
// and never wider than 4 (more rows instead), so the block fits a laptop screen
export function block(n) {
  const cols = n <= 3 ? n : Math.min(4, Math.ceil(n / 2));
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
// where a screen's picture goes inside a card's picture area (W × H): a wide page fills it from the
// top (cover); a tall one (a phone) sits whole in the middle with a margin. Odd or missing sizes
// fill the area rather than producing NaN.
export function fitIn(w, h, W, H) {
  if (!(w > 0 && h > 0 && W > 0 && H > 0) || ![w, h, W, H].every(Number.isFinite)) return { x: 0, y: 0, w: W || 0, h: H || 0, cover: true };
  if (w >= h) {
    const s = Math.max(W / w, H / h);
    return { x: (W - w * s) / 2, y: 0, w: w * s, h: h * s, cover: true };
  }
  const s = Math.min(W / w, H / h) * 0.86;
  return { x: (W - w * s) / 2, y: (H - h * s) / 2, w: w * s, h: h * s, cover: false };
}

// Editing text you can't read is guessing: the zoom at which text drawn `shown` px tall on screen
// (at zoom z) becomes comfortable to edit (14px), or null when it already is (11px or more). Never
// past maxZ.
export function readableZoom(z, shown, maxZ = 4) {
  if (!(z > 0) || !(shown > 0) || shown >= 11) return null;
  return Math.min(maxZ, z * (14 / shown));
}

// Opening a prototype: when every screen fits at a size you can read (30% or more) show them all;
// otherwise start on the first screen (the top row's leftmost), so what opens is a screen, not a
// strip of thumbnails. boards: [{ x, y, w, h }]. zAll: the zoom at which everything fits.
export function openOn(boards, zAll) {
  if (!boards.length || zAll >= 0.3) return null;
  const top = Math.min(...boards.map((b) => b.y));
  const row = boards.filter((b) => b.y <= top + b.h / 2);
  return row.reduce((a, b) => (b.x < a.x ? b : a));
}
