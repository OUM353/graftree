import { z } from "zod";
export const SCHEMA_VERSION = 1;
// ---------------------------------------------------------------------------
// Tiers: triage picks one; it sets the defaults for depth and redundancy.
// ---------------------------------------------------------------------------
export const Tier = z.enum(["focused", "standard", "deep"]);
export const TIER_DEFAULTS = {
    focused: { maxDepth: 0, attemptsPerLeaf: 4 },
    standard: { maxDepth: 2, attemptsPerLeaf: 3 },
    deep: { maxDepth: 4, attemptsPerLeaf: 2 },
};
// ---------------------------------------------------------------------------
// Config (.graftree/config.yaml)
// ---------------------------------------------------------------------------
/** A coding agent CLI run non-interactively inside a worktree (CommandCode, OpenCode, claude -p, ...). */
export const CliWorker = z.object({
    type: z.literal("cli"),
    /** argv template; placeholders: {prompt} {promptFile} {model} {cwd} */
    command: z.array(z.string()).min(1),
    model: z.string().optional(),
    /** How to read stdout: plain text, or newline-delimited JSON events with a final result line. */
    output: z.enum(["text", "ndjson"]).default("text"),
    timeoutSec: z.number().int().positive().default(1800),
    env: z.record(z.string(), z.string()).optional(),
});
/** Any OpenAI-compatible chat completions endpoint (OpenRouter, Ollama, vLLM, LM Studio, ...). */
export const OpenAICompatibleWorker = z.object({
    type: z.literal("openai-compatible"),
    baseUrl: z.string().url(),
    model: z.string(),
    /** Name of the environment variable holding the API key (the key itself never goes in config). */
    apiKeyEnv: z.string().optional(),
    headers: z.record(z.string(), z.string()).optional(),
    maxTokens: z.number().int().positive().optional(),
    /** Tool-call turns allowed when the worker acts as an agent (solve/integrate/plan). */
    maxTurns: z.number().int().positive().default(60),
    timeoutSec: z.number().int().positive().default(1800),
});
export const WorkerConfig = z.discriminatedUnion("type", [CliWorker, OpenAICompatibleWorker]);
/** "closer" is reserved: the root agent driving graftree does that role itself. */
export const CLOSER = "closer";
const RoleAssignment = z.array(z.string()).min(1);
export const Config = z.object({
    version: z.literal(1),
    workers: z.record(z.string(), WorkerConfig).default({}),
    roles: z
        .object({
        planner: RoleAssignment.default([CLOSER]),
        test_writer: RoleAssignment.default([CLOSER]),
        solver: RoleAssignment.default([CLOSER]),
        integrator: RoleAssignment.default([CLOSER]),
        reviewer: RoleAssignment.default([CLOSER]),
    })
        .prefault({}),
    budgets: z
        .object({
        attemptsPerLeaf: z.number().int().positive().optional(),
        maxRepairRounds: z.number().int().nonnegative().default(2),
        maxRedecompositions: z.number().int().nonnegative().default(1),
        maxWallMinutes: z.number().int().positive().default(240),
        concurrency: z.number().int().positive().default(3),
        /**
         * false (default): the closer picks every winner via `graftree decide`.
         * true: the engine accepts its top-ranked passing candidate (headless/CI use).
         */
        autoSelect: z.boolean().default(false),
    })
        .prefault({}),
    /**
     * Globs never snapshotted from worker worktrees (e.g. an agent CLI's own
     * metadata dir). Everything else a worker leaves behind counts toward the
     * ownership gate.
     */
    ignore: z.array(z.string()).default([]),
    commands: z
        .object({
        /** Full test suite; a gate at close. */
        test: z.string().optional(),
        /** Gate for every candidate. */
        build: z.string().optional(),
        /** Scored, not gated, for candidates; a gate at close. */
        lint: z.string().optional(),
        /** Run once in each fresh worktree before a worker starts (e.g. dependency install). */
        setup: z.string().optional(),
        timeoutSec: z.number().int().positive().default(900),
    })
        .prefault({}),
});
// ---------------------------------------------------------------------------
// Plan (what the planner submits; the closer and the human approve it)
// ---------------------------------------------------------------------------
export const NodeId = z
    .string()
    .regex(/^[a-z0-9][a-z0-9._-]{0,63}$/i, "node ids: letters, digits, '.', '_', '-' (max 64)");
export const Contract = z.object({
    /** Interfaces this node provides to siblings/parent (signatures, data shapes, endpoints). */
    exposes: z.array(z.string()).default([]),
    /** Interfaces this node relies on from siblings. It codes against these, not against their code. */
    consumes: z.array(z.string()).default([]),
});
export const Acceptance = z.object({
    /** Repo-relative test files for this node; drafted in the run's tests/ dir and locked on approval. */
    files: z.array(z.string()).default([]),
    /** Command that must exit 0 for the node to count as done. */
    command: z.string().min(1),
    /** For goals tests cannot fully express; judged by reviewer, then the closer. */
    rubric: z.string().optional(),
    /** Commands added by hardening after approval; all must exit 0 as well. */
    extraCommands: z.array(z.string()).default([]),
});
export const PlanNode = z.object({
    id: NodeId,
    parent: NodeId.nullable(),
    kind: z.enum(["leaf", "split"]),
    goal: z.string().min(1),
    contract: Contract.prefault({}),
    /** Paths/globs this node may modify. Siblings must not overlap. */
    ownedPaths: z.array(z.string()).min(1),
    /** Paths several children touch; only the parent's integrator may edit them. */
    sharedPaths: z.array(z.string()).default([]),
    acceptance: Acceptance,
    /** Sibling ids whose contracts this node consumes (ordering hint, not a hard wait). */
    dependsOn: z.array(NodeId).default([]),
});
export const Plan = z.object({
    tier: Tier,
    summary: z.string().min(1),
    /** Why this decomposition (or why no split). Shown to the human at approval. */
    rationale: z.string().default(""),
    nodes: z.array(PlanNode).min(1),
});
// ---------------------------------------------------------------------------
// Run state (tree.json) — the portable protocol between engine and closer
// ---------------------------------------------------------------------------
export const RunStatus = z.enum([
    "draft", // created, no plan yet
    "awaiting_approval", // plan + tests staged, waiting for the human
    "needs_replan", // human rejected with notes
    "approved", // tests locked, base commit created; ready to solve
    "solving",
    "awaiting_closer", // engine paused for a closer decision
    "ready_to_close", // root has a winner; `graftree close` runs final checks
    "done",
    "failed",
]);
export const NodeStatus = z.enum([
    "planned",
    "solving",
    "verifying",
    "awaiting_closer",
    "selected",
    "integrating",
    "done",
    "failed",
    "escalated",
    "redecomposed",
]);
export const CheckResult = z.object({
    ok: z.boolean(),
    exitCode: z.number().nullable().default(null),
    /** Path of the captured output, relative to the run dir. */
    log: z.string().optional(),
    violations: z.array(z.string()).default([]),
});
export const Gates = z.object({
    locked: CheckResult,
    ownership: CheckResult,
    build: CheckResult.optional(),
    acceptance: CheckResult.optional(),
    lint: CheckResult.optional(),
});
/** Token/call accounting, normalized across worker types. */
export const Usage = z.object({
    calls: z.number().int().nonnegative().default(0),
    inputTokens: z.number().nonnegative().default(0),
    outputTokens: z.number().nonnegative().default(0),
    cacheReadTokens: z.number().nonnegative().default(0),
    durationMs: z.number().nonnegative().default(0),
});
export const Attempt = z.object({
    n: z.number().int().positive(),
    kind: z.enum(["solve", "integrate", "external"]),
    /** Worker name, or "closer" for attempts the root agent submitted itself. */
    worker: z.string(),
    status: z.enum(["running", "passed", "failed", "disqualified", "error"]),
    startedAt: z.string(),
    finishedAt: z.string().optional(),
    branch: z.string(),
    worktree: z.string().optional(),
    commit: z.string().optional(),
    repairs: z.number().int().nonnegative().default(0),
    gates: Gates.optional(),
    diffStat: z.object({ files: z.number(), insertions: z.number(), deletions: z.number() }).optional(),
    /** Engine ranking among passing attempts (higher is better). */
    score: z.number().optional(),
    /** Review text path (relative to the run dir), when a reviewer ran. */
    review: z.string().optional(),
    reviewVerdict: z.enum(["pass", "concerns", "fail", "unknown"]).optional(),
    /** All worker calls spent on this attempt: solve, repairs, reviews. */
    usage: Usage.optional(),
    notes: z.string().optional(),
});
export const NodeState = PlanNode.extend({
    status: NodeStatus,
    /** Commit attempts start from: the run base for leaves, the merged children for splits. */
    base: z.string().nullable().default(null),
    /** Attempts the engine should run for this node (set by tier, raised by `retry`). */
    targetAttempts: z.number().int().nonnegative().nullable().default(null),
    attempts: z.array(Attempt).default([]),
    /** Engine's top-ranked passing attempt; the closer confirms or overrides. */
    recommended: z.number().int().positive().nullable().default(null),
    winner: z.number().int().positive().nullable().default(null),
    decidedBy: z.string().nullable().default(null),
    decisionNotes: z.string().optional(),
    /** Why the node is waiting on the closer. */
    awaiting: z.string().optional(),
    /** Set by hardening: existing attempts must be brought onto the new base and re-gated. */
    regate: z.boolean().default(false),
});
export const LockedFile = z.object({ path: z.string(), sha256: z.string() });
export const HistoryEntry = z.object({
    at: z.string(),
    event: z.string(),
    detail: z.string().optional(),
});
export const Run = z.object({
    schemaVersion: z.literal(SCHEMA_VERSION),
    id: z.string(),
    problem: z.string(),
    createdAt: z.string(),
    updatedAt: z.string(),
    status: RunStatus,
    /** Tier requested at creation ("auto" = closer/planner decides). */
    requestedTier: z.union([Tier, z.literal("auto")]),
    plan: Plan.nullable(),
    nodes: z.record(z.string(), NodeState).default({}),
    feedback: z.array(z.object({ at: z.string(), notes: z.string() })).default([]),
    approval: z
        .object({
        approvedAt: z.string(),
        notes: z.string().optional(),
        baseRef: z.string(),
        baseCommit: z.string(),
        headCommit: z.string(),
        locked: z.array(LockedFile),
    })
        .nullable()
        .default(null),
    final: z
        .object({
        branch: z.string(),
        commit: z.string(),
        closedAt: z.string(),
        checks: z.record(z.string(), CheckResult),
    })
        .nullable()
        .default(null),
    /** Tests added after approval from review findings. Additive only: they never replace locked tests. */
    hardening: z
        .array(z.object({
        at: z.string(),
        node: z.string(),
        files: z.array(z.string()),
        command: z.string(),
        reason: z.string(),
        baseCommit: z.string(),
    }))
        .default([]),
    /** Worker calls not tied to an attempt (e.g. planning). */
    overheadUsage: Usage.optional(),
    history: z.array(HistoryEntry).default([]),
});
//# sourceMappingURL=schema.js.map