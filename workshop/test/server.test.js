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
