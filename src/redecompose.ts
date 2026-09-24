import { existsSync } from "node:fs";
import { cp, mkdir, rm } from "node:fs/promises";
import { join } from "node:path";
import { formatIssues, loadConfig } from "./config.js";
import { commitOverlay, git, removeWorktree } from "./git.js";
import { checkPlan, nodesFromPlan, renderPlanMarkdown, type PlanCheck } from "./plan.js";
import { Subtree, TIER_DEFAULTS, type Plan, type Run, type Tier } from "./schema.js";
import { listFiles, resetAncestors, withRunLock } from "./solve.js";
import { logEvent, type Store } from "./store.js";
import { sumUsage } from "./usage.js";
import { GraftreeError, normalizeRepoPath, now, sha256File, writeFileAtomic } from "./util.js";

/**
 * Re-decomposition: when a leaf proves too hard to solve in one piece, the
 * closer splits it into a subtree after approval. The node keeps its id, goal,
 * ownership and locked tests, so the bar never drops; it becomes a split whose
 * new children get their own (new, additive) tests. Like the original plan,
 * the proposal pauses for human approval before anything is spent on it.
 */

export interface RedecomposeInput {
  subtree: unknown;
  /** Directory mirroring repo-relative paths, holding the new children's test files. */
  testsFrom?: string;
  reason: string;
}

const TIERS: Tier[] = ["focused", "standard", "deep"];

function depth(plan: Plan, id: string): number {
  let d = 0;
  for (let cur = plan.nodes.find((n) => n.id === id); cur?.parent; cur = plan.nodes.find((n) => n.id === cur!.parent)) d++;
  return d;
}

export async function proposeRedecomposition(store: Store, runId: string | undefined, nodeId: string, input: RedecomposeInput): Promise<PlanCheck & { run: Run }> {
  const id = (await store.loadRun(runId)).id;
  return withRunLock(store, id, async () => {
    const run = await store.loadRun(id);
    const cfg = await loadConfig(store.configPath);
    if (!run.approval || !run.plan || !["approved", "solving", "awaiting_closer"].includes(run.status)) {
      throw new GraftreeError(`run ${id} is "${run.status}"; re-decomposition needs an approved run that is still solving`, "bad_status");
    }
    const node = run.nodes[nodeId];
    if (!node) throw new GraftreeError(`unknown node "${nodeId}"`, "invalid");
    if (node.kind !== "leaf") throw new GraftreeError(`${nodeId} is already a split; re-decompose one of its leaves`, "invalid");
    if (node.status === "done") throw new GraftreeError(`${nodeId} already has a winner; nothing to re-decompose`, "invalid");
    if (!input.reason.trim()) throw new GraftreeError("redecompose needs --reason (why the leaf could not be solved whole)", "invalid");
    const used = run.redecompositions.filter((r) => r.node === nodeId).length;
    if (used >= cfg.budgets.maxRedecompositions) {
      throw new GraftreeError(
        `${nodeId} was already re-decomposed ${used} time(s) (budgets.maxRedecompositions = ${cfg.budgets.maxRedecompositions}); raise the budget or start a new run`,
        "budget",
      );
    }

    const parsed = Subtree.safeParse(input.subtree);
    if (!parsed.success) return { run, plan: null, errors: [`subtree does not match schema:\n${formatIssues(parsed.error.issues)}`], warnings: [] };
    const sub = parsed.data;
    const clash = sub.nodes.filter((n) => run.nodes[n.id]).map((n) => n.id);
    if (clash.length) return { run, plan: null, errors: [`node id(s) already in the plan: ${clash.join(", ")}`], warnings: [] };
    if (sub.nodes.filter((n) => n.parent === nodeId).length < 2) {
      return { run, plan: null, errors: [`at least 2 new nodes must have parent "${nodeId}"`], warnings: [] };
    }
    // The subtree may only grow under this node, never attach elsewhere in the tree.
    const newIds = new Set(sub.nodes.map((n) => n.id));
    const stray = sub.nodes.filter((n) => n.parent !== nodeId && !newIds.has(n.parent ?? ""));
    if (stray.length) {
      return { run, plan: null, errors: stray.map((n) => `node ${n.id}: parent must be "${nodeId}" or another new node (got ${JSON.stringify(n.parent)})`), warnings: [] };
    }

    // New test files: additive only, like hardening.
    if (input.testsFrom && !existsSync(input.testsFrom)) throw new GraftreeError(`tests dir not found: ${input.testsFrom}`, "invalid");
    const files = input.testsFrom ? (await listFiles(input.testsFrom)).map(normalizeRepoPath).sort() : [];
    const locked = new Set(run.approval.locked.map((l) => l.path));
    for (const f of files) {
      if (locked.has(f)) throw new GraftreeError(`${f} is a locked acceptance test; re-decomposition only adds new files`, "invalid");
      const exists = await git(store.root, ["cat-file", "-e", `${run.approval.baseCommit}:${f}`]).then(() => true, () => false);
      if (exists) throw new GraftreeError(`${f} already exists in the run base; re-decomposition only adds new files`, "invalid");
    }

    // The whole plan after the change: the leaf becomes a split with the same contract and tests.
    const plan: Plan = structuredClone(run.plan);
    const target = plan.nodes.find((n) => n.id === nodeId)!;
    target.kind = "split";
    if (sub.sharedPaths) target.sharedPaths = sub.sharedPaths;
    plan.nodes.push(...sub.nodes);
    const warnings: string[] = [];
    const needed = Math.max(...sub.nodes.map((n) => depth(plan, n.id)));
    const tier = TIERS.find((t) => TIER_DEFAULTS[t].maxDepth >= needed && TIERS.indexOf(t) >= TIERS.indexOf(plan.tier));
    if (tier && tier !== plan.tier) {
      warnings.push(`tier raised from "${plan.tier}" to "${tier}" to fit depth ${needed}`);
      plan.tier = tier;
    }

    // Validate against the existing tests plus the new ones.
    const staged = join(store.runDir(id), "redecompose", "tests");
    await rm(join(store.runDir(id), "redecompose"), { recursive: true, force: true });
    await mkdir(staged, { recursive: true });
    if (existsSync(store.testsDir(id))) await cp(store.testsDir(id), staged, { recursive: true });
    if (input.testsFrom) await cp(input.testsFrom, staged, { recursive: true });
    const check = checkPlan(plan, { testsDir: staged });
    check.warnings.unshift(...warnings);
    if (!check.plan) return { ...check, run };

    run.pendingRedecomposition = {
      at: now(),
      node: nodeId,
      reason: input.reason.trim(),
      plan: check.plan,
      files,
      stagedTests: "redecompose/tests",
      resumeStatus: run.status,
    };
    run.status = "awaiting_approval";
    logEvent(run, "redecomposition-proposed", `${nodeId} → ${sub.nodes.map((n) => n.id).join(", ")}: ${input.reason.trim()}`);
    await store.saveRun(run);
    await writeFileAtomic(store.planMdPath(id), renderPlanMarkdown(run, cfg));
    return { ...check, run };
  });
}

/** Human approval of a pending re-decomposition: lock the new tests and reopen the subtree. */
export async function approveRedecomposition(store: Store, runId: string | undefined, notes?: string): Promise<Run> {
  const id = (await store.loadRun(runId)).id;
  return withRunLock(store, id, async () => {
    const run = await store.loadRun(id);
    const p = run.pendingRedecomposition;
    if (!p || run.status !== "awaiting_approval" || !run.approval) throw new GraftreeError(`run ${id} has no pending re-decomposition`, "bad_status");
    const staged = join(store.runDir(id), p.stagedTests);
    const oldNode = run.nodes[p.node]!;

    let baseCommit = run.approval.baseCommit;
    if (p.files.length) {
      ({ commit: baseCommit } = await commitOverlay(
        store.root,
        p.files.map((f) => ({ repoPath: f, sourcePath: join(staged, f) })),
        `graftree: re-decomposition tests for ${id} ${p.node}\n\n${p.reason}`,
        run.approval.baseRef,
        run.approval.baseCommit,
      ));
      for (const f of p.files) run.approval.locked.push({ path: f, sha256: await sha256File(join(staged, f)) });
      run.approval.baseCommit = baseCommit;
      await cp(staged, store.testsDir(id), { recursive: true });
    }

    // Retire the leaf's attempts (their cost stays on the books) and install the new nodes.
    for (const a of oldNode.attempts) if (a.worktree) await removeWorktree(store.root, a.worktree);
    run.overheadUsage = sumUsage([run.overheadUsage, ...oldNode.attempts.map((a) => a.usage)]);
    const fresh = nodesFromPlan(p.plan);
    const added = p.plan.nodes.filter((n) => !run.nodes[n.id]).map((n) => n.id);
    run.nodes[p.node] = { ...fresh[p.node]!, acceptance: oldNode.acceptance };
    for (const n of added) run.nodes[n] = fresh[n]!;
    run.plan = p.plan;
    await resetAncestors(store, run, p.node);

    run.redecompositions.push({ at: now(), node: p.node, reason: p.reason, nodes: added, files: p.files, baseCommit });
    run.pendingRedecomposition = null;
    run.status = "solving";
    logEvent(run, "redecomposed", `${p.node} → ${added.join(", ")}${notes ? `: ${notes}` : ""}`);
    await store.saveRun(run);
    await rm(join(store.runDir(id), "redecompose"), { recursive: true, force: true });
    await writeFileAtomic(store.planMdPath(id), renderPlanMarkdown(run, await loadConfig(store.configPath)));
    return run;
  });
}

/** The human declines: drop the proposal and resume where the run was. */
export async function rejectRedecomposition(store: Store, runId: string | undefined, notes: string): Promise<Run> {
  const id = (await store.loadRun(runId)).id;
  return withRunLock(store, id, async () => {
    const run = await store.loadRun(id);
    const p = run.pendingRedecomposition;
    if (!p) throw new GraftreeError(`run ${id} has no pending re-decomposition`, "bad_status");
    if (!notes.trim()) throw new GraftreeError("reject needs --notes explaining what to change", "invalid");
    run.feedback.push({ at: now(), notes: `re-decomposition of ${p.node}: ${notes.trim()}` });
    run.pendingRedecomposition = null;
    run.status = p.resumeStatus;
    logEvent(run, "redecomposition-rejected", `${p.node}: ${notes.trim()}`);
    await store.saveRun(run);
    await rm(join(store.runDir(id), "redecompose"), { recursive: true, force: true });
    await writeFileAtomic(store.planMdPath(id), renderPlanMarkdown(run, await loadConfig(store.configPath)));
    return run;
  });
}
