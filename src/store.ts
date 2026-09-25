import { randomBytes } from "node:crypto";
import { existsSync } from "node:fs";
import { readFile, readdir } from "node:fs/promises";
import { join } from "node:path";
import { repoRoot } from "./git.js";
import { Run, SCHEMA_VERSION, type Tier } from "./schema.js";
import { GraftreeError, now, writeFileAtomic } from "./util.js";

export const GRAFTREE_DIR = ".graftree";

/** Filesystem layout of one project's graftree state. */
export class Store {
  constructor(readonly root: string) {}

  static async open(cwd = process.cwd()): Promise<Store> {
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
  runDir(id: string) {
    return join(this.runsDir, id);
  }
  treePath(id: string) {
    return join(this.runDir(id), "tree.json");
  }
  /** Where acceptance tests are drafted, mirroring repo-relative paths. */
  testsDir(id: string) {
    return join(this.runDir(id), "tests");
  }
  planMdPath(id: string) {
    return join(this.runDir(id), "plan.md");
  }

  /** Keep per-run state out of version control; config.yaml stays committable. */
  async ensureGitignore(): Promise<void> {
    const gi = join(this.dir, ".gitignore");
    if (!existsSync(gi)) await writeFileAtomic(gi, "runs/\n");
  }

  async createRun(problem: string, tier: Tier | "auto"): Promise<Run> {
    const d = new Date();
    const stamp = d.toISOString().replace(/[-:]/g, "").replace("T", "-").slice(0, 13);
    const id = `r${stamp}-${randomBytes(2).toString("hex")}`;
    const ts = now();
    const run: Run = {
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
      redecompositions: [],
      pendingRedecomposition: null,
      history: [{ at: ts, event: "created" }],
    };
    await this.ensureGitignore();
    await this.saveRun(run);
    return run;
  }

  async saveRun(run: Run): Promise<void> {
    run.updatedAt = now();
    const valid = Run.parse(run);
    await writeFileAtomic(this.treePath(run.id), `${JSON.stringify(valid, null, 2)}\n`);
  }

  async loadRun(idOrLatest?: string): Promise<Run> {
    const id = !idOrLatest || idOrLatest === "latest" ? await this.latestRunId() : idOrLatest;
    const path = this.treePath(id);
    if (!existsSync(path)) throw new GraftreeError(`run not found: ${id}`, "no_run");
    const parsed = Run.safeParse(JSON.parse(await readFile(path, "utf8")));
    if (!parsed.success) throw new GraftreeError(`corrupt tree.json for ${id}: ${parsed.error.message}`, "corrupt");
    return parsed.data;
  }

  async listRunIds(): Promise<string[]> {
    if (!existsSync(this.runsDir)) return [];
    const entries = await readdir(this.runsDir, { withFileTypes: true });
    return entries
      .filter((e) => e.isDirectory() && existsSync(this.treePath(e.name)))
      .map((e) => e.name)
      .sort();
  }

  /**
   * The most recently created run. Ids sort by their minute stamp; runs created
   * in the same minute are ordered by their recorded creation time.
   */
  async latestRunId(): Promise<string> {
    const ids = await this.listRunIds();
    const last = ids.at(-1);
    if (!last) throw new GraftreeError("no runs yet; start one with `graftree new`", "no_run");
    const stamp = (id: string) => id.slice(0, id.lastIndexOf("-"));
    const sameMinute = ids.filter((id) => stamp(id) === stamp(last));
    if (sameMinute.length === 1) return last;
    const created = await Promise.all(
      sameMinute.map(async (id) => {
        try {
          const raw = JSON.parse(await readFile(this.treePath(id), "utf8")) as { createdAt?: unknown };
          return typeof raw.createdAt === "string" ? raw.createdAt : "";
        } catch {
          return "";
        }
      }),
    );
    let best = 0;
    for (let i = 1; i < sameMinute.length; i++) {
      if (created[i]! > created[best]! || (created[i] === created[best] && sameMinute[i]! > sameMinute[best]!)) best = i;
    }
    return sameMinute[best]!;
  }
}

export function logEvent(run: Run, event: string, detail?: string): void {
  run.history.push({ at: now(), event, ...(detail ? { detail } : {}) });
}
