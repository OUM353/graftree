import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { listJson, read, run, tempFile } from "./helpers.mjs";

test("add and list", () => {
  const f = tempFile();
  assert.equal(run(f, ["add", "Buy", "milk", "--due", "fri", "--tags", "Home,errand,home"]).out, "added: 1 Buy milk\n");
  run(f, ["add", "No date"]);
  run(f, ["add", "Earlier", "--due", "+1d"]);
  const day = "2027-03-10";
  assert.deepEqual(listJson(f), [
    { id: 3, status: "open", created: day, updated: day, due: "2027-03-11", tags: [], title: "Earlier" },
    { id: 1, status: "open", created: day, updated: day, due: "2027-03-12", tags: ["errand", "home"], title: "Buy milk" },
    { id: 2, status: "open", created: day, updated: day, due: null, tags: [], title: "No date" },
  ]);
});

test("list filters and overdue marker", () => {
  const f = tempFile();
  run(f, ["add", "a", "--due", "2027-03-01", "--tags", "work"]);
  run(f, ["add", "b", "--due", "2027-03-20", "--tags", "work,x"]);
  run(f, ["add", "c"]);
  run(f, ["done", "3"]);
  assert.deepEqual(listJson(f, ["--tag", "work", "--tag", "x"]).map((t) => t.id), [2]);
  assert.deepEqual(listJson(f, ["--due-before", "2027-03-20"]).map((t) => t.id), [1]);
  const table = run(f, ["list"]).out;
  assert.match(table, /2027-03-01!/);
  assert.doesNotMatch(table, /\bc\b/);
});

test("done sets updated; ids can be ranges, lists and last", () => {
  const f = tempFile();
  for (const t of ["a", "b", "c", "d", "e"]) run(f, ["add", t], "2027-03-01");
  assert.equal(run(f, ["done", "2-3,last"]).out, "done: 2 b\ndone: 3 c\ndone: 5 e\n");
  const byId = Object.fromEntries(listJson(f).map((t) => [t.id, t]));
  assert.equal(byId[2].status, "done");
  assert.equal(byId[2].updated, "2027-03-10");
  assert.equal(byId[2].created, "2027-03-01");
  assert.equal(byId[1].updated, "2027-03-01");
  assert.equal(run(f, ["done", "4-2"]).code, 2);
});

test("done, errors and exit codes", () => {
  const f = tempFile();
  run(f, ["add", "x"]);
  assert.equal(run(f, ["done", "1"]).out, "done: 1 x\n");
  const again = run(f, ["done", "1"]);
  assert.equal(again.code, 0);
  assert.equal(again.err, "tasklog: task 1 is already done\n");
  const missing = run(f, ["done", "9"]);
  assert.equal(missing.code, 1);
  assert.equal(missing.err, "tasklog: no task with id 9\n");
  assert.equal(run(f, ["done", "abc"]).code, 2);
  assert.equal(run(f, ["add", "y", "--due", "someday"]).code, 2);
  assert.equal(run(f, ["add", "y", "--tags", "a b"]).code, 2);
  assert.equal(run(f, ["list", "--wat"]).code, 2);
});

test("a failed command changes nothing", () => {
  const f = tempFile();
  run(f, ["add", "x"]);
  const before = read(f);
  assert.equal(run(f, ["done", "1", "7"]).code, 1);
  assert.equal(read(f), before);
});

test("undo reverts the last command, one step at a time", () => {
  const f = tempFile();
  run(f, ["add", "a"]);
  run(f, ["add", "b"]);
  const afterAdds = read(f);
  run(f, ["done", "1-2"]);
  assert.equal(run(f, ["undo"]).out, "undone: done 1-2\n");
  assert.equal(read(f), afterAdds);
  assert.equal(run(f, ["undo"]).out, "undone: add b\n");
  assert.deepEqual(listJson(f).map((t) => t.title), ["a"]);
  run(f, ["undo"]);
  const none = run(f, ["undo"]);
  assert.equal(none.code, 1);
  assert.equal(none.err, "tasklog: nothing to undo\n");
});

test("commands that change the file hold a lock; list does not", () => {
  const f = tempFile();
  run(f, ["add", "a"]);
  const before = read(f);
  writeFileSync(`${f}.lock`, "");
  const r = run(f, ["add", "b"]);
  assert.equal(r.code, 3);
  assert.match(r.err, /^tasklog: .* is locked/);
  assert.equal(run(f, ["done", "1"]).code, 3);
  assert.equal(run(f, ["undo"]).code, 3);
  assert.equal(read(f), before);
  assert.equal(run(f, ["list"]).code, 0);
});

test("the lock is released after success and after failure", () => {
  const f = tempFile();
  run(f, ["add", "a"]);
  run(f, ["done", "9"]);
  assert.equal(existsSync(`${f}.lock`), false);
});

test(".tasklogrc sets list's default status and default tags", () => {
  const f = tempFile();
  writeFileSync(join(dirname(f), ".tasklogrc"), JSON.stringify({ defaultStatus: "all", defaultTags: "inbox" }));
  run(f, ["add", "a", "--tags", "work"]);
  run(f, ["add", "b"]);
  run(f, ["done", "1"]);
  const shown = JSON.parse(run(f, ["list", "--json"]).out);
  assert.deepEqual(shown.map((t) => [t.id, t.tags]), [[1, ["inbox", "work"]], [2, ["inbox"]]]);
  assert.deepEqual(JSON.parse(run(f, ["list", "--json", "--status", "open"]).out).map((t) => t.id), [2]);
});

test("titles with tabs, newlines and backslashes survive the file", () => {
  const f = tempFile();
  run(f, ["add", "a\tb\nc\\d"]);
  assert.equal(listJson(f)[0].title, "a\tb\nc\\d");
  assert.equal(read(f).split("\n").length, 3); // header, task, final newline
});

test("v1 files from tasklog 1.x are read (updated = created) and rewritten as v2", () => {
  const f = tempFile("# tasklog v1\n1\topen\t2026-11-02\t2026-12-01\twork\tOld report\n");
  assert.deepEqual(listJson(f), [{ id: 1, status: "open", created: "2026-11-02", updated: "2026-11-02", due: "2026-12-01", tags: ["work"], title: "Old report" }]);
  run(f, ["add", "new"]);
  assert.match(read(f), /^# tasklog v2\n1\topen\t2026-11-02\t2026-11-02\t2026-12-01\twork\tOld report\n/);
});
