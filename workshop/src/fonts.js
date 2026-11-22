// Atelier's typefaces, from a craft-fonts checkout when there is one.
//
// Font files never live in this repository (they belong in storytold/craft-fonts). The editor asks
// for /fonts/<name>.ttf; when a craft-fonts checkout is found (CRAFT_FONTS_DIR, or ../craft-fonts
// next to this repository, as the other Craft apps use it), the file listed for that face in its
// Latin manifest is served. Without one, the request is a 404 and the CSS falls back to fonts
// installed on the computer, then to system fonts. Nothing here is needed to run Atelier.

import fs from "node:fs";
import fsp from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const MANIFEST = "fonts/latin-manifest.txt";
const MAX_FONT_BYTES = 8 * 1024 * 1024; // Guard: a face is a few hundred KB; never stream something huge from a misconfigured folder

// Guard: the only faces the editor can ask for, by a fixed name. A request never names a path.
export const FACES = {
  "zilla-slab-semibold": ["Zilla Slab", "SemiBold"],
  "zilla-slab-bold": ["Zilla Slab", "Bold"],
  "schibsted-grotesk": ["Schibsted Grotesk", "Variable"],
  "shantell-sans": ["Shantell Sans", "Variable"],
};

export function defaultFontsDir() {
  if (process.env.CRAFT_FONTS_DIR) return path.resolve(process.env.CRAFT_FONTS_DIR);
  const sibling = path.resolve(HERE, "..", "..", "..", "craft-fonts");
  return fs.existsSync(path.join(sibling, MANIFEST)) ? sibling : null;
}

// The file for one face, or null: the face must be listed in the checkout's manifest, its file
// must stay inside the checkout, and it must be a font-sized regular file.
export async function fontFile(dir, name) {
  const face = Object.hasOwn(FACES, name) ? FACES[name] : null;
  if (!dir || !face) return null;
  const root = path.resolve(dir);
  const manifest = await fsp.readFile(path.join(root, MANIFEST), "utf8").catch(() => "");
  for (const line of manifest.split("\n")) {
    if (!line.trim() || line.startsWith("#")) continue;
    const [family, style, file] = line.split("|").map((s) => s.trim());
    if (family !== face[0] || style !== face[1] || !file || !/\.(ttf|otf)$/i.test(file)) continue;
    const abs = path.resolve(root, file);
    // Guard: a manifest line can't point outside the checkout (no ../, no absolute paths)
    if (!abs.startsWith(root + path.sep)) return null;
    const st = await fsp.stat(abs).catch(() => null);
    return st && st.isFile() && st.size <= MAX_FONT_BYTES ? abs : null;
  }
  return null;
}
