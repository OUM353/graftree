import { type PlanCheck } from "./plan.js";
import { type Run } from "./schema.js";
import { type Store } from "./store.js";
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
export declare function proposeRedecomposition(store: Store, runId: string | undefined, nodeId: string, input: RedecomposeInput): Promise<PlanCheck & {
    run: Run;
}>;
/** Human approval of a pending re-decomposition: lock the new tests and reopen the subtree. */
export declare function approveRedecomposition(store: Store, runId: string | undefined, notes?: string): Promise<Run>;
/** The human declines: drop the proposal and resume where the run was. */
export declare function rejectRedecomposition(store: Store, runId: string | undefined, notes: string): Promise<Run>;
