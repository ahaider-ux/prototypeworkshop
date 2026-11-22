import { test } from "node:test";
import assert from "node:assert/strict";
import fsp from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import { startServer, injectHtml } from "../src/server.js";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const tmp = () => fsp.mkdtemp(path.join(os.tmpdir(), "workshop-"));
const HTML = "<!doctype html><html><head><title>Board</title></head><body><p class=\"t\">Hi</p></body></html>";
const H = { "content-type": "application/json", "x-workshop": "1" };

test("injects the runtime first and the overrides last", () => {
  const out = injectHtml(HTML, "board", { theme: "dark" });
  assert.ok(out.indexOf("/_workshop/runtime.js") < out.indexOf("<title>"));
  assert.ok(out.indexOf("__overrides.css") > out.indexOf("Hi"));
  assert.ok(out.indexOf("__overrides.css") < out.indexOf("</body>"));
  assert.match(injectHtml("<p>bare</p>", "x", {}), /^<script src="\/_workshop\/runtime\.js"/);
  assert.match(out, /data-settings="\{&quot;theme&quot;:&quot;dark&quot;\}"/);
});

test("API: create, style, fork, version, and live events", async () => {
  const srv = await startServer({ workspace: await tmp(), port: 0, quiet: true });
  try {
    const u = srv.url;
    const r1 = await fetch(`${u}/api/envs`, { method: "POST", headers: H, body: JSON.stringify({ html: HTML }) });
    assert.equal(r1.status, 201);
    const env = await r1.json();
    const page = await (await fetch(`${u}/env/${env.id}/`)).text();
    assert.match(page, /data-env="board"/);

    const events = [];
    const ctl = new AbortController();
    const es = fetch(`${u}/api/events`, { signal: ctl.signal }).then(async (r) => {
      const rd = r.body.getReader();
      const dec = new TextDecoder();
      for (;;) {
        const { value, done } = await rd.read();
        if (done) break;
        events.push(dec.decode(value));
      }
    }).catch(() => {});
    await new Promise((r) => setTimeout(r, 100));

    const st = await fetch(`${u}/api/envs/${env.id}/styles`, { method: "PATCH", headers: H, body: JSON.stringify({ selector: "p.t", props: { color: "var(--text-secondary, #57514b)" } }) });
    assert.equal(st.status, 200);
    const css = await (await fetch(`${u}/env/${env.id}/__overrides.css`)).text();
    assert.match(css, /p\.t \{\n  color: var\(--text-secondary, #57514b\) !important;/);

    const fk = await (await fetch(`${u}/api/envs/${env.id}/fork`, { method: "POST", headers: H, body: JSON.stringify({ name: "Board dark" }) })).json();
    assert.equal(fk.parent, env.id);
    const v = await (await fetch(`${u}/api/envs/${fk.id}/versions`, { method: "POST", headers: H, body: JSON.stringify({ label: "Try" }) })).json();
    assert.equal(v.n, 1);

    // an outside writer (an agent editing the file) reaches every canvas
    await fsp.writeFile(path.join(srv.store.envDir(env.id), "index.html"), HTML.replace("Hi", "Hello"));
    await new Promise((r) => setTimeout(r, 600));
    ctl.abort();
    await es;
    const all = events.join("");
    assert.match(all, new RegExp(`"kind":"env","id":"${env.id}"`));
    assert.match(all, /index\.html/);
  } finally {
    await srv.close();
  }
});

test("atomic rewrites by another writer (a harness) all reach the event stream", async () => {
  const srv = await startServer({ workspace: await tmp(), port: 0, quiet: true, agent: false });
  try {
    const env = await srv.store.createEnv({ html: HTML });
    const t = await srv.store.addTask({ env: env.id, prompt: "x" });
    const seen = [];
    const ctl = new AbortController();
    const rd = fetch(`${srv.url}/api/events`, { signal: ctl.signal }).then(async (r) => {
      const reader = r.body.getReader();
      const dec = new TextDecoder();
      for (;;) {
        const { value, done } = await reader.read();
        if (done) break;
        seen.push(dec.decode(value));
      }
    }).catch(() => {});
    await new Promise((r) => setTimeout(r, 400)); // let the events from creating them arrive first
    const count = () => (seen.join("").match(/"kind":"tasks"/g) || []).length;
    const before = count();
    const file = path.join(srv.store.metaDir, "tasks", `${t.id}.json`);
    for (const status of ["working", "done"]) {
      await fsp.writeFile(file + ".tmp", JSON.stringify({ ...t, status }));
      await fsp.rename(file + ".tmp", file);
      await new Promise((r) => setTimeout(r, 400));
    }
    await fsp.writeFile(path.join(srv.store.envDir(env.id), "overrides.css.tmp"), "p{}");
    await fsp.rename(path.join(srv.store.envDir(env.id), "overrides.css.tmp"), path.join(srv.store.envDir(env.id), "overrides.css"));
    await new Promise((r) => setTimeout(r, 400));
    ctl.abort();
    await rd;
    const all = seen.join("");
    assert.equal(count() - before, 2, all);
    assert.match(all, /"files":\["overrides\.css"\]/);
  } finally {
    await srv.close();
  }
});

test("guards: mutations need the header, hosts are checked, paths stay inside", async () => {
  const srv = await startServer({ workspace: await tmp(), port: 0, quiet: true });
  try {
    const u = srv.url;
    const no = await fetch(`${u}/api/envs`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ html: HTML }) });
    assert.equal(no.status, 403);
    const env = await (await fetch(`${u}/api/envs`, { method: "POST", headers: H, body: JSON.stringify({ html: HTML }) })).json();
    const evil = await fetch(`${u}/env/${env.id}/..%2F..%2Fworkshop.json`);
    assert.equal(evil.status, 400);
    const port = new URL(u).port;
    const rebind = await new Promise((resolve) => {
      import("node:http").then(({ request }) => {
        const req = request({ host: "127.0.0.1", port, path: "/api/workspace", headers: { host: "evil.example:80" } }, (res) => resolve(res.statusCode));
        req.end();
      });
    });
    assert.equal(rebind, 403);
  } finally {
    await srv.close();
  }
});

test("share links: view only, one environment, revocable", async () => {
  const srv = await startServer({ workspace: await tmp(), port: 0, quiet: true });
  try {
    const u = srv.url;
    const a = await (await fetch(`${u}/api/envs`, { method: "POST", headers: H, body: JSON.stringify({ html: HTML, name: "A" }) })).json();
    const b = await (await fetch(`${u}/api/envs`, { method: "POST", headers: H, body: JSON.stringify({ html: HTML, name: "B" }) })).json();
    const net = await (await fetch(`${u}/api/shares/network`, { method: "POST", headers: H, body: JSON.stringify({ on: true }) })).json();
    assert.equal(net.network, true);
    const link = await (await fetch(`${u}/api/shares`, { method: "POST", headers: H, body: JSON.stringify({ env: a.id, role: "view" }) })).json();
    const shareBase = `http://127.0.0.1:${Number(new URL(u).port) + 1}`;
    const open = await fetch(`${shareBase}/s/${link.token}`, { redirect: "manual" });
    assert.equal(open.status, 302);
    const cookie = open.headers.get("set-cookie").split(";")[0];
    assert.equal((await fetch(`${shareBase}/env/${a.id}/`, { headers: { cookie } })).status, 200);
    assert.equal((await fetch(`${shareBase}/env/${b.id}/`, { headers: { cookie } })).status, 403);
    assert.equal((await fetch(`${shareBase}/api/workspace`, { headers: { cookie } })).status, 403);
    assert.equal((await fetch(`${shareBase}/api/comments`, { method: "POST", headers: { cookie, ...H }, body: JSON.stringify({ x: 1, y: 1, text: "hi" }) })).status, 403);
    await fetch(`${u}/api/shares/${link.id}`, { method: "DELETE", headers: H });
    assert.equal((await fetch(`${shareBase}/env/${a.id}/`, { headers: { cookie } })).status, 403);
  } finally {
    await srv.close();
  }
});

test("canvas requests run through a configured agent, with a version saved first", async () => {
  const dir = await tmp();
  const srv = await startServer({ workspace: dir, port: 0, quiet: true });
  try {
    const u = srv.url;
    const env = await (await fetch(`${u}/api/envs`, { method: "POST", headers: H, body: JSON.stringify({ html: HTML }) })).json();
    const agentScript = path.join(HERE, "fixtures", "fake-agent.js");
    await fetch(`${u}/api/workspace`, { method: "PATCH", headers: H, body: JSON.stringify({ agent: { name: "Fake agent", command: [process.execPath, agentScript, "{request}"] } }) });
    const t = await (await fetch(`${u}/api/tasks`, { method: "POST", headers: H, body: JSON.stringify({ env: env.id, prompt: "Make the text accent", selection: { selector: "p.t" } }) })).json();
    assert.equal(t.runner, "auto");
    let done = null;
    for (let i = 0; i < 50 && !done; i++) {
      await new Promise((r) => setTimeout(r, 100));
      const list = await (await fetch(`${u}/api/tasks`)).json();
      const x = list.find((y) => y.id === t.id);
      if (x.status === "done" || x.status === "failed") done = x;
    }
    assert.equal(done?.status, "done", JSON.stringify(done?.log));
    assert.deepEqual(done.changed, ["overrides.css"]);
    assert.equal(done.beforeVersion, 1);
    assert.match(done.reply, /accent/);
    assert.match(await srv.store.getOverrides(env.id), /--text-accent/);
  } finally {
    await srv.close();
  }
});

test("API: canvas items, branches, review and merge, and requests that branch", async () => {
  const srv = await startServer({ workspace: await tmp(), port: 0, quiet: true, agent: false });
  try {
    const u = srv.url;
    const call = async (p, method = "GET", body) => {
      const r = await fetch(`${u}/api/${p}`, { method, headers: method === "GET" ? {} : H, body: body === undefined ? undefined : JSON.stringify(body) });
      return { status: r.status, body: await r.json() };
    };
    const env = (await call("envs", "POST", { html: HTML })).body;
    const ws = (await call("workspace")).body;
    assert.equal(ws.items.filter((i) => i.type === "board").length, 1, "a new prototype gets a board");
    const chat = (await call("canvas/items", "POST", { type: "board", env: env.id, screen: "Chat" })).body;
    assert.equal(chat.screen, "Chat");
    const page = await (await fetch(`${u}/env/${env.id}/?ws-screen=Chat`)).text();
    assert.match(page, /runtime\.js/);
    const note = (await call("canvas/items", "POST", { type: "note", x: 10, y: 10, text: "Look here" })).body;
    assert.equal((await call(`canvas/items/${note.id}`, "PATCH", { text: "Look again" })).body.text, "Look again");
    assert.equal((await call("canvas/items", "POST", { type: "note", x: "far", y: 0 })).status, 400);

    const br = (await call(`envs/${env.id}/branch`, "POST", { name: "Bolder" })).body;
    assert.equal(br.parent, env.id);
    assert.equal((await fetch(`${u}/env/${br.id}/`)).status, 200, "a branch serves its parent's files");
    await call(`envs/${br.id}/styles`, "PATCH", { selector: "p.t", props: { "font-weight": "500" } });
    const d = (await call(`envs/${br.id}/diff`)).body;
    assert.equal(d.changes.length, 1);
    const m = (await call(`envs/${br.id}/merge`, "POST", { take: {} })).body;
    assert.equal(m.applied, 1);
    assert.match(await (await fetch(`${u}/env/${env.id}/__overrides.css`)).text(), /font-weight: 500/);
    assert.equal((await call(`envs/${br.id}`)).body.archived, true);
    assert.equal((await call(`envs/${env.id}`, "DELETE")).status, 409, "the merged branch still reads its files");

    const t = (await call("tasks", "POST", { env: env.id, prompt: "Make the text bigger please", branch: true })).body;
    assert.notEqual(t.env, env.id, "the request went to a branch of its own");
    const tb = (await call(`envs/${t.env}`)).body;
    assert.equal(tb.parent, env.id);
    assert.equal(tb.name, "Text bigger");
  } finally {
    await srv.close();
  }
});

test("spaces: connect a project folder, edit it in place, switch back", async () => {
  const first = await tmp();
  const project = await tmp();
  await fsp.mkdir(path.join(project, "site"));
  await fsp.writeFile(path.join(project, "site", "index.html"), HTML.replace("Board", "Site"));
  const spaces = path.join(await tmp(), "spaces.json");
  const srv = await startServer({ workspace: first, port: 0, quiet: true, agent: false, spaces });
  const call = (p, body) => fetch(`${srv.url}/api/${p}`, body ? { method: "POST", headers: H, body: JSON.stringify(body) } : { headers: { "x-workshop": "1" } }).then(async (r) => ({ status: r.status, body: await r.json() }));
  try {
    assert.equal((await call("spaces")).body.current, first);
    const picked = await call(`folders?path=${encodeURIComponent(project)}`);
    assert.deepEqual(picked.body.dirs.map((d) => [d.name, d.prototype]), [["site", true]]);
    assert.equal((await fetch(`${srv.url}/api/folders`)).status, 403, "folder names need the editor's header");
    const c = await call("spaces", { path: project });
    assert.equal(c.status, 201);
    assert.deepEqual(c.body.added.map((e) => e.name), ["Site"]);
    assert.equal(c.body.current, project);
    assert.equal(srv.store.home, project);
    // served from the real file, and live edits to it show up
    const id = c.body.added[0].id;
    assert.match(await (await fetch(`${srv.url}/env/${id}/`)).text(), /Site/);
    const ws = await (await fetch(`${srv.url}/api/workspace`)).json();
    assert.equal(ws.home, project);
    assert.equal(ws.envs[0].folder, path.join(project, "site"));
    // switch back; the list remembers both
    const back = await call("spaces/switch", { path: first });
    assert.equal(back.body.current, first);
    assert.deepEqual(back.body.spaces.map((x) => x.path).sort(), [first, project].sort());
    assert.equal((await call("spaces/switch", { path: os.tmpdir() })).status, 404, "only connected folders can be switched to");
    assert.equal((await call("spaces", { path: os.homedir() })).status, 400, "never the home folder itself");
    assert.equal((await call("spaces/forget", { path: first })).status, 400, "not the space you're in");
    const forgot = await call("spaces/forget", { path: project });
    assert.deepEqual(forgot.body.spaces.map((x) => x.path), [first]);
    assert.ok(await fsp.stat(path.join(project, "site", "index.html")), "forgetting a space touches no files");
  } finally {
    await srv.close();
  }
});

test("fonts: served from a craft-fonts checkout by fixed name only, a 404 without one", async () => {
  const dir = await tmp();
  await fsp.mkdir(path.join(dir, "fonts", "zilla-slab"), { recursive: true });
  await fsp.writeFile(path.join(dir, "fonts", "zilla-slab", "ZillaSlab-Bold.ttf"), "TTF-BYTES");
  await fsp.writeFile(path.join(dir, "secret.txt"), "nope");
  await fsp.writeFile(
    path.join(dir, "fonts", "latin-manifest.txt"),
    [
      "# family | style | file | scripts | licence | licence file | sha256 | source",
      "Zilla Slab | Bold | fonts/zilla-slab/ZillaSlab-Bold.ttf | Latn | OFL-1.1 | fonts/zilla-slab/OFL.txt | x | https://example.invalid",
      // a hostile manifest line must not reach outside the checkout
      "Shantell Sans | Variable | ../../etc/passwd.ttf | Latn | OFL-1.1 | x | x | https://example.invalid",
      "Schibsted Grotesk | Variable | secret.txt | Latn | OFL-1.1 | x | x | https://example.invalid",
    ].join("\n"),
  );
  const srv = await startServer({ workspace: await tmp(), port: 0, quiet: true, fontsDir: dir });
  const bare = await startServer({ workspace: await tmp(), port: 0, quiet: true, fontsDir: null });
  try {
    const ok = await fetch(`${srv.url}/fonts/zilla-slab-bold.ttf`);
    assert.equal(ok.status, 200);
    assert.equal(ok.headers.get("content-type"), "font/ttf");
    assert.equal(await ok.text(), "TTF-BYTES");
    assert.equal((await fetch(`${srv.url}/fonts/shantell-sans.ttf`)).status, 404); // ../ in the manifest
    assert.equal((await fetch(`${srv.url}/fonts/schibsted-grotesk.ttf`)).status, 404); // not a font file
    assert.equal((await fetch(`${srv.url}/fonts/zilla-slab-semibold.ttf`)).status, 404); // not listed
    assert.equal((await fetch(`${srv.url}/fonts/inter.ttf`)).status, 404); // not one of Atelier's faces
    assert.equal((await fetch(`${srv.url}/fonts/..%2Fsecret.ttf`)).status, 404);
    assert.equal((await fetch(`${bare.url}/fonts/zilla-slab-bold.ttf`)).status, 404); // no checkout: the CSS falls back
  } finally {
    await srv.close();
    await bare.close();
  }
});
