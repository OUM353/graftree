import assert from "node:assert/strict";
import { test } from "node:test";
import { checkPlan, estimateNotice, estimateWork, renderTree } from "../src/plan.js";
import { Config } from "../src/schema.js";
import { samplePlan } from "./helpers.js";

const errorsOf = (mutate: (p: ReturnType<typeof samplePlan>) => void) => {
  const p = samplePlan();
  mutate(p);
  return checkPlan(p).errors.join("\n");
};

test("valid plan passes", () => {
  const r = checkPlan(samplePlan());
  assert.deepEqual(r.errors, []);
  assert.ok(r.plan);
});

test("rejects overlapping sibling ownership", () => {
  assert.match(errorsOf((p) => (p.nodes[2]!.ownedPaths = ["src/parser/extra.ts"])), /may both modify/);
});

test("rejects child outside parent ownership", () => {
  assert.match(errorsOf((p) => (p.nodes[1]!.ownedPaths = ["lib/parser/**"])), /outside parent/);
});

test("rejects a split with one child", () => {
  assert.match(errorsOf((p) => p.nodes.pop()), /at least 2 children/);
});

test("rejects depth beyond tier", () => {
  assert.match(errorsOf((p) => (p.tier = "focused")), /exceeds tier "focused"/);
});

test("rejects multiple roots and unknown parents", () => {
  assert.match(errorsOf((p) => (p.nodes[1]!.parent = null)), /exactly one root/);
  assert.match(errorsOf((p) => (p.nodes[1]!.parent = "nope")), /does not exist/);
});

test("rejects dependsOn cycles and non-siblings", () => {
  assert.match(errorsOf((p) => (p.nodes[1]!.dependsOn = ["eval"])), /cycle/);
  assert.match(errorsOf((p) => (p.nodes[1]!.dependsOn = ["root"])), /not a sibling/);
});

test("requires tests or a rubric (tests-first)", () => {
  assert.match(errorsOf((p) => (p.nodes[1]!.acceptance.files = [])), /tests-first/);
  const p = samplePlan();
  p.nodes[1]!.acceptance.files = [];
  p.nodes[1]!.acceptance.rubric = "Readable error messages";
  const r = checkPlan(p);
  assert.deepEqual(r.errors, []);
  assert.match(r.warnings.join(), /rubric only/);
});

test("rejects acceptance paths escaping the repo", () => {
  assert.match(errorsOf((p) => (p.nodes[1]!.acceptance.files = ["../x.ts"])), /escapes repository/);
});

test("schema errors are reported, not thrown", () => {
  const r = checkPlan({ tier: "huge", nodes: [] });
  assert.equal(r.plan, null);
  assert.match(r.errors[0]!, /does not match schema/);
});

test("renderTree draws the hierarchy", () => {
  const t = renderTree(checkPlan(samplePlan()).plan!, (n) => n.id);
  assert.equal(t, "root\n├─ parser\n└─ eval");
});

test("estimateWork counts worker calls before anything is spent", () => {
  const plan = checkPlan(samplePlan()).plan!; // 1 split, 2 leaves, standard = 3 attempts per leaf
  const cfg = (roles: Record<string, string[]>, budgets = {}) =>
    Config.parse({ version: 1, workers: { w1: { type: "cli", command: ["w1"] }, w2: { type: "cli", command: ["w2"] } }, roles, budgets });

  // Workers solve and review; the closer plans and integrates.
  const e = estimateWork(plan, cfg({ solver: ["w1"], reviewer: ["w2"] }, { maxRepairRounds: 2 }));
  assert.deepEqual(e, { leaves: 2, splits: 1, attemptsPerLeaf: 3, solverRuns: 6, minCalls: 9, maxCalls: 25, closerWorks: true });
  assert.match(estimateNotice(e), /^⚠ Cost: expect 9–25 worker calls \(a single-agent run is 1\), plus the closer's own/);

  // Closer in the solver rotation: only the workers' share is counted; repairAll off caps repairs per node.
  const mixed = estimateWork(plan, cfg({ planner: ["w1"], test_writer: ["w1"], solver: ["w1", "closer"], integrator: ["w1"], reviewer: ["w1"] }, { attemptsPerLeaf: 2, maxRepairRounds: 1, repairAll: false }));
  assert.equal(mixed.solverRuns, 2);
  assert.equal(mixed.minCalls, 2 + 3, "solver runs + one review per node; the split's merge costs no call");
  assert.equal(mixed.maxCalls, 2 + 2 + 1 + 5, "solves + leaf repairs (one budget per leaf) + split repairs + reviews");
  assert.equal(mixed.closerWorks, true);

  // Everything by workers: nothing unmetered, so no closer caveat.
  const all = estimateWork(plan, cfg({ planner: ["w1"], test_writer: ["w1"], solver: ["w1"], integrator: ["w1"], reviewer: ["w1"] }));
  assert.equal(all.closerWorks, false);
  assert.doesNotMatch(estimateNotice(all), /closer/);

  // Only the closer solves: no worker solves, so nothing to repair either.
  const closerOnly = estimateWork(plan, cfg({}));
  assert.deepEqual([closerOnly.solverRuns, closerOnly.minCalls, closerOnly.maxCalls], [0, 0, 0]);
});
