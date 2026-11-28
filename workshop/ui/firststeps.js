// A new person's first steps: the whole studio loop, once, in the order it happens. Pure (no DOM),
// so it's tested in Node. What's done is what this person has done in this browser, not what the
// space already holds: a team's space has branches and merges before a newcomer has made one.
//
// Each step is something real to do on the person's own work; `cta` is what its button says.
export const STEPS = [
  { id: "open", title: "Open a prototype", text: "Its screens become frames on a canvas, each the real page.", cta: "Open it" },
  { id: "branch", title: "Try an idea on a branch", text: "Change anything there. Main stays as it is until you merge.", cta: "Create a branch" },
  { id: "connect", title: "Connect your AI tool", text: "Claude Code or another agent works on the same files, on branches.", cta: "Connect" },
  { id: "ask", title: "Ask an agent for a change", text: "Point at a frame or a layer and say what you want.", cta: "Ask" },
  { id: "merge", title: "Review and merge", text: "See each change against Main and keep what works.", cta: "Review" },
];
const IDS = STEPS.map((s) => s.id);
const clean = (done) => IDS.filter((id) => (Array.isArray(done) ? done : []).includes(id));

// done: the ids done so far, in any order (junk is ignored).
// → { steps: [{ ...step, done, next }], count, total, next: the first step not done (or null), finished }
export function firstSteps(done) {
  const d = clean(done);
  const next = STEPS.find((s) => !d.includes(s.id)) || null;
  return { steps: STEPS.map((s) => ({ ...s, done: d.includes(s.id), next: s === next })), count: d.length, total: STEPS.length, next, finished: !next };
}

// A step was just done. → { done: the new list, note: { title, text, next } } to tell the person,
// or null when it was done before or isn't a step (nothing to say twice).
export function stepDone(done, id) {
  const d = clean(done);
  if (!IDS.includes(id) || d.includes(id)) return null;
  const now = clean([...d, id]);
  const st = firstSteps(now);
  const step = STEPS.find((s) => s.id === id);
  return {
    done: now,
    note: st.finished
      ? { title: "First steps done", text: "That's the whole loop: open, branch, ask, review, merge.", next: null }
      : { title: `${step.title}: done · ${st.count} of ${st.total}`, text: `Next: ${st.next.title}`, next: st.next },
  };
}

// The line under the welcome, before anything is done and after
export const welcomeLine = (count, total = STEPS.length) => (count ? `${count} of ${total} first steps done.` : "A studio for your prototype. Five first steps take you through the whole loop.");
