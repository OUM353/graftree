import { type PlanCheck } from "./plan.js";
import type { Run, Tier } from "./schema.js";
import { type Store } from "./store.js";
import { type WorkerResult } from "./workers/index.js";
export declare function newRun(store: Store, problem: string, tier?: Tier | "auto"): Promise<Run>;
/**
 * Submit a plan (authored by the closer or a worker). Optionally copy drafted
 * tests from `testsFrom` (a dir mirroring repo-relative paths) into the run.
 * On success the run pauses at awaiting_approval and plan.md is written.
 */
export declare function submitPlan(store: Store, run: Run, planInput: unknown, opts?: {
    testsFrom?: string;
    author?: string;
}): Promise<PlanCheck>;
export interface WorkerPlanResult extends PlanCheck {
    worker: WorkerResult;
}
/** Ask a worker to plan + draft tests in a throwaway worktree, then submit its output. */
export declare function planWithWorker(store: Store, run: Run, workerName: string): Promise<WorkerPlanResult>;
/**
 * Human approval gate. Locks acceptance tests by hash and records a base
 * commit (HEAD + tests) under refs/graftree/<run>/base. Nothing touches the
 * user's working tree or branch.
 */
export declare function approveRun(store: Store, run: Run, notes?: string): Promise<Run>;
export declare function rejectRun(store: Store, run: Run, notes: string): Promise<Run>;
export interface LockViolation {
    path: string;
    reason: "modified" | "deleted";
}
/**
 * Check a candidate commit against the locked acceptance tests. Any change to a
 * locked file disqualifies the candidate.
 */
export declare function checkLocked(store: Store, run: Run, candidateCommit: string, from?: string): Promise<LockViolation[]>;
