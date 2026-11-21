// Recipes: the team's shared ways of working, run by agents. Each one is specific (one kind of
// job), shared (anyone can run it, the file is committed with the workspace) and scrutinised: its
// instructions are versioned (testing → production → retired) and every run is counted by what
// became of its branch, so someone can watch it and make it better.

import { S, fire, isBranch } from "./state.js";
import { h, esc, api, toast, IC, modal, closeModal } from "./lib.js";

const pageName = (e) => (e ? (isBranch(e) ? e.name : "Main") : "");
const prod = (r) => r.versions.find((v) => v.status === "production") || r.versions[r.versions.length - 1];

export async function loadRecipes() {
  try {
    S.recipes = await api("recipes");
  } catch {
    S.recipes = S.recipes || [];
  }
  fire("recipes");
}

// how a recipe's runs went, as one line and a bar: merged, open, discarded or failed
function statsLine(st) {
  if (!st?.runs) return `<span class="rcst">No runs yet</span>`;
  const seg = (n, cls) => (n ? `<i class="${cls}" style="flex:${n}"></i>` : "");
  const rate = st.merged + st.discarded + st.failed ? Math.round((100 * st.merged) / (st.merged + st.discarded + st.failed)) : null;
  return `<div class="rcbar" aria-hidden="true">${seg(st.merged, "m")}${seg(st.open, "o")}${seg(st.discarded + st.failed, "d")}</div><span class="rcst">${st.runs} run${st.runs === 1 ? "" : "s"} · ${st.merged} merged${st.open ? ` · ${st.open} open` : ""}${st.discarded + st.failed ? ` · ${st.discarded + st.failed} not kept` : ""}${rate !== null ? ` · ${rate}% kept` : ""}</span>`;
}

export function renderRecipes(head, body, env) {
  const add = h(`<button type="button" class="dbtn sm">${IC.plus || ""}New</button>`);
  add.onclick = () => openRecipe(null);
  head.append(add);
  if (!S.recipes) {
    loadRecipes();
    return;
  }
  body.append(h(`<div class="isec" style="border-bottom:0;padding-bottom:0"><span class="lineage">Standing instructions an agent follows. From Main, a run works on a new branch you review and merge; on a branch, it works there.</span></div>`));
  if (!S.recipes.length) body.append(h(`<div class="pempty"><b>No recipes yet</b>Write down a job you ask for often, so anyone can run it the same way.</div>`));
  for (const r of S.recipes) {
    const v = prod(r);
    const testing = r.versions.filter((x) => x.status === "testing");
    // a run still waiting on a branch that was since merged or archived doesn't count
    const running = S.tasks.some((t) => t.recipe?.id === r.id && (t.status === "queued" || t.status === "working") && S.envs.get(t.env) && !S.envs.get(t.env).archived);
    const card = h(`<div class="isec rcard">
      <div class="ih"><b>${esc(r.name)}</b>${r.trigger === "on-notes" ? `<span class="tagro info" title="Runs on a branch when notes or drawings are added there">Auto</span>` : ""}<span class="tagro">v${v.n}</span>${testing.length ? `<span class="tagro" title="A newer version waits to be tried">v${testing[testing.length - 1].n} testing</span>` : ""}</div>
      ${r.description ? `<span class="lineage">${esc(r.description)}</span>` : ""}
      <div class="rcs">${statsLine(r.stats)}</div>
      <div class="rca"><button type="button" class="createbtn sm" data-a="run" ${running ? "disabled" : ""}>${running ? "Running…" : `Run on ${esc(pageName(env))}`}</button><button type="button" class="dbtn sm" data-a="edit">Open</button></div>
    </div>`);
    card.querySelector('[data-a="run"]').onclick = () => runRecipe(r, env);
    card.querySelector('[data-a="edit"]').onclick = () => openRecipe(r.id);
    body.append(card);
  }
}

async function runRecipe(r, env, version = null) {
  try {
    const out = await api(`recipes/${r.id}/run`, { method: "POST", body: { env: env.id, version } });
    if (out.already) return toast(`${r.name} is already waiting on this branch`);
    const onBranch = out.env !== env.id;
    toast(`${r.name} is queued${onBranch ? " on a new branch" : ""}`, onBranch ? "Main stays as it is until you merge the result" : "Its changes show up here to review", onBranch ? { label: "Go to branch", fn: () => fire("go", out.env) } : null);
  } catch (e) {
    toast(`Couldn't run ${r.name}`, e.message);
  }
}

// one recipe: its name, when it runs, its instructions, and every version with how it did
export function openRecipe(id) {
  const r = id ? S.recipes?.find((x) => x.id === id) : null;
  const v = r ? prod(r) : null;
  const latest = r ? r.versions[r.versions.length - 1] : null;
  const md = modal(
    `<div class="md-h"><div class="tt"><h2>${r ? esc(r.name) : "New recipe"}</h2><p>${r ? `Version ${v.n} runs. A changed version is saved as testing until you promote it.` : "A job you ask for often, written once so anyone can run it the same way."}</p></div><button type="button" class="ib32" data-a="x" aria-label="Close">${IC.x}</button></div>
    <form class="md-b" id="rcF">
      <div class="fld"><span class="lr">Name</span><div class="afld-in"><input id="rcName" maxlength="80" value="${esc(r?.name || "")}" placeholder="Copy pass"></div></div>
      <div class="fld"><span class="lr">What it's for</span><div class="afld-in"><input id="rcDesc" maxlength="400" value="${esc(r?.description || "")}" placeholder="One line people read before running it"></div></div>
      <div class="fld"><span class="lr">Instructions${r ? ` <span style="color:var(--text-secondary);font-weight:400">· from v${latest.n}</span>` : ""}</span><textarea class="afld-ta" id="rcText" style="min-height:160px" maxlength="20000" placeholder="What the agent should do, step by step, and what it must not touch">${esc(latest?.prompt || "")}</textarea></div>
      ${r ? `<div class="fld"><span class="lr">What changed in this version</span><div class="afld-in"><input id="rcNote" maxlength="200" placeholder="Shorter steps, stricter about tokens"></div></div>` : ""}
      <div class="setrow"><div class="tx"><span style="font-size:12px;line-height:1.5">Run on its own when notes or drawings are added to a branch (after a 15 second pause). Uses your agent each time.</span></div><button type="button" class="sw" id="rcAuto" role="switch" aria-checked="${r?.trigger === "on-notes"}" aria-label="Run when notes are added"><i></i></button></div>
      ${r ? `<div class="rvg"><div class="rvh">Versions</div><div id="rcVers"></div></div>` : ""}
    </form>
    <div class="md-f">${r ? `<button type="button" class="dbtn sm err" data-a="del">${IC.trash}Delete</button>` : ""}<span class="sp"></span><button type="button" class="ghbtn" data-a="x2">Cancel</button><button type="button" class="createbtn" data-a="ok">${r ? "Save" : "Create recipe"}</button></div>`,
    { wide: true },
  );
  const auto = md.querySelector("#rcAuto");
  auto.onclick = () => auto.setAttribute("aria-checked", String(auto.getAttribute("aria-checked") !== "true"));
  if (r) {
    const list = md.querySelector("#rcVers");
    const bv = r.stats?.byVersion || {};
    for (const x of [...r.versions].reverse()) {
      const s = bv[x.n];
      const tag = x.status === "production" ? `<span class="tagro ok">Production</span>` : x.status === "testing" ? `<span class="tagro info">Testing</span>` : `<span class="tagro">Retired</span>`;
      const row = h(`<div class="rvr"><div style="display:flex;flex-direction:column;gap:4px;min-width:0"><span class="k">v${x.n} · ${esc(x.note || "No note")}</span><span class="v">${esc(x.author || "")} · ${s ? `${s.runs} run${s.runs === 1 ? "" : "s"}, ${s.merged} merged` : "not run yet"}</span></div><span class="ch" style="display:flex;gap:8px;align-items:center">${tag}${x.status !== "production" ? `<button type="button" class="dbtn sm" data-a="try">Try</button><button type="button" class="dbtn sm" data-a="pro">Promote</button>` : ""}</span></div>`);
      const tr = row.querySelector('[data-a="try"]');
      if (tr)
        tr.onclick = () => {
          const env = S.envs.get(S.page);
          if (env) runRecipe(r, env, x.n);
          closeModal();
        };
      const pr = row.querySelector('[data-a="pro"]');
      if (pr)
        pr.onclick = async () => {
          try {
            await api(`recipes/${r.id}/promote`, { method: "POST", body: { n: x.n } });
            closeModal();
            await loadRecipes();
            toast(`v${x.n} of ${r.name} is in production`, "New runs use it");
          } catch (e) {
            toast("Couldn't promote that version", e.message);
          }
        };
      list.append(row);
    }
    md.querySelector('[data-a="del"]').onclick = async () => {
      try {
        await api(`recipes/${r.id}`, { method: "DELETE" });
        closeModal();
        await loadRecipes();
        toast(`Deleted ${r.name}`);
      } catch (e) {
        toast("Couldn't delete the recipe", e.message);
      }
    };
  }
  md.querySelector('[data-a="x"]').onclick = closeModal;
  md.querySelector('[data-a="x2"]').onclick = closeModal;
  let busy = false;
  const save = async () => {
    if (busy) return;
    busy = true;
    const name = md.querySelector("#rcName").value.trim();
    const description = md.querySelector("#rcDesc").value.trim();
    const prompt = md.querySelector("#rcText").value.trim();
    const trigger = auto.getAttribute("aria-checked") === "true" ? "on-notes" : "manual";
    try {
      if (!r) {
        await api("recipes", { method: "POST", body: { name, description, prompt, trigger } });
        toast(`Created ${name || "the recipe"}`);
      } else {
        await api(`recipes/${r.id}`, { method: "PATCH", body: { name, description, trigger } });
        if (prompt !== latest.prompt) {
          await api(`recipes/${r.id}/versions`, { method: "POST", body: { prompt, note: md.querySelector("#rcNote").value.trim() } });
          toast(`Saved v${latest.n + 1} of ${name} as testing`, "Try it on a branch, then promote it when it does better");
        }
      }
      closeModal();
      await loadRecipes();
    } catch (e) {
      busy = false;
      toast("Couldn't save the recipe", e.message);
    }
  };
  md.querySelector('[data-a="ok"]').onclick = save;
  md.querySelector("#rcF").onsubmit = (e) => (e.preventDefault(), save());
}
