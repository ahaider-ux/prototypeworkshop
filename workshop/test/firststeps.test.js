import { test } from "node:test";
import assert from "node:assert/strict";
import { STEPS, firstSteps, stepDone, welcomeLine } from "../ui/firststeps.js";

// A new person's first steps are the studio loop, once: open, branch, connect, ask, merge. Each has
// something to do (a button label), and the next one is the first not done yet.
test("first steps: the loop in order, the next one is the first not done", () => {
  assert.deepEqual(STEPS.map((s) => s.id), ["open", "branch", "connect", "ask", "merge"]);
  assert.ok(STEPS.every((s) => s.title && s.text && s.cta), "every step says what it is and has something to press");
  const none = firstSteps([]);
  assert.equal(none.count, 0);
  assert.equal(none.total, 5);
  assert.equal(none.next.id, "open");
  assert.deepEqual(none.steps.map((s) => s.next), [true, false, false, false, false]);
  assert.equal(none.finished, false);
  // done out of order: connecting first doesn't skip opening
  const some = firstSteps(["connect", "open"]);
  assert.equal(some.count, 2);
  assert.equal(some.next.id, "branch");
  assert.deepEqual(some.steps.map((s) => s.done), [true, false, true, false, false]);
  const all = firstSteps(["merge", "ask", "connect", "branch", "open"]);
  assert.equal(all.finished, true);
  assert.equal(all.next, null);
});

test("first steps: junk in the saved list is ignored", () => {
  for (const junk of [null, undefined, "open", 5, {}, ["nope", 3, null]]) assert.equal(firstSteps(junk).count, 0);
  assert.equal(firstSteps(["open", "open", "nope"]).count, 1);
});

// Doing a step says so once, with what comes next; doing it again says nothing.
test("first steps: a step done is told once, with the next one", () => {
  const a = stepDone([], "open");
  assert.deepEqual(a.done, ["open"]);
  assert.equal(a.note.title, "Open a prototype: done · 1 of 5");
  assert.equal(a.note.text, "Next: Try an idea on a branch");
  assert.equal(a.note.next.id, "branch");
  assert.equal(stepDone(a.done, "open"), null, "not twice");
  assert.equal(stepDone(a.done, "nope"), null);
  // out of order: the next is still the first not done
  const b = stepDone(["open"], "ask");
  assert.deepEqual(b.done, ["open", "ask"]);
  assert.equal(b.note.text, "Next: Try an idea on a branch");
  const last = stepDone(["open", "branch", "connect", "ask"], "merge");
  assert.equal(last.note.title, "First steps done");
  assert.equal(last.note.next, null);
});

test("first steps: the welcome line counts what's done", () => {
  assert.match(welcomeLine(0), /^A studio for your prototype\./);
  assert.equal(welcomeLine(2), "2 of 5 first steps done.");
});
