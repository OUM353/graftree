#!/usr/bin/env node
import { add, done, list } from "./commands.mjs";

const USAGE = `usage: tasklog <command> [options]

  add <title...> [--due DATE] [--tags a,b]
  list [--status open|done|all] [--tag TAG]... [--due-before DATE] [--json]
  done <id...>

Every command takes --file PATH (default: $TASKLOG_FILE, then ./tasks.txt).`;

const COMMANDS = { add, list, done };

export function main(argv, out = { log: console.log, warn: console.error }) {
  const [cmd, ...rest] = argv;
  if (!cmd || cmd === "help" || cmd === "--help") {
    out.log(USAGE);
    return 0;
  }
  const run = COMMANDS[cmd];
  try {
    if (!run) {
      out.warn(`tasklog: unknown command: "${cmd}"`);
      out.warn(USAGE);
      return 2;
    }
    run(rest, out);
    return 0;
  } catch (e) {
    if (typeof e.exitCode !== "number") throw e;
    out.warn(`tasklog: ${e.message}`);
    return e.exitCode;
  }
}

process.exitCode = main(process.argv.slice(2));
