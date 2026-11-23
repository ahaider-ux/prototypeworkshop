// What names a board's saved drawing, shared by the canvas (ui/gfx.js, which saves drawings) and the
// server (src/store.js, which hands a frame's HTML to agents), so the two always find the same file.
// No DOM and no imports: it runs in the browser and in Node.

// the snapshot format: bump it when what goes into a drawing changes, so old ones aren't reused
export const DRAWING = 7;
// bitmaps are kept at half size: sharp up to 50% zoom on a 1× screen
export const LEVEL = 0.5;

// look: the environment's fingerprint (Store.fingerprint), or a stand-in for one not known yet
export const drawKey = (look, it) => `${look}|${it.file || ""}|${it.screen || ""}|${it.state || ""}|${it.w}x${it.h}|${LEVEL}|d${DRAWING}`;
