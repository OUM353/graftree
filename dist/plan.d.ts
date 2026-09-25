import { Plan, type Config, type NodeState, type PlanNode, type Run } from "./schema.js";
export interface PlanCheck {
    plan: Plan | null;
    errors: string[];
    warnings: string[];
}
/**
 * Parse and validate a submitted plan. Structural rules enforce the design's
 * accuracy principles: one root, real splits (>=2 children), depth within the
 * tier, disjoint sibling ownership, and executable acceptance for every node.
 */
export declare function checkPlan(input: unknown, opts?: {
    testsDir?: string;
}): PlanCheck;
export declare function nodesFromPlan(plan: Plan): Record<string, NodeState>;
export declare function allAcceptanceFiles(plan: Plan): string[];
/** Tree drawing, e.g. for plan.md and `graftree show`. */
export declare function renderTree(plan: Plan, label?: (n: PlanNode) => string): string;
export interface WorkEstimate {
    leaves: number;
    splits: number;
    attemptsPerLeaf: number;
    /** Attempts run by engine workers (the rest are the closer's own). */
    solverRuns: number;
    /**
     * Worker calls if every attempt passes first time: the solver runs plus one
     * review per node. A split's first attempt is a plain git merge (no call).
     */
    minCalls: number;
    /**
     * Worker calls if every failing attempt uses its whole repair budget (splits
     * included, when integrators are workers) and every candidate gets reviewed.
     * Hardening and re-decomposition add budget on top.
     */
    maxCalls: number;
    /** True when the closer (the root agent) also plans, solves, integrates or reviews; that usage is not metered. */
    closerWorks: boolean;
}
/** How much a plan will cost in worker calls, before anything is spent. A single-agent run is one call. */
export declare function estimateWork(plan: Plan, cfg: Config): WorkEstimate;
/** One-line cost notice shown before approval. */
export declare function estimateNotice(e: WorkEstimate): string;
/** Human-readable plan for the approval checkpoint. */
export declare function renderPlanMarkdown(run: Run, cfg: Config): string;
/**
 * Siblings this node, or any of its ancestors, depends on. Their winning code
 * is where the node's leaves start, so tests may use the real implementation.
 */
export declare function effectiveDeps(run: Run, node: Pick<NodeState, "parent" | "dependsOn">): NodeState[];
