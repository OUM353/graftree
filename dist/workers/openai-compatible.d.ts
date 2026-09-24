import type { OpenAICompatibleWorker } from "../schema.js";
import type { WorkerResult, WorkerTask } from "./types.js";
/**
 * Single-shot chat completion against an OpenAI-compatible endpoint
 * (OpenRouter, Ollama, vLLM, ...). The tool-using agent loop for API workers
 * builds on this in the solve phase.
 */
export declare function runOpenAICompatibleWorker(name: string, w: OpenAICompatibleWorker, task: WorkerTask, fetchImpl?: typeof fetch): Promise<WorkerResult>;
