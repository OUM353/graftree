import { mkdir, readFile, readdir, writeFile } from "node:fs/promises";
import { dirname, relative, resolve, sep } from "node:path";
import { git } from "../git.js";
import { runShell, tail } from "../exec.js";
import type { OpenAICompatibleWorker } from "../schema.js";
import type { WorkerResult, WorkerTask } from "./types.js";

/**
 * Tool-using agent loop for OpenAI-compatible endpoints (OpenRouter, Ollama, vLLM, ...).
 * Gives the model a small toolset confined to the task's worktree, so API
 * models can plan, solve, and integrate like CLI agents do.
 */

type ToolCall = { id: string; type: "function"; function: { name: string; arguments: string } };
type Message =
  | { role: "system" | "user"; content: string }
  | { role: "assistant"; content: string | null; tool_calls?: ToolCall[] }
  | { role: "tool"; tool_call_id: string; content: string };

const fn = (name: string, description: string, properties: Record<string, unknown>, required: string[] = []) => ({
  type: "function" as const,
  function: { name, description, parameters: { type: "object", properties, required, additionalProperties: false } },
});
const str = (description: string) => ({ type: "string", description });

export const AGENT_TOOLS = [
  fn("list_files", "List tracked and new files under a directory (repo-relative).", { path: str("directory, default '.'") }),
  fn("read_file", "Read a text file. Returns numbered lines.", {
    path: str("repo-relative path"),
    offset: { type: "integer", description: "first line (1-based)" },
    limit: { type: "integer", description: "max lines, default 400" },
  }, ["path"]),
  fn("write_file", "Create or overwrite a file with the given content.", { path: str("repo-relative path"), content: str("full file content") }, ["path", "content"]),
  fn("replace_in_file", "Replace one exact, unique occurrence of old_text with new_text.", {
    path: str("repo-relative path"),
    old_text: str("exact existing text (must occur once)"),
    new_text: str("replacement"),
  }, ["path", "old_text", "new_text"]),
  fn("search", "Search file contents with a regular expression (git grep).", { pattern: str("regex"), path: str("optional directory") }, ["pattern"]),
  fn("run_command", "Run a shell command in the repo root (tests, builds). Returns exit code and output tail.", { command: str("shell command") }, ["command"]),
  fn("finish", "Call when the task is complete.", { summary: str("what you did and the final test status") }, ["summary"]),
];

function confine(cwd: string, p: string): string {
  const abs = resolve(cwd, p || ".");
  const rel = relative(cwd, abs);
  if (rel.startsWith("..") || rel.split(sep).includes(".git")) throw new Error(`path not allowed: ${p}`);
  return abs;
}

export async function executeTool(cwd: string, name: string, args: Record<string, unknown>): Promise<string> {
  const s = (k: string) => (typeof args[k] === "string" ? (args[k] as string) : "");
  switch (name) {
    case "list_files": {
      const dir = confine(cwd, s("path") || ".");
      const rel = relative(cwd, dir) || ".";
      const out = await git(cwd, ["ls-files", "--cached", "--others", "--exclude-standard", "--", rel]).catch(async () =>
        (await readdir(dir)).join("\n"),
      );
      const lines = out.split("\n");
      return lines.length > 500 ? `${lines.slice(0, 500).join("\n")}\n… ${lines.length - 500} more` : out || "(empty)";
    }
    case "read_file": {
      const text = await readFile(confine(cwd, s("path")), "utf8");
      const lines = text.split("\n");
      const offset = Math.max(1, Number(args.offset) || 1);
      const limit = Math.max(1, Number(args.limit) || 400);
      const slice = lines.slice(offset - 1, offset - 1 + limit).map((l, i) => `${offset + i}\t${l}`);
      const more = offset - 1 + limit < lines.length ? `\n… (${lines.length} lines total)` : "";
      return slice.join("\n") + more;
    }
    case "write_file": {
      const abs = confine(cwd, s("path"));
      await mkdir(dirname(abs), { recursive: true });
      await writeFile(abs, s("content"));
      return `wrote ${s("path")}`;
    }
    case "replace_in_file": {
      const abs = confine(cwd, s("path"));
      const text = await readFile(abs, "utf8");
      const count = text.split(s("old_text")).length - 1;
      if (count !== 1) return `error: old_text occurs ${count} times; it must occur exactly once`;
      await writeFile(abs, text.replace(s("old_text"), () => s("new_text")));
      return `edited ${s("path")}`;
    }
    case "search": {
      const dir = s("path") ? [relative(cwd, confine(cwd, s("path"))) || "."] : [];
      const out = await git(cwd, ["grep", "-n", "-I", "-E", "--untracked", s("pattern"), "--", ...dir]).catch(() => "");
      return out ? tail(out, 8000) : "(no matches)";
    }
    case "run_command": {
      const r = await runShell(s("command"), cwd, 600);
      return `exit ${r.exitCode}${r.timedOut ? " (timed out)" : ""}\n${tail(r.output, 8000)}`;
    }
    default:
      return `error: unknown tool ${name}`;
  }
}

export async function runApiAgent(
  name: string,
  w: OpenAICompatibleWorker,
  task: WorkerTask,
  fetchImpl: typeof fetch = fetch,
): Promise<WorkerResult> {
  const started = Date.now();
  const deadline = started + (task.timeoutSec ?? w.timeoutSec) * 1000;
  const result = (ok: boolean, text: string, stderr = "", usage?: unknown): WorkerResult => ({
    worker: name,
    ok,
    exitCode: ok ? 0 : 1,
    timedOut: Date.now() > deadline,
    text,
    stdout: transcript.map((m) => JSON.stringify(m)).join("\n"),
    stderr,
    usage,
    durationMs: Date.now() - started,
  });

  const headers: Record<string, string> = { "content-type": "application/json", ...w.headers };
  const transcript: Message[] = [
    {
      role: "system",
      content:
        "You are a careful software engineer working in a git worktree. Use the tools to inspect and edit files and to run tests. Keep edits minimal and within the paths you are allowed to change. Call finish when done.",
    },
    { role: "user", content: task.prompt },
  ];
  const usageTotals: Record<string, number> = {};

  if (w.apiKeyEnv) {
    const key = process.env[w.apiKeyEnv];
    if (!key) return result(false, "", `environment variable ${w.apiKeyEnv} is not set`);
    headers.authorization = `Bearer ${key}`;
  }

  for (let turn = 0; turn < w.maxTurns; turn++) {
    if (Date.now() > deadline) return result(false, "", "timed out");
    let res: Response;
    try {
      res = await fetchImpl(`${w.baseUrl.replace(/\/$/, "")}/chat/completions`, {
        method: "POST",
        headers,
        body: JSON.stringify({ model: w.model, messages: transcript, tools: AGENT_TOOLS, ...(w.maxTokens ? { max_tokens: w.maxTokens } : {}) }),
        signal: AbortSignal.timeout(Math.max(1000, deadline - Date.now())),
      });
    } catch (e) {
      return result(false, "", (e as Error).message, usageTotals);
    }
    const raw = await res.text();
    if (!res.ok) return result(false, "", `HTTP ${res.status}: ${raw.slice(0, 2000)}`, usageTotals);
    const json = JSON.parse(raw) as { choices?: { message?: { content?: string | null; tool_calls?: ToolCall[] } }[]; usage?: Record<string, unknown> };
    for (const [k, v] of Object.entries(json.usage ?? {})) if (typeof v === "number") usageTotals[k] = (usageTotals[k] ?? 0) + v;
    const msg = json.choices?.[0]?.message;
    if (!msg) return result(false, "", `malformed response: ${raw.slice(0, 500)}`, usageTotals);
    const calls = msg.tool_calls ?? [];
    transcript.push({ role: "assistant", content: msg.content ?? null, ...(calls.length ? { tool_calls: calls } : {}) });
    if (!calls.length) return result(true, msg.content ?? "", "", usageTotals);

    for (const call of calls) {
      let args: Record<string, unknown> = {};
      try {
        args = JSON.parse(call.function.arguments || "{}");
      } catch {
        transcript.push({ role: "tool", tool_call_id: call.id, content: "error: arguments were not valid JSON" });
        continue;
      }
      if (call.function.name === "finish") {
        transcript.push({ role: "tool", tool_call_id: call.id, content: "ok" });
        return result(true, typeof args.summary === "string" ? args.summary : "", "", usageTotals);
      }
      let out: string;
      try {
        out = await executeTool(task.cwd, call.function.name, args);
      } catch (e) {
        out = `error: ${(e as Error).message}`;
      }
      transcript.push({ role: "tool", tool_call_id: call.id, content: out });
    }
  }
  return result(false, "", `reached maxTurns (${w.maxTurns}) without finish`, usageTotals);
}
