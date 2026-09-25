import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { test } from "node:test";
import { tempRepo } from "./helpers.js";

const CLI = fileURLToPath(new URL("../src/cli.ts", import.meta.url));
const TSX = import.meta.resolve("tsx");

/** Run the CLI as a real process in `cwd`, the way an agent does. */
function gt(cwd: string, ...args: string[]) {
  const env = { ...process.env };
  delete env.NODE_TEST_CONTEXT;
  const r = spawnSync(process.execPath, ["--import", TSX, CLI, ...args], { cwd, env, encoding: "utf8" });
  return { code: r.status, out: r.stdout, err: r.stderr };
}

test("cli: help documents init --force and the exit codes", () => {
  const h = gt(tempRepo(), "--help");
  assert.equal(h.code, 0);
  assert.match(h.out, /init \[--force\]/);
  assert.match(h.out, /Exit codes: 0 ok · 1 error · 2 not accepted/);
});

test("cli: bad input gets a readable error, as text or JSON", () => {
  const repo = tempRepo();
  const tier = gt(repo, "new", "x", "--tier", "bogus");
  assert.equal(tier.code, 1);
  assert.equal(tier.err, 'graftree: invalid --tier "bogus" (use auto, focused, standard, deep)\n');
  const json = gt(repo, "new", "x", "--tier", "bogus", "--json");
  assert.equal(json.code, 1);
  assert.deepEqual(JSON.parse(json.out), { ok: false, error: 'invalid --tier "bogus" (use auto, focused, standard, deep)', code: "invalid" });

  assert.equal(gt(repo, "new", "Some problem").code, 0);
  writeFileSync(join(repo, "plan.json"), "{not json");
  assert.match(gt(repo, "plan", "--file", "plan.json").err, /^graftree: plan\.json is not valid JSON: /);
  assert.match(gt(repo, "retry", "n", "--count", "abc").err, /--count needs a positive whole number, got "abc"/);
  assert.match(gt(repo, "retry", "n", "--count", "0").err, /--count needs a positive whole number/);
});

test("cli: latest is the most recently created run, even within the same minute", () => {
  const repo = tempRepo();
  const ids = ["first problem", "second problem", "third problem"].map((p) => JSON.parse(gt(repo, "new", p, "--json").out).run as string);
  assert.equal(new Set(ids).size, 3);
  const shown = JSON.parse(gt(repo, "show", "--json").out);
  assert.equal(shown.id, ids[2]);
  assert.equal(shown.problem, "third problem");
});

test("cli: large JSON output arrives whole through a pipe", () => {
  const r = gt(tempRepo(), "schema", "run");
  assert.equal(r.code, 0);
  assert.ok(r.out.length > 20_000);
  assert.equal(JSON.parse(r.out).type, "object");
});
