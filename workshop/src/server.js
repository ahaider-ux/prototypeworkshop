// The Workshop server: serves the canvas UI, each environment's files (with the runtime injected),
// a JSON API the canvas and harnesses share, and a live event stream so every open canvas
// reloads a board the moment its files change on disk — whoever changed them.

import http from "node:http";
import fs from "node:fs";
import fsp from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import { fileURLToPath } from "node:url";
import { Store, StoreError, assertId } from "./store.js";
import { AgentRunner } from "./agent.js";
import { screenshot, screenshotAvailable } from "./screenshot.js";
import { watchTree } from "./watch.js";
import { injectHtml } from "./inject.js";

export { injectHtml } from "./inject.js";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const UI_DIR = path.resolve(HERE, "..", "ui");
const RUNTIME = path.join(HERE, "runtime.js");
const MAX_BODY = 80 * 1024 * 1024; // Guard: the biggest upload we accept (a large single-file prototype is ~10 MB)

const TYPES = {
  ".html": "text/html; charset=utf-8", ".htm": "text/html; charset=utf-8", ".js": "text/javascript; charset=utf-8", ".mjs": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8", ".json": "application/json; charset=utf-8", ".svg": "image/svg+xml", ".png": "image/png", ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg", ".gif": "image/gif", ".webp": "image/webp", ".avif": "image/avif", ".ico": "image/x-icon", ".woff": "font/woff", ".woff2": "font/woff2",
  ".ttf": "font/ttf", ".otf": "font/otf", ".mp4": "video/mp4", ".webm": "video/webm", ".mp3": "audio/mpeg", ".wav": "audio/wav", ".txt": "text/plain; charset=utf-8",
  ".md": "text/markdown; charset=utf-8", ".map": "application/json", ".wasm": "application/wasm", ".glb": "model/gltf-binary", ".gltf": "model/gltf+json",
};

// "Make the sidebar rows denser" → "Sidebar rows denser"
export function branchNameFor(prompt) {
  const words = String(prompt || "").replace(/[^\p{L}\p{N}\s-]/gu, " ").split(/\s+/).filter(Boolean);
  const skip = new Set(["make", "please", "can", "you", "try", "the", "a", "an", "to", "and", "of", "this", "that", "it", "be", "more", "with", "for", "on", "in"]);
  const keep = words.filter((w, i) => !(skip.has(w.toLowerCase()) && i < 3) && !skip.has(w.toLowerCase())).slice(0, 4);
  const t = (keep.length ? keep : words.slice(0, 4)).join(" ");
  return t ? t[0].toUpperCase() + t.slice(1) : "Agent branch";
}

function lanAddress() {
  for (const list of Object.values(os.networkInterfaces())) for (const a of list || []) if (a.family === "IPv4" && !a.internal) return a.address;
  return null;
}

export async function startServer({ workspace, port = 4600, host = "127.0.0.1", quiet = false, agent = true } = {}) {
  const store = await Store.open(workspace);
  const clients = new Set();
  const emit = (event) => {
    const line = `event: change\ndata: ${JSON.stringify(event)}\n\n`;
    for (const res of clients) {
      try {
        res.write(line);
      } catch {}
    }
  };
  const runner = agent ? new AgentRunner(store, emit) : null;
  const state = { port, shareServer: null, sharePort: null };

  // ---------- helpers ----------
  const send = (res, status, body, headers = {}) => {
    const buf = typeof body === "string" || Buffer.isBuffer(body) ? body : JSON.stringify(body);
    res.writeHead(status, { "cache-control": "no-store", "x-content-type-options": "nosniff", ...headers });
    res.end(buf);
  };
  const json = (res, status, body) => send(res, status, body, { "content-type": "application/json; charset=utf-8" });
  const fail = (res, e) => {
    if (e instanceof StoreError) return json(res, e.status || 400, { error: e.code, message: e.message });
    if (e && e.code && Number.isInteger(e.status)) return json(res, e.status, { error: e.code, message: e.message });
    if (!quiet) console.error(e);
    return json(res, 500, { error: "internal", message: "Something went wrong on the server" });
  };
  const body = (req) =>
    new Promise((resolve, reject) => {
      const parts = [];
      let n = 0;
      req.on("data", (c) => {
        n += c.length;
        if (n > MAX_BODY) {
          reject(new StoreError("too_big", "That upload is too big", 413));
          req.destroy();
        } else parts.push(c);
      });
      req.on("end", () => {
        const raw = Buffer.concat(parts).toString("utf8");
        if (!raw) return resolve({});
        try {
          resolve(JSON.parse(raw));
        } catch {
          reject(new StoreError("bad_json", "The request body isn't JSON"));
        }
      });
      req.on("error", reject);
    });

  async function serveFile(res, file, { inject = null, type } = {}) {
    const st = await fsp.stat(file).catch(() => null);
    if (!st || !st.isFile()) return send(res, 404, "Not found", { "content-type": "text/plain; charset=utf-8" });
    const ext = path.extname(file).toLowerCase();
    const ct = type || TYPES[ext] || "application/octet-stream";
    if (inject && (ext === ".html" || ext === ".htm")) {
      const html = await fsp.readFile(file, "utf8");
      return send(res, 200, injectHtml(html, inject.env, inject.settings), { "content-type": ct });
    }
    res.writeHead(200, { "content-type": ct, "content-length": st.size, "cache-control": "no-store", "x-content-type-options": "nosniff" });
    fs.createReadStream(file).pipe(res);
  }

  async function settingsOf(id) {
    const env = await store.getEnv(id);
    return { env: id, theme: env.theme, screen: env.screen, state: env.state, variants: env.variants, patches: env.patches };
  }

  async function serveEnv(req, res, id, rest) {
    assertId(id);
    if (rest === "__overrides.css") return send(res, 200, await store.getOverrides(id), { "content-type": "text/css; charset=utf-8" });
    if (rest === "__workshop.json") return json(res, 200, await settingsOf(id));
    const rel = rest === "" || rest.endsWith("/") ? rest + "index.html" : rest;
    store.safeJoin(store.envDir(id), decodeURIComponent(rel)); // refuses ../ and dot files
    const file = await store.resolveFile(id, decodeURIComponent(rel)); // a branch reads files it hasn't changed from its base
    if (!file) return send(res, 404, "Not found", { "content-type": "text/plain; charset=utf-8" });
    const settings = /\.html?$/i.test(file) ? await settingsOf(id) : null;
    return serveFile(res, file, { inject: settings ? { env: id, settings } : null });
  }

  // ---------- the API ----------
  async function api(req, res, parts, url) {
    const m = req.method;
    const [a, b, c, d] = parts;
    const me = "You";

    if (a === "workspace" && !b) {
      if (m === "GET") {
        const [ws, envs, harnesses, items] = await Promise.all([store.workspace(), store.listEnvs(), store.harnesses(), store.items()]);
        return json(res, 200, { ...ws, envs, items, harnesses, screenshot: await screenshotAvailable(), share: shareInfo(), cli: { node: process.execPath, bin: path.resolve(HERE, "..", "bin", "workshop.js") } });
      }
      if (m === "PATCH") return json(res, 200, await store.updateWorkspace(await body(req)));
    }
    if (a === "canvas" && b === "items") {
      if (!c && m === "GET") return json(res, 200, await store.items());
      if (!c && m === "POST") return json(res, 201, await store.addItem(await body(req), me));
      if (c && m === "PATCH") return json(res, 200, await store.updateItem(c, await body(req)));
      if (c && m === "DELETE") return json(res, 200, await store.deleteItem(c));
    }
    if (a === "envs") {
      if (!b) {
        if (m === "GET") return json(res, 200, await store.listEnvs());
        if (m === "POST") {
          const p = await body(req);
          const env = await store.createEnv({ name: p.name, html: p.html, description: p.description, author: me, source: p.source || { kind: "upload" } });
          emit({ kind: "envs" });
          return json(res, 201, env);
        }
      }
      if (b === "restore" && m === "POST") {
        const env = await store.restoreEnv((await body(req)).trash);
        emit({ kind: "envs" });
        return json(res, 200, env);
      }
      if (b && !c) {
        if (m === "GET") return json(res, 200, await store.getEnv(b));
        if (m === "PATCH") {
          const env = await store.updateEnv(b, await body(req));
          return json(res, 200, env);
        }
        if (m === "DELETE") {
          const r = await store.deleteEnv(b);
          emit({ kind: "envs" });
          return json(res, 200, r);
        }
      }
      if (b && c === "branch" && m === "POST") {
        const p = await body(req);
        const env = await store.branchEnv(b, { name: p.name, author: me });
        emit({ kind: "envs" });
        return json(res, 201, env);
      }
      if (b && c === "diff" && m === "GET") return json(res, 200, await store.diffEnv(b));
      if (b && c === "merge" && m === "POST") {
        const p = await body(req);
        const r = await store.mergeEnv(b, { take: p.take || {}, author: me });
        emit({ kind: "envs" });
        return json(res, 200, r);
      }
      if (b && c === "update-from-main" && m === "POST") return json(res, 200, await store.updateFromMain(b, { author: me }));
      if (b && c === "checkout" && m === "POST") return json(res, 200, await store.checkout(b));
      if (b && c === "fork" && m === "POST") {
        const p = await body(req);
        const env = await store.forkEnv(b, { name: p.name, version: p.version ?? null, author: me });
        emit({ kind: "envs" });
        return json(res, 201, env);
      }
      if (b && c === "files") {
        const rel = parts.slice(3).join("/");
        if (!rel && m === "GET") return json(res, 200, await store.listFiles(b));
        if (rel && m === "GET") return send(res, 200, await store.readFile(b, decodeURIComponent(rel)), { "content-type": TYPES[path.extname(rel).toLowerCase()] || "application/octet-stream" });
        if (rel && m === "PUT") {
          const p = await body(req);
          return json(res, 200, await store.writeFile(b, decodeURIComponent(rel), p.content ?? ""));
        }
      }
      if (b && c === "styles") {
        if (m === "GET") return json(res, 200, { css: await store.getOverrides(b) });
        if (m === "PATCH") {
          const p = await body(req);
          if (Array.isArray(p.rules)) return json(res, 200, await store.setStyles(b, p.rules));
          return json(res, 200, await store.setStyle(b, p.selector, p.props || {}));
        }
        if (m === "DELETE") {
          const p = await body(req);
          return json(res, 200, await store.clearStyles(b, p.selector || null));
        }
      }
      if (b && c === "text" && m === "PUT") {
        const p = await body(req);
        return json(res, 200, { patches: await store.setText(b, p.selector, p.text ?? null) });
      }
      if (b && c === "versions") {
        if (!d && m === "GET") return json(res, 200, await store.listVersions(b));
        if (!d && m === "POST") {
          const p = await body(req);
          const v = await store.saveVersion(b, { label: p.label, author: me });
          emit({ kind: "versions", id: b });
          return json(res, 201, v);
        }
        if (d && parts[4] === "restore" && m === "POST") {
          const r = await store.restoreVersion(b, Number(d), { author: me });
          emit({ kind: "versions", id: b });
          return json(res, 200, r);
        }
      }
      if (b && c === "screenshot" && m === "GET") {
        const env = await store.getEnv(b);
        const w = Number(url.searchParams.get("w")) || env.device.w;
        const h = Number(url.searchParams.get("h")) || env.device.h;
        const png = await screenshot(`http://127.0.0.1:${state.port}/env/${b}/`, { width: w, height: h });
        return send(res, 200, png, { "content-type": "image/png" });
      }
    }
    if (a === "comments") {
      if (!b && m === "GET") return json(res, 200, await store.records("comments"));
      if (!b && m === "POST") {
        const p = await body(req);
        const r = await store.addComment({ ...p, author: me });
        emit({ kind: "comments" });
        return json(res, 201, r);
      }
      if (b && m === "PATCH") {
        const r = await store.updateComment(b, await body(req));
        emit({ kind: "comments" });
        return json(res, 200, r);
      }
      if (b && m === "DELETE") {
        const r = await store.deleteComment(b);
        emit({ kind: "comments" });
        return json(res, 200, r);
      }
    }
    if (a === "tasks") {
      if (!b && m === "GET") return json(res, 200, await store.records("tasks"));
      if (!b && m === "POST") {
        const p = await body(req);
        const ws = await store.workspace();
        let env = p.env;
        if (p.branch) {
          // the agent works on its own branch, so main only changes when someone merges
          const name = typeof p.branchName === "string" && p.branchName.trim() ? p.branchName : branchNameFor(p.prompt);
          env = (await store.branchEnv(p.env, { name, author: me })).id;
          emit({ kind: "envs" });
        }
        const t = await store.addTask({ env, prompt: p.prompt, selection: p.selection, author: me, runner: ws.agent && runner ? "auto" : "harness" });
        emit({ kind: "tasks" });
        if (t.runner === "auto") runner.kick();
        return json(res, 201, t);
      }
      if (b && c === "cancel" && m === "POST") {
        if (runner) runner.cancel(b);
        const t = await store.updateTask(b, { status: "cancelled", log: "Stopped from the canvas", logKind: "note" });
        emit({ kind: "tasks" });
        return json(res, 200, t);
      }
    }
    if (a === "selection") {
      if (m === "GET") return json(res, 200, await store.selection());
      if (m === "PUT") return json(res, 200, await store.setSelection((await body(req)).selection ?? null));
    }
    if (a === "shares") {
      if (!b && m === "GET") return json(res, 200, { links: (await store.records("shares")).filter((s) => !s.revoked), ...shareInfo() });
      if (!b && m === "POST") {
        const p = await body(req);
        return json(res, 201, await store.addShare({ env: p.env, role: p.role, author: me }));
      }
      if (b === "network" && m === "POST") {
        const p = await body(req);
        if (p.on) await openShareListener();
        else await closeShareListener();
        return json(res, 200, shareInfo());
      }
      if (b && m === "DELETE") return json(res, 200, await store.revokeShare(b));
    }
    return json(res, 404, { error: "not_found", message: "No such API route" });
  }

  function shareInfo() {
    const ip = lanAddress();
    return { network: !!state.shareServer, base: state.shareServer && ip ? `http://${ip}:${state.sharePort}` : null, local: `http://127.0.0.1:${state.port}` };
  }

  // ---------- main listener: this computer only ----------
  const okHosts = () => new Set([`127.0.0.1:${state.port}`, `localhost:${state.port}`, `[::1]:${state.port}`]);

  async function handle(req, res) {
    try {
      const url = new URL(req.url, "http://x");
      // Guard: DNS rebinding — a web page on another site can't reach this server through a hostname it controls.
      if (!okHosts().has(String(req.headers.host || "").toLowerCase())) return send(res, 403, "Open the Workshop at http://127.0.0.1:" + state.port, { "content-type": "text/plain; charset=utf-8" });
      const p = url.pathname;
      if (p.startsWith("/api/")) {
        // Guard: every change needs this header, which a cross-site form or image request can't send.
        if (req.method !== "GET" && req.method !== "HEAD" && req.headers["x-workshop"] !== "1") return json(res, 403, { error: "forbidden", message: "Missing the x-workshop header" });
        if (p === "/api/events") return events(req, res);
        return await api(req, res, p.slice(5).split("/").filter(Boolean), url);
      }
      if (p === "/_workshop/runtime.js") return serveFile(res, RUNTIME);
      const envm = /^\/env\/([a-z0-9][a-z0-9-]{0,63})(?:\/(.*))?$/.exec(p);
      if (envm) {
        if (envm[2] === undefined) return send(res, 301, "", { location: `/env/${envm[1]}/` });
        return await serveEnv(req, res, envm[1], envm[2]);
      }
      if (p === "/" || /^\/(home|canvas|tasks)(\/.*)?$/.test(p)) return serveFile(res, path.join(UI_DIR, "index.html"));
      if (/^\/present\/[a-z0-9-]+\/?$/.test(p)) return serveFile(res, path.join(UI_DIR, "present.html"));
      if (p.startsWith("/ui/")) return serveFile(res, store.safeJoin(UI_DIR, p.slice(4)));
      return send(res, 404, "Not found", { "content-type": "text/plain; charset=utf-8" });
    } catch (e) {
      return fail(res, e);
    }
  }

  function events(req, res) {
    res.writeHead(200, { "content-type": "text/event-stream", "cache-control": "no-store", connection: "keep-alive" });
    res.write(`event: hello\ndata: {}\n\n`);
    clients.add(res);
    const ping = setInterval(() => {
      try {
        res.write(": ping\n\n");
      } catch {}
    }, 25_000);
    req.on("close", () => {
      clearInterval(ping);
      clients.delete(res);
    });
  }

  // ---------- share listener: other computers, share links only ----------
  async function handleShare(req, res) {
    try {
      const url = new URL(req.url, "http://x");
      const p = url.pathname;
      const cookie = /(?:^|;\s*)ws_share=([a-z0-9]{8,40})/.exec(String(req.headers.cookie || ""));
      const linkm = /^\/s\/([a-z0-9]{8,40})\/?$/.exec(p);
      if (linkm) {
        const s = await store.shareByToken(linkm[1]);
        if (!s) return send(res, 404, "This link was turned off or never existed.", { "content-type": "text/plain; charset=utf-8" });
        return send(res, 302, "", { location: `/present/${s.env}/?shared=1`, "set-cookie": `ws_share=${s.token}; Path=/; HttpOnly; SameSite=Lax` });
      }
      // Guard: everything else on this listener needs a live share cookie, and only reaches that link's environment.
      const share = cookie ? await store.shareByToken(cookie[1]) : null;
      if (!share) return send(res, 403, "Open a share link first.", { "content-type": "text/plain; charset=utf-8" });
      if (p === "/_workshop/runtime.js") return serveFile(res, RUNTIME);
      if (p.startsWith("/ui/")) return serveFile(res, store.safeJoin(UI_DIR, p.slice(4)));
      if (p === `/present/${share.env}/` || p === `/present/${share.env}`) return serveFile(res, path.join(UI_DIR, "present.html"));
      const envm = /^\/env\/([a-z0-9][a-z0-9-]{0,63})\/(.*)$/.exec(p);
      if (envm && envm[1] === share.env && req.method === "GET") return await serveEnv(req, res, envm[1], envm[2]);
      if (p === `/api/envs/${share.env}` && req.method === "GET") {
        const e = await store.getEnv(share.env);
        return json(res, 200, { id: e.id, name: e.name, device: e.device, theme: e.theme, versions: e.versions, shared: share.role });
      }
      if (p === "/api/comments" && req.method === "GET") return json(res, 200, (await store.records("comments")).filter((c) => c.env === share.env));
      if (p === "/api/comments" && req.method === "POST" && share.role === "comment" && req.headers["x-workshop"] === "1") {
        const b = await body(req);
        const r = await store.addComment({ env: share.env, x: b.x, y: b.y, selector: b.selector, text: b.text, parent: b.parent || null, author: String(b.author || "Guest").slice(0, 40) });
        emit({ kind: "comments" });
        return json(res, 201, r);
      }
      return send(res, 403, "Not shared.", { "content-type": "text/plain; charset=utf-8" });
    } catch (e) {
      return fail(res, e);
    }
  }

  async function openShareListener() {
    if (state.shareServer) return;
    const srv = http.createServer(handleShare);
    await new Promise((resolve, reject) => {
      srv.once("error", reject);
      srv.listen(state.port + 1, "0.0.0.0", resolve);
    });
    state.shareServer = srv;
    state.sharePort = srv.address().port;
  }
  async function closeShareListener() {
    if (!state.shareServer) return;
    await new Promise((r) => state.shareServer.close(() => r()));
    state.shareServer = null;
  }

  // ---------- watching the workspace: any writer (editor, agent, harness) updates the canvas ----------
  const pending = new Map();
  const queue = (key, ev) => {
    clearTimeout(pending.get(key)?.t);
    const prev = pending.get(key)?.ev;
    const files = new Set([...(prev?.files || []), ...(ev.files || [])]);
    pending.set(key, { ev: { ...ev, files: [...files] }, t: setTimeout(() => (pending.delete(key), emit({ ...ev, files: [...files] })), 120) });
  };
  const watchers = [];
  try {
    watchers.push(
      watchTree(store.envsDir, (name) => {
        if (!name) return;
        const rel = String(name).split("/");
        const id = rel[0];
        if (!/^[a-z0-9][a-z0-9-]{0,63}$/.test(id)) return;
        const file = rel.slice(1).join("/");
        if (file.endsWith(".tmp") || /\.(restore|old)-[0-9a-f]+/.test(id)) return; // atomic-write temp files: the rename that follows is the real change
        if (!file) return queue("envs", { kind: "envs" });
        queue(`env:${id}`, { kind: "env", id, files: [file] });
      }),
    );
    watchers.push(watchTree(store.canvasDir, (name) => name && !String(name).endsWith(".tmp") && queue("canvas", { kind: "canvas" }), { maxDepth: 0 }));
    watchers.push(
      watchTree(store.metaDir, (name) => {
        if (!name || String(name).endsWith(".tmp")) return;
        const top = String(name).split("/")[0];
        if (["tasks", "comments", "harness", "versions"].includes(top)) queue(top, { kind: top });
        if (top === "tasks" && runner) runner.kick();
      }, { maxDepth: 2, skip: (n) => n === "trash" || n === "files" }),
    );
  } catch (e) {
    if (!quiet) console.warn("Live reload is off: this system can't watch folders", e.message);
  }

  const server = http.createServer(handle);
  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(port, host, resolve);
  });
  state.port = server.address().port;
  await fsp.writeFile(path.join(store.metaDir, "server.json"), JSON.stringify({ port: state.port, pid: process.pid, at: new Date().toISOString() }) + "\n");
  if (runner) runner.kick();

  const close = async () => {
    for (const w of watchers) w.close();
    for (const r of clients) r.end();
    await closeShareListener();
    await new Promise((r) => server.close(() => r()));
    await fsp.rm(path.join(store.metaDir, "server.json"), { force: true });
  };
  return { url: `http://127.0.0.1:${state.port}`, port: state.port, store, close, emit };
}
