import { spawn, type ChildProcess } from "node:child_process";
import { mkdir, writeFile } from "node:fs/promises";
import { dirname } from "node:path";

export interface ShellResult {
  exitCode: number | null;
  timedOut: boolean;
  output: string;
}

/**
 * Environment for commands graftree runs. Strips variables that would change a
 * nested test runner's behavior (e.g. node:test reports to a parent and exits 0
 * when NODE_TEST_CONTEXT is inherited), so a verdict never depends on how
 * graftree itself was launched.
 */
export function cleanEnv(extra?: NodeJS.ProcessEnv): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = { ...process.env, CI: "1", ...extra };
  delete env.NODE_TEST_CONTEXT;
  return env;
}

const live = new Set<ChildProcess>();

/** Remember a running child, so it can be stopped with everything it started. */
export function track(child: ChildProcess): void {
  live.add(child);
  child.once("close", () => live.delete(child));
  child.once("error", () => live.delete(child));
}

/**
 * Stop a child and every process it started, so nothing keeps running (or
 * editing a worktree) after a timeout. On POSIX the child must have been
 * spawned with `detached: true`, making it a process-group leader; on Windows
 * the tree is killed with taskkill.
 */
export function killTree(child: ChildProcess, sig: NodeJS.Signals = "SIGTERM"): void {
  // Don't skip a child that already exited: on POSIX its group may still hold a
  // process that keeps the output pipes open, and killing the group ends it.
  if (child.pid === undefined) return;
  try {
    if (process.platform === "win32") {
      spawn("taskkill", ["/pid", String(child.pid), "/T", "/F"], { stdio: "ignore", windowsHide: true }).on("error", () => child.kill(sig));
    } else {
      process.kill(-child.pid, sig);
    }
  } catch {
    try {
      child.kill(sig);
    } catch {
      /* already gone */
    }
  }
}

/** Stop every tracked child and its descendants (e.g. when graftree itself is interrupted). */
export function killTrackedChildren(sig: NodeJS.Signals = "SIGTERM"): void {
  for (const c of live) killTree(c, sig);
}

/** Run a shell command (the user's configured test/build commands) with a timeout. */
export function runShell(command: string, cwd: string, timeoutSec: number, env?: NodeJS.ProcessEnv): Promise<ShellResult> {
  return new Promise((resolve) => {
    const child = spawn(command, { cwd, shell: true, env: cleanEnv(env), stdio: ["ignore", "pipe", "pipe"], detached: process.platform !== "win32", windowsHide: true });
    track(child);
    let output = "";
    let timedOut = false;
    const cap = (d: Buffer) => {
      output += d.toString();
      if (output.length > 2_000_000) output = output.slice(-1_000_000);
    };
    child.stdout.on("data", cap);
    child.stderr.on("data", cap);
    const timer = setTimeout(() => {
      timedOut = true;
      killTree(child, "SIGTERM");
      setTimeout(() => killTree(child, "SIGKILL"), 5000).unref();
    }, timeoutSec * 1000);
    child.on("error", (e) => {
      clearTimeout(timer);
      resolve({ exitCode: null, timedOut, output: `${output}\n${e.message}` });
    });
    child.on("close", (code) => {
      clearTimeout(timer);
      resolve({ exitCode: code, timedOut, output });
    });
  });
}

export async function writeLog(path: string, content: string): Promise<void> {
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, content);
}

/** Last `n` characters, for feeding failure output back to a worker. */
export const tail = (s: string, n = 6000) => (s.length > n ? `…(truncated)…\n${s.slice(-n)}` : s);
