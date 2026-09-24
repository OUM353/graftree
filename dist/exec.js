import { spawn } from "node:child_process";
import { mkdir, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
/**
 * Environment for commands graftree runs. Strips variables that would change a
 * nested test runner's behavior (e.g. node:test reports to a parent and exits 0
 * when NODE_TEST_CONTEXT is inherited), so a verdict never depends on how
 * graftree itself was launched.
 */
export function cleanEnv(extra) {
    const env = { ...process.env, CI: "1", ...extra };
    delete env.NODE_TEST_CONTEXT;
    return env;
}
/** Run a shell command (the user's configured test/build commands) with a timeout. */
export function runShell(command, cwd, timeoutSec, env) {
    return new Promise((resolve) => {
        const child = spawn(command, { cwd, shell: true, env: cleanEnv(env), stdio: ["ignore", "pipe", "pipe"], detached: process.platform !== "win32" });
        let output = "";
        let timedOut = false;
        const cap = (d) => {
            output += d.toString();
            if (output.length > 2_000_000)
                output = output.slice(-1_000_000);
        };
        child.stdout.on("data", cap);
        child.stderr.on("data", cap);
        const kill = (sig) => {
            try {
                if (child.pid && process.platform !== "win32")
                    process.kill(-child.pid, sig);
                else
                    child.kill(sig);
            }
            catch {
                /* already gone */
            }
        };
        const timer = setTimeout(() => {
            timedOut = true;
            kill("SIGTERM");
            setTimeout(() => kill("SIGKILL"), 5000).unref();
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
export async function writeLog(path, content) {
    await mkdir(dirname(path), { recursive: true });
    await writeFile(path, content);
}
/** Last `n` characters, for feeding failure output back to a worker. */
export const tail = (s, n = 6000) => (s.length > n ? `…(truncated)…\n${s.slice(-n)}` : s);
//# sourceMappingURL=exec.js.map