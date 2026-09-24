import assert from "node:assert/strict";
import { test } from "node:test";
import { checkPlan, renderTree } from "../src/plan.js";
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
