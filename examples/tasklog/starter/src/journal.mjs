import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { NotFoundError } from "./errors.mjs";

// Undo history, kept next to the task file in <file>.undo as JSON lines:
// { "label": "done 3", "before": "<the whole task file before the change>" }.
// Every command that changes the file records one entry per invocation,
// before it saves, so `tasklog undo` reverts the whole command in one step.

const KEEP = 20;

const journalPath = (path) => `${path}.undo`;

function entries(path) {
  const p = journalPath(path);
  if (!existsSync(p)) return [];
  return readFileSync(p, "utf8").split("\n").filter(Boolean).map((l) => JSON.parse(l));
}

function write(path, list) {
  writeFileSync(journalPath(path), list.map((e) => JSON.stringify(e)).join("\n") + (list.length ? "\n" : ""));
}

/** Record the file's current content under a label, before changing it. */
export function record(path, label) {
  const before = existsSync(path) ? readFileSync(path, "utf8") : "";
  write(path, [...entries(path), { label, before }].slice(-KEEP));
}

/** Restore the file as it was before the last recorded command; returns its label. */
export function undoLast(path) {
  const list = entries(path);
  const last = list.pop();
  if (!last) throw new NotFoundError("nothing to undo");
  writeFileSync(path, last.before);
  write(path, list);
  return last.label;
}
