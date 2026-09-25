import { existsSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";

// The task file is plain text, one task per line, fields separated by tabs:
//
//   # tasklog v1
//   <id> <status> <created> <due> <tags> <title>
//
// status is "open" or "done"; created and due are YYYY-MM-DD, due may be "-";
// tags are comma-separated ("-" for none). Backslash, tab and newline inside a
// field are written as \\, \t and \n. Lines starting with "#" and blank lines
// are ignored when reading.

export const HEADER = "# tasklog v1";

/** Where the task file lives: --file, then $TASKLOG_FILE, then ./tasks.txt. */
export function taskFilePath(flag) {
  return resolve(flag ?? process.env.TASKLOG_FILE ?? "tasks.txt");
}

const escape = (s) => s.replace(/\\/g, "\\\\").replace(/\t/g, "\\t").replace(/\n/g, "\\n");
const unescape = (s) => s.replace(/\\(.)/g, (_, c) => (c === "t" ? "\t" : c === "n" ? "\n" : c));

export function loadTasks(path) {
  if (!existsSync(path)) return [];
  const tasks = [];
  for (const line of readFileSync(path, "utf8").split(/\r?\n/)) {
    if (line.trim() === "" || line.startsWith("#")) continue;
    const [id, status, created, due, tags, ...rest] = line.split("\t");
    tasks.push({
      id: Number(id),
      status,
      created,
      due: due === "-" ? null : due,
      tags: tags === "-" ? [] : tags.split(","),
      title: unescape(rest.join("\t")),
    });
  }
  return tasks;
}

export function saveTasks(path, tasks) {
  const lines = [HEADER];
  for (const t of tasks) {
    lines.push([t.id, t.status, t.created, t.due ?? "-", t.tags.length ? t.tags.join(",") : "-", escape(t.title)].join("\t"));
  }
  const tmp = `${path}.tmp`;
  writeFileSync(tmp, lines.join("\n") + "\n");
  renameSync(tmp, path);
}

export function nextId(tasks) {
  return tasks.reduce((m, t) => Math.max(m, t.id), 0) + 1;
}
