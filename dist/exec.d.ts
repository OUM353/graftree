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
/** Run a shell command (the user's configured test/build commands) with a timeout. */
export declare function runShell(command: string, cwd: string, timeoutSec: number, env?: NodeJS.ProcessEnv): Promise<ShellResult>;
export declare function writeLog(path: string, content: string): Promise<void>;
/** Last `n` characters, for feeding failure output back to a worker. */
export declare const tail: (s: string, n?: number) => string;
