#!/usr/bin/env node
import { existsSync } from "node:fs";
import { copyFile, mkdir, mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { parseArgs } from "node:util";
import { z } from "zod";
import { CONFIG_TEMPLATE_PATH, PACKAGE_ROOT, getWorker, loadConfig } from "./config.js";
import { approveRun, checkLocked, newRun, planWithWorker, rejectRun, submitPlan } from "./lifecycle.js";
import { closeRun } from "./close.js";
import { renderTree, type PlanCheck } from "./plan.js";
import { addExternalAttempt, attemptDiff, decide, removeRunWorktrees, retry, runTree, summarize, type RunSummary } from "./solve.js";
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

Solve phase (after approval)
  run [run] [--auto-select]          Solve leaves, integrate splits; stops when the closer must decide
  diff NODE ATTEMPT [--run R]        Show an attempt's diff against its node base
  decide NODE ATTEMPT [--run R] [--notes "…"]
                                     Closer's selection (only passing attempts)
  retry NODE [--count N] [--run R]   More engine attempts for a leaf
  attempt NODE (--worktree P | --commit REV) [--run R] [--notes "…"]
                                     Submit a closer-made candidate (same gates)
  close [run] [--keep-worktrees]     Final checks, final branch, report.md
  clean [run]                        Remove the run's worktrees (branches are kept)

Checks
  lock-check [run] --commit REV      Verify a candidate commit left locked tests untouched
  worker test NAME ["prompt"]        Smoke-test a configured worker

[run] / --run default to the most recent run ("latest"). ATTEMPT is a number or aN.
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

function attemptNo(s: string): number {
  const n = Number(s.replace(/^a/i, ""));
  if (!Number.isInteger(n) || n < 1) throw new GraftreeError(`invalid attempt "${s}" (use 2 or a2)`, "invalid");
  return n;
}

function humanSummary(sum: RunSummary): string {
  const lines = [`Run ${sum.run}: ${sum.status}`];
  for (const d of sum.decisions) {
    lines.push("", `◆ ${d.node} (${d.status}) — ${d.awaiting ?? ""}`);
    for (const c of d.candidates) {
      const stat = c.diffStat ? ` +${c.diffStat.insertions}/−${c.diffStat.deletions}` : "";
      lines.push(`    a${c.n} ${c.worker.padEnd(18)} ${c.status.padEnd(12)}${c.score !== undefined ? ` score ${c.score}` : ""}${stat}${c.review ? ` review:${c.review}` : ""}${d.recommended === c.n ? "  ← recommended" : ""}`);
    }
  }
  lines.push("", `Next: ${sum.next}`);
  return lines.join("\n");
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
      run: { type: "string" },
      worktree: { type: "string" },
      count: { type: "string" },
      "auto-select": { type: "boolean" },
      "keep-worktrees": { type: "boolean", default: false },
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
        lines.push(
          "",
          renderTree(run.plan, (n) => {
            const s = run.nodes[n.id]!;
            const atts = s.attempts.map((a) => `a${a.n}:${a.status}${a.n === s.winner ? "★" : ""}`).join(" ");
            return `${n.id} [${n.kind}] (${s.status}) ${atts}`;
          }),
        );
        lines.push("", `Plan: ${store.planMdPath(run.id)}`);
      }
      if (run.approval) lines.push(`Approved ${run.approval.approvedAt}; base ${run.approval.baseRef} = ${run.approval.baseCommit.slice(0, 12)}; ${run.approval.locked.length} test file(s) locked`);
      const sum = summarize(run);
      if (sum.decisions.length) lines.push("", humanSummary(sum));
      if (run.final) lines.push(`Final: ${run.final.branch} (${run.final.commit.slice(0, 12)})`);
      print(out, lines.join("\n"), run);
      return 0;
    }

    case "run": {
      const sum = await runTree(store, rest[0], {
        autoSelect: values["auto-select"],
        onEvent: out.json ? undefined : (m) => process.stderr.write(`${m}\n`),
      });
      print(out, humanSummary(sum), sum);
      return 0;
    }

    case "diff": {
      const [node, att] = rest;
      if (!node || !att) throw new GraftreeError("usage: graftree diff NODE ATTEMPT [--run R]", "invalid");
      const diff = await attemptDiff(store, values.run, node, attemptNo(att));
      print(out, diff || "(empty diff)", { node, attempt: attemptNo(att), diff });
      return 0;
    }

    case "decide": {
      const [node, att] = rest;
      if (!node || !att) throw new GraftreeError("usage: graftree decide NODE ATTEMPT [--run R] [--notes …]", "invalid");
      const run = await decide(store, values.run, node, attemptNo(att), values.notes);
      const sum = summarize(run);
      print(out, `${node}: a${attemptNo(att)} selected. Run is ${run.status}.\nNext: ${sum.next}`, { ok: true, ...sum });
      return 0;
    }

    case "retry": {
      const [node] = rest;
      if (!node) throw new GraftreeError("usage: graftree retry NODE [--count N] [--run R]", "invalid");
      const run = await retry(store, values.run, node, values.count ? Number(values.count) : 1);
      print(out, `${node}: ${run.nodes[node]!.targetAttempts} attempts targeted. Next: graftree run ${run.id}`, { ok: true, run: run.id, node, targetAttempts: run.nodes[node]!.targetAttempts });
      return 0;
    }

    case "attempt": {
      const [node] = rest;
      if (!node || (!values.worktree && !values.commit)) throw new GraftreeError("usage: graftree attempt NODE (--worktree PATH | --commit REV) [--run R]", "invalid");
      const a = await addExternalAttempt(store, values.run, node, {
        worktree: values.worktree ? resolve(values.worktree) : undefined,
        commit: values.commit,
        notes: values.notes,
      });
      const g = a.gates;
      const detail = g ? [g.locked, g.ownership].flatMap((x) => x.violations).join("; ") : "";
      print(out, `${node}/a${a.n} (closer): ${a.status}${detail ? ` — ${detail}` : ""}`, { ok: a.status === "passed", attempt: a });
      return a.status === "passed" ? 0 : 4;
    }

    case "close": {
      const res = await closeRun(store, rest[0], { keepWorktrees: values["keep-worktrees"] });
      const lines = Object.entries(res.checks).map(([k, v]) => `  ${v.ok ? "✓" : "✗"} ${k}`);
      print(
        out,
        res.ok
          ? `Closed ${res.run.id}. Result: branch ${res.run.final!.branch}\n${lines.join("\n")}\nReport: ${res.report}`
          : `Final checks FAILED for ${res.run.id}:\n${lines.join("\n")}\nReport: ${res.report}`,
        { ok: res.ok, run: res.run.id, status: res.run.status, final: res.run.final, checks: res.checks, report: res.report },
      );
      return res.ok ? 0 : 5;
    }

    case "clean": {
      const run = await store.loadRun(rest[0]);
      await removeRunWorktrees(store, run);
      print(out, `Removed worktrees for ${run.id} (branches kept).`, { ok: true, run: run.id });
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
      // Smoke tests run in a throwaway directory so an agent with permissions bypassed can't touch the repo.
      const scratch = await mkdtemp(join(tmpdir(), "graftree-worker-test-"));
      const res = await runWorker(rest[1], w, { prompt, cwd: scratch, timeoutSec: 300 }, "complete").finally(() =>
        rm(scratch, { recursive: true, force: true }),
      );
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
