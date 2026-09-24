import { type NodeState, type Run } from "./schema.js";
export declare const PLANNER_OUT_DIR = ".graftree-out";
export declare function planJsonSchema(): string;
/** Prompt for a planner/test-writer worker running in a throwaway worktree. */
export declare function plannerPrompt(run: Run): string;
export declare function solverPrompt(run: Run, node: NodeState): string;
export declare function repairPrompt(run: Run, node: NodeState, failure: string): string;
export declare function integratorPrompt(run: Run, node: NodeState, allowed: string[], failure: string): string;
export declare function reviewerPrompt(run: Run, node: NodeState, diff: string, siblingFindings?: string): string;
