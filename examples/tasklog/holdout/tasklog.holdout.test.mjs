// Holdout suite for examples/tasklog. Never show it to the planner or solvers.
// The ticket (PROBLEM.md) is deliberately short; most rules come from how
// tasklog already behaves. Each test names where its rule comes from:
//   ticket  = PROBLEM.md
//   README  = the starter's README.md
//   code    = the starter's existing code and tests
// Several rules cut across every command (undo journal, file lock, `updated`,
// `last`, .tasklogrc); new commands must join them to be consistent.
// Where the ticket leaves a real choice open (exact output wording, the CSV
// line ending, how an empty date or a tag list is written in CSV), the tests
// accept any reasonable answer.
import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const CLI = fileURLToPath(new URL("../src/cli.mjs", import.meta.url));
const NOW = "2027-03-10"; // a Wednesday

function tempFile(content) {
  const path = join(mkdtempSync(join(tmpdir(), "tasklog-hold-")), "tasks.txt");
  if (content !== undefined) writeFileSync(path, content);
  return path;
}
function run(file, args, now = NOW) {
  const env = { ...process.env, TASKLOG_FILE: file, TASKLOG_NOW: now };
  const r = spawnSync(process.execPath, [CLI, ...args], { env, encoding: "utf8" });
  return { code: r.status, out: r.stdout, err: r.stderr };
}
const ok = (r) => assert.equal(r.code, 0, `exit ${r.code}: ${r.err}`);
/** All tasks as list --json shows them, reduced to the documented fields. */
function tasks(file, now = NOW) {
  const r = run(file, ["list", "--json", "--status", "all"], now);
  ok(r);
  return JSON.parse(r.out).map(({ id, status, created, due, tags, title }) => ({ id, status, created, due, tags, title }));
}
const task = (file, id) => tasks(file).find((t) => t.id === id);
const read = (file) => readFileSync(file, "utf8");

/** A file with tasks 1..3 created on 2027-03-01. */
function seeded() {
  const f = tempFile();
  ok(run(f, ["add", "Write report", "--due", "2027-03-12", "--tags", "work"], "2027-03-01"));
  ok(run(f, ["add", "Buy milk", "--tags", "home,errand"], "2027-03-01"));
  ok(run(f, ["add", "Call Sam", "--due", "2027-03-05"], "2027-03-01"));
  return f;
}

/** RFC 4180 parser (accepts \n or \r\n). */
function parseCsv(text) {
  const rows = [];
  let row = [], field = "", i = 0, quoted = false;
  while (i < text.length) {
    const c = text[i];
    if (quoted) {
      if (c === '"' && text[i + 1] === '"') { field += '"'; i += 2; continue; }
      if (c === '"') { quoted = false; i++; continue; }
      field += c; i++; continue;
    }
    if (c === '"' && field === "") { quoted = true; i++; continue; }
    if (c === ",") { row.push(field); field = ""; i++; continue; }
    if (c === "\r" && text[i + 1] === "\n") { i++; continue; }
    if (c === "\n") { row.push(field); rows.push(row); row = []; field = ""; i++; continue; }
    field += c; i++;
  }
  if (field !== "" || row.length) { row.push(field); rows.push(row); }
  return rows;
}
function csvRecords(out) {
  const [header, ...rows] = parseCsv(out);
  const h = header.map((x) => x.trim().toLowerCase());
  return rows.map((r) => Object.fromEntries(h.map((k, i) => [k, r[i]])));
}

// --- edit -------------------------------------------------------------------------

test("edit: --title, --due and --tags each work on their own (ticket)", () => {
  const f = seeded();
  ok(run(f, ["edit", "1", "--title", "Send the report"]));
  assert.deepEqual(task(f, 1), { id: 1, status: "open", created: "2027-03-01", due: "2027-03-12", tags: ["work"], title: "Send the report" });
  ok(run(f, ["edit", "2", "--due", "2027-04-01"]));
  assert.equal(task(f, 2).due, "2027-04-01");
  ok(run(f, ["edit", "3", "--tags", "phone"]));
  assert.deepEqual(task(f, 3).tags, ["phone"]);
  assert.equal(task(f, 3).title, "Call Sam");
});

test("edit: all fields at once, other tasks untouched (ticket)", () => {
  const f = seeded();
  const before = tasks(f);
  ok(run(f, ["edit", "2", "--title", "Buy oat milk", "--due", "2027-03-15", "--tags", "home"]));
  const after = tasks(f);
  assert.deepEqual(after.find((t) => t.id === 2), { ...before.find((t) => t.id === 2), title: "Buy oat milk", due: "2027-03-15", tags: ["home"] });
  assert.deepEqual(after.filter((t) => t.id !== 2), before.filter((t) => t.id !== 2));
});

test("edit --due takes every date form, relative to today (README: Dates)", () => {
  const f = seeded();
  ok(run(f, ["edit", "1", "--due", "fri"]));
  assert.equal(task(f, 1).due, "2027-03-12");
  ok(run(f, ["edit", "1", "--due", "wed"]));
  assert.equal(task(f, 1).due, "2027-03-17", "a weekday is never today");
  ok(run(f, ["edit", "1", "--due", "+1m"], "2027-01-31"));
  assert.equal(task(f, 1).due, "2027-02-28", "months are clamped");
  ok(run(f, ["edit", "1", "--due", "TOMORROW"]));
  assert.equal(task(f, 1).due, "2027-03-11");
});

test("edit --due none removes the due date (ticket + README: `none` means no date)", () => {
  const f = seeded();
  ok(run(f, ["edit", "1", "--due", "none"]));
  assert.equal(task(f, 1).due, null);
});

test("edit --tags none and --tags '' remove the tags (ticket + README: Tags)", () => {
  const f = seeded();
  ok(run(f, ["edit", "1", "--tags", "none"]));
  assert.deepEqual(task(f, 1).tags, []);
  ok(run(f, ["edit", "2", "--tags="]));
  assert.deepEqual(task(f, 2).tags, []);
});

test("edit --tags normalizes like add: lower-case, de-duplicated, sorted (README: Tags)", () => {
  const f = seeded();
  ok(run(f, ["edit", "1", "--tags", " Urgent,work,URGENT , Q2"]));
  assert.deepEqual(task(f, 1).tags, ["q2", "urgent", "work"]);
});

test("edit: an unknown id exits 1 with the same message as done (README: Errors; code)", () => {
  const f = seeded();
  const r = run(f, ["edit", "9", "--title", "x"]);
  assert.equal(r.code, 1);
  assert.equal(r.err, "tasklog: no task with id 9\n");
});

test("edit: bad input exits 2 with a tasklog: message (README: Errors)", () => {
  const f = seeded();
  ok(run(f, ["edit", "1", "--title", "valid edit first"]));
  for (const args of [
    ["edit", "abc", "--title", "x"],
    ["edit", "1", "--due", "someday"],
    ["edit", "1", "--tags", "a b"],
    ["edit", "1", "--wat", "x"],
    ["edit", "1", "--title", ""],
  ]) {
    const r = run(f, args);
    assert.equal(r.code, 2, args.join(" "));
    assert.match(r.err, /^tasklog: /, args.join(" "));
  }
});

test("edit: a failed edit changes nothing (README: Errors; code)", () => {
  const f = seeded();
  ok(run(f, ["edit", "2", "--title", "Buy milk"]));
  const before = read(f);
  assert.notEqual(run(f, ["edit", "1", "--title", "New", "--due", "someday"]).code, 0);
  assert.notEqual(run(f, ["edit", "1", "--title", "New", "--tags", "b@d"]).code, 0);
  assert.equal(read(f), before);
});

test("edit: titles with tabs, newlines and backslashes are kept exactly (code: store escaping)", () => {
  const f = seeded();
  ok(run(f, ["edit", "3", "--title", "line1\nline2\tx\\y"]));
  assert.equal(task(f, 3).title, "line1\nline2\tx\\y");
  assert.equal(tasks(f).length, 3);
});

test("edit works with --file like every command (README)", () => {
  const f = seeded();
  const other = tempFile();
  ok(run(other, ["add", "Other"]));
  ok(run(other, ["edit", "1", "--file", f, "--title", "Via --file"]));
  assert.equal(task(f, 1).title, "Via --file");
  assert.equal(tasks(other)[0].title, "Other");
});

test("edit: a done task keeps its status (ticket: edit changes title, due, tags)", () => {
  const f = seeded();
  ok(run(f, ["done", "2"]));
  ok(run(f, ["edit", "2", "--title", "Bought milk"]));
  assert.equal(task(f, 2).status, "done");
});

// --- export -----------------------------------------------------------------------

test("export --format json matches list --json, including its default filter and order (ticket + README)", () => {
  const f = seeded();
  ok(run(f, ["done", "3"]));
  const listed = run(f, ["list", "--json"]);
  const exported = run(f, ["export", "--format", "json"]);
  ok(exported);
  assert.deepEqual(JSON.parse(exported.out), JSON.parse(listed.out));
  assert.deepEqual(JSON.parse(exported.out).map((t) => t.id), [1, 2]);
});

test("export takes list's filters: --status, repeated --tag, --due-before (ticket)", () => {
  const f = seeded();
  ok(run(f, ["add", "Plan Q2", "--due", "2027-03-20", "--tags", "work,plan"]));
  ok(run(f, ["done", "1"]));
  const ids = (...args) => JSON.parse(run(f, ["export", "--format", "json", ...args]).out).map((t) => t.id);
  assert.deepEqual(ids("--status", "done", "--tag", "work"), [1]);
  assert.deepEqual(ids("--status", "all", "--tag", "work"), [1, 4]);
  assert.deepEqual(ids("--tag", "work", "--tag", "plan"), [4]);
  assert.deepEqual(ids("--status", "all", "--due-before", "2027-03-12"), [3]);
  assert.deepEqual(ids("--status", "all"), [3, 1, 4, 2], "sorted like list: due date, no date last");
});

test("export: bad filters are usage errors like in list (README: Errors)", () => {
  const f = seeded();
  ok(run(f, ["export", "--format", "json", "--status", "done"]));
  assert.equal(run(f, ["export", "--format", "json", "--status", "pending"]).code, 2);
  assert.equal(run(f, ["export", "--format", "json", "--due-before", "someday"]).code, 2);
});

test("export --format must be csv or json; without it, a usage error or a sensible default (ticket; README: Errors)", () => {
  const f = seeded();
  ok(run(f, ["export", "--format", "csv"]));
  const bad = run(f, ["export", "--format", "xml"]);
  assert.equal(bad.code, 2);
  assert.match(bad.err, /^tasklog: /);
  const none = run(f, ["export"]);
  if (none.code === 0) assert.ok(none.out.trim().length > 0, "a default format should still print the tasks");
  else {
    assert.equal(none.code, 2);
    assert.match(none.err, /^tasklog: /);
  }
});

test("export --format csv: a header row and one record per task, fields matching the JSON (ticket)", () => {
  const f = seeded();
  const r = run(f, ["export", "--format", "csv", "--status", "all"]);
  ok(r);
  const recs = csvRecords(r.out);
  assert.equal(recs.length, 3);
  const byId = Object.fromEntries(recs.map((x) => [x.id, x]));
  assert.deepEqual(Object.keys(byId).sort(), ["1", "2", "3"]);
  assert.equal(byId["1"].title, "Write report");
  assert.equal(byId["1"].due, "2027-03-12");
  assert.equal(byId["1"].status, "open");
  assert.equal(byId["1"].created, "2027-03-01");
  assert.deepEqual(byId["2"].tags.split(/[,; ]+/), ["errand", "home"]);
  assert.ok(["", "-", "null"].includes(byId["2"].due), `empty due written as ${JSON.stringify(byId["2"].due)}`);
});

test("export --format csv quotes commas, quotes and newlines (ticket: for a spreadsheet)", () => {
  const f = tempFile();
  const title = 'Say "hi", then\nleave';
  ok(run(f, ["add", title]));
  ok(run(f, ["add", "plain"]));
  const recs = csvRecords(run(f, ["export", "--format", "csv"]).out);
  assert.equal(recs.length, 2);
  assert.equal(recs.find((x) => x.id === "1").title, title);
});

test("export shows the stored date, not list's overdue marker (README: `!` is list display)", () => {
  const f = seeded();
  const json = JSON.parse(run(f, ["export", "--format", "json"]).out);
  assert.equal(json.find((t) => t.id === 3).due, "2027-03-05");
  const csv = csvRecords(run(f, ["export", "--format", "csv"]).out);
  assert.equal(csv.find((x) => x.id === "3").due, "2027-03-05");
});

test("export with no matching tasks still exits 0 (list prints 'No tasks.', exit 0)", () => {
  const f = seeded();
  const r = run(f, ["export", "--format", "json", "--tag", "nothing"]);
  ok(r);
  assert.deepEqual(JSON.parse(r.out), []);
  ok(run(f, ["export", "--format", "csv", "--tag", "nothing"]));
});

// --- recurring tasks ------------------------------------------------------------

test("recurring: done creates the next task one interval after the previous due date (ticket)", () => {
  const f = tempFile();
  ok(run(f, ["add", "Weekly review", "--due", "mon", "--every", "week", "--tags", "work"]));
  assert.equal(task(f, 1).due, "2027-03-15");
  ok(run(f, ["done", "1"], "2027-03-16"));
  const all = tasks(f);
  assert.equal(all.length, 2);
  assert.equal(task(f, 1).status, "done");
  assert.deepEqual(task(f, 2), { id: 2, status: "open", created: "2027-03-16", due: "2027-03-22", tags: ["work"], title: "Weekly review" });
});

test("recurring: the next task recurs too (ticket)", () => {
  const f = tempFile();
  ok(run(f, ["add", "Water plants", "--due", "2027-03-10", "--every", "day"]));
  ok(run(f, ["done", "1"]));
  ok(run(f, ["done", "2"]));
  assert.deepEqual(tasks(f).map((t) => [t.id, t.status, t.due]), [
    [1, "done", "2027-03-10"],
    [2, "done", "2027-03-11"],
    [3, "open", "2027-03-12"],
  ]);
});

test("recurring: a step like 2w (ticket)", () => {
  const f = tempFile();
  ok(run(f, ["add", "Payroll", "--due", "2027-03-12", "--every", "2w"]));
  ok(run(f, ["done", "1"]));
  assert.equal(task(f, 2).due, "2027-03-26");
});

test("recurring: months use tasklog's calendar months, clamped (ticket + README: Dates)", () => {
  const f = tempFile();
  ok(run(f, ["add", "Rent", "--due", "2027-01-31", "--every", "month"]));
  ok(run(f, ["done", "1"]));
  assert.equal(task(f, 2).due, "2027-02-28");
  ok(run(f, ["done", "2"]));
  assert.equal(task(f, 3).due, "2027-03-28", "one interval after the previous due date");
});

test("recurring: from the previous due date even when completed late (ticket)", () => {
  const f = tempFile();
  ok(run(f, ["add", "Backup", "--due", "2027-01-01", "--every", "week"], "2026-12-30"));
  ok(run(f, ["done", "1"], "2027-03-10"));
  assert.equal(task(f, 2).due, "2027-01-08");
  assert.equal(task(f, 2).created, "2027-03-10");
});

test("recurring: a recurring task needs a due date (ticket; README: Errors)", () => {
  const f = tempFile();
  ok(run(tempFile(), ["add", "valid", "--due", "fri", "--every", "week"]));
  for (const args of [["add", "x", "--every", "week"], ["add", "x", "--every", "week", "--due", "none"]]) {
    const r = run(f, args);
    assert.equal(r.code, 2, args.join(" "));
    assert.match(r.err, /^tasklog: /);
  }
  assert.deepEqual(tasks(f), []);
});

test("recurring: an invalid interval is a usage error and adds nothing (README: Errors)", () => {
  const f = tempFile();
  for (const every of ["day", "WEEK", "month", "3d", "2w"]) ok(run(tempFile(), ["add", "valid", "--due", "fri", "--every", every]));
  for (const every of ["fortnight", "0w", "-1d", "w2"]) {
    assert.equal(run(f, ["add", "x", "--due", "fri", "--every", every]).code, 2, every);
  }
  assert.deepEqual(tasks(f), []);
});

test("recurring: marking an already-done task again creates nothing (code: done warns, changes nothing)", () => {
  const f = tempFile();
  ok(run(f, ["add", "Review", "--due", "fri", "--every", "week"]));
  ok(run(f, ["done", "1"]));
  ok(run(f, ["done", "1"]));
  assert.equal(tasks(f).length, 2);
});

test("recurring: done on several tasks at once creates each next task (code: done takes several ids)", () => {
  const f = tempFile();
  ok(run(f, ["add", "A", "--due", "2027-03-10", "--every", "day"]));
  ok(run(f, ["add", "B", "--due", "2027-03-10", "--every", "week"]));
  ok(run(f, ["add", "C"]));
  ok(run(f, ["done", "1", "2", "3"]));
  const open = tasks(f).filter((t) => t.status === "open");
  assert.deepEqual(open.map((t) => [t.title, t.due]).sort(), [["A", "2027-03-11"], ["B", "2027-03-17"]]);
  assert.equal(new Set(tasks(f).map((t) => t.id)).size, 5, "ids stay unique");
});

test("recurring: a failed done (unknown id) creates nothing (README: a command that fails changes nothing)", () => {
  const f = tempFile();
  ok(run(f, ["add", "Review", "--due", "fri", "--every", "week"]));
  const before = read(f);
  assert.equal(run(f, ["done", "1", "9"]).code, 1);
  assert.equal(read(f), before);
});

test("recurring: editing a recurring task keeps it recurring (ticket: edit changes title, due, tags)", () => {
  const f = tempFile();
  ok(run(f, ["add", "Standup", "--due", "2027-03-10", "--every", "day"]));
  ok(run(f, ["edit", "1", "--title", "Daily standup", "--due", "2027-03-11"]));
  ok(run(f, ["done", "1"]));
  assert.deepEqual([task(f, 2).title, task(f, 2).due], ["Daily standup", "2027-03-12"]);
});

// --- existing files and behavior ---------------------------------------------------

const V1_FILE = [
  "# tasklog v1",
  "1\topen\t2026-11-02\t2026-12-01\twork\tOld report",
  "2\tdone\t2026-11-03\t-\t-\tOld\\tdone task",
  "",
  "3\topen\t2026-11-04\t2027-04-01\thome,urgent\tFix the sink",
  "",
].join("\n");

test("existing files keep working: read, edit, add, recurring (ticket)", () => {
  const f = tempFile(V1_FILE);
  assert.deepEqual(tasks(f), [
    { id: 1, status: "open", created: "2026-11-02", due: "2026-12-01", tags: ["work"], title: "Old report" },
    { id: 3, status: "open", created: "2026-11-04", due: "2027-04-01", tags: ["home", "urgent"], title: "Fix the sink" },
    { id: 2, status: "done", created: "2026-11-03", due: null, tags: [], title: "Old\tdone task" },
  ]);
  ok(run(f, ["edit", "3", "--due", "none"]));
  ok(run(f, ["add", "Weekly", "--due", "fri", "--every", "week"]));
  ok(run(f, ["done", "4"]));
  const all = tasks(f);
  assert.equal(all.length, 5);
  assert.equal(all.find((t) => t.id === 1).title, "Old report");
  assert.equal(all.find((t) => t.id === 2).title, "Old\tdone task");
  assert.equal(all.find((t) => t.id === 5).due, "2027-03-19");
});

test("existing behavior: add, list, done and their messages are unchanged (code + README)", () => {
  const f = tempFile();
  assert.equal(run(f, ["add", "Buy", "milk"]).out, "added: 1 Buy milk\n");
  assert.equal(run(f, ["done", "1"]).out, "done: 1 Buy milk\n");
  assert.equal(run(f, ["list"]).out, "No tasks.\n");
  assert.equal(run(f, ["done", "1"]).err, "tasklog: task 1 is already done\n");
});

// --- conventions every command must join (README: Picking tasks, Settings, Safety) ---

const V2_FILE = [
  "# tasklog v2",
  "1\topen\t2027-01-02\t2027-02-01\t2027-04-01\twork\tFrom tasklog 2.0",
  "2\tdone\t2027-01-03\t2027-01-05\t-\t-\tAlso 2.0",
  "",
].join("\n");

test("existing v2 files keep working, including their updated dates (ticket; README: Safety)", () => {
  const f = tempFile(V2_FILE);
  ok(run(f, ["edit", "2", "--title", "Also 2.0, edited"]));
  const all = JSON.parse(run(f, ["list", "--json", "--status", "all"]).out);
  const one = all.find((t) => t.id === 1);
  assert.equal(one.updated, "2027-02-01");
  assert.equal(one.title, "From tasklog 2.0");
  assert.equal(all.find((t) => t.id === 2).title, "Also 2.0, edited");
});

test("edit sets updated to today and keeps created (README: updated is the day the task last changed)", () => {
  const f = seeded();
  ok(run(f, ["edit", "1", "--title", "x"]));
  const t = JSON.parse(run(f, ["list", "--json", "--status", "all"]).out).find((x) => x.id === 1);
  assert.equal(t.created, "2027-03-01");
  assert.equal(t.updated, NOW);
});

test("recurring: the next task is created and updated today (README: updated)", () => {
  const f = tempFile();
  ok(run(f, ["add", "Review", "--due", "2027-03-12", "--every", "week"], "2027-03-01"));
  ok(run(f, ["done", "1"]));
  const t = JSON.parse(run(f, ["list", "--json"]).out)[0];
  assert.deepEqual([t.id, t.created, t.updated, t.due], [2, NOW, NOW, "2027-03-19"]);
});

test("undo reverts an edit exactly (README: every change can be undone)", () => {
  const f = seeded();
  const before = read(f);
  ok(run(f, ["edit", "1", "--title", "Changed", "--due", "none", "--tags", "none"]));
  ok(run(f, ["undo"]));
  assert.equal(read(f), before);
});

test("undo reverts a recurring done in one step: reopens it and removes the next task (README: one command is one step)", () => {
  const f = tempFile();
  ok(run(f, ["add", "Review", "--due", "fri", "--every", "week"]));
  const before = read(f);
  ok(run(f, ["done", "1"]));
  assert.equal(tasks(f).length, 2);
  ok(run(f, ["undo"]));
  assert.equal(read(f), before);
});

test("undo removes a recurring task that was just added (README: undo)", () => {
  const f = tempFile();
  ok(run(f, ["add", "Plain"]));
  ok(run(f, ["add", "Review", "--due", "fri", "--every", "week"]));
  ok(run(f, ["undo"]));
  assert.deepEqual(tasks(f).map((t) => t.title), ["Plain"]);
});

test("export and show change nothing, so undo skips past them (README: undo reverts commands that change the file)", () => {
  const f = seeded();
  ok(run(f, ["export", "--format", "json"]));
  ok(run(f, ["show", "1"]));
  ok(run(f, ["undo"]));
  assert.deepEqual(tasks(f).map((t) => t.id), [1, 2], "the last add (task 3) was undone");
});

test("a failed edit leaves no undo step behind (README: a failed command changes nothing)", () => {
  const f = tempFile();
  ok(run(f, ["add", "a"]));
  assert.notEqual(run(f, ["edit", "1", "--due", "someday"]).code, 0);
  assert.equal(run(f, ["edit", "9", "--title", "x"]).code, 1);
  ok(run(f, ["undo"]));
  assert.deepEqual(tasks(f), [], "undo reverted the add, not a failed edit");
});

test("edit respects the lock: exit 3, nothing changed (README: Safety)", () => {
  const f = seeded();
  const before = read(f);
  writeFileSync(`${f}.lock`, "");
  const r = run(f, ["edit", "1", "--title", "x"]);
  assert.equal(r.code, 3);
  assert.match(r.err, /^tasklog: /);
  assert.equal(read(f), before);
});

test("a recurring done respects the lock: exit 3, no next task (README: Safety)", () => {
  const f = tempFile();
  ok(run(f, ["add", "Review", "--due", "fri", "--every", "week"]));
  const before = read(f);
  writeFileSync(`${f}.lock`, "");
  assert.equal(run(f, ["done", "1"]).code, 3);
  assert.equal(read(f), before);
});

test("export and show only read, so they work while the file is locked (README: commands that only read never lock)", () => {
  const f = seeded();
  writeFileSync(`${f}.lock`, "");
  ok(run(f, ["export", "--format", "json"]));
  ok(run(f, ["export", "--format", "csv"]));
  ok(run(f, ["show", "2"]));
});

test("edit releases the lock after success and after failure (README: Safety)", () => {
  const f = seeded();
  ok(run(f, ["edit", "1", "--title", "x"]));
  assert.equal(existsSync(`${f}.lock`), false);
  assert.equal(run(f, ["edit", "9", "--title", "x"]).code, 1);
  assert.equal(existsSync(`${f}.lock`), false);
  assert.equal(run(f, ["edit", "1", "--due", "someday"]).code, 2);
  assert.equal(existsSync(`${f}.lock`), false);
});

test("edit and show accept last (README: Picking tasks)", () => {
  const f = seeded();
  ok(run(f, ["edit", "last", "--title", "Call Sam today"]));
  assert.equal(task(f, 3).title, "Call Sam today");
  assert.match(run(f, ["show", "last"]).out, /Call Sam today/);
});

test("edit and show take a single task: ranges and lists are usage errors (README: Picking tasks)", () => {
  const f = seeded();
  ok(run(f, ["edit", "2", "--title", "Buy milk"]));
  ok(run(f, ["show", "2"]));
  for (const sel of ["1-2", "1,2"]) {
    assert.equal(run(f, ["edit", sel, "--title", "x"]).code, 2, `edit ${sel}`);
    assert.equal(run(f, ["show", sel]).code, 2, `show ${sel}`);
  }
});

test("export follows .tasklogrc's defaultStatus, like list (ticket: same filters as list; README: Settings)", () => {
  const f = seeded();
  ok(run(f, ["done", "3"]));
  writeFileSync(join(dirname(f), ".tasklogrc"), JSON.stringify({ defaultStatus: "all" }));
  const ids = JSON.parse(run(f, ["export", "--format", "json"]).out).map((t) => t.id);
  assert.deepEqual(ids, [3, 1, 2]);
  assert.deepEqual(ids, JSON.parse(run(f, ["list", "--json"]).out).map((t) => t.id));
});

test("show prints the whole task: full title, due date and tags (ticket)", () => {
  const f = tempFile();
  const long = "A very long task title that list would certainly cut off at forty characters";
  ok(run(f, ["add", long, "--due", "2027-04-01", "--tags", "work,q2"]));
  const out = run(f, ["show", "1"]).out;
  assert.ok(out.includes(long), out);
  assert.match(out, /2027-04-01/);
  assert.match(out, /q2/);
  assert.match(out, /work/);
});

test("show: unknown and invalid ids follow the usual exit codes (README: Errors)", () => {
  const f = seeded();
  const r = run(f, ["show", "9"]);
  assert.equal(r.code, 1);
  assert.equal(r.err, "tasklog: no task with id 9\n");
  assert.equal(run(f, ["show", "abc"]).code, 2);
});
