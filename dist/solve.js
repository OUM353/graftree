import { existsSync } from "node:fs";
import { cp, mkdir, open, readFile, readdir, rm } from "node:fs/promises";
import { join, relative } from "node:path";
import { getWorker, loadConfig } from "./config.js";
import { runShell, tail, writeLog } from "./exec.js";
import { addBranchWorktree, addDetachedWorktree, changedFiles, commitAll, commitOverlay, diffStat, diffText, git, isAncestor, mergeCommit, removeWorktree, resetWorktree } from "./git.js";
import { matchesAny } from "./glob.js";
import { effectiveDeps } from "./plan.js";
import { checkLocked } from "./lifecycle.js";
import { integratorPrompt, repairPrompt, reviewerPrompt, solverPrompt } from "./prompts.js";
import { CLOSER, TIER_DEFAULTS } from "./schema.js";
import { logEvent } from "./store.js";
import { addUsage, recordedWarnings, runUsage, sumUsage, usageWarnings } from "./usage.js";
import { GraftreeError, normalizeRepoPath, now, sha256File } from "./util.js";
import { runWorker } from "./workers/index.js";
class Semaphore {
    free;
    queue = [];
    constructor(free) {
        this.free = free;
    }
    async use(fn) {
        if (this.free > 0)
            this.free--;
        else
            await new Promise((r) => this.queue.push(r));
        try {
            return await fn();
        }
        finally {
            const next = this.queue.shift();
            if (next)
                next();
            else
                this.free++;
        }
    }
}
function makeCtx(store, run, cfg, opts) {
    let chain = Promise.resolve();
    return {
        gitLock: new Semaphore(1),
        store,
        run,
        cfg,
        opts,
        deadline: Date.now() + cfg.budgets.maxWallMinutes * 60_000,
        sem: new Semaphore(cfg.budgets.concurrency),
        // Serialize tree.json writes from concurrent attempts.
        save: () => (chain = chain.then(() => store.saveRun(run))),
        say: (m) => opts.onEvent?.(m),
    };
}
const wtPath = (c, node, label) => join(c.store.runDir(c.run.id), "wt", node, label);
const logPath = (c, node, n, file) => join(c.store.runDir(c.run.id), "nodes", node, `a${n}`, file);
const branchName = (c, node, label) => `graftree/${c.run.id}/${node}/${label}`;
const relRun = (c, p) => relative(c.store.runDir(c.run.id), p);
const childrenOf = (run, id) => Object.values(run.nodes).filter((n) => n.parent === id);
const descendantsOf = (run, id) => childrenOf(run, id).flatMap((k) => [k, ...descendantsOf(run, k.id)]);
const ancestorsOf = (run, id) => {
    const out = [];
    let p = run.nodes[id]?.parent;
    while (p) {
        const n = run.nodes[p];
        out.push(n);
        p = n.parent;
    }
    return out;
};
const rootOf = (run) => Object.values(run.nodes).find((n) => n.parent === null);
const depsDone = (run, node) => effectiveDeps(run, node).every((d) => d.status === "done" && d.winner !== null);
/** Nodes that start from this node's code: dependents of it or of its ancestors, and their subtrees. */
function dependentsOf(run, id) {
    const direct = Object.values(run.nodes).filter((n) => n.id !== id && effectiveDeps(run, n).some((d) => d.id === id));
    const out = new Map();
    for (const d of direct)
        for (const n of [d, ...descendantsOf(run, d.id)])
            out.set(n.id, n);
    return [...out.values()];
}
function attemptsPerLeaf(c) {
    return c.cfg.budgets.attemptsPerLeaf ?? TIER_DEFAULTS[c.run.plan.tier].attemptsPerLeaf;
}
const engineWorkers = (names) => names.filter((n) => n !== CLOSER);
// ---------------------------------------------------------------------------
// Run lock (one engine process per run)
// ---------------------------------------------------------------------------
/** While a re-decomposition waits for the human, nothing else may change the tree. */
export function assertNoPending(run) {
    const p = run.pendingRedecomposition;
    if (p)
        throw new GraftreeError(`run ${run.id} has a re-decomposition of ${p.node} awaiting approval; \`graftree approve\` or \`graftree reject --notes …\` it first`, "bad_status");
}
export async function withRunLock(store, runId, fn) {
    const lock = join(store.runDir(runId), ".lock");
    await mkdir(store.runDir(runId), { recursive: true });
    if (existsSync(lock)) {
        const pid = Number((await readFile(lock, "utf8")).trim());
        let alive = false;
        try {
            if (pid)
                process.kill(pid, 0);
            alive = pid > 0;
        }
        catch {
            alive = false;
        }
        if (alive && pid !== process.pid)
            throw new GraftreeError(`run ${runId} is already being processed by pid ${pid}`, "locked");
        await rm(lock, { force: true });
    }
    let fh;
    try {
        fh = await open(lock, "wx");
    }
    catch (e) {
        // Another process created the lock between our check and now.
        if (e.code === "EEXIST")
            throw new GraftreeError(`run ${runId} is already being processed by another graftree`, "locked");
        throw e;
    }
    await fh.write(String(process.pid));
    await fh.close();
    try {
        return await fn();
    }
    finally {
        await rm(lock, { force: true });
    }
}
// ---------------------------------------------------------------------------
// Gates
// ---------------------------------------------------------------------------
/** Paths an integrator may touch at a split: shared paths, or parent-owned paths no child owns. */
function integrationAllows(run, node, file) {
    if (matchesAny(node.sharedPaths, file))
        return true;
    if (!matchesAny(node.ownedPaths, file))
        return false;
    return !childrenOf(run, node.id).some((k) => matchesAny(k.ownedPaths, file));
}
async function runCheck(c, cwd, commands, log) {
    let out = "";
    let exitCode = 0;
    for (const cmd of commands) {
        const r = await runShell(cmd, cwd, c.cfg.commands.timeoutSec);
        out += `$ ${cmd}\n${r.output}\n[exit ${r.exitCode}${r.timedOut ? ", timed out" : ""}]\n\n`;
        if (r.exitCode !== 0) {
            exitCode = r.exitCode;
            break;
        }
    }
    await writeLog(log, out);
    return { ok: exitCode === 0, exitCode, log: relRun(c, log), violations: [] };
}
/** Commands that must pass for a node: its own, plus every descendant's (no regressions inside the subtree). */
function acceptanceCommands(run, node) {
    return [...new Set([node, ...descendantsOf(run, node.id)].flatMap((n) => [n.acceptance.command, ...n.acceptance.extraCommands]))];
}
async function gateAttempt(c, node, a, wt) {
    const commit = a.commit;
    const base = node.base;
    const locked = await checkLocked(c.store, c.run, commit, base);
    const changed = await changedFiles(c.store.root, base, commit);
    const isSplit = node.kind === "split";
    const outside = changed.filter((f) => (isSplit ? !integrationAllows(c.run, node, f) : !matchesAny(node.ownedPaths, f)));
    a.gates = {
        locked: { ok: locked.length === 0, exitCode: null, violations: locked.map((v) => `${v.reason}: ${v.path}`) },
        ownership: { ok: outside.length === 0, exitCode: null, violations: outside },
    };
    a.diffStat = await diffStat(c.store.root, base, commit);
    if (!a.gates.locked.ok || !a.gates.ownership.ok) {
        a.status = "disqualified";
        return;
    }
    if (!isSplit && changed.length === 0) {
        a.status = "failed";
        a.notes = "no changes";
        return;
    }
    if (c.cfg.commands.build) {
        a.gates.build = await runCheck(c, wt, [c.cfg.commands.build], logPath(c, node.id, a.n, "build.log"));
        if (!a.gates.build.ok) {
            a.status = "failed";
            return;
        }
    }
    a.gates.acceptance = await runCheck(c, wt, acceptanceCommands(c.run, node), logPath(c, node.id, a.n, "acceptance.log"));
    if (c.cfg.commands.lint)
        a.gates.lint = await runCheck(c, wt, [c.cfg.commands.lint], logPath(c, node.id, a.n, "lint.log"));
    a.status = a.gates.acceptance.ok ? "passed" : "failed";
}
async function failureText(c, a) {
    const g = a.gates;
    if (!g)
        return a.notes ?? "attempt produced no result";
    if (!g.locked.ok)
        return `Locked acceptance tests were changed: ${g.locked.violations.join(", ")}`;
    if (!g.ownership.ok)
        return `Edited files outside the allowed paths: ${g.ownership.violations.join(", ")}`;
    for (const check of [g.build, g.acceptance]) {
        if (check && !check.ok && check.log)
            return tail(await readFile(join(c.store.runDir(c.run.id), check.log), "utf8"));
    }
    return a.notes ?? "unknown failure";
}
function score(a) {
    const size = (a.diffStat?.insertions ?? 0) + (a.diffStat?.deletions ?? 0);
    let s = 100 - Math.min(40, size / 25);
    if (a.gates?.lint && !a.gates.lint.ok)
        s -= 10;
    s -= a.repairs * 5;
    if (a.reviewVerdict === "concerns")
        s -= 10;
    if (a.reviewVerdict === "fail")
        s -= 30;
    return Math.round(s * 10) / 10;
}
// ---------------------------------------------------------------------------
// Attempts
// ---------------------------------------------------------------------------
async function prepareWorktree(c, wt, branch, base) {
    await mkdir(join(wt, ".."), { recursive: true });
    // Worktree admin dirs and branch refs live in the shared .git; create them one at a time.
    await c.gitLock.use(async () => {
        if (branch)
            await addBranchWorktree(c.store.root, wt, branch, base);
        else {
            await removeWorktree(c.store.root, wt);
            await addDetachedWorktree(c.store.root, wt, base);
        }
    });
    if (c.cfg.commands.setup) {
        const r = await runShell(c.cfg.commands.setup, wt, c.cfg.commands.timeoutSec);
        if (r.exitCode !== 0)
            throw new GraftreeError(`setup command failed in ${wt}:\n${tail(r.output, 2000)}`, "setup");
    }
}
/** Report newly crossed usage thresholds once each (recorded in history), and wall time once per `run`. */
function checkUsage(c) {
    const seen = new Set(c.run.history.filter((h) => h.event === "usage-warning").map((h) => h.detail?.split(" ")[0]));
    const warnings = usageWarnings(c.run, c.cfg.budgets);
    const b = c.cfg.budgets;
    if (b.warnWallPercent > 0 && !c.wallWarned) {
        const budgetMs = b.maxWallMinutes * 60_000;
        const used = Date.now() - (c.deadline - budgetMs);
        if (used >= (budgetMs * b.warnWallPercent) / 100) {
            c.wallWarned = true;
            warnings.push({
                key: `wall:${new Date(c.deadline).toISOString()}`,
                message: `this run has used ${Math.round(used / 60_000)} of its ${b.maxWallMinutes} min wall-clock budget (budgets.maxWallMinutes)`,
            });
        }
    }
    for (const w of warnings) {
        if (seen.has(w.key))
            continue;
        logEvent(c.run, "usage-warning", `${w.key} ${w.message}`);
        c.say(`⚠ ${w.message}`);
    }
}
async function invokeWorker(c, node, a, workerName, prompt, logFile) {
    const w = getWorker(c.cfg, workerName);
    const res = await runWorker(workerName, w, { prompt, cwd: a.worktree });
    a.usage = addUsage(a.usage, res);
    checkUsage(c);
    await writeLog(logPath(c, node.id, a.n, logFile), `${res.stdout}\n--- stderr ---\n${res.stderr}\n--- result ---\n${res.text}`);
    if (!res.ok)
        c.say(`  ${node.id}/a${a.n} ${workerName}: worker exited ${res.exitCode}${res.timedOut ? " (timed out)" : ""}`);
}
async function snapshotAndGate(c, node, a, message) {
    a.commit = await commitAll(a.worktree, message, c.cfg.ignore);
    await gateAttempt(c, node, a, a.worktree);
    a.score = a.status === "passed" ? score(a) : undefined;
    a.finishedAt = now();
}
async function runSolveAttempt(c, node, n, workerName) {
    const label = `a${n}`;
    const a = {
        n,
        kind: "solve",
        worker: workerName,
        status: "running",
        startedAt: now(),
        branch: branchName(c, node.id, label),
        worktree: wtPath(c, node.id, label),
        repairs: 0,
    };
    node.attempts.push(a);
    await c.save();
    c.say(`  ${node.id}/${label}: ${workerName} solving…`);
    try {
        await prepareWorktree(c, a.worktree, a.branch, node.base);
        await invokeWorker(c, node, a, workerName, solverPrompt(c.run, node), "worker.log");
        await snapshotAndGate(c, node, a, `graftree ${c.run.id} ${node.id} ${label} (${workerName})`);
    }
    catch (e) {
        a.status = "error";
        a.notes = e.message;
        a.finishedAt = now();
    }
    c.say(`  ${node.id}/${label}: ${a.status}${a.score !== undefined ? ` (score ${a.score})` : ""}`);
    await c.save();
}
/** One repair round on one attempt: feed its failure output back to a worker in the same worktree. */
async function repairAttempt(c, node, a, workerName) {
    const isSplit = node.kind === "split";
    const failure = await failureText(c, a);
    a.repairs++;
    a.status = "running";
    await c.save();
    c.say(`  ${node.id}/a${a.n}: repair ${a.repairs} by ${workerName}`);
    try {
        const allowed = isSplit ? [...node.sharedPaths, `${node.ownedPaths.join(", ")} (except paths owned by children)`] : node.ownedPaths;
        const prompt = isSplit ? integratorPrompt(c.run, node, allowed, failure) : repairPrompt(c.run, node, failure);
        await invokeWorker(c, node, a, workerName, prompt, `repair${a.repairs}.log`);
        if (isSplit && a.worker === "merge")
            a.worker = workerName;
        await snapshotAndGate(c, node, a, `graftree ${c.run.id} ${node.id} a${a.n} repair ${a.repairs} (${workerName})`);
        // The code changed, so any earlier review no longer describes it.
        a.review = undefined;
        a.reviewVerdict = undefined;
    }
    catch (e) {
        a.status = "error";
        a.notes = e.message;
    }
    c.say(`  ${node.id}/a${a.n}: ${a.status} after repair`);
    await c.save();
    // (status is reassigned inside awaited calls; widen so TS doesn't keep the "running" narrowing)
    return a.status === "passed";
}
/** Failed (not disqualified) attempts in engine-managed worktrees: the ones a repair can still fix. */
function nearMisses(node) {
    return node.attempts
        .filter((a) => a.status === "failed" && a.kind !== "external" && a.worktree && existsSync(a.worktree))
        .sort((x, y) => x.repairs - y.repairs || (x.diffStat?.insertions ?? 0) - (y.diffStat?.insertions ?? 0));
}
/**
 * Repair loop. Each hardening of this node grants a fresh budget: the bar
 * moved, so fixing is expected.
 *
 * budgets.repairAll (default): every near-miss gets its own budget and is
 * repaired in parallel, even when another attempt already passes, so the
 * closer chooses among as many verified candidates as possible.
 * Otherwise: one node-wide budget, spent on the best near-miss until the
 * first attempt passes.
 */
async function repairNode(c, node) {
    const isSplit = node.kind === "split";
    const pool = engineWorkers(isSplit ? c.cfg.roles.integrator : c.cfg.roles.solver);
    const hardenings = c.run.hardening.filter((h) => h.node === node.id).length;
    const budget = c.cfg.budgets.maxRepairRounds * (1 + hardenings);
    const workerFor = (a, round) => isSplit ? pool[round % Math.max(1, pool.length)] : a.worker !== CLOSER && a.worker !== "merge" ? a.worker : pool[0];
    if (c.cfg.budgets.repairAll) {
        const jobs = nearMisses(node)
            .filter((a) => a.repairs < budget)
            .map((a) => c.sem.use(async () => {
            while (a.status === "failed" && a.repairs < budget && Date.now() < c.deadline) {
                const w = workerFor(a, a.repairs);
                if (!w || (await repairAttempt(c, node, a, w)))
                    return;
            }
        }));
        await Promise.all(jobs);
        return node.attempts.some((a) => a.status === "passed");
    }
    let rounds = node.attempts.reduce((s, a) => s + a.repairs, 0);
    while (rounds < budget && Date.now() < c.deadline) {
        const a = nearMisses(node)[0];
        if (!a)
            return false;
        const w = workerFor(a, rounds);
        if (!w)
            return false;
        rounds++;
        if (await repairAttempt(c, node, a, w))
            return true;
    }
    return false;
}
/**
 * Findings raised on other attempts at this node. The next reviewer must check
 * each one against its own candidate, so a flaw spotted in a losing sibling
 * can't slip through in the winner.
 */
async function siblingFindings(c, node, self) {
    const out = [];
    for (const o of node.attempts) {
        if (o === self || !o.review || (o.reviewVerdict !== "concerns" && o.reviewVerdict !== "fail"))
            continue;
        const text = await readFile(join(c.store.runDir(c.run.id), o.review), "utf8").catch(() => "");
        const issues = /ISSUES:([\s\S]*)/i.exec(text)?.[1] ?? text;
        out.push(`From the review of a${o.n}:\n${tail(issues.trim(), 4000)}`);
    }
    return out.join("\n\n");
}
async function reviewCandidates(c, node) {
    const reviewers = engineWorkers(c.cfg.roles.reviewer);
    if (!reviewers.length)
        return;
    // Keep reviewing whoever currently ranks first until the leader is a reviewed attempt,
    // so an unreviewed candidate never wins just because nobody looked at it.
    for (let i = 0;; i++) {
        const ranked = node.attempts
            .filter((a) => a.status === "passed")
            .sort((x, y) => (y.score ?? 0) - (x.score ?? 0));
        const a = ranked.find((x) => !x.review);
        const leader = ranked[0];
        if (!a || !leader || leader.review || !a.worktree || !existsSync(a.worktree))
            return;
        if (a !== leader)
            return;
        // Prefer a reviewer different from the author when possible.
        const pick = reviewers.find((r) => r !== a.worker) ?? reviewers[i % reviewers.length];
        c.say(`  ${node.id}/a${a.n}: review by ${pick}`);
        const diff = await diffText(c.store.root, node.base, a.commit);
        const siblings = await siblingFindings(c, node, a);
        const res = await runWorker(pick, getWorker(c.cfg, pick), { prompt: reviewerPrompt(c.run, node, tail(diff, 60_000), siblings), cwd: a.worktree });
        a.usage = addUsage(a.usage, res);
        checkUsage(c);
        await resetWorktree(a.worktree);
        const file = logPath(c, node.id, a.n, "review.md");
        await writeLog(file, `# Review of ${node.id}/a${a.n} by ${pick}\n\n${res.ok ? res.text : `reviewer failed: ${res.stderr}`}\n`);
        a.review = relRun(c, file);
        const v = /VERDICT:\s*(pass|concerns|fail)/i.exec(res.text)?.[1]?.toLowerCase();
        a.reviewVerdict = v ?? "unknown";
        a.score = score(a);
        await c.save();
    }
}
/** After attempts: rank, review, then either auto-select or hand the decision to the closer. */
async function settleNode(c, node) {
    if (c.cfg.budgets.repairAll || !node.attempts.some((a) => a.status === "passed"))
        await repairNode(c, node);
    const passed = node.attempts.filter((a) => a.status === "passed");
    if (!passed.length) {
        node.status = "escalated";
        const tried = node.attempts.map((a) => `a${a.n}:${a.worker}:${a.status}`).join(", ") || "none";
        const kinds = node.kind === "split"
            ? "fix the integration worktree and submit it with `graftree attempt`"
            : "`graftree retry` for fresh attempts, submit your own with `graftree attempt`, or split it with `graftree redecompose`";
        node.awaiting = `no attempt passed (${tried}); ${kinds}`;
        return;
    }
    await reviewCandidates(c, node);
    for (const a of passed)
        a.score = score(a);
    const best = [...passed].sort((x, y) => (y.score ?? 0) - (x.score ?? 0))[0];
    node.recommended = best.n;
    const auto = c.opts.autoSelect ?? c.cfg.budgets.autoSelect;
    if (auto) {
        node.winner = best.n;
        node.decidedBy = "engine (autoSelect)";
        node.status = "done";
        node.awaiting = undefined;
        logEvent(c.run, "auto-selected", `${node.id} a${best.n}`);
    }
    else {
        node.status = "awaiting_closer";
        node.awaiting = `select a winner among passing attempts: ${passed.map((a) => `a${a.n} (${a.worker}, score ${a.score})`).join(", ")}; recommended a${best.n}`;
    }
}
/**
 * After hardening, bring every gradable attempt onto the new base (which only
 * adds test files, so the merge is clean) and run the gates again. Attempts
 * that now fail go through the normal repair loop.
 */
async function regateLeaf(c, node) {
    const newBase = await leafBase(c, node);
    node.base = newBase;
    c.say(`  ${node.id}: re-verifying ${node.attempts.length} attempt(s) against hardened tests`);
    for (const a of node.attempts) {
        if (!a.commit || (a.status !== "passed" && a.status !== "failed"))
            continue;
        try {
            if (!a.worktree || !existsSync(a.worktree)) {
                a.worktree = wtPath(c, node.id, `a${a.n}`);
                await prepareWorktree(c, a.worktree, a.branch, a.commit);
            }
            if (!(await mergeCommit(a.worktree, newBase, `graftree ${c.run.id}: hardened tests for ${node.id}`))) {
                throw new GraftreeError("could not merge hardened tests into this attempt", "merge");
            }
            a.commit = await git(a.worktree, ["rev-parse", "HEAD"]);
            await gateAttempt(c, node, a, a.worktree);
            a.score = a.status === "passed" ? score(a) : undefined;
        }
        catch (e) {
            a.status = "error";
            a.notes = e.message;
        }
        c.say(`  ${node.id}/a${a.n}: ${a.status} (hardened)`);
        await c.save();
    }
    node.regate = false;
}
/** A leaf starts from the run base plus the winning code of everything it depends on. */
async function leafBase(c, node) {
    const runBase = c.run.approval.baseCommit;
    const deps = effectiveDeps(c.run, node);
    if (!deps.length)
        return runBase;
    const wt = wtPath(c, node.id, "_base");
    await c.gitLock.use(() => addBranchWorktree(c.store.root, wt, branchName(c, node.id, "base"), runBase));
    try {
        for (const d of deps) {
            const win = d.attempts.find((a) => a.n === d.winner);
            if (!win?.commit)
                throw new GraftreeError(`dependency ${d.id} of ${node.id} has no winner yet`, "bad_status");
            if (!(await mergeCommit(wt, win.commit, `graftree ${c.run.id}: ${d.id} a${win.n} as the base of ${node.id}`))) {
                throw new GraftreeError(`could not merge dependency ${d.id} into the base of ${node.id}; check ownership overlap`, "merge");
            }
        }
        return await git(wt, ["rev-parse", "HEAD"]);
    }
    finally {
        await removeWorktree(c.store.root, wt);
    }
}
async function solveLeaf(c, node) {
    node.status = "solving";
    node.base ??= await leafBase(c, node);
    if (node.regate)
        await regateLeaf(c, node);
    node.targetAttempts ??= attemptsPerLeaf(c);
    const pool = c.cfg.roles.solver;
    const jobs = [];
    for (let n = node.attempts.length + 1; n <= node.targetAttempts; n++) {
        const worker = pool[(n - 1) % pool.length];
        if (worker === CLOSER) {
            // Closer-owned slot: the root agent submits this attempt itself via `graftree attempt`.
            node.attempts.push({ n, kind: "external", worker: CLOSER, status: "running", startedAt: now(), branch: branchName(c, node.id, `a${n}`), repairs: 0, notes: "awaiting closer submission" });
            continue;
        }
        if (Date.now() > c.deadline)
            break;
        jobs.push(c.sem.use(() => runSolveAttempt(c, node, n, worker)));
    }
    await c.save();
    await Promise.all(jobs);
    const pendingCloser = node.attempts.filter((a) => a.worker === CLOSER && a.status === "running");
    if (pendingCloser.length && !node.attempts.some((a) => a.status === "passed")) {
        node.status = "awaiting_closer";
        node.awaiting = `closer attempt slot(s) ${pendingCloser.map((a) => `a${a.n}`).join(", ")}: solve in a worktree from ${node.base.slice(0, 12)} and submit with \`graftree attempt ${c.run.id} ${node.id} --worktree PATH\``;
        return;
    }
    for (const a of pendingCloser) {
        a.status = "error";
        a.notes = "closer slot not used (other attempts passed)";
    }
    await settleNode(c, node);
}
async function integrateSplit(c, node) {
    node.status = "integrating";
    if (!node.base) {
        const wt = wtPath(c, node.id, "merge");
        await prepareWorktree(c, wt, branchName(c, node.id, "merge"), c.run.approval.baseCommit);
        for (const k of childrenOf(c.run, node.id)) {
            const win = k.attempts.find((a) => a.n === k.winner);
            const ok = await mergeCommit(wt, win.commit, `graftree ${c.run.id}: merge ${k.id} a${win.n} into ${node.id}`);
            if (!ok) {
                node.status = "escalated";
                node.awaiting = `merging child ${k.id} conflicted in ${wt}; resolve manually and submit with \`graftree attempt\`, or replan ownership`;
                return;
            }
        }
        node.base = await git(wt, ["rev-parse", "HEAD"]);
        await removeWorktree(c.store.root, wt);
        await c.save();
    }
    if (!node.attempts.length) {
        // Attempt 1 is the plain merge: if the children already fit together, no glue is needed.
        const a = { n: 1, kind: "integrate", worker: "merge", status: "running", startedAt: now(), branch: branchName(c, node.id, "a1"), worktree: wtPath(c, node.id, "a1"), repairs: 0 };
        node.attempts.push(a);
        c.say(`  ${node.id}: integrating ${childrenOf(c.run, node.id).length} children`);
        try {
            await prepareWorktree(c, a.worktree, a.branch, node.base);
            await snapshotAndGate(c, node, a, `graftree ${c.run.id} ${node.id} a1 (merge)`);
        }
        catch (e) {
            a.status = "error";
            a.notes = e.message;
        }
        c.say(`  ${node.id}/a1: ${a.status}`);
        await c.save();
    }
    if (!node.attempts.some((a) => a.status === "passed") && !engineWorkers(c.cfg.roles.integrator).length) {
        const a1 = node.attempts[0];
        node.status = "awaiting_closer";
        node.awaiting = `integration needs glue: edit ${a1.worktree} (allowed: sharedPaths ${JSON.stringify(node.sharedPaths)} or unowned parent paths), then \`graftree attempt ${c.run.id} ${node.id} --worktree ${a1.worktree}\``;
        return;
    }
    await settleNode(c, node);
}
export function summarize(run) {
    const decisions = Object.values(run.nodes)
        .filter((n) => n.status === "awaiting_closer" || n.status === "escalated")
        .map((n) => ({
        node: n.id,
        status: n.status,
        awaiting: n.awaiting,
        recommended: n.recommended,
        candidates: n.attempts.map((a) => ({
            n: a.n,
            worker: a.worker,
            status: a.status,
            score: a.score,
            review: a.reviewVerdict,
            branch: a.branch,
            diffStat: a.diffStat,
        })),
    }));
    const next = run.status === "ready_to_close"
        ? `graftree close ${run.id}`
        : decisions.length
            ? `inspect with \`graftree diff <node> <attempt> --run ${run.id}\`, then \`graftree decide <node> <attempt> --run ${run.id}\` (or retry/attempt/redecompose), then \`graftree run ${run.id}\``
            : run.pendingRedecomposition
                ? `review ${run.id}/plan.md, then \`graftree approve ${run.id}\` or \`graftree reject ${run.id} --notes "…"\``
                : run.status === "done"
                    ? `merge branch ${run.final?.branch}`
                    : `graftree run ${run.id}`;
    return { run: run.id, status: run.status, usage: runUsage(run), decisions, warnings: recordedWarnings(run), next };
}
/**
 * Drive the tree as far as possible: solve ready leaves, integrate ready
 * splits, and stop when everything left needs the closer (or the root is done).
 * Safe to re-run; it resumes from tree.json.
 */
export async function runTree(store, runId, opts = {}) {
    const run0 = await store.loadRun(runId);
    return withRunLock(store, run0.id, async () => {
        const run = await store.loadRun(run0.id);
        assertNoPending(run);
        if (!["approved", "solving", "awaiting_closer"].includes(run.status)) {
            if (run.status === "ready_to_close" || run.status === "done")
                return summarize(run);
            throw new GraftreeError(`run ${run.id} is "${run.status}"; it must be approved before solving`, "bad_status");
        }
        const cfg = await loadConfig(store.configPath);
        const c = makeCtx(store, run, cfg, opts);
        // Recover from an interrupted engine: drop attempts that never finished so they run again.
        for (const n of Object.values(run.nodes)) {
            const lost = n.attempts.filter((a) => a.status === "running" && a.worker !== CLOSER);
            for (const a of lost) {
                if (a.worktree)
                    await removeWorktree(store.root, a.worktree);
                logEvent(run, "attempt-interrupted", `${n.id} a${a.n}`);
            }
            n.attempts = n.attempts.filter((a) => !lost.includes(a));
        }
        if (run.status !== "solving")
            logEvent(run, "solving");
        run.status = "solving";
        await c.save();
        for (;;) {
            const ready = Object.values(run.nodes).filter((n) => {
                if (!["planned", "solving", "integrating"].includes(n.status))
                    return false;
                // A node that depends on siblings waits for their winners, then starts from their code.
                if (!depsDone(run, n))
                    return false;
                return n.kind === "leaf" || childrenOf(run, n.id).every((k) => k.status === "done");
            });
            checkUsage(c);
            if (!ready.length || Date.now() > c.deadline)
                break;
            c.say(`▶ ${ready.map((n) => n.id).join(", ")}`);
            await Promise.all(ready.map((n) => (n.kind === "leaf" ? solveLeaf(c, n) : integrateSplit(c, n))));
            await c.save();
        }
        const root = rootOf(run);
        if (root.status === "done")
            run.status = "ready_to_close";
        else if (Object.values(run.nodes).some((n) => n.status === "awaiting_closer" || n.status === "escalated"))
            run.status = "awaiting_closer";
        else {
            // Nothing left the engine can do on its own: say why instead of stalling silently.
            run.status = "awaiting_closer";
            root.status = root.status === "planned" ? "awaiting_closer" : root.status;
            root.awaiting =
                Date.now() > c.deadline
                    ? `wall-clock budget (${cfg.budgets.maxWallMinutes} min) reached; re-run to continue`
                    : `engine stalled with no decidable node; inspect \`graftree show ${run.id}\``;
        }
        logEvent(run, run.status);
        await c.save();
        return summarize(run);
    });
}
/** Reopen everything above a node whose winner changed; their merges are stale. */
export async function resetAncestors(store, run, id) {
    for (const anc of ancestorsOf(run, id)) {
        for (const a of anc.attempts)
            if (a.worktree)
                await removeWorktree(store.root, a.worktree);
        if (anc.attempts.length || anc.base)
            logEvent(run, "reopened", `${anc.id} (child ${id} changed)`);
        Object.assign(anc, { status: "planned", base: null, attempts: [], recommended: null, winner: null, decidedBy: null, awaiting: undefined });
    }
}
/**
 * A node's winner changed, so everything built on top of its old code is stale:
 * dependents (and their subtrees) start over from the new code. Their cost stays
 * on the books as run overhead.
 */
async function resetDependents(store, run, id) {
    for (const d of dependentsOf(run, id)) {
        if (!d.attempts.length && !d.base)
            continue;
        for (const a of d.attempts)
            if (a.worktree)
                await removeWorktree(store.root, a.worktree);
        run.overheadUsage = sumUsage([run.overheadUsage, ...d.attempts.map((a) => a.usage)]);
        Object.assign(d, { status: "planned", base: null, attempts: [], recommended: null, winner: null, decidedBy: null, awaiting: undefined, regate: false, targetAttempts: null });
        logEvent(run, "reopened", `${d.id} (dependency ${id} changed)`);
        await resetAncestors(store, run, d.id);
    }
}
/** The closer's selection. Only a passing attempt can win: the bar is never lowered. */
export async function decide(store, runId, nodeId, n, notes, by = "closer") {
    const id = (await store.loadRun(runId)).id;
    return withRunLock(store, id, async () => {
        const run = await store.loadRun(id);
        assertNoPending(run);
        const node = run.nodes[nodeId];
        if (!node)
            throw new GraftreeError(`unknown node "${nodeId}"`, "invalid");
        const a = node.attempts.find((x) => x.n === n);
        if (!a)
            throw new GraftreeError(`node ${nodeId} has no attempt a${n}`, "invalid");
        if (a.status !== "passed")
            throw new GraftreeError(`a${n} did not pass its gates (status ${a.status}); only passing attempts can be selected`, "invalid");
        const changed = node.winner !== null && node.winner !== n;
        node.winner = n;
        node.decidedBy = by;
        node.decisionNotes = notes;
        node.status = "done";
        node.awaiting = undefined;
        if (changed) {
            await resetAncestors(store, run, nodeId);
            await resetDependents(store, run, nodeId);
        }
        logEvent(run, "decided", `${nodeId} a${n}${notes ? `: ${notes}` : ""}`);
        run.status = rootOf(run).status === "done" ? "ready_to_close" : "solving";
        await store.saveRun(run);
        return run;
    });
}
/** Ask for more engine attempts on a leaf (e.g. after escalation), continuing round-robin over solvers. */
export async function retry(store, runId, nodeId, count = 1) {
    const id = (await store.loadRun(runId)).id;
    return withRunLock(store, id, async () => {
        const run = await store.loadRun(id);
        assertNoPending(run);
        const node = run.nodes[nodeId];
        if (!node)
            throw new GraftreeError(`unknown node "${nodeId}"`, "invalid");
        if (node.kind !== "leaf")
            throw new GraftreeError(`retry applies to leaves; for split ${nodeId}, fix the integration and use \`graftree attempt\``, "invalid");
        if (!Number.isSafeInteger(count) || count < 1)
            throw new GraftreeError(`retry count must be a positive whole number, got ${count}`, "invalid");
        const hadWinner = node.winner !== null;
        node.targetAttempts = node.attempts.length + count;
        node.status = "planned";
        node.winner = null;
        node.recommended = null;
        node.awaiting = undefined;
        await resetAncestors(store, run, nodeId);
        // Its code may change, so anything built on the old winner starts over.
        if (hadWinner)
            await resetDependents(store, run, nodeId);
        logEvent(run, "retry", `${nodeId} +${count}`);
        run.status = "solving";
        await store.saveRun(run);
        return run;
    });
}
/**
 * Register a candidate the closer produced itself (e.g. with its own subagents,
 * or glue for an integration). It goes through exactly the same gates.
 */
export async function addExternalAttempt(store, runId, nodeId, src) {
    const id = (await store.loadRun(runId)).id;
    return withRunLock(store, id, async () => {
        const run = await store.loadRun(id);
        assertNoPending(run);
        const cfg = await loadConfig(store.configPath);
        const c = makeCtx(store, run, cfg, {});
        const node = run.nodes[nodeId];
        if (!node)
            throw new GraftreeError(`unknown node "${nodeId}"`, "invalid");
        if (!run.approval)
            throw new GraftreeError("run is not approved", "bad_status");
        if (node.kind === "leaf" && !node.base) {
            if (!depsDone(run, node)) {
                throw new GraftreeError(`${nodeId} depends on ${effectiveDeps(run, node).map((d) => d.id).join(", ")}; decide those first`, "bad_status");
            }
            node.base = await leafBase(c, node);
        }
        if (!node.base)
            throw new GraftreeError(`split ${nodeId} has no merged base yet; run \`graftree run\` first`, "bad_status");
        let commit = src.commit ? await git(store.root, ["rev-parse", "--verify", `${src.commit}^{commit}`]) : undefined;
        if (src.worktree)
            commit = await commitAll(src.worktree, `graftree ${run.id} ${nodeId} (closer)`, cfg.ignore);
        if (!commit)
            throw new GraftreeError("attempt needs --worktree PATH or --commit REV", "invalid");
        if (!(await isAncestor(store.root, node.base, commit))) {
            throw new GraftreeError(`candidate ${commit.slice(0, 12)} does not descend from the node base ${node.base.slice(0, 12)}`, "invalid");
        }
        const slot = node.attempts.find((a) => a.worker === CLOSER && a.status === "running");
        const n = slot?.n ?? node.attempts.length + 1;
        const label = `a${n}`;
        const a = slot ?? { n, kind: "external", worker: CLOSER, status: "running", startedAt: now(), branch: branchName(c, nodeId, label), repairs: 0 };
        if (!slot)
            node.attempts.push(a);
        a.commit = commit;
        a.notes = src.notes;
        await git(store.root, ["branch", "-f", a.branch, commit]);
        // Gate in a fresh worktree at the candidate so the closer's own dir is untouched.
        a.worktree = wtPath(c, nodeId, `${label}-gate`);
        await prepareWorktree(c, a.worktree, null, commit);
        await gateAttempt(c, node, a, a.worktree);
        a.score = a.status === "passed" ? score(a) : undefined;
        a.finishedAt = now();
        if (a.status === "passed") {
            const passed = node.attempts.filter((x) => x.status === "passed");
            node.recommended = [...passed].sort((x, y) => (y.score ?? 0) - (x.score ?? 0))[0].n;
            node.status = "awaiting_closer";
            node.awaiting = `select a winner: ${passed.map((x) => `a${x.n} (${x.worker}, score ${x.score})`).join(", ")}`;
        }
        else {
            if (node.status !== "escalated")
                node.status = "awaiting_closer";
            node.awaiting = `closer attempt ${label} ${a.status}: ${(await failureText(c, a)).slice(-500)}`;
        }
        logEvent(run, "external-attempt", `${nodeId} ${label}: ${a.status}`);
        run.status = "awaiting_closer";
        await store.saveRun(run);
        return a;
    });
}
export async function listFiles(dir, prefix = "") {
    const out = [];
    for (const e of await readdir(dir, { withFileTypes: true })) {
        const rel = prefix ? `${prefix}/${e.name}` : e.name;
        if (e.isDirectory())
            out.push(...(await listFiles(join(dir, e.name), rel)));
        else if (e.isFile())
            out.push(rel);
    }
    return out;
}
/**
 * Add tests after approval, from real review findings. Strictly additive:
 * new files only, never touching locked tests, so the bar can only rise.
 * The run base moves forward (old base + new tests), the new files are locked,
 * the node re-verifies its attempts (repairing ones that now fail), and every
 * ancestor re-integrates on the new base.
 */
export async function harden(store, runId, nodeId, input) {
    const id = (await store.loadRun(runId)).id;
    return withRunLock(store, id, async () => {
        const run = await store.loadRun(id);
        assertNoPending(run);
        if (!run.approval || !["approved", "solving", "awaiting_closer", "ready_to_close"].includes(run.status)) {
            throw new GraftreeError(`run ${id} is "${run.status}"; hardening needs an approved, unfinished run`, "bad_status");
        }
        const node = run.nodes[nodeId];
        if (!node)
            throw new GraftreeError(`unknown node "${nodeId}"`, "invalid");
        if (!input.reason.trim())
            throw new GraftreeError("harden needs --reason (the finding these tests pin down)", "invalid");
        if (!input.command.trim())
            throw new GraftreeError("harden needs --command to run the new tests", "invalid");
        if (!existsSync(input.testsFrom))
            throw new GraftreeError(`tests dir not found: ${input.testsFrom}`, "invalid");
        const files = (await listFiles(input.testsFrom)).map(normalizeRepoPath).sort();
        if (!files.length)
            throw new GraftreeError(`no test files in ${input.testsFrom}`, "invalid");
        const locked = new Set(run.approval.locked.map((l) => l.path));
        const oldBase = run.approval.baseCommit;
        for (const f of files) {
            if (locked.has(f))
                throw new GraftreeError(`${f} is a locked acceptance test; hardening only adds new files`, "invalid");
            const exists = await git(store.root, ["cat-file", "-e", `${oldBase}:${f}`]).then(() => true, () => false);
            if (exists)
                throw new GraftreeError(`${f} already exists in the run base; hardening only adds new files`, "invalid");
        }
        const { commit } = await commitOverlay(store.root, files.map((f) => ({ repoPath: f, sourcePath: join(input.testsFrom, f) })), `graftree: hardening tests for ${id} ${nodeId}\n\n${input.reason.trim()}`, run.approval.baseRef, oldBase);
        for (const f of files)
            run.approval.locked.push({ path: f, sha256: await sha256File(join(input.testsFrom, f)) });
        run.approval.baseCommit = commit;
        await mkdir(store.testsDir(id), { recursive: true });
        await cp(input.testsFrom, store.testsDir(id), { recursive: true });
        for (const target of [node, run.plan?.nodes.find((n) => n.id === nodeId)]) {
            if (!target)
                continue;
            target.acceptance.files = [...new Set([...target.acceptance.files, ...files])];
            target.acceptance.extraCommands = [...new Set([...target.acceptance.extraCommands, input.command.trim()])];
        }
        run.hardening.push({ at: now(), node: nodeId, files, command: input.command.trim(), reason: input.reason.trim(), baseCommit: commit });
        const hadWinner = node.winner !== null;
        Object.assign(node, { winner: null, recommended: null, decidedBy: null, awaiting: undefined, status: "planned" });
        if (node.kind === "leaf")
            node.regate = true;
        else {
            // A split re-integrates its children's winners on the new base.
            for (const a of node.attempts)
                if (a.worktree)
                    await removeWorktree(store.root, a.worktree);
            Object.assign(node, { base: null, attempts: [] });
        }
        await resetAncestors(store, run, nodeId);
        // The bar rose and its winner may change, so anything built on the old winner starts over.
        if (hadWinner)
            await resetDependents(store, run, nodeId);
        logEvent(run, "hardened", `${nodeId}: +${files.length} test file(s): ${input.reason.trim()}`);
        run.status = "solving";
        await store.saveRun(run);
        return run;
    });
}
export async function attemptDiff(store, runId, nodeId, n) {
    const run = await store.loadRun(runId);
    const node = run.nodes[nodeId];
    const a = node?.attempts.find((x) => x.n === n);
    if (!node || !a?.commit || !node.base)
        throw new GraftreeError(`no committed attempt a${n} on node ${nodeId}`, "invalid");
    return diffText(store.root, node.base, a.commit);
}
export async function removeRunWorktrees(store, run) {
    for (const n of Object.values(run.nodes)) {
        for (const a of n.attempts)
            if (a.worktree)
                await removeWorktree(store.root, a.worktree);
    }
    await rm(join(store.runDir(run.id), "wt"), { recursive: true, force: true });
    await git(store.root, ["worktree", "prune"]).catch(() => undefined);
}
export const _test = { integrationAllows, score };
