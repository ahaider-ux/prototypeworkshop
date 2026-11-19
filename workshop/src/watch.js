// Watches a folder tree with one plain fs.watch per directory.
//
// Node's built-in recursive watcher on Linux drops events for files written by atomic rename
// (temp file, then rename over the old one), which is how this app, most editors and many agents
// save. A per-directory watch maps straight onto inotify and reports every rename.

import fs from "node:fs";
import path from "node:path";

const MAX_DIRS = 4000; // Guard: a prototype that ships node_modules can't exhaust the system's watches

export function watchTree(root, onEvent, { maxDepth = 8, skip = (name) => name === "node_modules" || name === ".git" } = {}) {
  const watchers = new Map(); // dir → FSWatcher

  const drop = (dir) => {
    for (const [d, w] of watchers) {
      if (d === dir || d.startsWith(dir + path.sep)) {
        try {
          w.close();
        } catch {}
        watchers.delete(d);
      }
    }
  };

  const add = (dir, depth) => {
    if (watchers.has(dir) || watchers.size >= MAX_DIRS || depth > maxDepth) return;
    let w;
    try {
      w = fs.watch(dir, (type, name) => {
        if (!name) return;
        const full = path.join(dir, String(name));
        onEvent(path.relative(root, full).split(path.sep).join("/"), type);
        if (type !== "rename" || skip(String(name))) return;
        fs.stat(full, (err, st) => {
          if (err) return drop(full);
          // a folder that appeared, or was swapped in place (a restored version): watch it afresh
          if (st.isDirectory()) {
            drop(full);
            add(full, depth + 1);
          }
        });
      });
    } catch {
      return;
    }
    w.on("error", () => drop(dir));
    watchers.set(dir, w);
    let entries = [];
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch {}
    for (const e of entries) if (e.isDirectory() && !skip(e.name)) add(path.join(dir, e.name), depth + 1);
  };

  add(root, 0);
  return {
    size: () => watchers.size,
    close: () => {
      for (const w of watchers.values()) {
        try {
          w.close();
        } catch {}
      }
      watchers.clear();
    },
  };
}
