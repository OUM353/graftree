const num = (o, ...keys) => {
    for (const k of keys)
        if (typeof o[k] === "number")
            return o[k];
    return 0;
};
/**
 * Normalize token usage from any worker: CommandCode (inputTokens/outputTokens),
 * Claude (input_tokens/output_tokens), OpenAI-compatible (prompt_tokens/completion_tokens).
 */
export function normalizeUsage(u) {
    if (!u || typeof u !== "object")
        return { inputTokens: 0, outputTokens: 0, cacheReadTokens: 0 };
    const o = u;
    const details = (o.prompt_tokens_details ?? {});
    return {
        inputTokens: num(o, "inputTokens", "input_tokens", "prompt_tokens"),
        outputTokens: num(o, "outputTokens", "output_tokens", "completion_tokens"),
        cacheReadTokens: num(o, "cacheReadTokens", "cache_read_input_tokens") || num(details, "cached_tokens"),
    };
}
export function addUsage(acc, res) {
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
export function sumUsage(list) {
    const total = { calls: 0, inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, durationMs: 0 };
    for (const u of list) {
        if (!u)
            continue;
        total.calls += u.calls;
        total.inputTokens += u.inputTokens;
        total.outputTokens += u.outputTokens;
        total.cacheReadTokens += u.cacheReadTokens;
        total.durationMs += u.durationMs;
    }
    return total;
}
const k = (n) => (n >= 10_000 ? `${Math.round(n / 1000)}K` : n >= 1000 ? `${(n / 1000).toFixed(1)}K` : String(n));
export const formatUsage = (u) => `${u.calls} call${u.calls === 1 ? "" : "s"}, ${k(u.inputTokens)} in / ${k(u.outputTokens)} out${u.cacheReadTokens ? ` (${k(u.cacheReadTokens)} cached)` : ""}, ${Math.round(u.durationMs / 1000)}s`;
export function runUsage(run) {
    return sumUsage([...Object.values(run.nodes).flatMap((n) => n.attempts.map((a) => a.usage)), run.overheadUsage]);
}
//# sourceMappingURL=usage.js.map