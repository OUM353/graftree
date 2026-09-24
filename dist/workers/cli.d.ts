import type { CliWorker } from "../schema.js";
import type { WorkerResult, WorkerTask } from "./types.js";
/** Fill {prompt} {promptFile} {model} {cwd} in an argv template. No shell is involved. */
export declare function renderArgv(template: string[], vars: Record<string, string>): string[];
/**
 * Extract the final answer from newline-delimited JSON events.
 *
 * Known shapes, checked from the last event backwards:
 * - CommandCode: `{"type":"result","subtype":"success"|…,"finalText":"…","usage":{…}}`
 *   (also `{"type":"event","event":{"type":"run_end","result":{"finalText":"…"}}}`)
 * - Claude Code `-p --output-format stream-json`: `{"type":"result","subtype":"success","is_error":false,"result":"…"}`
 * - Generic: the last event with a string `result`/`text`/`output`/`content`/`message`.
 * A result event reporting failure (non-"success" subtype or is_error) sets ok=false.
 * With no recognizable event, the raw stdout is the text.
 */
export declare function parseNdjson(stdout: string): {
    text: string;
    events: unknown[];
    usage?: unknown;
    ok?: boolean;
};
/** File (in the worker's cwd) holding a prompt too long for a command line. Never snapshotted. */
export declare const TASK_FILE = ".graftree-task.md";
/** Prompts above this go through TASK_FILE: Windows caps a whole command line at 32,767 chars. */
export declare const MAX_ARGV_PROMPT = 8000;
export declare function runCliWorker(name: string, w: CliWorker, task: WorkerTask): Promise<WorkerResult>;
