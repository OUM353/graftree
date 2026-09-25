import assert from "node:assert/strict";
import { test } from "node:test";
import { closeRun } from "../src/close.js";
import { solverPrompt, plannerPrompt } from "../src/prompts.js";
import { decide, retry, runTree } from "../src/solve.js";
import { approvedRun, dependentPlan } from "./fixtures.js";
import { gitOut } from "./helpers.js";

test("dependsOn: a dependent leaf waits, then starts from its dependencies' winning code", async () => {
  const { root, store, runId } = await approvedRun(dependentPlan(), { solver: ["good"], extra: "budgets:\n  attemptsPerLeaf: 1\n  autoSelect: true" });
  const s = await runTree(store, runId);
  assert.equal(s.status, "ready_to_close");
  const run = await store.loadRun(runId);
  const calc = run.nodes.calc!;
  assert.equal(calc.attempts[0]!.status, "passed");
  // calc's base carries parser's and eval's winners...
  for (const dep of ["parser", "eval"]) {
    const win = run.nodes[dep]!.attempts[0]!.commit!;
    assert.equal(gitOut(root, "merge-base", "--is-ancestor", win, calc.base!), "");
  }
  // ...so its own diff (and the ownership gate) covers only its file.
  assert.deepEqual(gitOut(root, "diff", "--name-only", calc.base!, calc.attempts[0]!.commit!).split("\n"), ["src/index.mjs"]);
  // It started only after both dependencies were done.
  const order = run.history.map((h) => h.event === "auto-selected" ? h.detail : null).filter(Boolean);
  assert.deepEqual(order.indexOf("calc a1") > Math.max(order.indexOf("parser a1"), order.indexOf("eval a1")), true);
  const closed = await closeRun(store, runId);
  assert.equal(closed.ok, true);
  assert.ok(Object.keys(closed.checks).some((k) => k.includes("calc.test")));
});

test("dependsOn: solver prompts say the dependency code is present; the planner is told how dependsOn works", async () => {
  const { store, runId } = await approvedRun(dependentPlan(), { solver: ["good"], extra: "budgets:\n  attemptsPerLeaf: 1" });
  const run = await store.loadRun(runId);
  assert.match(solverPrompt(run, run.nodes.calc!), /Already built and verified[\s\S]*- parser: parse[\s\S]*- eval: eval/);
  assert.doesNotMatch(solverPrompt(run, run.nodes.parser!), /Already built and verified/);
  assert.match(plannerPrompt(run), /starts from their verified code/);
});

test("dependsOn: changing a dependency's winner restarts its dependents", async () => {
  const { store, runId } = await approvedRun(dependentPlan(), { solver: ["good"], extra: "budgets:\n  attemptsPerLeaf: 2\n  autoSelect: true" });
  assert.equal((await runTree(store, runId)).status, "ready_to_close");
  const before = await store.loadRun(runId);
  const other = before.nodes.parser!.winner === 1 ? 2 : 1;
  const run = await decide(store, runId, "parser", other, "switch");
  assert.deepEqual(run.nodes.calc!.attempts, []);
  assert.equal(run.nodes.calc!.base, null);
  assert.equal(run.nodes.eval!.status, "done"); // unrelated siblings keep their winners
  assert.ok(run.history.some((h) => h.event === "reopened" && h.detail === "calc (dependency parser changed)"));
  // The cost of the discarded attempts is kept.
  assert.ok((run.overheadUsage?.calls ?? 0) >= 2);
  const s = await runTree(store, runId);
  assert.equal(s.status, "ready_to_close");
  const after = await store.loadRun(runId);
  const win = after.nodes.parser!.attempts.find((a) => a.n === other)!.commit!;
  assert.equal(gitOut(store.root, "merge-base", "--is-ancestor", win, after.nodes.calc!.base!), "");
});

test("dependsOn: retrying a decided dependency restarts its dependents", async () => {
  const { store, runId } = await approvedRun(dependentPlan(), { solver: ["good"], extra: "budgets:\n  attemptsPerLeaf: 1\n  autoSelect: true" });
  assert.equal((await runTree(store, runId)).status, "ready_to_close");
  const run = await retry(store, runId, "parser", 1);
  assert.deepEqual(run.nodes.calc!.attempts, [], "calc was built on parser's old winner");
  assert.equal(run.nodes.calc!.base, null);
  assert.ok(run.history.some((h) => h.event === "reopened" && h.detail === "calc (dependency parser changed)"));
  assert.equal(run.nodes.eval!.status, "done");
  assert.equal((await runTree(store, runId)).status, "ready_to_close");
  const after = await store.loadRun(runId);
  const win = after.nodes.parser!.attempts.find((a) => a.n === after.nodes.parser!.winner)!.commit!;
  assert.equal(gitOut(store.root, "merge-base", "--is-ancestor", win, after.nodes.calc!.base!), "");
});
