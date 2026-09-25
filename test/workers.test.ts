import assert from "node:assert/strict";
import { test } from "node:test";
import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { parseNdjson, renderArgv, runCliWorker } from "../src/workers/cli.js";
import { runShell } from "../src/exec.js";
import { runOpenAICompatibleWorker } from "../src/workers/openai-compatible.js";
import { CliWorker, OpenAICompatibleWorker } from "../src/schema.js";

test("renderArgv substitutes placeholders without a shell", () => {
  assert.deepEqual(renderArgv(["cmd", "-p", "{prompt}", "-m", "{model}"], { prompt: "a; rm -rf /", model: "m" }), [
    "cmd", "-p", "a; rm -rf /", "-m", "m",
  ]);
  assert.throws(() => renderArgv(["{model}"], { prompt: "x" }), /no value/);
});

test("parseNdjson returns the last result-like event", () => {
  const out = ['{"type":"start"}', "noise", '{"type":"text","text":"partial"}', '{"type":"result","result":"final","usage":{"in":3}}'].join("\n");
  const r = parseNdjson(out);
  assert.equal(r.text, "final");
  assert.deepEqual(r.usage, { in: 3 });
  assert.equal(parseNdjson("plain output").text, "plain output");
});

test("cli worker runs a command and parses ndjson", async () => {
  const w = CliWorker.parse({
    type: "cli",
    command: [process.execPath, "-e", 'console.log(JSON.stringify({type:"result",result:process.argv[1]}))', "{prompt}"],
    output: "ndjson",
  });
  const r = await runCliWorker("fake", w, { prompt: "hello", cwd: tmpdir() });
  assert.equal(r.ok, true);
  assert.equal(r.text, "hello");
});

test("cli worker reports timeouts and missing binaries", async () => {
  const slow = CliWorker.parse({ type: "cli", command: [process.execPath, "-e", "setTimeout(()=>{},60000)"], timeoutSec: 1 });
  const r = await runCliWorker("slow", slow, { prompt: "", cwd: tmpdir() });
  assert.equal(r.ok, false);
  assert.equal(r.timedOut, true);
  const missing = CliWorker.parse({ type: "cli", command: ["definitely-not-a-binary-xyz"] });
  const m = await runCliWorker("missing", missing, { prompt: "", cwd: tmpdir() });
  assert.equal(m.ok, false);
  assert.match(m.stderr, /ENOENT/);
});

test("openai-compatible worker sends auth from env and reads content", async () => {
  process.env.GT_TEST_KEY = "sekret";
  const w = OpenAICompatibleWorker.parse({ type: "openai-compatible", baseUrl: "https://example.test/api/v1/", model: "m", apiKeyEnv: "GT_TEST_KEY" });
  let seen: { url: string; auth: string | null; body: { model: string } } | undefined;
  const fakeFetch = (async (url: string, init: RequestInit) => {
    seen = { url, auth: new Headers(init.headers).get("authorization"), body: JSON.parse(String(init.body)) };
    return new Response(JSON.stringify({ choices: [{ message: { content: "hi" } }], usage: { total_tokens: 5 } }));
  }) as unknown as typeof fetch;
  const r = await runOpenAICompatibleWorker("or", w, { prompt: "p", cwd: "." }, fakeFetch);
  assert.equal(r.ok, true);
  assert.equal(r.text, "hi");
  assert.equal(seen?.url, "https://example.test/api/v1/chat/completions");
  assert.equal(seen?.auth, "Bearer sekret");
  assert.equal(seen?.body.model, "m");
  delete process.env.GT_TEST_KEY;
  const noKey = await runOpenAICompatibleWorker("or", w, { prompt: "p", cwd: "." }, fakeFetch);
  assert.equal(noKey.ok, false);
  assert.match(noKey.stderr, /GT_TEST_KEY/);
});

test("parses real CommandCode v1.65 `-p --output-format json` output (captured on Windows)", async () => {
  const { readFileSync } = await import("node:fs");
  const raw = readFileSync("test/fixtures/commandcode-v1.65-print-json.ndjson", "utf8").replace(/\n/g, "\r\n");
  const r = parseNdjson(raw);
  assert.equal(r.text, "GRAFTREE OK");
  assert.equal(r.ok, true);
  assert.deepEqual(r.usage, { inputTokens: 17962, outputTokens: 5, cacheReadTokens: 8960, cacheWriteTokens: 0 });
  // Without the final result line, the run_end event still yields the answer.
  const noResult = raw.split("\r\n").filter((l) => !l.startsWith('{"type":"result"')).join("\n");
  assert.equal(parseNdjson(noResult).text, "GRAFTREE OK");
});

test("a failed result event marks the worker run as not ok", async () => {
  const r = parseNdjson('{"type":"result","subtype":"error_max_turns","finalText":""}');
  assert.equal(r.ok, false);
  const claude = parseNdjson('{"type":"result","subtype":"success","is_error":false,"result":"done"}');
  assert.equal(claude.text, "done");
  assert.equal(claude.ok, true);
  const w = CliWorker.parse({
    type: "cli",
    command: [process.execPath, "-e", 'console.log(JSON.stringify({type:"result",subtype:"error_during_execution",finalText:"boom"}))'],
    output: "ndjson",
  });
  const res = await runCliWorker("x", w, { prompt: "", cwd: tmpdir() });
  assert.equal(res.exitCode, 0);
  assert.equal(res.ok, false);
  assert.equal(res.text, "boom");
});

test("normalizeUsage understands CommandCode, Claude and OpenAI shapes", async () => {
  const { normalizeUsage } = await import("../src/usage.js");
  assert.deepEqual(normalizeUsage({ inputTokens: 5, outputTokens: 2, cacheReadTokens: 1 }), { inputTokens: 5, outputTokens: 2, cacheReadTokens: 1 });
  // Claude counts cache reads and writes outside input_tokens; graftree's input includes them.
  assert.deepEqual(normalizeUsage({ input_tokens: 5, output_tokens: 2, cache_read_input_tokens: 3 }), { inputTokens: 8, outputTokens: 2, cacheReadTokens: 3 });
  // Shape captured from `claude -p --output-format json` (Claude Code 2.1).
  assert.deepEqual(
    normalizeUsage({ input_tokens: 10, cache_creation_input_tokens: 5124, cache_read_input_tokens: 23422, output_tokens: 46 }),
    { inputTokens: 28556, outputTokens: 46, cacheReadTokens: 23422 },
  );
  assert.deepEqual(normalizeUsage({ prompt_tokens: 5, completion_tokens: 2, prompt_tokens_details: { cached_tokens: 4 } }), { inputTokens: 5, outputTokens: 2, cacheReadTokens: 4 });
  assert.deepEqual(normalizeUsage(undefined), { inputTokens: 0, outputTokens: 0, cacheReadTokens: 0 });
});

/** Whether a process still runs. A zombie still answers signal 0, so on Linux check its state too. */
function alive(pid: number): boolean {
  try {
    process.kill(pid, 0);
  } catch {
    return false;
  }
  try {
    return !/^\d+ \(.*\) Z/.test(readFileSync(`/proc/${pid}/stat`, "utf8"));
  } catch {
    return true;
  }
}

// The grandchild has its own stdio, like a test runner or dev server an agent starts;
// killing only the agent process would leave it running.
test("a timed-out cli worker is stopped together with everything it started", { skip: process.platform === "win32" }, async () => {
  const dir = mkdtempSync(join(tmpdir(), "gt-kill-"));
  const pidFile = join(dir, "grandchild.pid");
  const w = CliWorker.parse({ type: "cli", command: ["sh", "-c", `sleep 30 </dev/null >/dev/null 2>&1 & echo $! > "${pidFile}"; wait`], timeoutSec: 1 });
  const r = await runCliWorker("slow", w, { prompt: "x", cwd: dir });
  assert.equal(r.timedOut, true);
  const pid = Number(readFileSync(pidFile, "utf8"));
  for (let i = 0; i < 20 && alive(pid); i++) await new Promise((res) => setTimeout(res, 100));
  assert.equal(alive(pid), false, "the agent's own child process must not outlive the timeout");
});

test("a timed-out command whose shell already exited, but whose child holds the output open, still ends", { skip: process.platform === "win32" }, async () => {
  const dir = mkdtempSync(join(tmpdir(), "gt-hold-"));
  const started = Date.now();
  const r = await runShell("sleep 30 & echo started", dir, 1);
  assert.equal(r.timedOut, true);
  assert.match(r.output, /started/);
  assert.ok(Date.now() - started < 10_000, `took ${Date.now() - started} ms`);
});
