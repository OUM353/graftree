import type { CheckResult, Run } from "./schema.js";
import { type Store } from "./store.js";
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
export declare function closeRun(store: Store, runId: string | undefined, opts?: {
    keepWorktrees?: boolean;
}): Promise<CloseResult>;
