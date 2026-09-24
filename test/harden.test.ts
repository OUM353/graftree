import assert from "node:assert/strict";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { closeRun } from "../src/close.js";
import { decide, harden, runTree } from "../src/solve.js";
import { approvedRun, calcPlan, focusedPlan } from "./fixtures.js";
import { gitOut } from "./helpers.js";

function hardeningTests(file: string, body: string): string {
  const dir = mkdtempSync(join(tmpdir(), "gt-harden-"));
  mkdirSync(join(dir, file, ".."), { recursive: true });
  writeFileSync(join(dir, file), body);
  return dir;
}

const HARDENED = `import { test } from "node:test"; import assert from "node:assert/strict";
import { parse } from "../src/parser/index.mjs";
test("hardened", () => assert.equal(parse.hardened, true));\n`;

test("hardening a leaf: tests are added and locked, attempts re-verify and get repaired", async () => {
  const { root, store, runId } = await approvedRun(focusedPlan(), { solver: ["good"], extra: "budgets:\n  attemptsPerLeaf: 1\n  maxRepairRounds: 1" });
  await runTree(store, runId);
  await decide(store, runId, "parser", 1);
  const before = await store.loadRun(runId);
  assert.equal(before.status, "ready_to_close");
  const oldBase = before.approval!.baseCommit;

  const dir = hardeningTests("test/parser.hardened.test.mjs", HARDENED);
  const cmd = "node --test test/parser.hardened.test.mjs";
  // Additive only: cannot overwrite a locked test or an existing file.
  const clash = hardeningTests("test/parser.test.mjs", "// replaced\n");
  await assert.rejects(harden(store, runId, "parser", { testsFrom: clash, command: cmd, reason: "x" }), /locked acceptance test/);
  await assert.rejects(harden(store, runId, "parser", { testsFrom: dir, command: cmd, reason: " " }), /--reason/);

  const run = await harden(store, runId, "parser", { testsFrom: dir, command: cmd, reason: "reviewer: parse must be hardened" });
  assert.equal(run.status, "solving");
  assert.equal(run.nodes.parser!.winner, null);
  assert.ok(run.approval!.locked.some((l) => l.path === "test/parser.hardened.test.mjs"));
  assert.notEqual(run.approval!.baseCommit, oldBase);
  assert.equal(gitOut(root, "rev-parse", `${run.approval!.baseCommit}^`), oldBase);
  assert.equal(gitOut(root, "rev-parse", run.approval!.baseRef), run.approval!.baseCommit);
  assert.deepEqual(run.nodes.parser!.acceptance.extraCommands, [cmd]);

  // The existing winner fails the new test, then the repair loop fixes it.
  const s = await runTree(store, runId);
  const a1 = (await store.loadRun(runId)).nodes.parser!.attempts[0]!;
  assert.equal(a1.status, "passed");
  assert.equal(a1.repairs, 1);
  assert.equal(s.decisions[0]!.recommended, 1);
  await decide(store, runId, "parser", 1);
  const closed = await closeRun(store, runId);
  assert.equal(closed.ok, true);
  assert.ok(Object.keys(closed.checks).some((k) => k.includes("parser.hardened")));
  const report = readFileSync(closed.report, "utf8");
  assert.match(report, /## Hardening/);
  assert.match(report, /reviewer: parse must be hardened/);
  assert.match(gitOut(root, "show", `${closed.run.final!.branch}:src/parser/index.mjs`), /hardened = true/);
});

test("hardening a split re-integrates on the new base", async () => {
  const { store, runId } = await approvedRun(calcPlan(), { solver: ["good"], extra: "budgets:\n  attemptsPerLeaf: 1\n  autoSelect: true" });
  assert.equal((await runTree(store, runId)).status, "ready_to_close");
  const e2e = `import { test } from "node:test"; import assert from "node:assert/strict";
import { parse } from "../src/parser/index.mjs"; import { evaluate } from "../src/eval/index.mjs";
test("more e2e", () => assert.equal(evaluate(parse("1+1")), 2));\n`;
  const dir = hardeningTests("test/e2e.more.test.mjs", e2e);
  const run = await harden(store, runId, "root", { testsFrom: dir, command: "node --test test/e2e.more.test.mjs", reason: "cover another sum" });
  assert.deepEqual(run.nodes.root!.attempts, []);
  assert.equal(run.nodes.parser!.status, "done");
  const s = await runTree(store, runId);
  assert.equal(s.status, "ready_to_close");
  assert.equal((await closeRun(store, runId)).ok, true);
});

test("reviewers cross-check findings from sibling attempts", async () => {
  const { store, runId } = await approvedRun(focusedPlan(), { solver: ["good"], reviewer: ["critic"], extra: "budgets:\n  attemptsPerLeaf: 2" });
  await runTree(store, runId);
  const run = await store.loadRun(runId);
  const reviews = run.nodes.parser!.attempts.map((a) => readFileSync(join(store.runDir(runId), a.review!), "utf8"));
  // The first review had no siblings to consider; the second had to check the first one's findings.
  assert.equal(reviews.filter((r) => r.includes("no-siblings")).length, 1);
  assert.equal(reviews.filter((r) => r.includes("saw-siblings")).length, 1);
});

test("usage is recorded per attempt and summed for the run", async () => {
  const { store, runId } = await approvedRun(focusedPlan(), { solver: ["good"], reviewer: ["critic"], extra: "budgets:\n  attemptsPerLeaf: 2\n  autoSelect: true" });
  const s = await runTree(store, runId);
  const node = (await store.loadRun(runId)).nodes.parser!;
  // Each attempt: 1 solve + 1 review.
  for (const a of node.attempts) assert.deepEqual({ calls: a.usage!.calls, in: a.usage!.inputTokens, out: a.usage!.outputTokens }, { calls: 2, in: 2000, out: 100 });
  assert.equal(s.usage.calls, 4);
  assert.equal(s.usage.inputTokens, 4000);
  const closed = await closeRun(store, runId);
  assert.match(readFileSync(closed.report, "utf8"), /Total: 4 calls, 4\.0K in \/ 200 out/);
});

test("solver and repair prompts list hardening commands", async () => {
  const { solverPrompt, repairPrompt } = await import("../src/prompts.js");
  const { store, runId } = await approvedRun(focusedPlan(), { solver: ["good"], extra: "budgets:\n  attemptsPerLeaf: 1" });
  const dir = hardeningTests("test/parser.hardened.test.mjs", HARDENED);
  const run = await harden(store, runId, "parser", { testsFrom: dir, command: "node --test test/parser.hardened.test.mjs", reason: "r" });
  for (const p of [solverPrompt(run, run.nodes.parser!), repairPrompt(run, run.nodes.parser!, "fail")]) {
    assert.match(p, /node --test test\/parser\.test\.mjs/);
    assert.match(p, /node --test test\/parser\.hardened\.test\.mjs/);
    assert.match(p, /test\/parser\.hardened\.test\.mjs/);
  }
});

test("a repair invalidates the attempt's earlier review, so the new code is reviewed", async () => {
  const { store, runId } = await approvedRun(focusedPlan(), { solver: ["good"], reviewer: ["review"], extra: "budgets:\n  attemptsPerLeaf: 1" });
  await runTree(store, runId);
  const firstReview = (await store.loadRun(runId)).nodes.parser!.attempts[0]!.usage!.calls;
  assert.equal(firstReview, 2); // solve + review
  const dir = hardeningTests("test/parser.hardened.test.mjs", HARDENED);
  await harden(store, runId, "parser", { testsFrom: dir, command: "node --test test/parser.hardened.test.mjs", reason: "r" });
  await runTree(store, runId);
  const a = (await store.loadRun(runId)).nodes.parser!.attempts[0]!;
  assert.equal(a.repairs, 1);
  assert.equal(a.reviewVerdict, "pass");
  assert.equal(a.usage!.calls, 4); // + repair + fresh review
});
