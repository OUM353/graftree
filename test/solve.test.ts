import assert from "node:assert/strict";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";
import { closeRun } from "../src/close.js";
import { addExternalAttempt, decide, retry, runTree } from "../src/solve.js";
import { approvedRun, calcPlan, focusedPlan } from "./fixtures.js";
import { gitOut } from "./helpers.js";

test("full tree: gates, closer decisions, integration, close", async () => {
  const { root, store, runId } = await approvedRun(calcPlan(), {
    solver: ["good", "bad", "cheat", "sprawl"],
    reviewer: ["review"],
    extra: "budgets:\n  attemptsPerLeaf: 4\n  maxRepairRounds: 0",
  });
  const headBefore = gitOut(root, "rev-parse", "HEAD");

  const s1 = await runTree(store, runId);
  assert.equal(s1.status, "awaiting_closer");
  assert.deepEqual(s1.decisions.map((d) => d.node).sort(), ["eval", "parser"]);
  const run1 = await store.loadRun(runId);
  const statuses = run1.nodes.parser!.attempts.map((a) => `${a.worker}:${a.status}`);
  assert.deepEqual(statuses, ["good:passed", "bad:failed", "cheat:disqualified", "sprawl:disqualified"]);
  const cheat = run1.nodes.parser!.attempts[2]!;
  assert.deepEqual(cheat.gates!.locked.violations, ["modified: test/parser.test.mjs"]);
  assert.deepEqual(run1.nodes.parser!.attempts[3]!.gates!.ownership.violations, ["src/unrelated.mjs"]);
  assert.equal(run1.nodes.parser!.recommended, 1);
  assert.equal(run1.nodes.parser!.attempts[0]!.reviewVerdict, "pass");

  await assert.rejects(decide(store, runId, "parser", 2), /did not pass/);
  await decide(store, runId, "parser", 1, "clean and minimal");
  await decide(store, runId, "eval", 1);

  const s2 = await runTree(store, runId);
  assert.equal(s2.status, "awaiting_closer");
  const run2 = await store.loadRun(runId);
  assert.equal(run2.nodes.root!.attempts[0]!.worker, "merge");
  assert.equal(run2.nodes.root!.attempts[0]!.status, "passed");
  await decide(store, runId, "root", 1);
  assert.equal((await store.loadRun(runId)).status, "ready_to_close");

  const closed = await closeRun(store, runId);
  assert.equal(closed.ok, true);
  assert.equal(closed.run.status, "done");
  const final = closed.run.final!;
  assert.equal(gitOut(root, "rev-parse", final.branch), final.commit);
  assert.match(gitOut(root, "show", `${final.branch}:src/parser/index.mjs`), /split/);
  assert.match(gitOut(root, "show", `${final.branch}:test/e2e.test.mjs`), /40\+2/);
  assert.match(readFileSync(closed.report, "utf8"), /a1 ★ \| good \| passed/);
  // User's branch untouched; worktrees cleaned up.
  assert.equal(gitOut(root, "rev-parse", "HEAD"), headBefore);
  assert.equal(gitOut(root, "worktree", "list").split("\n").length, 1);
  assert.equal(existsSync(join(store.runDir(runId), "wt")), false);
});

test("repair loop turns a near-miss into a pass; autoSelect finishes headless", async () => {
  const { store, runId } = await approvedRun(focusedPlan(), { solver: ["fixer"], extra: "budgets:\n  attemptsPerLeaf: 1\n  autoSelect: true" });
  const s = await runTree(store, runId);
  assert.equal(s.status, "ready_to_close");
  const a = (await store.loadRun(runId)).nodes.parser!.attempts[0]!;
  assert.equal(a.status, "passed");
  assert.equal(a.repairs, 1);
  assert.ok(existsSync(join(store.runDir(runId), "nodes/parser/a1/repair1.log")));
  assert.equal((await closeRun(store, runId)).ok, true);
});

test("exhausted repairs escalate; retry adds attempts with the next workers", async () => {
  const { store, runId } = await approvedRun(focusedPlan(), { solver: ["bad", "good"], extra: "budgets:\n  attemptsPerLeaf: 1\n  maxRepairRounds: 1" });
  const s = await runTree(store, runId);
  assert.equal(s.status, "awaiting_closer");
  assert.equal(s.decisions[0]!.status, "escalated");
  assert.match(s.decisions[0]!.awaiting!, /no attempt passed/);
  await retry(store, runId, "parser", 1);
  const s2 = await runTree(store, runId);
  const node = (await store.loadRun(runId)).nodes.parser!;
  assert.deepEqual(node.attempts.map((a) => `${a.worker}:${a.status}`), ["bad:failed", "good:passed"]);
  assert.equal(s2.decisions[0]!.recommended, 2);
});

test("integration glue by the closer: ownership enforced, then accepted", async () => {
  const { store, runId } = await approvedRun(calcPlan({ glue: true }), { solver: ["good"], extra: "budgets:\n  attemptsPerLeaf: 1\n  autoSelect: true" });
  const s = await runTree(store, runId);
  assert.equal(s.status, "awaiting_closer");
  const root = (await store.loadRun(runId)).nodes.root!;
  assert.equal(root.attempts[0]!.status, "failed");
  assert.match(root.awaiting!, /integration needs glue/);
  const wt = root.attempts[0]!.worktree!;

  // Glue that also rewrites a child's file is rejected.
  writeFileSync(join(wt, "src/index.mjs"), "import { parse } from './parser/index.mjs'; import { evaluate } from './eval/index.mjs';\nexport const calc = (s) => evaluate(parse(s));\n");
  writeFileSync(join(wt, "src/parser/index.mjs"), "export const parse = () => ({ op: '+', a: 1, b: 1 });\n");
  const bad = await addExternalAttempt(store, runId, "root", { worktree: wt });
  assert.equal(bad.status, "disqualified");
  assert.deepEqual(bad.gates!.ownership.violations, ["src/parser/index.mjs"]);

  // Proper glue only touches the shared path.
  gitOut(wt, "checkout", "HEAD~1", "--", "src/parser/index.mjs");
  const good = await addExternalAttempt(store, runId, "root", { worktree: wt, notes: "wire calc()" });
  assert.equal(good.status, "passed");
  assert.equal(good.worker, "closer");
  await decide(store, runId, "root", good.n);
  const closed = await closeRun(store, runId);
  assert.equal(closed.ok, true);
});

test("closer-owned solver slots wait for submitted attempts", async () => {
  const { root, store, runId } = await approvedRun(focusedPlan(), { solver: ["closer"], extra: "budgets:\n  attemptsPerLeaf: 1" });
  const s = await runTree(store, runId);
  assert.equal(s.status, "awaiting_closer");
  assert.match(s.decisions[0]!.awaiting!, /closer attempt slot/);
  const run = await store.loadRun(runId);
  const wt = join(root, "..", `${root.split("/").pop()}-closer`);
  gitOut(root, "worktree", "add", "-q", "--detach", wt, run.approval!.baseCommit);
  gitOut(wt, "config", "user.email", "c@x");
  gitOut(wt, "config", "user.name", "c");
  const { mkdirSync } = await import("node:fs");
  mkdirSync(join(wt, "src/parser"), { recursive: true });
  writeFileSync(join(wt, "src/parser/index.mjs"), "export const parse = (s) => { const [a, b] = s.split('+').map(Number); return { op: '+', a, b }; };\n");
  const a = await addExternalAttempt(store, runId, "parser", { worktree: wt });
  assert.equal(a.n, 1);
  assert.equal(a.status, "passed");
});

test("config.ignore keeps agent metadata out of snapshots and the ownership gate", async () => {
  const { store, runId } = await approvedRun(focusedPlan(), {
    solver: ["good"],
    extra: [
      'ignore: [".agent-meta/**"]',
      "budgets:",
      "  attemptsPerLeaf: 1",
      "commands:",
      `  setup: node -e "require('fs').mkdirSync('.agent-meta',{recursive:true});require('fs').writeFileSync('.agent-meta/state.json','x')"`,
    ].join("\n"),
  });
  const s = await runTree(store, runId);
  assert.equal(s.decisions[0]!.candidates[0]!.status, "passed");
});
