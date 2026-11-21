// Ink: hand-drawn marks for giving notes on a screen, the way an atelier marks up a fitting —
// circle the problem, underline what works, cross out what goes.
//
// The pens' behaviour follows Benji Taylor's Drawesome (MIT, © 2026 Benji Taylor,
// https://github.com/benjitaylor/drawesome): its pen parameters (size, opacity, thinning,
// streamline, simulated pressure, flat-ended highlighter in multiply) and its approach to strokes —
// smooth the input, walk it at a fixed step, let width follow speed or pen pressure, taper the
// ends, and fill the outline. This file is Atelier's own implementation of that approach.

export const PENS = {
  marker: { label: "Marker", size: 6, opacity: 1, thinning: 0.12, streamline: 0.5, pressure: true, color: "#e03131" },
  pen: { label: "Pen", size: 3, opacity: 1, thinning: 0.5, streamline: 0.5, pressure: true, ease: (t) => t * t * (3 - 2 * t), color: "#1c7ed6" },
  pencil: { label: "Pencil", size: 1.5, opacity: 0.85, thinning: 0.5, streamline: 0.5, pressure: true, color: "#111111" },
  highlighter: { label: "Highlighter", size: 22, opacity: 0.6, thinning: 0, streamline: 0.6, pressure: false, flat: true, blend: "multiply", color: "#ffd43b" },
};
// a short palette for notes: ink, the reds and oranges that say "fix this", and the calm ones
export const INKS = ["#111111", "#e03131", "#f76707", "#ffd43b", "#2f9e44", "#1c7ed6", "#7048e8", "#ffffff"];
// sizes, as multiples of each pen's own size
export const SIZES = [
  { label: "Fine", k: 0.6 },
  { label: "Medium", k: 1 },
  { label: "Bold", k: 1.8 },
];

const FAST = 26; // px between input points at which a stroke is fully thinned by speed
const RESPONSE = 14; // px over which the width catches up with the speed
const MIN_R = 0.4;

const dist = (a, b) => Math.hypot(b[0] - a[0], b[1] - a[1]);

// points: [[x, y, pressure?], …] in canvas units; zoom: how much the canvas is scaled, so speed is
// measured as the hand moved, not as the canvas
export function outline(points, penName, size, zoom = 1) {
  const pen = PENS[penName] || PENS.marker;
  if (!points.length) return "";
  const nib = Math.max(MIN_R, size / 2);
  if (points.length === 1 || points.every((q) => dist(q, points[0]) < 0.5)) {
    const [x, y] = points[0];
    const r = Math.max(0.75, nib * (pen.flat ? 1 : 0.8));
    return `M${x - r} ${y}a${r} ${r} 0 1 0 ${r * 2} 0a${r} ${r} 0 1 0 ${-r * 2} 0Z`;
  }
  // 1. streamline: an exponential smoother on the raw input
  const t = 0.15 + (1 - pen.streamline) * 0.85;
  const sm = [points[0].slice()];
  for (let i = 1; i < points.length; i++) {
    const p = sm[i - 1],
      q = points[i];
    sm.push([p[0] + (q[0] - p[0]) * t, p[1] + (q[1] - p[1]) * t, q[2] ?? 0.5, dist(points[i - 1], q) * zoom]);
  }
  sm.push(points[points.length - 1].concat([0]).slice(0, 4)); // end where the hand stopped
  // 2. walk the smoothed line at a fixed step, carrying pressure and speed along
  const step = Math.min(3, Math.max(0.6, nib / 3));
  const walk = [];
  let carry = 0;
  for (let i = 1; i < sm.length; i++) {
    const a = sm[i - 1],
      b = sm[i];
    const d = dist(a, b);
    if (!d) continue;
    for (let s = carry; s < d; s += step) {
      const u = s / d;
      walk.push([a[0] + (b[0] - a[0]) * u, a[1] + (b[1] - a[1]) * u, (a[2] ?? 0.5) + ((b[2] ?? 0.5) - (a[2] ?? 0.5)) * u, b[3] ?? 0]);
    }
    carry = step - ((d - carry) % step || step);
  }
  const last = sm[sm.length - 1];
  walk.push([last[0], last[1], last[2] ?? 0.5, 0]);
  if (walk.length < 2) return outline([points[0]], penName, size, zoom);
  // 3. width: from real pen pressure, or from speed (fast = thin), eased and caught up gradually
  const real = points.some((q) => q[2] !== undefined && q[2] !== 0.5);
  const ease = pen.ease || ((v) => v);
  let pr = 0.5;
  const rate = 1 - Math.exp(-step / RESPONSE);
  const radii = walk.map((q) => {
    const target = pen.pressure && !real ? 1 - Math.min(1, (q[3] || 0) / FAST) : real ? q[2] : 1;
    pr += (target - pr) * rate;
    return Math.max(MIN_R, nib * (1 - pen.thinning + pen.thinning * ease(pr)));
  });
  // 4. taper the ends (not the highlighter's: it has flat, chisel ends)
  let total = 0;
  const along = walk.map((q, i) => (i ? (total += dist(walk[i - 1], q)) : 0));
  if (!pen.flat) {
    const len = Math.min(nib * 3, total / 2);
    for (let i = 0; i < radii.length; i++) {
      const k = Math.min(1, along[i] / (len || 1), (total - along[i]) / (len || 1));
      radii[i] *= 0.2 + 0.8 * Math.pow(Math.max(0, k), 0.55);
    }
  }
  // 5. the outline: both edges, joined round (or flat for the highlighter)
  const L = [],
    R = [];
  for (let i = 0; i < walk.length; i++) {
    const a = walk[Math.max(0, i - 1)],
      b = walk[Math.min(walk.length - 1, i + 1)];
    let nx = -(b[1] - a[1]),
      ny = b[0] - a[0];
    const n = Math.hypot(nx, ny) || 1;
    nx /= n;
    ny /= n;
    const r = radii[i];
    L.push([walk[i][0] + nx * r, walk[i][1] + ny * r]);
    R.push([walk[i][0] - nx * r, walk[i][1] - ny * r]);
  }
  const f = (v) => Math.round(v * 10) / 10;
  const pt = (q) => `${f(q[0])} ${f(q[1])}`;
  const r0 = radii[0],
    r1 = radii[radii.length - 1];
  let d = `M${pt(L[0])}`;
  for (let i = 1; i < L.length; i++) d += `L${pt(L[i])}`;
  d += pen.flat ? `L${pt(R[R.length - 1])}` : `A${f(r1)} ${f(r1)} 0 0 1 ${pt(R[R.length - 1])}`;
  for (let i = R.length - 2; i >= 0; i--) d += `L${pt(R[i])}`;
  d += pen.flat ? "Z" : `A${f(r0)} ${f(r0)} 0 0 1 ${pt(L[0])}Z`;
  return d;
}

// does a point (canvas units, relative to the stroke's spot) touch this stroke? for the eraser
export function touches(points, size, x, y, pad = 0) {
  const r = size / 2 + pad;
  for (let i = 0; i < points.length; i++) {
    const a = points[i],
      b = points[Math.min(points.length - 1, i + 1)];
    const dx = b[0] - a[0],
      dy = b[1] - a[1];
    const l2 = dx * dx + dy * dy;
    const u = l2 ? Math.max(0, Math.min(1, ((x - a[0]) * dx + (y - a[1]) * dy) / l2)) : 0;
    if (Math.hypot(a[0] + dx * u - x, a[1] + dy * u - y) <= r) return true;
  }
  return false;
}
