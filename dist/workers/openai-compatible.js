/**
 * Single-shot chat completion against an OpenAI-compatible endpoint
 * (OpenRouter, Ollama, vLLM, ...). The tool-using agent loop for API workers
 * builds on this in the solve phase.
 */
export async function runOpenAICompatibleWorker(name, w, task, fetchImpl = fetch) {
    const started = Date.now();
    const base = {
        worker: name,
        exitCode: null,
        timedOut: false,
        durationMs: 0,
    };
    const headers = { "content-type": "application/json", ...w.headers };
    if (w.apiKeyEnv) {
        const key = process.env[w.apiKeyEnv];
        if (!key) {
            return { ...base, ok: false, text: "", stdout: "", stderr: `environment variable ${w.apiKeyEnv} is not set`, durationMs: 0 };
        }
        headers.authorization = `Bearer ${key}`;
    }
    const body = {
        model: w.model,
        messages: [{ role: "user", content: task.prompt }],
        ...(w.maxTokens ? { max_tokens: w.maxTokens } : {}),
    };
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), (task.timeoutSec ?? w.timeoutSec) * 1000);
    try {
        const res = await fetchImpl(`${w.baseUrl.replace(/\/$/, "")}/chat/completions`, {
            method: "POST",
            headers,
            body: JSON.stringify(body),
            signal: ctrl.signal,
        });
        const raw = await res.text();
        if (!res.ok) {
            return { ...base, ok: false, exitCode: res.status, text: "", stdout: raw, stderr: `HTTP ${res.status}`, durationMs: Date.now() - started };
        }
        const json = JSON.parse(raw);
        const text = json.choices?.[0]?.message?.content ?? "";
        return { ...base, ok: text.length > 0, exitCode: 0, text, stdout: raw, stderr: "", usage: json.usage, durationMs: Date.now() - started };
    }
    catch (e) {
        const timedOut = e.name === "AbortError";
        return { ...base, ok: false, timedOut, text: "", stdout: "", stderr: e.message, durationMs: Date.now() - started };
    }
    finally {
        clearTimeout(timer);
    }
}
//# sourceMappingURL=openai-compatible.js.map