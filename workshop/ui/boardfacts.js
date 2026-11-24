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
