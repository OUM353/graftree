import { existsSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";

// The task file is plain text, one task per line, tab-separated fields.
//
// Version 2 (written since tasklog 2.0):
//   # tasklog v2
//   <id> <status> <created> <updated> <due> <tags> <title>
//
// Version 1 (tasklog 1.x; still read, never written):
//   # tasklog v1
//   <id> <status> <created> <due> <tags> <title>
//   A v1 task's "updated" is its "created".
//
// status is "open" or "done"; dates are YYYY-MM-DD; due may be "-"; tags are
// comma-separated ("-" for none). Backslash, tab and newline inside a field are
// written as \\, \t and \n. Blank lines and other "#" lines are ignored.

export const HEADER = "# tasklog v2";

/** Where the task file lives: --file, then $TASKLOG_FILE, then ./tasks.txt. */
export function taskFilePath(flag) {
  return resolve(flag ?? process.env.TASKLOG_FILE ?? "tasks.txt");
}

const escape = (s) => s.replace(/\\/g, "\\\\").replace(/\t/g, "\\t").replace(/\n/g, "\\n");
const unescape = (s) => s.replace(/\\(.)/g, (_, c) => (c === "t" ? "\t" : c === "n" ? "\n" : c));

function parseLine(fields, version) {
  if (version === 1) {
    const [id, status, created, due, tags, title] = fields;
    return parseLine([id, status, created, created, due, tags, title], 2);
  }
  const [id, status, created, updated, due, tags, title] = fields;
  return {
    id: Number(id),
    status,
    created,
    updated,
    due: due === "-" ? null : due,
    tags: tags === "-" ? [] : tags.split(","),
    title: unescape(title ?? ""),
  };
}

export function loadTasks(path) {
  if (!existsSync(path)) return [];
  const tasks = [];
  let version = null;
  for (const line of readFileSync(path, "utf8").split(/\r?\n/)) {
    const header = /^# tasklog v(\d+)\s*$/.exec(line);
    if (header) {
      version = Number(header[1]);
      continue;
    }
    if (line.trim() === "" || line.startsWith("#")) continue;
    const fields = line.split("\t");
    tasks.push(parseLine(fields, version ?? (fields.length >= 7 ? 2 : 1)));
  }
  return tasks;
}

export function saveTasks(path, tasks) {
  const lines = [HEADER];
  for (const t of tasks) {
    lines.push([t.id, t.status, t.created, t.updated, t.due ?? "-", t.tags.length ? t.tags.join(",") : "-", escape(t.title)].join("\t"));
  }
  const tmp = `${path}.tmp`;
  writeFileSync(tmp, lines.join("\n") + "\n");
  renameSync(tmp, path);
}

export function nextId(tasks) {
  return tasks.reduce((m, t) => Math.max(m, t.id), 0) + 1;
}
