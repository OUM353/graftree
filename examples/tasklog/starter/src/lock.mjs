import { closeSync, openSync, rmSync } from "node:fs";

/** Another tasklog is changing the file. Exit code 3. */
export class LockedError extends Error {
  exitCode = 3;
}

/**
 * Run fn while holding <file>.lock. Every command that changes the task file
 * must do its read-modify-write inside withLock, so two tasklogs never
 * interleave. Commands that only read (list) do not lock.
 */
export function withLock(path, fn) {
  const lock = `${path}.lock`;
  let fd;
  try {
    fd = openSync(lock, "wx");
  } catch (e) {
    if (e.code === "EEXIST") throw new LockedError(`${path} is locked by another tasklog (delete ${lock} if none is running)`);
    throw e;
  }
  try {
    return fn();
  } finally {
    closeSync(fd);
    rmSync(lock, { force: true });
  }
}
