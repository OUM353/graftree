import { type Attempt, type NodeState, type Run, type RunStatus } from "./schema.js";
import { type Store } from "./store.js";
import { runUsage } from "./usage.js";
export interface RunOptions {
    /** Override config budgets.autoSelect (headless use). */
    autoSelect?: boolean;
    /** Progress messages (human-readable). */
    onEvent?: (msg: string) => void;
}
/** While a re-decomposition waits for the human, nothing else may change the tree. */
export declare function assertNoPending(run: Run): void;
export declare function withRunLock<T>(store: Store, runId: string, fn: () => Promise<T>): Promise<T>;
/** Paths an integrator may touch at a split: shared paths, or parent-owned paths no child owns. */
declare function integrationAllows(run: Run, node: NodeState, file: string): boolean;
declare function score(a: Attempt): number;
export interface Decision {
    node: string;
    status: string;
    awaiting?: string;
    recommended: number | null;
    candidates: {
        n: number;
        worker: string;
        status: string;
        score?: number;
        review?: string;
        branch: string;
        diffStat?: Attempt["diffStat"];
    }[];
}
export interface RunSummary {
    run: string;
    status: RunStatus;
    usage: ReturnType<typeof runUsage>;
    decisions: Decision[];
    /** Usage warnings raised so far (high tokens, many calls, a runaway attempt, wall time). */
    warnings: string[];
    next: string;
}
export declare function summarize(run: Run): RunSummary;
/**
 * Drive the tree as far as possible: solve ready leaves, integrate ready
 * splits, and stop when everything left needs the closer (or the root is done).
 * Safe to re-run; it resumes from tree.json.
 */
export declare function runTree(store: Store, runId: string | undefined, opts?: RunOptions): Promise<RunSummary>;
/** Reopen everything above a node whose winner changed; their merges are stale. */
export declare function resetAncestors(store: Store, run: Run, id: string): Promise<void>;
/** The closer's selection. Only a passing attempt can win: the bar is never lowered. */
export declare function decide(store: Store, runId: string | undefined, nodeId: string, n: number, notes?: string, by?: string): Promise<Run>;
/** Ask for more engine attempts on a leaf (e.g. after escalation), continuing round-robin over solvers. */
export declare function retry(store: Store, runId: string | undefined, nodeId: string, count?: number): Promise<Run>;
/**
 * Register a candidate the closer produced itself (e.g. with its own subagents,
 * or glue for an integration). It goes through exactly the same gates.
 */
export declare function addExternalAttempt(store: Store, runId: string | undefined, nodeId: string, src: {
    worktree?: string;
    commit?: string;
    notes?: string;
}): Promise<Attempt>;
export declare function listFiles(dir: string, prefix?: string): Promise<string[]>;
export interface HardenInput {
    /** Directory mirroring repo-relative paths, holding the NEW test files. */
    testsFrom: string;
    /** Command that runs the new tests; must exit 0 for the node to count as done. */
    command: string;
    /** The review finding(s) these tests pin down. Goes into the report. */
    reason: string;
}
/**
 * Add tests after approval, from real review findings. Strictly additive:
 * new files only, never touching locked tests, so the bar can only rise.
 * The run base moves forward (old base + new tests), the new files are locked,
 * the node re-verifies its attempts (repairing ones that now fail), and every
 * ancestor re-integrates on the new base.
 */
export declare function harden(store: Store, runId: string | undefined, nodeId: string, input: HardenInput): Promise<Run>;
export declare function attemptDiff(store: Store, runId: string | undefined, nodeId: string, n: number): Promise<string>;
export declare function removeRunWorktrees(store: Store, run: Run): Promise<void>;
export declare const _test: {
    integrationAllows: typeof integrationAllows;
    score: typeof score;
};
export {};
