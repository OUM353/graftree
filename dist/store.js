import { randomBytes } from "node:crypto";
import { existsSync } from "node:fs";
import { readFile, readdir } from "node:fs/promises";
import { join } from "node:path";
import { repoRoot } from "./git.js";
import { Run, SCHEMA_VERSION } from "./schema.js";
import { GraftreeError, now, writeFileAtomic } from "./util.js";
export const GRAFTREE_DIR = ".graftree";
/** Filesystem layout of one project's graftree state. */
export class Store {
    root;
    constructor(root) {
        this.root = root;
    }
    static async open(cwd = process.cwd()) {
        return new Store(await repoRoot(cwd));
    }
    get dir() {
        return join(this.root, GRAFTREE_DIR);
    }
    get configPath() {
        return join(this.dir, "config.yaml");
    }
    get runsDir() {
        return join(this.dir, "runs");
    }
    runDir(id) {
        return join(this.runsDir, id);
    }
    treePath(id) {
        return join(this.runDir(id), "tree.json");
    }
    /** Where acceptance tests are drafted, mirroring repo-relative paths. */
    testsDir(id) {
        return join(this.runDir(id), "tests");
    }
    planMdPath(id) {
        return join(this.runDir(id), "plan.md");
    }
    /** Keep per-run state out of version control; config.yaml stays committable. */
    async ensureGitignore() {
        const gi = join(this.dir, ".gitignore");
        if (!existsSync(gi))
            await writeFileAtomic(gi, "runs/\n");
    }
    async createRun(problem, tier) {
        const d = new Date();
        const stamp = d.toISOString().replace(/[-:]/g, "").replace("T", "-").slice(0, 13);
        const id = `r${stamp}-${randomBytes(2).toString("hex")}`;
        const ts = now();
        const run = {
            schemaVersion: SCHEMA_VERSION,
            id,
            problem,
            createdAt: ts,
            updatedAt: ts,
            status: "draft",
            requestedTier: tier,
            plan: null,
            nodes: {},
            feedback: [],
            approval: null,
            final: null,
            hardening: [],
            history: [{ at: ts, event: "created" }],
        };
        await this.ensureGitignore();
        await this.saveRun(run);
        return run;
    }
    async saveRun(run) {
        run.updatedAt = now();
        const valid = Run.parse(run);
        await writeFileAtomic(this.treePath(run.id), `${JSON.stringify(valid, null, 2)}\n`);
    }
    async loadRun(idOrLatest) {
        const id = !idOrLatest || idOrLatest === "latest" ? await this.latestRunId() : idOrLatest;
        const path = this.treePath(id);
        if (!existsSync(path))
            throw new GraftreeError(`run not found: ${id}`, "no_run");
        const parsed = Run.safeParse(JSON.parse(await readFile(path, "utf8")));
        if (!parsed.success)
            throw new GraftreeError(`corrupt tree.json for ${id}: ${parsed.error.message}`, "corrupt");
        return parsed.data;
    }
    async listRunIds() {
        if (!existsSync(this.runsDir))
            return [];
        const entries = await readdir(this.runsDir, { withFileTypes: true });
        return entries
            .filter((e) => e.isDirectory() && existsSync(this.treePath(e.name)))
            .map((e) => e.name)
            .sort();
    }
    async latestRunId() {
        const ids = await this.listRunIds();
        const last = ids.at(-1);
        if (!last)
            throw new GraftreeError("no runs yet; start one with `graftree new`", "no_run");
        return last;
    }
}
export function logEvent(run, event, detail) {
    run.history.push({ at: now(), event, ...(detail ? { detail } : {}) });
}
//# sourceMappingURL=store.js.map