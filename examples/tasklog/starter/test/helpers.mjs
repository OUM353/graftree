import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

export const CLI = fileURLToPath(new URL("../src/cli.mjs", import.meta.url));

/** A fresh task file path in a temp dir. */
export function tempFile(content) {
  const path = join(mkdtempSync(join(tmpdir(), "tasklog-")), "tasks.txt");
  if (content !== undefined) writeFileSync(path, content);
  return path;
}

/** Run the CLI against `file` with TASKLOG_NOW = now. */
export function run(file, args, now = "2027-03-10") {
  const env = { ...process.env, TASKLOG_FILE: file, TASKLOG_NOW: now };
  const r = spawnSync(process.execPath, [CLI, ...args], { env, encoding: "utf8" });
  return { code: r.status, out: r.stdout, err: r.stderr };
}

export const listJson = (file, extra = [], now) => JSON.parse(run(file, ["list", "--json", "--status", "all", ...extra], now).out);
export const read = (file) => readFileSync(file, "utf8");
