import { type ChildProcess } from "node:child_process";
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
export declare function cleanEnv(extra?: NodeJS.ProcessEnv): NodeJS.ProcessEnv;
/** Remember a running child, so it can be stopped with everything it started. */
export declare function track(child: ChildProcess): void;
/**
 * Stop a child and every process it started, so nothing keeps running (or
 * editing a worktree) after a timeout. On POSIX the child must have been
 * spawned with `detached: true`, making it a process-group leader; on Windows
 * the tree is killed with taskkill.
 */
export declare function killTree(child: ChildProcess, sig?: NodeJS.Signals): void;
/** Stop every tracked child and its descendants (e.g. when graftree itself is interrupted). */
export declare function killTrackedChildren(sig?: NodeJS.Signals): void;
/** Run a shell command (the user's configured test/build commands) with a timeout. */
export declare function runShell(command: string, cwd: string, timeoutSec: number, env?: NodeJS.ProcessEnv): Promise<ShellResult>;
export declare function writeLog(path: string, content: string): Promise<void>;
/** Last `n` characters, for feeding failure output back to a worker. */
export declare const tail: (s: string, n?: number) => string;
