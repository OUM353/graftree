import type { WorkerConfig } from "../schema.js";
import type { WorkerResult, WorkerTask } from "./types.js";
export type { WorkerResult, WorkerTask } from "./types.js";
/**
 * Run a worker on a task. CLI agents bring their own tools; API workers run
 * graftree's tool loop confined to task.cwd. `mode: "complete"` skips tools
 * (single chat completion), used for smoke tests.
 */
export declare function runWorker(name: string, w: WorkerConfig, task: WorkerTask, mode?: "agent" | "complete"): Promise<WorkerResult>;
