import assert from "node:assert/strict";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { closeRun } from "../src/close.js";
import { approveRun } from "../src/lifecycle.js";
import { approveRedecomposition, proposeRedecomposition, rejectRedecomposition } from "../src/redecompose.js";
import type { SubtreeInput } from "../src/schema.js";
import { decide, runTree } from "../src/solve.js";
import { runUsage } from "../src/usage.js";
import { approvedRun, focusedPlan } from "./fixtures.js";
import { gitOut } from "./helpers.js";

const LEX_TEST = `import { test } from "node:test"; import assert from "node:assert/strict";
import { lex } from "../src/parser/lex/index.mjs";
test("lex", () => assert.deepEqual(lex("2+3"), [2, 3]));\n`;
const GRAMMAR_TEST = `import { test } from "node:test"; import assert from "node:assert/strict";
import { parse } from "../src/parser/index.mjs";
test("grammar", () => assert.equal(parse("1+2").op, "+"));\n`;

function newTests(files: Record<string, string>): string {
  const dir = mkdtempSync(join(tmpdir(), "gt-redecomp-"));
  for (const [f, body] of Object.entries(files)) {
    mkdirSync(join(dir, f, ".."), { recursive: true });
    writeFileSync(join(dir, f), body);
  }
  return dir;
}

const subtree = (): SubtreeInput => ({
  rationale: "Lexing and grammar fail for different reasons; solve them separately.",
  nodes: [
    { id: "lexer", parent: "parser", kind: "leaf", goal: "split 'a+b' into numbers", contract: { exposes: ["lex(s): number[]"] }, ownedPaths: ["src/parser/lex/**"], acceptance: { files: ["test/lex.test.mjs"], command: "node --test test/lex.test.mjs" } },
    { id: "grammar", parent: "parser", kind: "leaf", goal: "build the AST from lex()", ownedPaths: ["src/parser/index.mjs"], acceptance: { files: ["test/grammar.test.mjs"], command: "node --test test/grammar.test.mjs" } },
  ],
});

/** A focused run whose only leaf escalated: every attempt failed and repairs are off. */
async function escalatedRun(extra = "") {
  const r = await approvedRun(focusedPlan(), { solver: ["bad"], extra: `budgets:\n  attemptsPerLeaf: 1\n  maxRepairRounds: 0\n  autoSelect: true${extra}` });
  const s = await runTree(r.store, r.runId);
  assert.equal(s.decisions[0]!.status, "escalated");
  assert.match(s.decisions[0]!.awaiting!, /graftree redecompose/);
  // From here on the solvers can do the smaller pieces.
  const cfg = join(r.root, ".graftree/config.yaml");
  writeFileSync(cfg, readFileSync(cfg, "utf8").replace("solver: [bad]", "solver: [good]"));
  return r;
}

test("an escalated leaf is split into a subtree, approved, solved and closed", async () => {
  const { root, store, runId } = await escalatedRun();
  const before = await store.loadRun(runId);
  const tests = newTests({ "test/lex.test.mjs": LEX_TEST, "test/grammar.test.mjs": GRAMMAR_TEST });

  const res = await proposeRedecomposition(store, runId, "parser", { subtree: subtree(), testsFrom: tests, reason: "one-piece attempts keep failing" });
  assert.deepEqual(res.errors, []);
  assert.match(res.warnings[0]!, /tier raised from "focused" to "standard"/);
  let run = await store.loadRun(runId);
  assert.equal(run.status, "awaiting_approval");
  assert.equal(run.nodes.parser!.kind, "leaf"); // nothing changes before approval
  assert.match(readFileSync(store.planMdPath(runId), "utf8"), /Proposed re-decomposition of `parser`/);
  // The tree is frozen while the human decides.
  await assert.rejects(runTree(store, runId), /awaiting approval/);
  await assert.rejects(decide(store, runId, "parser", 1), /awaiting approval/);
  await assert.rejects(approveRun(store, run), /pending/);

  run = await approveRedecomposition(store, runId, "ok");
  assert.equal(run.status, "solving");
  assert.equal(run.plan!.tier, "standard");
  assert.equal(run.nodes.parser!.kind, "split");
  assert.deepEqual(run.nodes.parser!.attempts, []);
  assert.deepEqual(run.redecompositions.map((r) => [r.node, r.nodes]), [["parser", ["lexer", "grammar"]]]);
  // New tests are locked on top of the old base; the original test stays locked.
  const locked = run.approval!.locked.map((l) => l.path);
  for (const f of ["test/parser.test.mjs", "test/lex.test.mjs", "test/grammar.test.mjs"]) assert.ok(locked.includes(f), f);
  assert.equal(gitOut(root, "rev-parse", `${run.approval!.baseCommit}^`), before.approval!.baseCommit);
  // The retired attempt's cost is still counted.
  assert.equal(runUsage(run).calls, runUsage(before).calls);

  const s = await runTree(store, runId);
  assert.equal(s.status, "ready_to_close");
  run = await store.loadRun(runId);
  assert.deepEqual(["lexer", "grammar", "parser"].map((id) => run.nodes[id]!.status), ["done", "done", "done"]);
  const closed = await closeRun(store, runId);
  assert.equal(closed.ok, true);
  for (const f of ["parser.test", "lex.test", "grammar.test"]) assert.ok(Object.keys(closed.checks).some((k) => k.includes(f)), f);
  // The final branch carries both children's work.
  for (const f of ["src/parser/index.mjs", "src/parser/lex/index.mjs"]) assert.ok(gitOut(root, "show", `${closed.run.final!.branch}:${f}`), f);
});

test("re-decomposition is validated, budgeted, and can be rejected", async () => {
  const { store, runId } = await escalatedRun();
  const tests = newTests({ "test/lex.test.mjs": LEX_TEST, "test/grammar.test.mjs": GRAMMAR_TEST });

  // Additive only: a new test may not replace a locked one.
  const clash = newTests({ "test/parser.test.mjs": "// replaced\n" });
  await assert.rejects(proposeRedecomposition(store, runId, "parser", { subtree: subtree(), testsFrom: clash, reason: "r" }), /locked acceptance test/);
  // Children must stay inside the node's ownership, and their tests must exist.
  const outside = subtree();
  outside.nodes[0]!.ownedPaths = ["src/other/**"];
  const bad = await proposeRedecomposition(store, runId, "parser", { subtree: outside, testsFrom: tests, reason: "r" });
  assert.ok(bad.errors.some((e) => /outside parent parser/.test(e)));
  const elsewhere = subtree();
  elsewhere.nodes.push({ ...elsewhere.nodes[0]!, id: "rogue", parent: null });
  assert.ok((await proposeRedecomposition(store, runId, "parser", { subtree: elsewhere, testsFrom: tests, reason: "r" })).errors.some((e) => /rogue: parent must be "parser"/.test(e)));
  await assert.rejects(proposeRedecomposition(store, runId, "parser", { subtree: subtree(), testsFrom: join(tests, "missing"), reason: "r" }), /tests dir not found/);
  const untested = await proposeRedecomposition(store, runId, "parser", { subtree: subtree(), reason: "r" });
  assert.ok(untested.errors.some((e) => /not drafted: tests\/test\/lex\.test\.mjs/.test(e)));
  assert.equal((await store.loadRun(runId)).status, "awaiting_closer");

  // Rejecting drops the proposal and resumes where the run was.
  await proposeRedecomposition(store, runId, "parser", { subtree: subtree(), testsFrom: tests, reason: "r" });
  let run = await rejectRedecomposition(store, runId, "split by operator instead");
  assert.equal(run.status, "awaiting_closer");
  assert.equal(run.pendingRedecomposition, null);
  assert.equal(run.nodes.lexer, undefined);
  assert.ok(!existsSync(join(store.runDir(runId), "redecompose")));

  // Budget: maxRedecompositions (default 1) per leaf.
  await proposeRedecomposition(store, runId, "parser", { subtree: subtree(), testsFrom: tests, reason: "r" });
  run = await approveRedecomposition(store, runId);
  await assert.rejects(proposeRedecomposition(store, runId, "parser", { subtree: subtree(), reason: "r" }), /already a split/);
  const again = { ...subtree(), nodes: subtree().nodes.map((n) => ({ ...n, id: `${n.id}2`, parent: "lexer", ownedPaths: [`src/parser/lex/${n.id}/**`] })) };
  run.nodes.lexer!.status = "escalated";
  await store.saveRun(run);
  const cfg = join(store.root, ".graftree/config.yaml");
  writeFileSync(cfg, readFileSync(cfg, "utf8").replace("autoSelect: true", "autoSelect: true\n  maxRedecompositions: 0"));
  await assert.rejects(proposeRedecomposition(store, runId, "lexer", { subtree: again, reason: "r" }), /maxRedecompositions = 0/);
});
