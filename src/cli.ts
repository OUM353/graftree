#!/usr/bin/env node
import { existsSync } from "node:fs";
import { copyFile, mkdir, readFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { parseArgs } from "node:util";
import { z } from "zod";
import { CONFIG_TEMPLATE_PATH, PACKAGE_ROOT, getWorker, loadConfig } from "./config.js";
import { approveRun, checkLocked, newRun, planWithWorker, rejectRun, submitPlan } from "./lifecycle.js";
import { renderTree, type PlanCheck } from "./plan.js";
import { Config, Plan, Run, Tier } from "./schema.js";
import { Store } from "./store.js";
import { GraftreeError } from "./util.js";
import { runWorker } from "./workers/index.js";

const HELP = `graftree — tree-structured, test-first, multi-model coding agent engine

Usage: graftree <command> [options]      (add --json for machine-readable output)

Setup
  init                               Create .graftree/config.yaml in this repo
  schema [plan|run|config]           Print a JSON Schema

Plan phase (nothing is spent on solving before approval)
  new "<problem>" [--tier T]         Start a run (T: auto|focused|standard|deep)
  plan [run] --file plan.json [--tests DIR]
                                     Submit a closer-authored plan (+ drafted tests)
  plan [run] --worker NAME           Let a CLI agent worker plan + draft tests
  show [run]                         Show plan/tree status (plan.md path)
  list                               List runs
  approve [run] [--notes "…"]        Human gate: lock tests, create base commit
  reject  [run] --notes "…"          Send the plan back for replanning

Checks
  lock-check [run] --commit REV      Verify a candidate commit left locked tests untouched
  worker test NAME ["prompt"]        Smoke-test a configured worker

[run] defaults to the most recent run ("latest").
`;

type Out = { json: boolean };

function print(out: Out, human: string, data: unknown): void {
  if (out.json) process.stdout.write(`${JSON.stringify(data, null, 2)}\n`);
  else process.stdout.write(`${human}\n`);
}

function reportPlanCheck(out: Out, run: Run, check: PlanCheck, store: Store, extra: Record<string, unknown> = {}): number {
  if (!check.plan) {
    print(out, `Plan rejected by validation:\n${check.errors.map((e) => `  ✗ ${e}`).join("\n")}`, {
      ok: false,
      run: run.id,
      errors: check.errors,
      warnings: check.warnings,
      ...extra,
    });
    return 2;
  }
  const warn = check.warnings.length ? `\nWarnings:\n${check.warnings.map((w) => `  ! ${w}`).join("\n")}` : "";
  print(
    out,
    `Plan accepted for ${run.id} — status: awaiting_approval\n\n${renderTree(check.plan)}${warn}\n\nReview: ${store.planMdPath(run.id)}\nThen:  graftree approve ${run.id}   or   graftree reject ${run.id} --notes "…"`,
    { ok: true, run: run.id, status: "awaiting_approval", planMd: store.planMdPath(run.id), warnings: check.warnings, ...extra },
  );
  return 0;
}

async function main(argv: string[]): Promise<number> {
  const { values, positionals } = parseArgs({
    args: argv,
    allowPositionals: true,
    options: {
      json: { type: "boolean", default: false },
      tier: { type: "string" },
      file: { type: "string" },
      tests: { type: "string" },
      worker: { type: "string" },
      notes: { type: "string" },
      commit: { type: "string" },
      force: { type: "boolean", default: false },
      help: { type: "boolean", short: "h", default: false },
      version: { type: "boolean", short: "v", default: false },
    },
  });
  const out: Out = { json: values.json! };
  const [cmd, ...rest] = positionals;

  if (values.version) {
    const pkg = JSON.parse(await readFile(join(PACKAGE_ROOT, "package.json"), "utf8")) as { version: string };
    print(out, pkg.version, { version: pkg.version });
    return 0;
  }
  if (!cmd || values.help || cmd === "help") {
    process.stdout.write(HELP);
    return 0;
  }

  if (cmd === "schema") {
    const which = rest[0] ?? "plan";
    const schemas = { plan: Plan, run: Run, config: Config } as const;
    const s = schemas[which as keyof typeof schemas];
    if (!s) throw new GraftreeError(`unknown schema "${which}" (plan|run|config)`, "invalid");
    process.stdout.write(`${JSON.stringify(z.toJSONSchema(s, { io: "input" }), null, 2)}\n`);
    return 0;
  }

  const store = await Store.open();

  switch (cmd) {
    case "init": {
      await mkdir(store.dir, { recursive: true });
      const created: string[] = [];
      if (!existsSync(store.configPath) || values.force) {
        await copyFile(CONFIG_TEMPLATE_PATH, store.configPath);
        created.push(store.configPath);
      }
      const gi = join(store.dir, ".gitignore");
      if (!existsSync(gi)) {
        await store.ensureGitignore();
        created.push(gi);
      }
      await loadConfig(store.configPath);
      print(out, created.length ? `Created:\n${created.map((c) => `  ${c}`).join("\n")}` : "Already initialized (use --force to reset config).", {
        ok: true,
        created,
        config: store.configPath,
      });
      return 0;
    }

    case "new": {
      const problem = rest.join(" ");
      const tier = values.tier ? z.union([Tier, z.literal("auto")]).parse(values.tier) : "auto";
      const run = await newRun(store, problem, tier);
      print(
        out,
        `Created run ${run.id} (tier: ${tier})\nDraft acceptance tests under: ${store.testsDir(run.id)}/<repo-relative path>\nThen submit:  graftree plan ${run.id} --file plan.json   (or --worker NAME)`,
        { ok: true, run: run.id, status: run.status, testsDir: store.testsDir(run.id), runDir: store.runDir(run.id) },
      );
      return 0;
    }

    case "plan": {
      const run = await store.loadRun(rest[0]);
      if (values.worker && values.file) throw new GraftreeError("use either --file or --worker, not both", "invalid");
      if (values.worker) {
        const res = await planWithWorker(store, run, values.worker);
        const extra = {
          worker: { name: res.worker.worker, ok: res.worker.ok, exitCode: res.worker.exitCode, timedOut: res.worker.timedOut, durationMs: res.worker.durationMs },
        };
        return reportPlanCheck(out, run, res, store, extra);
      }
      if (!values.file) throw new GraftreeError("plan needs --file plan.json or --worker NAME", "invalid");
      const planJson = JSON.parse(await readFile(resolve(values.file), "utf8")) as unknown;
      const check = await submitPlan(store, run, planJson, { testsFrom: values.tests ? resolve(values.tests) : undefined });
      return reportPlanCheck(out, run, check, store);
    }

    case "show": {
      const run = await store.loadRun(rest[0]);
      const lines = [`Run ${run.id} — ${run.status}`, `Problem: ${run.problem}`];
      if (run.plan) {
        lines.push("", renderTree(run.plan, (n) => `${n.id} [${n.kind}] (${run.nodes[n.id]?.status ?? "?"}) ${n.goal}`));
        lines.push("", `Plan: ${store.planMdPath(run.id)}`);
      }
      if (run.approval) lines.push(`Approved ${run.approval.approvedAt}; base ${run.approval.baseRef} = ${run.approval.baseCommit.slice(0, 12)}; ${run.approval.locked.length} test file(s) locked`);
      print(out, lines.join("\n"), run);
      return 0;
    }

    case "list": {
      const runs = await Promise.all((await store.listRunIds()).map((id) => store.loadRun(id)));
      const rows = runs.map((r) => ({ id: r.id, status: r.status, tier: r.plan?.tier ?? r.requestedTier, problem: r.problem.slice(0, 70) }));
      print(out, rows.length ? rows.map((r) => `${r.id}  ${r.status.padEnd(18)} ${String(r.tier).padEnd(9)} ${r.problem}`).join("\n") : "No runs.", rows);
      return 0;
    }

    case "approve": {
      const run = await approveRun(store, await store.loadRun(rest[0]), values.notes);
      const a = run.approval!;
      print(out, `Approved ${run.id}. Locked ${a.locked.length} test file(s). Base: ${a.baseRef} (${a.baseCommit.slice(0, 12)})`, {
        ok: true,
        run: run.id,
        status: run.status,
        approval: a,
      });
      return 0;
    }

    case "reject": {
      const run = await rejectRun(store, await store.loadRun(rest[0]), values.notes ?? "");
      print(out, `Rejected ${run.id}; status needs_replan. Feedback will be given to the planner.`, { ok: true, run: run.id, status: run.status });
      return 0;
    }

    case "lock-check": {
      if (!values.commit) throw new GraftreeError("lock-check needs --commit REV", "invalid");
      const run = await store.loadRun(rest[0]);
      const violations = await checkLocked(store, run, values.commit);
      print(
        out,
        violations.length ? `DISQUALIFIED — locked tests changed:\n${violations.map((v) => `  ${v.reason}: ${v.path}`).join("\n")}` : "OK — locked tests untouched.",
        { ok: violations.length === 0, violations },
      );
      return violations.length ? 3 : 0;
    }

    case "worker": {
      if (rest[0] !== "test" || !rest[1]) throw new GraftreeError('usage: graftree worker test NAME ["prompt"]', "invalid");
      const cfg = await loadConfig(store.configPath);
      const w = getWorker(cfg, rest[1]);
      const prompt = rest[2] ?? "Reply with exactly: GRAFTREE OK";
      const res = await runWorker(rest[1], w, { prompt, cwd: store.root, timeoutSec: 300 });
      print(
        out,
        `${res.ok ? "✓" : "✗"} ${res.worker} (exit ${res.exitCode}${res.timedOut ? ", timed out" : ""}, ${res.durationMs} ms)\n${res.text || res.stderr}`,
        { ok: res.ok, exitCode: res.exitCode, timedOut: res.timedOut, durationMs: res.durationMs, text: res.text, stderr: res.stderr, usage: res.usage },
      );
      return res.ok ? 0 : 1;
    }

    default:
      throw new GraftreeError(`unknown command "${cmd}" (see graftree --help)`, "invalid");
  }
}

main(process.argv.slice(2)).then(
  (code) => process.exit(code),
  (e: unknown) => {
    const json = process.argv.includes("--json");
    const err = e instanceof GraftreeError ? e : new GraftreeError((e as Error).message ?? String(e), "internal");
    if (json) process.stdout.write(`${JSON.stringify({ ok: false, error: err.message, code: err.code })}\n`);
    else process.stderr.write(`graftree: ${err.message}\n`);
    process.exit(1);
  },
);
