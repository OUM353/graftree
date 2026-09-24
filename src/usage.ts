import type { Config, Run, Usage } from "./schema.js";
import type { WorkerResult } from "./workers/types.js";

const num = (o: Record<string, unknown>, ...keys: string[]) => {
  for (const k of keys) if (typeof o[k] === "number") return o[k] as number;
  return 0;
};

/**
 * Normalize token usage from any worker: CommandCode (inputTokens/outputTokens),
 * Claude (input_tokens/output_tokens), OpenAI-compatible (prompt_tokens/completion_tokens).
 */
export function normalizeUsage(u: unknown): { inputTokens: number; outputTokens: number; cacheReadTokens: number } {
  if (!u || typeof u !== "object") return { inputTokens: 0, outputTokens: 0, cacheReadTokens: 0 };
  const o = u as Record<string, unknown>;
  const details = (o.prompt_tokens_details ?? {}) as Record<string, unknown>;
  return {
    inputTokens: num(o, "inputTokens", "input_tokens", "prompt_tokens"),
    outputTokens: num(o, "outputTokens", "output_tokens", "completion_tokens"),
    cacheReadTokens: num(o, "cacheReadTokens", "cache_read_input_tokens") || num(details, "cached_tokens"),
  };
}

export function addUsage(acc: Usage | undefined, res: Pick<WorkerResult, "usage" | "durationMs">): Usage {
  const u = normalizeUsage(res.usage);
  const a = acc ?? { calls: 0, inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, durationMs: 0 };
  return {
    calls: a.calls + 1,
    inputTokens: a.inputTokens + u.inputTokens,
    outputTokens: a.outputTokens + u.outputTokens,
    cacheReadTokens: a.cacheReadTokens + u.cacheReadTokens,
    durationMs: a.durationMs + res.durationMs,
  };
}

export function sumUsage(list: (Usage | undefined)[]): Usage {
  const total: Usage = { calls: 0, inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, durationMs: 0 };
  for (const u of list) {
    if (!u) continue;
    total.calls += u.calls;
    total.inputTokens += u.inputTokens;
    total.outputTokens += u.outputTokens;
    total.cacheReadTokens += u.cacheReadTokens;
    total.durationMs += u.durationMs;
  }
  return total;
}

const k = (n: number) => (n >= 10_000 ? `${Math.round(n / 1000)}K` : n >= 1000 ? `${(n / 1000).toFixed(1)}K` : String(n));
export const formatUsage = (u: Usage) =>
  `${u.calls} call${u.calls === 1 ? "" : "s"}, ${k(u.inputTokens)} in / ${k(u.outputTokens)} out${u.cacheReadTokens ? ` (${k(u.cacheReadTokens)} cached)` : ""}, ${Math.round(u.durationMs / 1000)}s`;

export function runUsage(run: { nodes: Record<string, { attempts: { usage?: Usage }[] }>; overheadUsage?: Usage }): Usage {
  return sumUsage([...Object.values(run.nodes).flatMap((n) => n.attempts.map((a) => a.usage)), run.overheadUsage]);
}

export interface UsageWarning {
  /** Stable id, so each threshold is reported once. */
  key: string;
  message: string;
}

const tokens = (u: Usage) => u.inputTokens + u.outputTokens;

/**
 * Thresholds the run has crossed so far. Totals warn at each multiple of the
 * threshold (1x, 2x, ...); a single attempt warns once.
 */
export function usageWarnings(run: Run, budgets: Config["budgets"]): UsageWarning[] {
  const out: UsageWarning[] = [];
  const total = runUsage(run);
  const cached = total.cacheReadTokens ? ` (${k(total.cacheReadTokens)} of the input was cached)` : "";
  if (budgets.warnTokens > 0) {
    const x = Math.floor(tokens(total) / budgets.warnTokens);
    if (x >= 1) out.push({ key: `tokens:${x}`, message: `high token usage: ${k(tokens(total))} tokens so far${cached}, over ${x}× budgets.warnTokens (${k(budgets.warnTokens)})` });
  }
  if (budgets.warnCalls > 0) {
    const x = Math.floor(total.calls / budgets.warnCalls);
    if (x >= 1) out.push({ key: `calls:${x}`, message: `many worker calls: ${total.calls} so far, over ${x}× budgets.warnCalls (${budgets.warnCalls})` });
  }
  if (budgets.warnAttemptTokens > 0) {
    for (const n of Object.values(run.nodes)) {
      for (const a of n.attempts) {
        if (a.usage && tokens(a.usage) >= budgets.warnAttemptTokens) {
          out.push({
            key: `attempt:${n.id}/a${a.n}`,
            message: `${n.id}/a${a.n} (${a.worker}) used ${k(tokens(a.usage))} tokens in ${a.usage.calls} call(s), over budgets.warnAttemptTokens (${k(budgets.warnAttemptTokens)}); check its logs for a looping agent`,
          });
        }
      }
    }
  }
  return out;
}

/** Warnings already recorded in the run's history (what `run`, `show` and the report display). */
export function recordedWarnings(run: Run): string[] {
  return run.history.filter((h) => h.event === "usage-warning" && h.detail).map((h) => h.detail!.replace(/^[^ ]+ /, ""));
}
