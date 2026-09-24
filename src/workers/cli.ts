import { spawn } from "node:child_process";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { CliWorker } from "../schema.js";
import type { WorkerResult, WorkerTask } from "./types.js";

/** Fill {prompt} {promptFile} {model} {cwd} in an argv template. No shell is involved. */
export function renderArgv(template: string[], vars: Record<string, string>): string[] {
  return template.map((arg) =>
    arg.replace(/\{(prompt|promptFile|model|cwd)\}/g, (m, key: string) => {
      const v = vars[key];
      if (v === undefined) throw new Error(`command template uses ${m} but no value is available (set "model" on the worker?)`);
      return v;
    }),
  );
}

/**
 * Extract the final answer from newline-delimited JSON events. Agent CLIs
 * differ in event shapes, so this looks for the last event carrying a
 * result-like field and falls back to raw stdout.
 */
export function parseNdjson(stdout: string): { text: string; events: unknown[]; usage?: unknown } {
  const events: unknown[] = [];
  for (const line of stdout.split("\n")) {
    const t = line.trim();
    if (!t.startsWith("{")) continue;
    try {
      events.push(JSON.parse(t));
    } catch {
      /* non-JSON noise */
    }
  }
  for (let i = events.length - 1; i >= 0; i--) {
    const e = events[i] as Record<string, unknown>;
    for (const key of ["result", "text", "output", "content", "message"]) {
      const v = e[key];
      if (typeof v === "string" && v.length) return { text: v, events, usage: e.usage };
    }
  }
  return { text: stdout.trim(), events };
}

export async function runCliWorker(name: string, w: CliWorker, task: WorkerTask): Promise<WorkerResult> {
  const started = Date.now();
  const tmp = await mkdtemp(join(tmpdir(), "graftree-prompt-"));
  const promptFile = join(tmp, "prompt.md");
  await writeFile(promptFile, task.prompt);
  const vars: Record<string, string> = { prompt: task.prompt, promptFile, cwd: task.cwd };
  if (w.model) vars.model = w.model;

  try {
    const [cmd, ...args] = renderArgv(w.command, vars);
    const { code, stdout, stderr, timedOut } = await new Promise<{
      code: number | null;
      stdout: string;
      stderr: string;
      timedOut: boolean;
    }>((resolve, reject) => {
      const child = spawn(cmd!, args, {
        cwd: task.cwd,
        env: { ...process.env, ...w.env },
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
  } catch (e) {
    return {
      worker: name,
      ok: false,
      exitCode: null,
      timedOut: false,
      text: "",
      stdout: "",
      stderr: (e as Error).message,
      durationMs: Date.now() - started,
    };
  } finally {
    await rm(tmp, { recursive: true, force: true });
  }
}
