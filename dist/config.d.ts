import { Config, type Role, type WorkerConfig } from "./schema.js";
/** Package root (works from src/ under tsx and from dist/ when installed). */
export declare const PACKAGE_ROOT: string;
export declare const CONFIG_TEMPLATE_PATH: string;
export declare function loadConfig(path: string): Promise<Config>;
export declare function workersForRole(cfg: Config, role: Role): string[];
export declare function getWorker(cfg: Config, name: string): WorkerConfig;
export declare function formatIssues(issues: {
    path: PropertyKey[];
    message: string;
}[]): string;
