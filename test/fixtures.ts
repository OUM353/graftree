import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { approveRun, newRun, submitPlan } from "../src/lifecycle.js";
import type { PlanInput } from "../src/schema.js";
import { Store } from "../src/store.js";
import { tempRepo, write } from "./helpers.js";

/**
 * A fake coding agent. argv: <behavior> <prompt>. It edits files in its cwd the
 * way a real CLI agent would, so the whole engine can be tested offline.
 */
const FAKE_AGENT = String.raw`
import { writeFileSync, mkdirSync } from "node:fs";
const [behavior, prompt] = process.argv.slice(2);
const w = (p, s) => { mkdirSync(p.split("/").slice(0, -1).join("/") || ".", { recursive: true }); writeFileSync(p, s); };
const node = /Your node: (\S+)/.exec(prompt)?.[1];
const repairing = prompt.includes("REPAIRING");
const good = {
  // A repair pass also marks the parser "hardened", so hardening tests can require it.
  parser: () => w("src/parser/index.mjs", "export const parse = (s) => { const [a, b] = s.split('+').map(Number); return { op: '+', a, b }; };\n" + (repairing ? "parse.hardened = true;\n" : "")),
  eval: () => w("src/eval/index.mjs", "export const evaluate = (t) => t.a + t.b;\n"),
  // Children of a re-decomposed parser.
  lexer: () => w("src/parser/lex/index.mjs", "export const lex = (s) => s.split('+').map(Number);\n"),
  grammar: () => w("src/parser/index.mjs", "export const parse = (s) => { const [a, b] = s.split('+').map(Number); return { op: '+', a, b }; };\n"),
};
const bad = {
  parser: () => w("src/parser/index.mjs", "export const parse = () => ({});\n"),
  eval: () => w("src/eval/index.mjs", "export const evaluate = () => 0;\n"),
};
const USAGE = { inputTokens: 1000, outputTokens: 50 };
if (behavior === "critic") {
  const saw = prompt.includes("SIBLING FINDINGS") ? "saw-siblings" : "no-siblings";
  console.log(JSON.stringify({ type: "result", result: "VERDICT: concerns\nISSUES:\n- [severity medium] huge input overflows (" + saw + ")", usage: USAGE }));
  process.exit(0);
}
if (behavior === "review") { console.log(JSON.stringify({ type: "result", result: "VERDICT: pass\nISSUES: none" })); process.exit(0); }
if (behavior === "good" || (behavior === "fixer" && repairing)) good[node]();
else if (behavior === "bad" || behavior === "fixer") bad[node]();
else if (behavior === "cheat") { bad[node](); w("test/" + node + ".test.mjs", "// no assertions\n"); }
else if (behavior === "sprawl") { good[node](); w("src/unrelated.mjs", "export {};\n"); }
console.log(JSON.stringify({ type: "result", result: behavior + " done on " + node, usage: USAGE }));
`;

const t = (file: string, body: string) => ({ file, body });
export const TESTS = [
  t("test/parser.test.mjs", `import { test } from "node:test"; import assert from "node:assert/strict";
import { parse } from "../src/parser/index.mjs";
test("parse", () => assert.deepEqual(parse("2+3"), { op: "+", a: 2, b: 3 }));\n`),
  t("test/eval.test.mjs", `import { test } from "node:test"; import assert from "node:assert/strict";
import { evaluate } from "../src/eval/index.mjs";
test("eval", () => assert.equal(evaluate({ op: "+", a: 2, b: 3 }), 5));\n`),
  t("test/e2e.test.mjs", `import { test } from "node:test"; import assert from "node:assert/strict";
import { parse } from "../src/parser/index.mjs"; import { evaluate } from "../src/eval/index.mjs";
test("e2e", () => assert.equal(evaluate(parse("40+2")), 42));\n`),
  t("test/calc.test.mjs", `import { test } from "node:test"; import assert from "node:assert/strict";
import { calc } from "../src/index.mjs";
test("calc", () => assert.equal(calc("1+1"), 2));\n`),
];

export function calcPlan(opts: { glue?: boolean } = {}): PlanInput {
  const e2e = opts.glue ? "test/calc.test.mjs" : "test/e2e.test.mjs";
  return {
    tier: "standard",
    summary: "calculator",
    nodes: [
      { id: "root", parent: null, kind: "split", goal: "calculator", ownedPaths: ["src/**"], sharedPaths: opts.glue ? ["src/index.mjs"] : [], acceptance: { files: [e2e], command: `node --test ${e2e}` } },
      { id: "parser", parent: "root", kind: "leaf", goal: "parse", contract: { exposes: ["parse(s): {op,a,b}"] }, ownedPaths: ["src/parser/**"], acceptance: { files: ["test/parser.test.mjs"], command: "node --test test/parser.test.mjs" } },
      { id: "eval", parent: "root", kind: "leaf", goal: "eval", contract: { consumes: ["{op,a,b}"] }, ownedPaths: ["src/eval/**"], acceptance: { files: ["test/eval.test.mjs"], command: "node --test test/eval.test.mjs" } },
    ],
  };
}

export function focusedPlan(): PlanInput {
  return {
    tier: "focused",
    summary: "parser only",
    nodes: [{ id: "parser", parent: null, kind: "leaf", goal: "parse", ownedPaths: ["src/parser/**"], acceptance: { files: ["test/parser.test.mjs"], command: "node --test test/parser.test.mjs" } }],
  };
}

/** Repo + config + approved run, ready for `runTree`. */
export async function approvedRun(plan: PlanInput, config: { solver: string[]; integrator?: string[]; reviewer?: string[]; extra?: string }) {
  const root = tempRepo();
  const agent = `${root}-agent.mjs`;
  writeFileSync(agent, FAKE_AGENT);
  const behaviors = ["good", "bad", "cheat", "sprawl", "fixer", "review", "critic"];
  const workers = behaviors
    .map((b) => `  ${b}:\n    type: cli\n    command: [${JSON.stringify(process.execPath)}, ${JSON.stringify(agent)}, ${b}, "{prompt}"]\n    output: ndjson`)
    .join("\n");
  write(root, ".graftree/config.yaml", [
    "version: 1",
    "workers:",
    workers,
    "roles:",
    `  solver: [${config.solver.join(", ")}]`,
    `  integrator: [${(config.integrator ?? ["closer"]).join(", ")}]`,
    `  reviewer: [${(config.reviewer ?? ["closer"]).join(", ")}]`,
    config.extra ?? "",
  ].join("\n"));
  const store = new Store(root);
  const run = await newRun(store, "Build a calculator");
  for (const f of TESTS) write(store.testsDir(run.id), f.file, f.body);
  const check = await submitPlan(store, run, plan);
  if (!check.plan) throw new Error(check.errors.join("\n"));
  await approveRun(store, await store.loadRun(run.id));
  return { root, store, runId: run.id };
}
