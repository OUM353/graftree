import assert from "node:assert/strict";
import { test } from "node:test";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { approveRun, checkLocked, newRun, planWithWorker, rejectRun, submitPlan } from "../src/lifecycle.js";
import { Store } from "../src/store.js";
import { gitOut, samplePlan, tempRepo, write } from "./helpers.js";

function draftTests(store: Store, runId: string) {
  for (const f of ["test/e2e.test.ts", "test/parser.test.ts", "test/eval.test.ts"]) {
    write(store.testsDir(runId), f, `// acceptance: ${f}\n`);
  }
}

test("plan → approve locks tests in a base commit without touching the working tree", async () => {
  const root = tempRepo();
  const store = new Store(root);
  const headBefore = gitOut(root, "rev-parse", "HEAD");
  const status = () => gitOut(root, "status", "--porcelain").split("\n").filter((l) => !l.includes(".graftree/")).join("\n");
  const statusBefore = status();

  const run = await newRun(store, "Build a calculator", "standard");
  assert.equal(run.status, "draft");

  // Missing drafted tests → validation errors, status unchanged.
  const bad = await submitPlan(store, run, samplePlan());
  assert.equal(bad.plan, null);
  assert.match(bad.errors.join(), /not drafted/);
  assert.equal((await store.loadRun(run.id)).status, "draft");

  draftTests(store, run.id);
  const ok = await submitPlan(store, run, samplePlan());
  assert.deepEqual(ok.errors, []);
  const planned = await store.loadRun(run.id);
  assert.equal(planned.status, "awaiting_approval");
  assert.equal(Object.keys(planned.nodes).length, 3);
  assert.match(readFileSync(store.planMdPath(run.id), "utf8"), /Solver runs: 2 leaves × 3 attempts = \*\*6\*\*/);

  const approved = await approveRun(store, planned, "looks right");
  assert.equal(approved.status, "approved");
  const a = approved.approval!;
  assert.equal(a.locked.length, 3);
  assert.equal(a.headCommit, headBefore);
  assert.equal(gitOut(root, "rev-parse", a.baseRef), a.baseCommit);
  assert.equal(gitOut(root, "show", `${a.baseCommit}:test/parser.test.ts`), "// acceptance: test/parser.test.ts");
  assert.equal(gitOut(root, "show", `${a.baseCommit}:src/app.ts`), "export const x = 1;");

  // User's branch, HEAD and working tree are untouched.
  assert.equal(gitOut(root, "rev-parse", "HEAD"), headBefore);
  assert.equal(status(), statusBefore);
  assert.equal(gitOut(root, "check-ignore", ".graftree/runs/x"), ".graftree/runs/x");

  // Approving twice is refused.
  await assert.rejects(approveRun(store, approved), /cannot approve/);
});

test("checkLocked disqualifies candidates that edit or delete locked tests", async () => {
  const root = tempRepo();
  const store = new Store(root);
  const run = await newRun(store, "calc");
  draftTests(store, run.id);
  await submitPlan(store, run, samplePlan());
  const approved = await approveRun(store, await store.loadRun(run.id));
  const base = approved.approval!.baseCommit;

  const wt = `${root}-wt`;
  gitOut(root, "worktree", "add", "-q", "--detach", wt, base);
  write(wt, "src/parser/index.ts", "export const parse = () => 1;\n");
  gitOut(wt, "add", ".");
  gitOut(wt, "commit", "-q", "-m", "honest candidate");
  const honest = gitOut(wt, "rev-parse", "HEAD");
  assert.deepEqual(await checkLocked(store, approved, honest), []);

  write(wt, "test/parser.test.ts", "// weakened\n");
  gitOut(wt, "rm", "-q", "test/eval.test.ts");
  gitOut(wt, "add", ".");
  gitOut(wt, "commit", "-q", "-m", "cheating candidate");
  const cheat = gitOut(wt, "rev-parse", "HEAD");
  const v = await checkLocked(store, approved, cheat);
  assert.deepEqual(
    v.sort((x, y) => x.path.localeCompare(y.path)),
    [
      { path: "test/eval.test.ts", reason: "deleted" },
      { path: "test/parser.test.ts", reason: "modified" },
    ],
  );
});

test("reject records feedback and allows replanning", async () => {
  const root = tempRepo();
  const store = new Store(root);
  const run = await newRun(store, "calc");
  draftTests(store, run.id);
  await submitPlan(store, run, samplePlan());
  await assert.rejects(rejectRun(store, await store.loadRun(run.id), "  "), /needs --notes/);
  const rejected = await rejectRun(store, await store.loadRun(run.id), "merge parser and eval");
  assert.equal(rejected.status, "needs_replan");
  assert.equal(rejected.feedback[0]!.notes, "merge parser and eval");
  const again = await submitPlan(store, rejected, samplePlan());
  assert.deepEqual(again.errors, []);
  assert.equal((await store.loadRun("latest")).status, "awaiting_approval");
});

test("planWithWorker runs a CLI agent in a throwaway worktree and ingests its plan + tests", async () => {
  const root = tempRepo();
  const store = new Store(root);
  // Fake planner agent: writes .graftree-out/plan.json + tests, and also scribbles in the repo.
  const script = `
    const fs = require("fs"); const path = require("path");
    const plan = ${JSON.stringify(samplePlan())};
    const out = ".graftree-out";
    fs.mkdirSync(out + "/tests/test", { recursive: true });
    fs.writeFileSync(out + "/plan.json", JSON.stringify(plan));
    for (const f of ["e2e", "parser", "eval"]) fs.writeFileSync(out + "/tests/test/" + f + ".test.ts", "// by worker\\n");
    fs.writeFileSync("src/app.ts", "scribble");
    console.log(JSON.stringify({ type: "result", result: "PLAN WRITTEN" }));
  `;
  write(root, ".graftree/config.yaml", [
    "version: 1",
    "workers:",
    "  fake-planner:",
    "    type: cli",
    `    command: [${JSON.stringify(process.execPath)}, -e, ${JSON.stringify(script)}]`,
    "    output: ndjson",
  ].join("\n"));

  const run = await newRun(store, "calc");
  const res = await planWithWorker(store, run, "fake-planner");
  assert.deepEqual(res.errors, []);
  assert.equal(res.worker.text, "PLAN WRITTEN");
  assert.equal(readFileSync(join(store.testsDir(run.id), "test/parser.test.ts"), "utf8"), "// by worker\n");
  assert.equal((await store.loadRun(run.id)).status, "awaiting_approval");
  // The worker's scribble stayed in its worktree; the user's file is intact and the worktree is gone.
  assert.equal(readFileSync(join(root, "src/app.ts"), "utf8"), "export const x = 1;\n");
  assert.equal(gitOut(root, "worktree", "list").split("\n").length, 1);
  assert.ok(existsSync(join(store.runDir(run.id), "planner.log")));
});

test("API workers can plan through the tool loop", async () => {
  const root = tempRepo();
  const store = new Store(root);
  write(root, ".graftree/config.yaml", "version: 1\nworkers:\n  api:\n    type: openai-compatible\n    baseUrl: https://x.test/v1\n    model: m\n");
  const run = await newRun(store, "calc");
  const calls = [
    { name: "write_file", args: { path: ".graftree-out/plan.json", content: JSON.stringify(samplePlan()) } },
    ...["e2e", "parser", "eval"].map((f) => ({ name: "write_file", args: { path: `.graftree-out/tests/test/${f}.test.ts`, content: "// api\n" } })),
    { name: "finish", args: { summary: "PLAN WRITTEN" } },
  ];
  let i = 0;
  const realFetch = globalThis.fetch;
  globalThis.fetch = (async () => {
    const c = calls[i++]!;
    return new Response(JSON.stringify({ choices: [{ message: { content: null, tool_calls: [{ id: `c${i}`, type: "function", function: { name: c.name, arguments: JSON.stringify(c.args) } }] } }] }));
  }) as typeof fetch;
  try {
    const res = await planWithWorker(store, run, "api");
    assert.deepEqual(res.errors, []);
    assert.equal(res.worker.text, "PLAN WRITTEN");
  } finally {
    globalThis.fetch = realFetch;
  }
});

test("a new plan's drafted tests replace the previous plan's", async () => {
  const { mkdtempSync, mkdirSync, writeFileSync, existsSync } = await import("node:fs");
  const { tmpdir } = await import("node:os");
  const { join } = await import("node:path");
  const root = tempRepo();
  const store = new Store(root);
  const run = await newRun(store, "p");
  const draft = (file: string) => {
    const d = mkdtempSync(join(tmpdir(), "gt-draft-"));
    mkdirSync(join(d, file, ".."), { recursive: true });
    writeFileSync(join(d, file), "// t\n");
    return d;
  };
  const plan = (file: string) => ({ tier: "focused", summary: "s", nodes: [{ id: "a", parent: null, kind: "leaf", goal: "g", ownedPaths: ["src/**"], acceptance: { files: [file], command: "true" } }] });
  await submitPlan(store, run, plan("test/old.test.ts"), { testsFrom: draft("test/old.test.ts") });
  await rejectRun(store, await store.loadRun(run.id), "redo");
  const check = await submitPlan(store, await store.loadRun(run.id), plan("test/new.test.ts"), { testsFrom: draft("test/new.test.ts") });
  assert.deepEqual(check.errors, []);
  assert.equal(existsSync(join(store.testsDir(run.id), "test/old.test.ts")), false);
  assert.equal(existsSync(join(store.testsDir(run.id), "test/new.test.ts")), true);
});
