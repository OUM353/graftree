import { spawn } from "node:child_process";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { cleanEnv } from "../exec.js";
import { resolveCommand } from "./resolve-command.js";
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
 * Extract the final answer from newline-delimited JSON events.
 *
 * Known shapes, checked from the last event backwards:
 * - CommandCode: `{"type":"result","subtype":"success"|…,"finalText":"…","usage":{…}}`
 *   (also `{"type":"event","event":{"type":"run_end","result":{"finalText":"…"}}}`)
 * - Claude Code `-p --output-format stream-json`: `{"type":"result","subtype":"success","is_error":false,"result":"…"}`
 * - Generic: the last event with a string `result`/`text`/`output`/`content`/`message`.
 * A result event reporting failure (non-"success" subtype or is_error) sets ok=false.
 * With no recognizable event, the raw stdout is the text.
 */
export function parseNdjson(stdout: string): { text: string; events: unknown[]; usage?: unknown; ok?: boolean } {
  const events: Record<string, unknown>[] = [];
  for (const line of stdout.split(/\r?\n/)) {
    const t = line.trim();
    if (!t.startsWith("{")) continue;
    try {
      const v = JSON.parse(t);
      if (v && typeof v === "object") events.push(v as Record<string, unknown>);
    } catch {
      /* non-JSON noise */
    }
  }
  const str = (v: unknown) => (typeof v === "string" && v.length ? v : undefined);
  const obj = (v: unknown) => (v && typeof v === "object" ? (v as Record<string, unknown>) : undefined);

  for (let i = events.length - 1; i >= 0; i--) {
    const e = events[i]!;
    if (e.type === "result") {
      const failed = (typeof e.subtype === "string" && e.subtype !== "success") || e.is_error === true;
      const text = str(e.finalText) ?? str(e.result) ?? str(obj(e.result)?.finalText) ?? str(e.error) ?? "";
      return { text, events, usage: e.usage, ok: !failed };
    }
    const runEnd = obj(e.event);
    if (runEnd?.type === "run_end") {
      const r = obj(runEnd.result);
      const text = str(r?.finalText);
      if (text !== undefined) return { text, events, usage: r?.usage };
    }
  }
  for (let i = events.length - 1; i >= 0; i--) {
    const e = events[i]!;
    for (const key of ["finalText", "result", "text", "output", "content", "message"]) {
      const v = str(e[key]);
      if (v) return { text: v, events, usage: e.usage };
    }
  }
  return { text: stdout.trim(), events };
}

/** File (in the worker's cwd) holding a prompt too long for a command line. Never snapshotted. */
export const TASK_FILE = ".graftree-task.md";

/** Prompts above this go through TASK_FILE: Windows caps a whole command line at 32,767 chars. */
export const MAX_ARGV_PROMPT = 8000;

export async function runCliWorker(name: string, w: CliWorker, task: WorkerTask): Promise<WorkerResult> {
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
  const vars: Record<string, string> = { prompt: argPrompt, promptFile, cwd: task.cwd };
  if (w.model) vars.model = w.model;

  try {
    const [cmd0, ...args0] = renderArgv(w.command, vars);
    const env = cleanEnv(w.env);
    const resolved = resolveCommand(cmd0!, env);
    const cmd = resolved.file;
    const args = [...resolved.prefixArgs, ...args0];
    const { code, stdout, stderr, timedOut } = await new Promise<{
      code: number | null;
      stdout: string;
      stderr: string;
      timedOut: boolean;
    }>((resolve, reject) => {
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
      ok: code === 0 && !timedOut && ("ok" in parsed ? parsed.ok !== false : true),
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
    await rm(taskFile, { force: true });
  }
}
