import { test } from "node:test";
import assert from "node:assert/strict";
import { branchStatus, branchCounts, greeting, waitingLine, studyRows, branchesLine, versionRequests } from "../ui/boardfacts.js";

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

// Side by side: each branch's screens hang in a row of their own under the page's, in the places
// they have on the branch, so a screen and every version of it line up in a column.
test("board: branches hang in rows under the page, a screen above its versions", () => {
  const own = [{ x: 0, y: 0, w: 1000, h: 600 }, { x: 1200, y: 0, w: 1000, h: 800 }];
  const a = { id: "a", boards: [{ id: "b1", x: 0, y: 0, w: 1000, h: 600, screen: "home", state: "Default" }, { id: "b2", x: 1200, y: 0, w: 1000, h: 800, screen: "chat" }] };
  const b = { id: "b", boards: [{ id: "b3", x: 0, y: 50, w: 1000, h: 600, screen: "home" }] };
  const rows = studyRows(own, [a, b], 300);
  assert.deepEqual(rows.map((r) => [r.id, r.env, r.row, r.x, r.y]), [
    ["std-a-b1", "a", 0, 0, 1100],
    ["std-a-b2", "a", 0, 1200, 1100],
    ["std-b-b3", "b", 1, 0, 2200],
  ]);
  assert.equal(rows[0].of, "b1");
  assert.equal(rows[1].screen, "chat");
  // nothing overlaps the page's own screens or another row
  const bottom = (r) => r.y + r.h;
  assert.ok(rows.every((r) => r.y >= 800 + 300));
  assert.ok(rows[2].y >= Math.max(bottom(rows[0]), bottom(rows[1])) + 300);
});

test("board: side by side leaves out what can't be placed", () => {
  assert.deepEqual(studyRows(), []);
  assert.deepEqual(studyRows([], [{ id: "a", boards: [] }, null, { boards: [{ id: "x", x: 0, y: 0, w: 10, h: 10 }] }]), []);
  const rows = studyRows([], [{ id: "a", boards: [{ id: "x", x: 5, y: 40, w: 10, h: 10 }, { id: "bad", x: NaN, y: 0, w: 10, h: 10 }, { id: "flat", x: 0, y: 0, w: 0, h: 10 }] }]);
  assert.deepEqual(rows.map((r) => [r.id, r.x, r.y]), [["std-a-x", 5, 0]]);
});

test("board: a page's banner says how its branches stand", () => {
  assert.equal(branchesLine({}), "");
  assert.equal(branchesLine({ open: 1 }), "1 branch off it");
  assert.equal(branchesLine({ open: 3, ready: 2, working: 1 }), "3 branches off it · 2 ready to review · 1 agent working");
});

test("board: asking for several versions makes one request each, told apart", () => {
  assert.deepEqual(versionRequests("Denser rows", 1), [{ prompt: "Denser rows", name: "" }]);
  assert.deepEqual(versionRequests("  ", 3), []);
  const three = versionRequests("Denser rows", 3);
  assert.deepEqual(three.map((r) => r.name), ["Denser rows · 1", "Denser rows · 2", "Denser rows · 3"]);
  assert.ok(three.every((r, i) => r.prompt.startsWith("Denser rows\n\n") && r.prompt.includes(`Version ${i + 1} of 3`)));
  assert.equal(versionRequests("x", 99).length, 3, "never more than three");
  assert.equal(versionRequests("x", "junk").length, 1);
  // a long request names its branches by its first words, cut at a word
  const long = versionRequests("Make the project cards much easier to scan at a glance\nand keep the tags", 2);
  assert.deepEqual(long.map((r) => r.name), ["Make the project cards much · 1", "Make the project cards much · 2"]);
  assert.equal(versionRequests("a".repeat(80), 2)[0].name, `${"a".repeat(28)} · 1`);
});
