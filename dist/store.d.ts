import { Run, type Tier } from "./schema.js";
export declare const GRAFTREE_DIR = ".graftree";
/** Filesystem layout of one project's graftree state. */
export declare class Store {
    readonly root: string;
    constructor(root: string);
    static open(cwd?: string): Promise<Store>;
    get dir(): string;
    get configPath(): string;
    get runsDir(): string;
    runDir(id: string): string;
    treePath(id: string): string;
    /** Where acceptance tests are drafted, mirroring repo-relative paths. */
    testsDir(id: string): string;
    planMdPath(id: string): string;
    /** Keep per-run state out of version control; config.yaml stays committable. */
    ensureGitignore(): Promise<void>;
    createRun(problem: string, tier: Tier | "auto"): Promise<Run>;
    saveRun(run: Run): Promise<void>;
    loadRun(idOrLatest?: string): Promise<Run>;
    listRunIds(): Promise<string[]>;
    latestRunId(): Promise<string>;
}
export declare function logEvent(run: Run, event: string, detail?: string): void;
