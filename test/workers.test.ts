import assert from "node:assert/strict";
import { test } from "node:test";
import { tmpdir } from "node:os";
import { parseNdjson, renderArgv, runCliWorker } from "../src/workers/cli.js";
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
