// What a branch's card on the home board says about where it stands, in the order that matters to
// someone deciding what to look at next. Pure (no DOM), so it's tested in Node.
//
// facts: { changes, conflicts, working, queued } — counts for one branch.
// → { label, tone } where tone is "warn" (needs a decision), "busy" (someone's on it), "ok" (ready
//   for you) or "" (nothing to do yet).
export function branchStatus({ changes = 0, conflicts = 0, working = 0, queued = 0 } = {}) {
  if (conflicts > 0) return { label: `${conflicts} ${conflicts === 1 ? "conflict" : "conflicts"} with Main`, tone: "warn" };
  if (working > 0) return { label: "Agent working", tone: "busy" };
  if (queued > 0) return { label: "Waiting for an agent", tone: "busy" };
  if (changes > 0) return { label: "Ready to review", tone: "ok" };
  return { label: "No changes yet", tone: "" };
}

// "2 changes · 1 comment", leaving out what there's none of
export function branchCounts({ changes = 0, comments = 0 } = {}) {
  const n = (k, one, many) => (k ? `${k} ${k === 1 ? one : many}` : "");
  return [n(changes, "change", "changes"), n(comments, "comment", "comments")].filter(Boolean).join(" · ");
}

// The home's greeting, by the hour of the day (0–23)
export const greeting = (hour) => (hour >= 5 && hour < 12 ? "Good morning" : hour >= 12 && hour < 18 ? "Good afternoon" : "Good evening");

// What's waiting on you, in one plain line under the greeting
export function waitingLine({ ready = 0, working = 0, projects = 0 } = {}) {
  const n = (k, one, many) => `${k} ${k === 1 ? one : many}`;
  if (!projects) return "Add a prototype to get started.";
  if (ready && working) return `${n(ready, "branch is", "branches are")} ready to review, and ${n(working, "agent is", "agents are")} working.`;
  if (ready) return `${n(ready, "branch is", "branches are")} ready to review.`;
  if (working) return `${n(working, "agent is", "agents are")} working.`;
  return "Nothing is waiting on you. Go into a project to try an idea on a branch.";
}

// Where a page's branches hang when they're shown side by side with it: each branch's screens in a
// row of their own under the page's, in the places they have on the branch, so a screen and every
// version of it line up in a column.
// own: the page's boards [{ x, y, w, h }]. branches: [{ id, boards: [{ id, x, y, w, h, screen, state }] }],
// in the order to hang them. gap: the space between rows, which holds a row's title.
// → [{ id, of, env, row, screen, state, x, y, w, h }], one per branch screen; a branch with no
//   screens, or a screen without a real size, gets nothing.
export function studyRows(own = [], branches = [], gap = 320) {
  const ok = (b) => b && [b.x, b.y, b.w, b.h].every(Number.isFinite) && b.w > 0 && b.h > 0;
  const mine = own.filter(ok);
  let y = mine.length ? Math.max(...mine.map((b) => b.y + b.h)) + gap : 0;
  const out = [];
  let row = 0;
  for (const br of branches) {
    const bs = (br?.boards || []).filter(ok);
    if (!br?.id || !bs.length) continue;
    const top = Math.min(...bs.map((b) => b.y));
    const bottom = Math.max(...bs.map((b) => b.y + b.h));
    for (const b of bs) out.push({ id: `std-${br.id}-${b.id}`, of: b.id, env: br.id, row, screen: b.screen, state: b.state, x: b.x, y: b.y - top + y, w: b.w, h: b.h });
    y += bottom - top + gap;
    row++;
  }
  return out;
}

// The line on a page's banner about the branches off it
export function branchesLine({ open = 0, ready = 0, working = 0 } = {}) {
  const n = (k, one, many) => `${k} ${k === 1 ? one : many}`;
  if (!open) return "";
  return [n(open, "branch", "branches") + " off it", ready ? `${ready} ready to review` : "", working ? `${n(working, "agent", "agents")} working` : ""].filter(Boolean).join(" · ");
}

// A request for several versions at once: one request per version, each for its own branch. The
// branch is named after the request with the version's number; the note tells each agent it is one
// of several, so the versions come out different. → [{ prompt, name }], or [] with nothing to ask;
// one version is just the request, with no name (the server names its branch).
export function versionRequests(prompt, n) {
  const text = String(prompt || "").trim();
  const k = Math.max(1, Math.min(3, Math.floor(Number(n)) || 1));
  if (!text) return [];
  if (k === 1) return [{ prompt: text, name: "" }];
  const line = text.split("\n")[0].trim();
  const short = line.length <= 28 ? line : line.slice(0, 28).replace(/\s+\S*$/, "") || line.slice(0, 28); // short enough that the number shows in the Branches list
  return Array.from({ length: k }, (_, i) => ({
    name: `${short} · ${i + 1}`,
    prompt: `${text}\n\nVersion ${i + 1} of ${k}. The other versions are being made on their own branches. Read the activity feed for what they did, take a clearly different direction, and post one line saying what yours does.`,
  }));
}
