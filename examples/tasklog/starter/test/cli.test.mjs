import { test } from "node:test";
import assert from "node:assert/strict";
import { listJson, read, run, tempFile } from "./helpers.mjs";

test("add and list", () => {
  const f = tempFile();
  assert.equal(run(f, ["add", "Buy", "milk", "--due", "fri", "--tags", "Home,errand,home"]).out, "added: 1 Buy milk\n");
  run(f, ["add", "No date"]);
  run(f, ["add", "Earlier", "--due", "+1d"]);
  assert.deepEqual(listJson(f), [
    { id: 3, status: "open", created: "2027-03-10", due: "2027-03-11", tags: [], title: "Earlier" },
    { id: 1, status: "open", created: "2027-03-10", due: "2027-03-12", tags: ["errand", "home"], title: "Buy milk" },
    { id: 2, status: "open", created: "2027-03-10", due: null, tags: [], title: "No date" },
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

test("titles with tabs, newlines and backslashes survive the file", () => {
  const f = tempFile();
  run(f, ["add", "a\tb\nc\\d"]);
  assert.equal(listJson(f)[0].title, "a\tb\nc\\d");
  assert.equal(read(f).split("\n").length, 3); // header, task, final newline
});
