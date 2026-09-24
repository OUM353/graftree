import { join, relative } from "node:path";
import { loadConfig } from "./config.js";
import { runShell, writeLog } from "./exec.js";
import { addDetachedWorktree, diffStat, git, removeWorktree } from "./git.js";
import { renderTree } from "./plan.js";
import type { CheckResult, Config, Run } from "./schema.js";
import { removeRunWorktrees } from "./solve.js";
import { logEvent, type Store } from "./store.js";
import { formatUsage, recordedWarnings, runUsage, sumUsage } from "./usage.js";
import { GraftreeError, now, writeFileAtomic } from "./util.js";

export interface CloseResult {
  run: Run;
  ok: boolean;
  checks: Record<string, CheckResult>;
  report: string;
}

/**
 * Final verification at the root: every node's acceptance command plus the
 * repo-wide test/build/lint commands, on the root winner. On success the
 * result lands on branch graftree/<run>/final and the run is done.
 */
export async function closeRun(store: Store, runId: string | undefined, opts: { keepWorktrees?: boolean } = {}): Promise<CloseResult> {
  const run = await store.loadRun(runId);
  if (run.status !== "ready_to_close") {
    throw new GraftreeError(`run ${run.id} is "${run.status}"; close needs "ready_to_close" (every node decided)`, "bad_status");
  }
  const cfg = await loadConfig(store.configPath);
  const root = Object.values(run.nodes).find((n) => n.parent === null)!;
  const win = root.attempts.find((a) => a.n === root.winner)!;
  const commit = win.commit!;

  const wt = join(store.runDir(run.id), "wt", "_final");
  await removeWorktree(store.root, wt);
  await addDetachedWorktree(store.root, wt, commit);
  const checks: Record<string, CheckResult> = {};
  const check = async (name: string, cmd: string) => {
    const r = await runShell(cmd, wt, cfg.commands.timeoutSec);
    const log = join(store.runDir(run.id), "final", `${name.replace(/[^a-z0-9._-]/gi, "_")}.log`);
    await writeLog(log, `$ ${cmd}\n${r.output}\n[exit ${r.exitCode}${r.timedOut ? ", timed out" : ""}]\n`);
    checks[name] = { ok: r.exitCode === 0, exitCode: r.exitCode, log: relative(store.runDir(run.id), log), violations: [] };
  };
  try {
    if (cfg.commands.setup) await check("setup", cfg.commands.setup);
    if (cfg.commands.build) await check("build", cfg.commands.build);
    const cmds = new Set(Object.values(run.nodes).flatMap((n) => [n.acceptance.command, ...n.acceptance.extraCommands]));
    for (const cmd of cmds) await check(`acceptance: ${cmd}`, cmd);
    if (cfg.commands.test) await check("test", cfg.commands.test);
    if (cfg.commands.lint) await check("lint", cfg.commands.lint);
  } finally {
    await removeWorktree(store.root, wt);
  }

  const ok = Object.values(checks).every((c) => c.ok);
  const branch = `graftree/${run.id}/final`;
  if (ok) {
    await git(store.root, ["branch", "-f", branch, commit]);
    run.final = { branch, commit, closedAt: now(), checks };
    run.status = "done";
    logEvent(run, "closed", `${branch} = ${commit.slice(0, 12)}`);
    if (!opts.keepWorktrees) await removeRunWorktrees(store, run);
  } else {
    run.status = "awaiting_closer";
    root.status = "awaiting_closer";
    root.awaiting = `final checks failed: ${Object.entries(checks).filter(([, c]) => !c.ok).map(([k]) => k).join(", ")}; see final/*.log`;
    logEvent(run, "close-failed", root.awaiting);
  }
  await store.saveRun(run);
  const report = await renderReport(store, run, cfg, checks, commit);
  await writeFileAtomic(join(store.runDir(run.id), "report.md"), report);
  return { run, ok, checks, report: join(store.runDir(run.id), "report.md") };
}

async function renderReport(store: Store, run: Run, cfg: Config, checks: Record<string, CheckResult>, commit: string): Promise<string> {
  const plan = run.plan!;
  const md: string[] = [];
  const stat = await diffStat(store.root, run.approval!.headCommit, commit);
  md.push(`# graftree report — ${run.id}`, "");
  md.push(`**Status:** ${run.status}  `);
  if (run.final) md.push(`**Result:** branch \`${run.final.branch}\` (${run.final.commit.slice(0, 12)}): ${stat.files} files, +${stat.insertions} −${stat.deletions} vs. your HEAD at approval  `);
  md.push(`**Tier:** ${plan.tier}`, "");
  md.push("## Problem", "", run.problem, "");
  md.push("## Tree", "", "```", renderTree(plan, (n) => {
    const s = run.nodes[n.id]!;
    const w = s.attempts.find((a) => a.n === s.winner);
    return `${n.id} [${n.kind}] → ${w ? `a${w.n} by ${w.worker}` : s.status}`;
  }), "```", "");
  md.push("## Final checks", "", "| Check | Result |", "|---|---|");
  for (const [k, v] of Object.entries(checks)) md.push(`| \`${k}\` | ${v.ok ? "✅ pass" : `❌ exit ${v.exitCode}`} |`);
  md.push("");
  md.push("## Nodes", "");
  for (const n of plan.nodes) {
    const s = run.nodes[n.id]!;
    md.push(`### ${n.id} — ${n.kind}`, "", n.goal, "");
    md.push(`Winner: ${s.winner ? `a${s.winner}` : "—"} · decided by ${s.decidedBy ?? "—"}${s.decisionNotes ? ` — ${s.decisionNotes}` : ""}`, "");
    const nodeUsage = sumUsage(s.attempts.map((a) => a.usage));
    if (nodeUsage.calls) md.push(`Cost: ${formatUsage(nodeUsage)}`, "");
    md.push("| Attempt | Worker | Status | Repairs | Diff | Score | Review | Tokens (in/out) |", "|---|---|---|---|---|---|---|---|");
    for (const a of s.attempts) {
      const d = a.diffStat ? `${a.diffStat.files}f +${a.diffStat.insertions} −${a.diffStat.deletions}` : "—";
      const why = a.status === "disqualified" ? ` (${[...(a.gates?.locked.violations ?? []), ...(a.gates?.ownership.violations ?? [])].join("; ")})` : "";
      const tok = a.usage ? `${a.usage.inputTokens} / ${a.usage.outputTokens}` : "—";
      md.push(`| a${a.n}${a.n === s.winner ? " ★" : ""} | ${a.worker} | ${a.status}${why} | ${a.repairs} | ${d} | ${a.score ?? "—"} | ${a.reviewVerdict ?? "—"} | ${tok} |`);
    }
    md.push("");
  }
  if (run.hardening.length) {
    md.push("## Hardening (tests added after approval)", "");
    md.push("Each entry adds new test files from a review finding. The originally approved tests were never changed.", "");
    for (const h of run.hardening) {
      md.push(`- **${h.node}** (${h.at}): ${h.reason}`, `  - files: ${h.files.map((f) => `\`${f}\``).join(", ")}`, `  - command: \`${h.command}\``);
    }
    md.push("");
  }
  const total = runUsage(run);
  md.push("## Cost", "", `Total: ${formatUsage(total)}`);
  if (run.overheadUsage) md.push(`Planning and retired attempts: ${formatUsage(run.overheadUsage)}`);
  const warnings = recordedWarnings(run);
  if (warnings.length) md.push("", "Usage warnings raised during the run:", ...warnings.map((w) => `- ⚠ ${w}`));
  md.push("");
  md.push("## Workers", "", ...Object.entries(cfg.roles).map(([r, ws]) => `- ${r}: ${ws.join(", ")}`), "");
  if (run.final) {
    md.push("## Next", "", "```", `git log --oneline ${run.approval!.headCommit.slice(0, 12)}..${run.final.branch}`, `git merge ${run.final.branch}      # or cherry-pick / open a PR from it`, "```", "");
    md.push("The branch includes the acceptance tests commit, so the tests ship with the change.", "");
  }
  return md.join("\n");
}
