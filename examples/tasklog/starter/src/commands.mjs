import { parseArgs } from "./args.mjs";
import { parseDate, today } from "./dates.mjs";
import { NotFoundError, UsageError } from "./errors.mjs";
import { table, toJson } from "./format.mjs";
import { loadTasks, nextId, saveTasks, taskFilePath } from "./store.mjs";
import { parseTags } from "./tags.mjs";

// Every command validates all of its input before it writes anything, so a
// failed command never leaves the task file half-changed.

function parseId(s) {
  if (!/^[1-9]\d*$/.test(s)) throw new UsageError(`invalid id: "${s}"`);
  return Number(s);
}

function findTask(tasks, id) {
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

/** The filters `list` understands, applied in one place. */
export function filterTasks(tasks, flags, now) {
  const status = (flags.status ?? "open").toLowerCase();
  if (!STATUSES.includes(status)) throw new UsageError(`invalid status: "${flags.status}" (use open, done or all)`);
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
  const due = flags.due === undefined ? null : parseDate(flags.due, now);
  const tags = flags.tags === undefined ? [] : parseTags(flags.tags);
  const path = taskFilePath(flags.file);
  const tasks = loadTasks(path);
  const task = { id: nextId(tasks), status: "open", created: now, due, tags, title };
  tasks.push(task);
  saveTasks(path, tasks);
  out.log(`added: ${task.id} ${task.title}`);
}

export function list(argv, out) {
  const { flags, positional } = parseArgs(argv, LIST_FLAGS);
  if (positional.length) throw new UsageError(`unexpected argument: "${positional[0]}"`);
  const now = today();
  const tasks = sortTasks(filterTasks(loadTasks(taskFilePath(flags.file)), flags, now));
  out.log(flags.json ? JSON.stringify(tasks.map(toJson), null, 2) : table(tasks, now));
}

export function done(argv, out) {
  const { flags, positional } = parseArgs(argv, { file: "string" });
  if (!positional.length) throw new UsageError("missing task id");
  const ids = positional.map(parseId);
  const path = taskFilePath(flags.file);
  const tasks = loadTasks(path);
  const targets = ids.map((id) => findTask(tasks, id));
  for (const t of targets) {
    if (t.status === "done") {
      out.warn(`tasklog: task ${t.id} is already done`);
      continue;
    }
    t.status = "done";
    out.log(`done: ${t.id} ${t.title}`);
  }
  saveTasks(path, tasks);
}
