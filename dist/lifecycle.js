import { existsSync } from "node:fs";
import { cp, mkdir, mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { getWorker, loadConfig } from "./config.js";
import { addDetachedWorktree, changedFiles, commitOverlay, git, headCommit, removeWorktree } from "./git.js";
import { allAcceptanceFiles, checkPlan, nodesFromPlan, renderPlanMarkdown } from "./plan.js";
import { PLANNER_OUT_DIR, plannerPrompt } from "./prompts.js";
import { logEvent } from "./store.js";
import { GraftreeError, now, sha256File, writeFileAtomic } from "./util.js";
import { addUsage } from "./usage.js";
import { runWorker } from "./workers/index.js";
const PLANNABLE = ["draft", "needs_replan", "awaiting_approval"];
function requireStatus(run, allowed, action) {
    if (run.pendingRedecomposition) {
        throw new GraftreeError(`run ${run.id} has a re-decomposition of ${run.pendingRedecomposition.node} pending; use approveRedecomposition/rejectRedecomposition (CLI: graftree approve / reject)`, "bad_status");
    }
    if (!allowed.includes(run.status)) {
        throw new GraftreeError(`cannot ${action} run ${run.id} in status "${run.status}" (allowed: ${allowed.join(", ")})`, "bad_status");
    }
}
export async function newRun(store, problem, tier = "auto") {
    if (!problem.trim())
        throw new GraftreeError("problem statement is empty", "invalid");
    await headCommit(store.root); // fail early: approval needs a base commit
    const run = await store.createRun(problem.trim(), tier);
    await mkdir(store.testsDir(run.id), { recursive: true });
    return run;
}
/**
 * Submit a plan (authored by the closer or a worker). Optionally copy drafted
 * tests from `testsFrom` (a dir mirroring repo-relative paths) into the run.
 * On success the run pauses at awaiting_approval and plan.md is written.
 */
export async function submitPlan(store, run, planInput, opts = {}) {
    requireStatus(run, PLANNABLE, "plan");
    const testsDir = store.testsDir(run.id);
    if (opts.testsFrom) {
        if (!existsSync(opts.testsFrom))
            throw new GraftreeError(`tests dir not found: ${opts.testsFrom}`, "invalid");
        await mkdir(testsDir, { recursive: true });
        await cp(opts.testsFrom, testsDir, { recursive: true });
    }
    const check = checkPlan(planInput, { testsDir });
    if (!check.plan)
        return check;
    if (run.requestedTier !== "auto" && check.plan.tier !== run.requestedTier) {
        check.warnings.push(`plan tier "${check.plan.tier}" differs from requested "${run.requestedTier}"`);
    }
    run.plan = check.plan;
    run.nodes = nodesFromPlan(check.plan);
    run.status = "awaiting_approval";
    logEvent(run, "planned", `${check.plan.nodes.length} nodes by ${opts.author ?? "closer"}`);
    await store.saveRun(run);
    const cfg = await loadConfig(store.configPath);
    await writeFileAtomic(store.planMdPath(run.id), renderPlanMarkdown(run, cfg));
    return check;
}
/** Ask a worker to plan + draft tests in a throwaway worktree, then submit its output. */
export async function planWithWorker(store, run, workerName) {
    requireStatus(run, PLANNABLE, "plan");
    const cfg = await loadConfig(store.configPath);
    const w = getWorker(cfg, workerName);
    const scratch = await mkdtemp(join(tmpdir(), `graftree-plan-${run.id}-`));
    const wt = join(scratch, "wt");
    await addDetachedWorktree(store.root, wt, "HEAD");
    try {
        const result = await runWorker(workerName, w, { prompt: plannerPrompt(run), cwd: wt });
        run.overheadUsage = addUsage(run.overheadUsage, result);
        await mkdir(store.runDir(run.id), { recursive: true });
        await writeFileAtomic(join(store.runDir(run.id), "planner.log"), `${result.stdout}\n--- stderr ---\n${result.stderr}`);
        const planPath = join(wt, PLANNER_OUT_DIR, "plan.json");
        if (!existsSync(planPath)) {
            return {
                plan: null,
                errors: [`worker did not write ${PLANNER_OUT_DIR}/plan.json (ok=${result.ok}, exit=${result.exitCode}); see planner.log`],
                warnings: [],
                worker: result,
            };
        }
        let planJson;
        try {
            planJson = JSON.parse(await readFile(planPath, "utf8"));
        }
        catch (e) {
            return { plan: null, errors: [`plan.json is not valid JSON: ${e.message}`], warnings: [], worker: result };
        }
        const testsOut = join(wt, PLANNER_OUT_DIR, "tests");
        const check = await submitPlan(store, run, planJson, {
            testsFrom: existsSync(testsOut) ? testsOut : undefined,
            author: workerName,
        });
        return { ...check, worker: result };
    }
    finally {
        await removeWorktree(store.root, wt);
        await rm(scratch, { recursive: true, force: true });
    }
}
/**
 * Human approval gate. Locks acceptance tests by hash and records a base
 * commit (HEAD + tests) under refs/graftree/<run>/base. Nothing touches the
 * user's working tree or branch.
 */
export async function approveRun(store, run, notes) {
    requireStatus(run, ["awaiting_approval"], "approve");
    const plan = run.plan;
    const testsDir = store.testsDir(run.id);
    const files = allAcceptanceFiles(plan);
    const locked = [];
    for (const f of files) {
        const src = join(testsDir, f);
        if (!existsSync(src))
            throw new GraftreeError(`acceptance file missing from run: tests/${f}`, "invalid");
        locked.push({ path: f, sha256: await sha256File(src) });
    }
    const baseRef = `refs/graftree/${run.id}/base`;
    const { commit, parent } = await commitOverlay(store.root, files.map((f) => ({ repoPath: f, sourcePath: join(testsDir, f) })), `graftree: acceptance tests for ${run.id}`, baseRef);
    run.approval = { approvedAt: now(), ...(notes ? { notes } : {}), baseRef, baseCommit: commit, headCommit: parent, locked };
    run.status = "approved";
    logEvent(run, "approved", notes);
    await store.saveRun(run);
    const cfg = await loadConfig(store.configPath);
    await writeFileAtomic(store.planMdPath(run.id), renderPlanMarkdown(run, cfg));
    return run;
}
export async function rejectRun(store, run, notes) {
    requireStatus(run, ["awaiting_approval"], "reject");
    if (!notes.trim())
        throw new GraftreeError("reject needs --notes explaining what to change", "invalid");
    run.feedback.push({ at: now(), notes: notes.trim() });
    run.status = "needs_replan";
    logEvent(run, "rejected", notes.trim());
    await store.saveRun(run);
    return run;
}
/**
 * Check a candidate commit against the locked acceptance tests. Any change to a
 * locked file disqualifies the candidate.
 */
export async function checkLocked(store, run, candidateCommit, from) {
    if (!run.approval)
        throw new GraftreeError(`run ${run.id} is not approved`, "bad_status");
    const lockedPaths = new Set(run.approval.locked.map((l) => l.path));
    // Compare against where the candidate started (its node base); defaults to the run base.
    const changed = await changedFiles(store.root, from ?? run.approval.baseCommit, candidateCommit);
    const violations = [];
    for (const p of changed) {
        if (!lockedPaths.has(p))
            continue;
        const exists = await git(store.root, ["cat-file", "-e", `${candidateCommit}:${p}`]).then(() => true, () => false);
        violations.push({ path: p, reason: exists ? "modified" : "deleted" });
    }
    return violations;
}
//# sourceMappingURL=lifecycle.js.map