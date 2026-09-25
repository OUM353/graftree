import { runCliWorker } from "./cli.js";
import { runApiAgent } from "./api-agent.js";
import { runOpenAICompatibleWorker } from "./openai-compatible.js";
/**
 * Run a worker on a task. CLI agents bring their own tools; API workers run
 * graftree's tool loop confined to task.cwd. `mode: "complete"` skips tools
 * (single chat completion), used for smoke tests.
 */
export function runWorker(name, w, task, mode = "agent") {
    switch (w.type) {
        case "cli":
            return runCliWorker(name, w, task);
        case "openai-compatible":
            return mode === "agent" ? runApiAgent(name, w, task) : runOpenAICompatibleWorker(name, w, task);
    }
}
