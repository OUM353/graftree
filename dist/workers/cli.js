import { spawn } from "node:child_process";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { cleanEnv } from "../exec.js";
import { resolveCommand } from "./resolve-command.js";
/** Fill {prompt} {promptFile} {model} {cwd} in an argv template. No shell is involved. */
export function renderArgv(template, vars) {
    return template.map((arg) => arg.replace(/\{(prompt|promptFile|model|cwd)\}/g, (m, key) => {
        const v = vars[key];
        if (v === undefined)
            throw new Error(`command template uses ${m} but no value is available (set "model" on the worker?)`);
        return v;
    }));
}
/**
 * Extract the final answer from newline-delimited JSON events. Agent CLIs
 * differ in event shapes, so this looks for the last event carrying a
 * result-like field and falls back to raw stdout.
 */
export function parseNdjson(stdout) {
    const events = [];
    for (const line of stdout.split("\n")) {
        const t = line.trim();
        if (!t.startsWith("{"))
            continue;
        try {
            events.push(JSON.parse(t));
        }
        catch {
            /* non-JSON noise */
        }
    }
    for (let i = events.length - 1; i >= 0; i--) {
        const e = events[i];
        for (const key of ["result", "text", "output", "content", "message"]) {
            const v = e[key];
            if (typeof v === "string" && v.length)
                return { text: v, events, usage: e.usage };
        }
    }
    return { text: stdout.trim(), events };
}
/** File (in the worker's cwd) holding a prompt too long for a command line. Never snapshotted. */
export const TASK_FILE = ".graftree-task.md";
/** Prompts above this go through TASK_FILE: Windows caps a whole command line at 32,767 chars. */
export const MAX_ARGV_PROMPT = 8000;
export async function runCliWorker(name, w, task) {
    const started = Date.now();
    const tmp = await mkdtemp(join(tmpdir(), "graftree-prompt-"));
    const promptFile = join(tmp, "prompt.md");
    await writeFile(promptFile, task.prompt);
    let argPrompt = task.prompt;
    const taskFile = join(task.cwd, TASK_FILE);
    if (task.prompt.length > MAX_ARGV_PROMPT && w.command.some((a) => a.includes("{prompt}"))) {
        await writeFile(taskFile, task.prompt);
        argPrompt = `Your full task is in the file ${TASK_FILE} in the current directory. Read it completely and follow it exactly. Do not modify or commit that file.`;
    }
    const vars = { prompt: argPrompt, promptFile, cwd: task.cwd };
    if (w.model)
        vars.model = w.model;
    try {
        const [cmd0, ...args0] = renderArgv(w.command, vars);
        const env = cleanEnv(w.env);
        const resolved = resolveCommand(cmd0, env);
        const cmd = resolved.file;
        const args = [...resolved.prefixArgs, ...args0];
        const { code, stdout, stderr, timedOut } = await new Promise((resolve, reject) => {
            const child = spawn(cmd, args, {
                cwd: task.cwd,
                env,
                windowsHide: true,
                stdio: ["ignore", "pipe", "pipe"],
            });
            let out = "";
            let err = "";
            let timedOut = false;
            child.stdout.on("data", (d) => (out += d));
            child.stderr.on("data", (d) => (err += d));
            const timer = setTimeout(() => {
                timedOut = true;
                child.kill("SIGTERM");
                setTimeout(() => child.kill("SIGKILL"), 5000).unref();
            }, (task.timeoutSec ?? w.timeoutSec) * 1000);
            child.on("error", (e) => {
                clearTimeout(timer);
                reject(e);
            });
            child.on("close", (code) => {
                clearTimeout(timer);
                resolve({ code, stdout: out, stderr: err, timedOut });
            });
        });
        const parsed = w.output === "ndjson" ? parseNdjson(stdout) : { text: stdout.trim() };
        return {
            worker: name,
            ok: code === 0 && !timedOut,
            exitCode: code,
            timedOut,
            text: parsed.text,
            stdout,
            stderr,
            usage: "usage" in parsed ? parsed.usage : undefined,
            durationMs: Date.now() - started,
        };
    }
    catch (e) {
        return {
            worker: name,
            ok: false,
            exitCode: null,
            timedOut: false,
            text: "",
            stdout: "",
            stderr: e.message,
            durationMs: Date.now() - started,
        };
    }
    finally {
        await rm(tmp, { recursive: true, force: true });
        await rm(taskFile, { force: true });
    }
}
//# sourceMappingURL=cli.js.map