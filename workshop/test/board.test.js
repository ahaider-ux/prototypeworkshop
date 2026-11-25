import { test } from "node:test";
import assert from "node:assert/strict";
import { branchStatus, branchCounts, greeting, waitingLine } from "../ui/boardfacts.js";

// What a branch's card says, in the order that matters to someone deciding what to look at next.
test("board: a branch's status puts what needs you first", () => {
  assert.deepEqual(branchStatus({}), { label: "No changes yet", tone: "" });
  assert.deepEqual(branchStatus({ changes: 3 }), { label: "Ready to review", tone: "ok" });
  assert.deepEqual(branchStatus({ changes: 3, queued: 1 }), { label: "Waiting for an agent", tone: "busy" });
  assert.deepEqual(branchStatus({ changes: 3, queued: 1, working: 1 }), { label: "Agent working", tone: "busy" });
  assert.deepEqual(branchStatus({ changes: 3, working: 1, conflicts: 1 }), { label: "1 conflict with Main", tone: "warn" });
  assert.equal(branchStatus({ conflicts: 2 }).label, "2 conflicts with Main");
});

test("board: counts leave out what there's none of", () => {
  assert.equal(branchCounts({ changes: 2, comments: 1 }), "2 changes · 1 comment");
  assert.equal(branchCounts({ changes: 1 }), "1 change");
  assert.equal(branchCounts({ comments: 4 }), "4 comments");
  assert.equal(branchCounts({}), "");
});

test("board: the greeting follows the time of day, and says what's waiting", () => {
  assert.equal(greeting(8), "Good morning");
  assert.equal(greeting(12), "Good afternoon");
  assert.equal(greeting(17), "Good afternoon");
  assert.equal(greeting(18), "Good evening");
  assert.equal(greeting(2), "Good evening");
  assert.equal(waitingLine({ projects: 0 }), "Add a prototype to get started.");
  assert.equal(waitingLine({ projects: 2, ready: 1 }), "1 branch is ready to review.");
  assert.equal(waitingLine({ projects: 2, ready: 3, working: 1 }), "3 branches are ready to review, and 1 agent is working.");
  assert.equal(waitingLine({ projects: 2, working: 2 }), "2 agents are working.");
  assert.match(waitingLine({ projects: 1 }), /^Nothing is waiting on you\./);
});
