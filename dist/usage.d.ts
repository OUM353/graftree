import type { Config, Run, Usage } from "./schema.js";
import type { WorkerResult } from "./workers/types.js";
/**
 * Normalize token usage from any worker: CommandCode (inputTokens/outputTokens),
 * Claude (input_tokens/output_tokens), OpenAI-compatible (prompt_tokens/completion_tokens).
 */
export declare function normalizeUsage(u: unknown): {
    inputTokens: number;
    outputTokens: number;
    cacheReadTokens: number;
};
export declare function addUsage(acc: Usage | undefined, res: Pick<WorkerResult, "usage" | "durationMs">): Usage;
export declare function sumUsage(list: (Usage | undefined)[]): Usage;
export declare const formatUsage: (u: Usage) => string;
export declare function runUsage(run: {
    nodes: Record<string, {
        attempts: {
            usage?: Usage;
        }[];
    }>;
    overheadUsage?: Usage;
}): Usage;
export interface UsageWarning {
    /** Stable id, so each threshold is reported once. */
    key: string;
    message: string;
}
/**
 * Thresholds the run has crossed so far. Totals warn at each multiple of the
 * threshold (1x, 2x, ...); a single attempt warns once.
 */
export declare function usageWarnings(run: Run, budgets: Config["budgets"]): UsageWarning[];
/** Warnings already recorded in the run's history (what `run`, `show` and the report display). */
export declare function recordedWarnings(run: Run): string[];
