import type { OpenAICompatibleWorker } from "../schema.js";
import type { WorkerResult, WorkerTask } from "./types.js";
export declare const AGENT_TOOLS: {
    type: "function";
    function: {
        name: string;
        description: string;
        parameters: {
            type: string;
            properties: Record<string, unknown>;
            required: string[];
            additionalProperties: boolean;
        };
    };
}[];
export declare function executeTool(cwd: string, name: string, args: Record<string, unknown>): Promise<string>;
export declare function runApiAgent(name: string, w: OpenAICompatibleWorker, task: WorkerTask, fetchImpl?: typeof fetch): Promise<WorkerResult>;
