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
/** Human-readable plan for the approval checkpoint. */
export declare function renderPlanMarkdown(run: Run, cfg: Config): string;
