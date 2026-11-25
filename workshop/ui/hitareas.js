// The areas around a selection that resize it, in screen pixels. Pure, so it's tested in Node.
//
// A selection is used three ways: drag inside it to move it, drag an edge to resize one way, drag a
// corner to resize both ways. The targets are areas, not the small squares drawn at the corners:
//
// - An edge's area runs the whole length of the edge (between the corners), in a band across the
//   outline: EDGE px thick, half inside and half outside.
// - A corner's area is a square, a little bigger than an edge band is thick and set a little
//   outward, so it is the easiest thing to hit and sits over the drawn square.
// - No area reaches further into the selection than a quarter of its size, so the middle half is
//   always free to drag. On something small the areas sit mostly outside it rather than being taken
//   away: a 10px layer can still be resized from every side and corner, and still be moved.
//
// r: { x, y, w, h } on screen. keys: which of the eight to make.
// → [{ k, x, y, w, h }], edges first and corners last (corners go on top), nothing for a rect
//   without a real size.
export const EDGE = 10;
export const CORNER = 16;
const OUT = 2; // how far a corner's square is set outward from the corner
export const SIDES = ["n", "e", "s", "w", "nw", "ne", "se", "sw"];

export function resizeAreas(r, keys = SIDES) {
  if (!r || ![r.x, r.y, r.w, r.h].every(Number.isFinite) || r.w <= 0 || r.h <= 0) return [];
  // how far the areas reach inside, along each axis
  const eIn = { x: Math.min(EDGE / 2, r.w / 4), y: Math.min(EDGE / 2, r.h / 4) };
  const cIn = { x: Math.min(CORNER / 2 - OUT, r.w / 4), y: Math.min(CORNER / 2 - OUT, r.h / 4) };
  const out = [];
  for (const k of SIDES) {
    if (!keys.includes(k)) continue;
    if (k.length === 1) {
      // an edge: between the corners, across the outline
      const across = /[ns]/.test(k);
      const inn = across ? eIn.y : eIn.x;
      const thick = EDGE - EDGE / 2 + inn; // the outside half is always whole
      if (across) out.push({ k, x: r.x + cIn.x, w: r.w - cIn.x * 2, y: k === "n" ? r.y - EDGE / 2 : r.y + r.h - inn, h: thick });
      else out.push({ k, y: r.y + cIn.y, h: r.h - cIn.y * 2, x: k === "w" ? r.x - EDGE / 2 : r.x + r.w - inn, w: thick });
    } else {
      const w = CORNER / 2 + OUT + cIn.x,
        h = CORNER / 2 + OUT + cIn.y;
      out.push({ k, x: k.includes("w") ? r.x - (CORNER / 2 + OUT) : r.x + r.w - cIn.x, y: k.includes("n") ? r.y - (CORNER / 2 + OUT) : r.y + r.h - cIn.y, w, h });
    }
  }
  return out;
}

// A frame (or a link or picture) resized from any side or corner: the opposite side stays where it
// was. start: { x, y, w, h } in canvas units. k: the side or corner. dx, dy: how far the pointer has
// moved, in canvas units. lo/hi: the size limits. snap: the grid. ratio: keep the start's
// proportions (a picture from a corner).
// → { x, y, w, h }
export function resizeFrom(start, k, dx, dy, { lo = 1, hi = Infinity, snap = 1, ratio = false } = {}) {
  const sn = (v) => Math.min(hi, Math.max(lo, Math.round(v / snap) * snap));
  let { x, y, w, h } = start;
  if (![x, y, w, h, dx, dy].every(Number.isFinite)) return { ...start };
  if (k.includes("e")) w = sn(start.w + dx);
  if (k.includes("w")) w = sn(start.w - dx);
  if (k.includes("s")) h = sn(start.h + dy);
  if (k.includes("n")) h = sn(start.h - dy);
  if (ratio && k.length === 2 && start.w > 0) h = Math.min(hi, Math.max(lo, Math.round((w * start.h) / start.w)));
  if (k.includes("w")) x = start.x + start.w - w;
  if (k.includes("n")) y = start.y + start.h - h;
  return { x, y, w, h };
}
