import type { WorkerConfig } from "../schema.js";
import { runCliWorker } from "./cli.js";
import { runOpenAICompatibleWorker } from "./openai-compatible.js";
import type { WorkerResult, WorkerTask } from "./types.js";

export type { WorkerResult, WorkerTask } from "./types.js";

export function runWorker(name: string, w: WorkerConfig, task: WorkerTask): Promise<WorkerResult> {
  switch (w.type) {
    case "cli":
      return runCliWorker(name, w, task);
    case "openai-compatible":
      return runOpenAICompatibleWorker(name, w, task);
  }
}

/** Whether a worker can read and edit files in its cwd by itself (API workers get tools later). */
export function canEditFiles(w: WorkerConfig): boolean {
  return w.type === "cli";
}
