import type { CliWorker } from "../schema.js";
import type { WorkerResult, WorkerTask } from "./types.js";
/** Fill {prompt} {promptFile} {model} {cwd} in an argv template. No shell is involved. */
export declare function renderArgv(template: string[], vars: Record<string, string>): string[];
/**
 * Extract the final answer from newline-delimited JSON events. Agent CLIs
 * differ in event shapes, so this looks for the last event carrying a
 * result-like field and falls back to raw stdout.
 */
export declare function parseNdjson(stdout: string): {
    text: string;
    events: unknown[];
    usage?: unknown;
};
/** File (in the worker's cwd) holding a prompt too long for a command line. Never snapshotted. */
export declare const TASK_FILE = ".graftree-task.md";
/** Prompts above this go through TASK_FILE: Windows caps a whole command line at 32,767 chars. */
export declare const MAX_ARGV_PROMPT = 8000;
export declare function runCliWorker(name: string, w: CliWorker, task: WorkerTask): Promise<WorkerResult>;
