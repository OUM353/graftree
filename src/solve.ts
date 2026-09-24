import { existsSync } from "node:fs";
import { mkdir, open, readFile, rm } from "node:fs/promises";
import { join, relative } from "node:path";
import { getWorker, loadConfig } from "./config.js";
import { runShell, tail, writeLog } from "./exec.js";
import {
  addBranchWorktree,
  addDetachedWorktree,
  changedFiles,
  commitAll,
  diffStat,
  diffText,
  git,
  isAncestor,
  mergeCommit,
  removeWorktree,
  resetWorktree,
} from "./git.js";
import { matchesAny } from "./glob.js";
import { checkLocked } from "./lifecycle.js";
import { integratorPrompt, repairPrompt, reviewerPrompt, solverPrompt } from "./prompts.js";
import { CLOSER, TIER_DEFAULTS, type Attempt, type CheckResult, type Config, type NodeState, type Run, type RunStatus } from "./schema.js";
import { logEvent, type Store } from "./store.js";
import { GraftreeError, now } from "./util.js";
import { runWorker } from "./workers/index.js";

// ---------------------------------------------------------------------------
// Context
// ---------------------------------------------------------------------------

export interface RunOptions {
  /** Override config budgets.autoSelect (headless use). */
  autoSelect?: boolean;
  /** Progress messages (human-readable). */
  onEvent?: (msg: string) => void;
}

interface Ctx {
  gitLock: Semaphore;
  store: Store;
  run: Run;
  cfg: Config;
  opts: RunOptions;
  deadline: number;
  sem: Semaphore;
  save: () => Promise<void>;
  say: (msg: string) => void;
}

class Semaphore {
  private queue: (() => void)[] = [];
  constructor(private free: number) {}
  async use<T>(fn: () => Promise<T>): Promise<T> {
    if (this.free > 0) this.free--;
    else await new Promise<void>((r) => this.queue.push(r));
    try {
      return await fn();
    } finally {
      const next = this.queue.shift();
      if (next) next();
      else this.free++;
    }
  }
}

function makeCtx(store: Store, run: Run, cfg: Config, opts: RunOptions): Ctx {
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

const wtPath = (c: Ctx, node: string, label: string) => join(c.store.runDir(c.run.id), "wt", node, label);
const logPath = (c: Ctx, node: string, n: number, file: string) => join(c.store.runDir(c.run.id), "nodes", node, `a${n}`, file);
const branchName = (c: Ctx, node: string, label: string) => `graftree/${c.run.id}/${node}/${label}`;
const relRun = (c: Ctx, p: string) => relative(c.store.runDir(c.run.id), p);

const childrenOf = (run: Run, id: string) => Object.values(run.nodes).filter((n) => n.parent === id);
const descendantsOf = (run: Run, id: string): NodeState[] =>
  childrenOf(run, id).flatMap((k) => [k, ...descendantsOf(run, k.id)]);
const ancestorsOf = (run: Run, id: string): NodeState[] => {
  const out: NodeState[] = [];
  let p = run.nodes[id]?.parent;
  while (p) {
    const n = run.nodes[p]!;
    out.push(n);
    p = n.parent;
  }
  return out;
};
const rootOf = (run: Run) => Object.values(run.nodes).find((n) => n.parent === null)!;

function attemptsPerLeaf(c: Ctx): number {
  return c.cfg.budgets.attemptsPerLeaf ?? TIER_DEFAULTS[c.run.plan!.tier].attemptsPerLeaf;
}

const engineWorkers = (names: string[]) => names.filter((n) => n !== CLOSER);

// ---------------------------------------------------------------------------
// Run lock (one engine process per run)
// ---------------------------------------------------------------------------

async function withRunLock<T>(store: Store, runId: string, fn: () => Promise<T>): Promise<T> {
  const lock = join(store.runDir(runId), ".lock");
  await mkdir(store.runDir(runId), { recursive: true });
  if (existsSync(lock)) {
    const pid = Number((await readFile(lock, "utf8")).trim());
    let alive = false;
    try {
      if (pid) process.kill(pid, 0);
      alive = pid > 0;
    } catch {
      alive = false;
    }
    if (alive && pid !== process.pid) throw new GraftreeError(`run ${runId} is already being processed by pid ${pid}`, "locked");
    await rm(lock, { force: true });
  }
  const fh = await open(lock, "wx");
  await fh.write(String(process.pid));
  await fh.close();
  try {
    return await fn();
  } finally {
    await rm(lock, { force: true });
  }
}

// ---------------------------------------------------------------------------
// Gates
// ---------------------------------------------------------------------------

/** Paths an integrator may touch at a split: shared paths, or parent-owned paths no child owns. */
function integrationAllows(run: Run, node: NodeState, file: string): boolean {
  if (matchesAny(node.sharedPaths, file)) return true;
  if (!matchesAny(node.ownedPaths, file)) return false;
  return !childrenOf(run, node.id).some((k) => matchesAny(k.ownedPaths, file));
}

async function runCheck(c: Ctx, cwd: string, commands: string[], log: string): Promise<CheckResult> {
  let out = "";
  let exitCode: number | null = 0;
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
function acceptanceCommands(run: Run, node: NodeState): string[] {
  return [...new Set([node, ...descendantsOf(run, node.id)].map((n) => n.acceptance.command))];
}

async function gateAttempt(c: Ctx, node: NodeState, a: Attempt, wt: string): Promise<void> {
  const commit = a.commit!;
  const base = node.base!;
  const locked = await checkLocked(c.store, c.run, commit);
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
  if (c.cfg.commands.lint) a.gates.lint = await runCheck(c, wt, [c.cfg.commands.lint], logPath(c, node.id, a.n, "lint.log"));
  a.status = a.gates.acceptance.ok ? "passed" : "failed";
}

async function failureText(c: Ctx, a: Attempt): Promise<string> {
  const g = a.gates;
  if (!g) return a.notes ?? "attempt produced no result";
  if (!g.locked.ok) return `Locked acceptance tests were changed: ${g.locked.violations.join(", ")}`;
  if (!g.ownership.ok) return `Edited files outside the allowed paths: ${g.ownership.violations.join(", ")}`;
  for (const check of [g.build, g.acceptance]) {
    if (check && !check.ok && check.log) return tail(await readFile(join(c.store.runDir(c.run.id), check.log), "utf8"));
  }
  return a.notes ?? "unknown failure";
}

function score(a: Attempt): number {
  const size = (a.diffStat?.insertions ?? 0) + (a.diffStat?.deletions ?? 0);
  let s = 100 - Math.min(40, size / 25);
  if (a.gates?.lint && !a.gates.lint.ok) s -= 10;
  s -= a.repairs * 5;
  if (a.reviewVerdict === "concerns") s -= 10;
  if (a.reviewVerdict === "fail") s -= 30;
  return Math.round(s * 10) / 10;
}

// ---------------------------------------------------------------------------
// Attempts
// ---------------------------------------------------------------------------

async function prepareWorktree(c: Ctx, wt: string, branch: string | null, base: string): Promise<void> {
  await mkdir(join(wt, ".."), { recursive: true });
  // Worktree admin dirs and branch refs live in the shared .git; create them one at a time.
  await c.gitLock.use(async () => {
    if (branch) await addBranchWorktree(c.store.root, wt, branch, base);
    else {
      await removeWorktree(c.store.root, wt);
      await addDetachedWorktree(c.store.root, wt, base);
    }
  });
  if (c.cfg.commands.setup) {
    const r = await runShell(c.cfg.commands.setup, wt, c.cfg.commands.timeoutSec);
    if (r.exitCode !== 0) throw new GraftreeError(`setup command failed in ${wt}:\n${tail(r.output, 2000)}`, "setup");
  }
}

async function invokeWorker(c: Ctx, node: NodeState, a: Attempt, workerName: string, prompt: string, logFile: string): Promise<void> {
  const w = getWorker(c.cfg, workerName);
  const res = await runWorker(workerName, w, { prompt, cwd: a.worktree! });
  await writeLog(logPath(c, node.id, a.n, logFile), `${res.stdout}\n--- stderr ---\n${res.stderr}\n--- result ---\n${res.text}`);
  if (!res.ok) c.say(`  ${node.id}/a${a.n} ${workerName}: worker exited ${res.exitCode}${res.timedOut ? " (timed out)" : ""}`);
}

async function snapshotAndGate(c: Ctx, node: NodeState, a: Attempt, message: string): Promise<void> {
  a.commit = await commitAll(a.worktree!, message, c.cfg.ignore);
  await gateAttempt(c, node, a, a.worktree!);
  a.score = a.status === "passed" ? score(a) : undefined;
  a.finishedAt = now();
}

async function runSolveAttempt(c: Ctx, node: NodeState, n: number, workerName: string): Promise<void> {
  const label = `a${n}`;
  const a: Attempt = {
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
    await prepareWorktree(c, a.worktree!, a.branch, node.base!);
    await invokeWorker(c, node, a, workerName, solverPrompt(c.run, node), "worker.log");
    await snapshotAndGate(c, node, a, `graftree ${c.run.id} ${node.id} ${label} (${workerName})`);
  } catch (e) {
    a.status = "error";
    a.notes = (e as Error).message;
    a.finishedAt = now();
  }
  c.say(`  ${node.id}/${label}: ${a.status}${a.score !== undefined ? ` (score ${a.score})` : ""}`);
  await c.save();
}

/** Repair loop: feed failure output back to a worker in the same worktree. */
async function repairNode(c: Ctx, node: NodeState): Promise<boolean> {
  const isSplit = node.kind === "split";
  const pool = engineWorkers(isSplit ? c.cfg.roles.integrator : c.cfg.roles.solver);
  let rounds = node.attempts.reduce((s, a) => s + a.repairs, 0);
  while (rounds < c.cfg.budgets.maxRepairRounds && Date.now() < c.deadline) {
    // Best near-miss: failed (not disqualified), engine-managed worktree, fewest repairs, smallest diff.
    const candidates = node.attempts
      .filter((a) => a.status === "failed" && a.kind !== "external" && a.worktree && existsSync(a.worktree))
      .sort((x, y) => x.repairs - y.repairs || (x.diffStat?.insertions ?? 0) - (y.diffStat?.insertions ?? 0));
    const a = candidates[0];
    if (!a) return false;
    const workerName = isSplit ? pool[rounds % Math.max(1, pool.length)] : a.worker !== CLOSER && a.worker !== "merge" ? a.worker : pool[0];
    if (!workerName) return false;
    const failure = await failureText(c, a);
    rounds++;
    a.repairs++;
    a.status = "running";
    await c.save();
    c.say(`  ${node.id}/a${a.n}: repair ${a.repairs} by ${workerName}`);
    try {
      const allowed = isSplit ? [...node.sharedPaths, `${node.ownedPaths.join(", ")} (except paths owned by children)`] : node.ownedPaths;
      const prompt = isSplit ? integratorPrompt(c.run, node, allowed, failure) : repairPrompt(c.run, node, failure);
      await invokeWorker(c, node, a, workerName, prompt, `repair${a.repairs}.log`);
      if (isSplit && a.worker === "merge") a.worker = workerName;
      await snapshotAndGate(c, node, a, `graftree ${c.run.id} ${node.id} a${a.n} repair ${a.repairs} (${workerName})`);
    } catch (e) {
      a.status = "error";
      a.notes = (e as Error).message;
    }
    c.say(`  ${node.id}/a${a.n}: ${a.status} after repair`);
    await c.save();
    // (status is reassigned inside awaited calls; widen so TS doesn't keep the "running" narrowing)
    if ((a.status as Attempt["status"]) === "passed") return true;
  }
  return false;
}

async function reviewCandidates(c: Ctx, node: NodeState): Promise<void> {
  const reviewers = engineWorkers(c.cfg.roles.reviewer);
  if (!reviewers.length) return;
  const top = node.attempts
    .filter((a) => a.status === "passed" && !a.review && a.worktree && existsSync(a.worktree))
    .sort((x, y) => (y.score ?? 0) - (x.score ?? 0))
    .slice(0, 2);
  for (const [i, a] of top.entries()) {
    const reviewer = reviewers[i % reviewers.length]!;
    // Prefer a reviewer different from the author when possible.
    const pick = reviewers.find((r) => r !== a.worker) ?? reviewer;
    c.say(`  ${node.id}/a${a.n}: review by ${pick}`);
    const diff = await diffText(c.store.root, node.base!, a.commit!);
    const res = await runWorker(pick, getWorker(c.cfg, pick), { prompt: reviewerPrompt(c.run, node, tail(diff, 60_000)), cwd: a.worktree! });
    await resetWorktree(a.worktree!);
    const file = logPath(c, node.id, a.n, "review.md");
    await writeLog(file, `# Review of ${node.id}/a${a.n} by ${pick}\n\n${res.ok ? res.text : `reviewer failed: ${res.stderr}`}\n`);
    a.review = relRun(c, file);
    const v = /VERDICT:\s*(pass|concerns|fail)/i.exec(res.text)?.[1]?.toLowerCase();
    a.reviewVerdict = (v as Attempt["reviewVerdict"]) ?? "unknown";
    a.score = score(a);
    await c.save();
  }
}

/** After attempts: rank, review, then either auto-select or hand the decision to the closer. */
async function settleNode(c: Ctx, node: NodeState): Promise<void> {
  let passed = node.attempts.filter((a) => a.status === "passed");
  if (!passed.length && (await repairNode(c, node))) passed = node.attempts.filter((a) => a.status === "passed");
  if (!passed.length) {
    node.status = "escalated";
    const tried = node.attempts.map((a) => `a${a.n}:${a.worker}:${a.status}`).join(", ") || "none";
    const kinds = node.kind === "split" ? "fix the integration worktree and submit it with `graftree attempt`" : "`graftree retry` for fresh attempts, submit your own with `graftree attempt`";
    node.awaiting = `no attempt passed (${tried}); ${kinds}, or reject and replan`;
    return;
  }
  await reviewCandidates(c, node);
  for (const a of passed) a.score = score(a);
  const best = [...passed].sort((x, y) => (y.score ?? 0) - (x.score ?? 0))[0]!;
  node.recommended = best.n;
  const auto = c.opts.autoSelect ?? c.cfg.budgets.autoSelect;
  if (auto) {
    node.winner = best.n;
    node.decidedBy = "engine (autoSelect)";
    node.status = "done";
    node.awaiting = undefined;
    logEvent(c.run, "auto-selected", `${node.id} a${best.n}`);
  } else {
    node.status = "awaiting_closer";
    node.awaiting = `select a winner among passing attempts: ${passed.map((a) => `a${a.n} (${a.worker}, score ${a.score})`).join(", ")}; recommended a${best.n}`;
  }
}

async function solveLeaf(c: Ctx, node: NodeState): Promise<void> {
  node.status = "solving";
  node.base ??= c.run.approval!.baseCommit;
  node.targetAttempts ??= attemptsPerLeaf(c);
  const pool = c.cfg.roles.solver;
  const jobs: Promise<void>[] = [];
  for (let n = node.attempts.length + 1; n <= node.targetAttempts; n++) {
    const worker = pool[(n - 1) % pool.length]!;
    if (worker === CLOSER) {
      // Closer-owned slot: the root agent submits this attempt itself via `graftree attempt`.
      node.attempts.push({ n, kind: "external", worker: CLOSER, status: "running", startedAt: now(), branch: branchName(c, node.id, `a${n}`), repairs: 0, notes: "awaiting closer submission" });
      continue;
    }
    if (Date.now() > c.deadline) break;
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

async function integrateSplit(c: Ctx, node: NodeState): Promise<void> {
  node.status = "integrating";
  if (!node.base) {
    const wt = wtPath(c, node.id, "merge");
    await prepareWorktree(c, wt, branchName(c, node.id, "merge"), c.run.approval!.baseCommit);
    for (const k of childrenOf(c.run, node.id)) {
      const win = k.attempts.find((a) => a.n === k.winner)!;
      const ok = await mergeCommit(wt, win.commit!, `graftree ${c.run.id}: merge ${k.id} a${win.n} into ${node.id}`);
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
    const a: Attempt = { n: 1, kind: "integrate", worker: "merge", status: "running", startedAt: now(), branch: branchName(c, node.id, "a1"), worktree: wtPath(c, node.id, "a1"), repairs: 0 };
    node.attempts.push(a);
    c.say(`  ${node.id}: integrating ${childrenOf(c.run, node.id).length} children`);
    try {
      await prepareWorktree(c, a.worktree!, a.branch, node.base);
      await snapshotAndGate(c, node, a, `graftree ${c.run.id} ${node.id} a1 (merge)`);
    } catch (e) {
      a.status = "error";
      a.notes = (e as Error).message;
    }
    c.say(`  ${node.id}/a1: ${a.status}`);
    await c.save();
  }
  if (!node.attempts.some((a) => a.status === "passed") && !engineWorkers(c.cfg.roles.integrator).length) {
    const a1 = node.attempts[0]!;
    node.status = "awaiting_closer";
    node.awaiting = `integration needs glue: edit ${a1.worktree} (allowed: sharedPaths ${JSON.stringify(node.sharedPaths)} or unowned parent paths), then \`graftree attempt ${c.run.id} ${node.id} --worktree ${a1.worktree}\``;
    return;
  }
  await settleNode(c, node);
}

// ---------------------------------------------------------------------------
// Public operations
// ---------------------------------------------------------------------------

export interface Decision {
  node: string;
  status: string;
  awaiting?: string;
  recommended: number | null;
  candidates: { n: number; worker: string; status: string; score?: number; review?: string; branch: string; diffStat?: Attempt["diffStat"] }[];
}

export interface RunSummary {
  run: string;
  status: RunStatus;
  decisions: Decision[];
  next: string;
}

export function summarize(run: Run): RunSummary {
  const decisions: Decision[] = Object.values(run.nodes)
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
  const next =
    run.status === "ready_to_close"
      ? `graftree close ${run.id}`
      : decisions.length
        ? `inspect with \`graftree diff ${run.id} <node> <attempt>\`, then \`graftree decide ${run.id} <node> <attempt>\` (or retry/attempt), then \`graftree run ${run.id}\``
        : run.status === "done"
          ? `merge branch ${run.final?.branch}`
          : `graftree run ${run.id}`;
  return { run: run.id, status: run.status, decisions, next };
}

/**
 * Drive the tree as far as possible: solve ready leaves, integrate ready
 * splits, and stop when everything left needs the closer (or the root is done).
 * Safe to re-run; it resumes from tree.json.
 */
export async function runTree(store: Store, runId: string | undefined, opts: RunOptions = {}): Promise<RunSummary> {
  const run0 = await store.loadRun(runId);
  return withRunLock(store, run0.id, async () => {
    const run = await store.loadRun(run0.id);
    if (!["approved", "solving", "awaiting_closer"].includes(run.status)) {
      if (run.status === "ready_to_close" || run.status === "done") return summarize(run);
      throw new GraftreeError(`run ${run.id} is "${run.status}"; it must be approved before solving`, "bad_status");
    }
    const cfg = await loadConfig(store.configPath);
    const c = makeCtx(store, run, cfg, opts);

    // Recover from an interrupted engine: drop attempts that never finished so they run again.
    for (const n of Object.values(run.nodes)) {
      const lost = n.attempts.filter((a) => a.status === "running" && a.worker !== CLOSER);
      for (const a of lost) {
        if (a.worktree) await removeWorktree(store.root, a.worktree);
        logEvent(run, "attempt-interrupted", `${n.id} a${a.n}`);
      }
      n.attempts = n.attempts.filter((a) => !lost.includes(a));
    }
    if (run.status !== "solving") logEvent(run, "solving");
    run.status = "solving";
    await c.save();

    for (;;) {
      const ready = Object.values(run.nodes).filter((n) => {
        if (!["planned", "solving", "integrating"].includes(n.status)) return false;
        return n.kind === "leaf" || childrenOf(run, n.id).every((k) => k.status === "done");
      });
      if (!ready.length || Date.now() > c.deadline) break;
      c.say(`▶ ${ready.map((n) => n.id).join(", ")}`);
      await Promise.all(ready.map((n) => (n.kind === "leaf" ? solveLeaf(c, n) : integrateSplit(c, n))));
      await c.save();
    }

    const root = rootOf(run);
    if (root.status === "done") run.status = "ready_to_close";
    else if (Object.values(run.nodes).some((n) => n.status === "awaiting_closer" || n.status === "escalated")) run.status = "awaiting_closer";
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
async function resetAncestors(store: Store, run: Run, id: string): Promise<void> {
  for (const anc of ancestorsOf(run, id)) {
    for (const a of anc.attempts) if (a.worktree) await removeWorktree(store.root, a.worktree);
    if (anc.attempts.length || anc.base) logEvent(run, "reopened", `${anc.id} (child ${id} changed)`);
    Object.assign(anc, { status: "planned", base: null, attempts: [], recommended: null, winner: null, decidedBy: null, awaiting: undefined });
  }
}

/** The closer's selection. Only a passing attempt can win: the bar is never lowered. */
export async function decide(store: Store, runId: string | undefined, nodeId: string, n: number, notes?: string, by = "closer"): Promise<Run> {
  const id = (await store.loadRun(runId)).id;
  return withRunLock(store, id, async () => {
    const run = await store.loadRun(id);
    const node = run.nodes[nodeId];
    if (!node) throw new GraftreeError(`unknown node "${nodeId}"`, "invalid");
    const a = node.attempts.find((x) => x.n === n);
    if (!a) throw new GraftreeError(`node ${nodeId} has no attempt a${n}`, "invalid");
    if (a.status !== "passed") throw new GraftreeError(`a${n} did not pass its gates (status ${a.status}); only passing attempts can be selected`, "invalid");
    const changed = node.winner !== null && node.winner !== n;
    node.winner = n;
    node.decidedBy = by;
    node.decisionNotes = notes;
    node.status = "done";
    node.awaiting = undefined;
    if (changed) await resetAncestors(store, run, nodeId);
    logEvent(run, "decided", `${nodeId} a${n}${notes ? `: ${notes}` : ""}`);
    run.status = rootOf(run).status === "done" ? "ready_to_close" : "solving";
    await store.saveRun(run);
    return run;
  });
}

/** Ask for more engine attempts on a leaf (e.g. after escalation), continuing round-robin over solvers. */
export async function retry(store: Store, runId: string | undefined, nodeId: string, count = 1): Promise<Run> {
  const id = (await store.loadRun(runId)).id;
  return withRunLock(store, id, async () => {
    const run = await store.loadRun(id);
    const node = run.nodes[nodeId];
    if (!node) throw new GraftreeError(`unknown node "${nodeId}"`, "invalid");
    if (node.kind !== "leaf") throw new GraftreeError(`retry applies to leaves; for split ${nodeId}, fix the integration and use \`graftree attempt\``, "invalid");
    node.targetAttempts = node.attempts.length + count;
    node.status = "planned";
    node.winner = null;
    node.recommended = null;
    node.awaiting = undefined;
    await resetAncestors(store, run, nodeId);
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
export async function addExternalAttempt(
  store: Store,
  runId: string | undefined,
  nodeId: string,
  src: { worktree?: string; commit?: string; notes?: string },
): Promise<Attempt> {
  const id = (await store.loadRun(runId)).id;
  return withRunLock(store, id, async () => {
    const run = await store.loadRun(id);
    const cfg = await loadConfig(store.configPath);
    const c = makeCtx(store, run, cfg, {});
    const node = run.nodes[nodeId];
    if (!node) throw new GraftreeError(`unknown node "${nodeId}"`, "invalid");
    if (!run.approval) throw new GraftreeError("run is not approved", "bad_status");
    node.base ??= node.kind === "leaf" ? run.approval.baseCommit : null;
    if (!node.base) throw new GraftreeError(`split ${nodeId} has no merged base yet; run \`graftree run\` first`, "bad_status");

    let commit = src.commit ? await git(store.root, ["rev-parse", "--verify", `${src.commit}^{commit}`]) : undefined;
    if (src.worktree) commit = await commitAll(src.worktree, `graftree ${run.id} ${nodeId} (closer)`, cfg.ignore);
    if (!commit) throw new GraftreeError("attempt needs --worktree PATH or --commit REV", "invalid");
    if (!(await isAncestor(store.root, node.base, commit))) {
      throw new GraftreeError(`candidate ${commit.slice(0, 12)} does not descend from the node base ${node.base.slice(0, 12)}`, "invalid");
    }

    const slot = node.attempts.find((a) => a.worker === CLOSER && a.status === "running");
    const n = slot?.n ?? node.attempts.length + 1;
    const label = `a${n}`;
    const a: Attempt = slot ?? { n, kind: "external", worker: CLOSER, status: "running", startedAt: now(), branch: branchName(c, nodeId, label), repairs: 0 };
    if (!slot) node.attempts.push(a);
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
      node.recommended = [...passed].sort((x, y) => (y.score ?? 0) - (x.score ?? 0))[0]!.n;
      node.status = "awaiting_closer";
      node.awaiting = `select a winner: ${passed.map((x) => `a${x.n} (${x.worker}, score ${x.score})`).join(", ")}`;
    } else {
      if (node.status !== "escalated") node.status = "awaiting_closer";
      node.awaiting = `closer attempt ${label} ${a.status}: ${(await failureText(c, a)).slice(-500)}`;
    }
    logEvent(run, "external-attempt", `${nodeId} ${label}: ${a.status}`);
    run.status = "awaiting_closer";
    await store.saveRun(run);
    return a;
  });
}

export async function attemptDiff(store: Store, runId: string | undefined, nodeId: string, n: number): Promise<string> {
  const run = await store.loadRun(runId);
  const node = run.nodes[nodeId];
  const a = node?.attempts.find((x) => x.n === n);
  if (!node || !a?.commit || !node.base) throw new GraftreeError(`no committed attempt a${n} on node ${nodeId}`, "invalid");
  return diffText(store.root, node.base, a.commit);
}

export async function removeRunWorktrees(store: Store, run: Run): Promise<void> {
  for (const n of Object.values(run.nodes)) {
    for (const a of n.attempts) if (a.worktree) await removeWorktree(store.root, a.worktree);
  }
  await rm(join(store.runDir(run.id), "wt"), { recursive: true, force: true });
  await git(store.root, ["worktree", "prune"]).catch(() => undefined);
}

export const _test = { integrationAllows, score };
