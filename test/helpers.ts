import { execFileSync } from "node:child_process";
import { mkdtempSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import type { PlanInput } from "../src/schema.js";

export function tempRepo(): string {
  const dir = mkdtempSync(join(tmpdir(), "graftree-test-"));
  const g = (...args: string[]) => execFileSync("git", args, { cwd: dir, stdio: "pipe" });
  g("init", "-q", "-b", "main");
  g("config", "user.email", "t@example.com");
  g("config", "user.name", "t");
  write(dir, "src/app.ts", "export const x = 1;\n");
  g("add", ".");
  g("commit", "-q", "-m", "init");
  return dir;
}

export function write(root: string, rel: string, content: string): void {
  const p = join(root, rel);
  mkdirSync(dirname(p), { recursive: true });
  writeFileSync(p, content);
}

export function gitOut(cwd: string, ...args: string[]): string {
  return execFileSync("git", args, { cwd, encoding: "utf8" }).trim();
}

/** A valid two-leaf plan used across tests. */
export function samplePlan(): PlanInput {
  return {
    tier: "standard",
    summary: "Parser + evaluator",
    rationale: "Parser and evaluator meet only at the AST type.",
    nodes: [
      {
        id: "root",
        parent: null,
        kind: "split",
        goal: "Expression calculator",
        ownedPaths: ["src/**"],
        sharedPaths: ["src/index.ts"],
        acceptance: { files: ["test/e2e.test.ts"], command: "node --test test/e2e.test.ts" },
      },
      {
        id: "parser",
        parent: "root",
        kind: "leaf",
        goal: "Parse text to AST",
        contract: { exposes: ["parse(src: string): Ast"] },
        ownedPaths: ["src/parser/**"],
        acceptance: { files: ["test/parser.test.ts"], command: "node --test test/parser.test.ts" },
      },
      {
        id: "eval",
        parent: "root",
        kind: "leaf",
        goal: "Evaluate AST",
        contract: { consumes: ["Ast"] },
        ownedPaths: ["src/eval/**"],
        dependsOn: ["parser"],
        acceptance: { files: ["test/eval.test.ts"], command: "node --test test/eval.test.ts" },
      },
    ],
  };
}
