import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { OpenAICompatibleWorker } from "../src/schema.js";
import { executeTool, runApiAgent } from "../src/workers/api-agent.js";

const worker = OpenAICompatibleWorker.parse({ type: "openai-compatible", baseUrl: "https://x.test/v1", model: "m", maxTurns: 5 });

function scripted(steps: { name: string; args: object }[]) {
  const bodies: { messages: { role: string; content?: string }[]; tools: unknown[] }[] = [];
  let i = 0;
  const f = (async (_url: string, init: RequestInit) => {
    bodies.push(JSON.parse(String(init.body)));
    const s = steps[i++];
    const message = s
      ? { content: null, tool_calls: [{ id: `t${i}`, type: "function", function: { name: s.name, arguments: JSON.stringify(s.args) } }] }
      : { content: "done without finish" };
    return new Response(JSON.stringify({ choices: [{ message }], usage: { total_tokens: 10 } }));
  }) as unknown as typeof fetch;
  return { f, bodies };
}

test("agent loop executes tools in the worktree and stops at finish", async () => {
  const cwd = mkdtempSync(join(tmpdir(), "gt-agent-"));
  const { f, bodies } = scripted([
    { name: "write_file", args: { path: "src/a.txt", content: "hello world" } },
    { name: "replace_in_file", args: { path: "src/a.txt", old_text: "world", new_text: "tree" } },
    { name: "run_command", args: { command: `node -e "process.stdout.write(require('fs').readFileSync('src/a.txt','utf8'))"` } },
    { name: "finish", args: { summary: "all good" } },
  ]);
  const r = await runApiAgent("api", worker, { prompt: "do it", cwd }, f);
  assert.equal(r.ok, true);
  assert.equal(r.text, "all good");
  assert.equal(readFileSync(join(cwd, "src/a.txt"), "utf8"), "hello tree");
  const toolMsgs = bodies[3]!.messages.filter((m) => m.role === "tool");
  assert.match(toolMsgs[2]!.content!, /exit 0\nhello tree/);
  assert.equal(bodies[0]!.tools.length, 7);
  assert.deepEqual(r.usage, { total_tokens: 40 });
});

test("agent loop enforces maxTurns and plain-text completion", async () => {
  const cwd = mkdtempSync(join(tmpdir(), "gt-agent-"));
  const loop = scripted(Array.from({ length: 10 }, () => ({ name: "list_files", args: {} })));
  const r = await runApiAgent("api", worker, { prompt: "x", cwd }, loop.f);
  assert.equal(r.ok, false);
  assert.match(r.stderr, /maxTurns/);
  const plain = scripted([]);
  const r2 = await runApiAgent("api", worker, { prompt: "x", cwd }, plain.f);
  assert.equal(r2.ok, true);
  assert.equal(r2.text, "done without finish");
});

test("tools cannot escape the worktree or touch .git", async () => {
  const cwd = mkdtempSync(join(tmpdir(), "gt-agent-"));
  writeFileSync(join(cwd, "a.txt"), "x x");
  await assert.rejects(executeTool(cwd, "read_file", { path: "../etc/passwd" }), /not allowed/);
  await assert.rejects(executeTool(cwd, "write_file", { path: ".git/config", content: "" }), /not allowed/);
  assert.match(await executeTool(cwd, "replace_in_file", { path: "a.txt", old_text: "x", new_text: "y" }), /occurs 2 times/);
  assert.match(await executeTool(cwd, "nope", {}), /unknown tool/);
});
