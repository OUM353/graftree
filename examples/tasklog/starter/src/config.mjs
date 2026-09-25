import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { UsageError } from "./errors.mjs";

/**
 * Settings from .tasklogrc (JSON) in the task file's directory, or from the
 * file named by $TASKLOG_CONFIG. Missing file: defaults.
 *   defaultStatus  "open" | "done" | "all"   the status list shows without --status
 *   defaultTags    "a,b"                      tags every new task starts with
 */
export function loadConfig(taskFile) {
  const path = process.env.TASKLOG_CONFIG ?? join(dirname(taskFile), ".tasklogrc");
  const cfg = { defaultStatus: "open", defaultTags: "" };
  if (!existsSync(path)) return cfg;
  let raw;
  try {
    raw = JSON.parse(readFileSync(path, "utf8"));
  } catch {
    throw new UsageError(`invalid config: ${path} is not valid JSON`);
  }
  for (const [k, v] of Object.entries(raw)) {
    if (!(k in cfg)) throw new UsageError(`invalid config: unknown setting "${k}" in ${path}`);
    if (typeof v !== "string") throw new UsageError(`invalid config: "${k}" must be a string`);
    cfg[k] = v;
  }
  return cfg;
}
