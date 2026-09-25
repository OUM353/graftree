import { parseArgs } from "./args.mjs";
import { loadConfig } from "./config.mjs";
import { parseDate, today } from "./dates.mjs";
import { NotFoundError, UsageError } from "./errors.mjs";
import { table, toJson } from "./format.mjs";
import { parseIds } from "./ids.mjs";
import { record, undoLast } from "./journal.mjs";
import { withLock } from "./lock.mjs";
import { loadTasks, nextId, saveTasks, taskFilePath } from "./store.mjs";
import { parseTags } from "./tags.mjs";

// How a command that changes the task file is written:
//   1. parse and validate all flags and arguments (no file access yet);
//   2. withLock(path, () => { load; validate against the tasks; record(path, label); change; save; });
//   3. print the result.
// A failed command changes nothing, and every change can be undone in one step.

export function findTask(tasks, id) {
  const t = tasks.find((x) => x.id === id);
  if (!t) throw new NotFoundError(`no task with id ${id}`);
  return t;
}

/** Due date first (tasks without one last), then id. */
export function sortTasks(tasks) {
  return [...tasks].sort((a, b) => {
    if (a.due !== b.due) {
      if (a.due === null) return 1;
      if (b.due === null) return -1;
      return a.due < b.due ? -1 : 1;
    }
    return a.id - b.id;
  });
}

const STATUSES = ["open", "done", "all"];

/** The filters `list` understands, applied in one place. The default status comes from the config. */
export function filterTasks(tasks, flags, now, config) {
  const raw = flags.status ?? config.defaultStatus;
  const status = raw.toLowerCase();
  if (!STATUSES.includes(status)) throw new UsageError(`invalid status: "${raw}" (use open, done or all)`);
  const tags = (flags.tag ?? []).flatMap(parseTags);
  const before = flags["due-before"] === undefined ? undefined : parseDate(flags["due-before"], now);
  if (before === null) throw new UsageError(`--due-before needs a date`);
  return tasks.filter(
    (t) =>
      (status === "all" || t.status === status) &&
      tags.every((tag) => t.tags.includes(tag)) &&
      (before === undefined || (t.due !== null && t.due < before)),
  );
}

export const LIST_FLAGS = { file: "string", status: "string", tag: "list", "due-before": "string", json: "boolean" };

export function add(argv, out) {
  const { flags, positional } = parseArgs(argv, { file: "string", due: "string", tags: "string" });
  const title = positional.join(" ").trim();
  if (!title) throw new UsageError("missing title");
  const now = today();
  const path = taskFilePath(flags.file);
  const config = loadConfig(path);
  const due = flags.due === undefined ? null : parseDate(flags.due, now);
  const tags = parseTags([config.defaultTags, flags.tags ?? ""].filter(Boolean).join(","));
  const task = withLock(path, () => {
    const tasks = loadTasks(path);
    record(path, `add ${title}`);
    const t = { id: nextId(tasks), status: "open", created: now, updated: now, due, tags, title };
    tasks.push(t);
    saveTasks(path, tasks);
    return t;
  });
  out.log(`added: ${task.id} ${task.title}`);
}

export function list(argv, out) {
  const { flags, positional } = parseArgs(argv, LIST_FLAGS);
  if (positional.length) throw new UsageError(`unexpected argument: "${positional[0]}"`);
  const now = today();
  const path = taskFilePath(flags.file);
  const tasks = sortTasks(filterTasks(loadTasks(path), flags, now, loadConfig(path)));
  out.log(flags.json ? JSON.stringify(tasks.map(toJson), null, 2) : table(tasks, now));
}

export function done(argv, out) {
  const { flags, positional } = parseArgs(argv, { file: "string" });
  if (!positional.length) throw new UsageError("missing task id");
  const path = taskFilePath(flags.file);
  const now = today();
  const messages = withLock(path, () => {
    const tasks = loadTasks(path);
    const ids = positional.flatMap((p) => parseIds(p, tasks));
    const targets = ids.map((id) => findTask(tasks, id));
    const msgs = [];
    const open = targets.filter((t) => t.status !== "done");
    for (const t of targets) if (t.status === "done") msgs.push(["warn", `tasklog: task ${t.id} is already done`]);
    if (open.length) {
      record(path, `done ${positional.join(" ")}`);
      for (const t of open) {
        t.status = "done";
        t.updated = now;
        msgs.push(["log", `done: ${t.id} ${t.title}`]);
      }
      saveTasks(path, tasks);
    }
    return msgs;
  });
  for (const [kind, m] of messages) out[kind](m);
}

export function undo(argv, out) {
  const { flags, positional } = parseArgs(argv, { file: "string" });
  if (positional.length) throw new UsageError(`unexpected argument: "${positional[0]}"`);
  const path = taskFilePath(flags.file);
  const label = withLock(path, () => undoLast(path));
  out.log(`undone: ${label}`);
}
