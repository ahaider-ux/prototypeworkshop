import { test } from "node:test";
import assert from "node:assert/strict";
import { branchStatus, branchCounts } from "../ui/boardfacts.js";

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
