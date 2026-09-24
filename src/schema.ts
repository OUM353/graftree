import { z } from "zod";

export const SCHEMA_VERSION = 1;

// ---------------------------------------------------------------------------
// Tiers: triage picks one; it sets the defaults for depth and redundancy.
// ---------------------------------------------------------------------------

export const Tier = z.enum(["focused", "standard", "deep"]);
export type Tier = z.infer<typeof Tier>;

export const TIER_DEFAULTS: Record<Tier, { maxDepth: number; attemptsPerLeaf: number }> = {
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
  timeoutSec: z.number().int().positive().default(600),
});

export const WorkerConfig = z.discriminatedUnion("type", [CliWorker, OpenAICompatibleWorker]);
export type WorkerConfig = z.infer<typeof WorkerConfig>;
export type CliWorker = z.infer<typeof CliWorker>;
export type OpenAICompatibleWorker = z.infer<typeof OpenAICompatibleWorker>;

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
    })
    .prefault({}),
  commands: z
    .object({
      test: z.string().optional(),
      build: z.string().optional(),
      lint: z.string().optional(),
    })
    .prefault({}),
});
export type Config = z.infer<typeof Config>;
export type Role = keyof Config["roles"];

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
export type PlanNode = z.infer<typeof PlanNode>;

export const Plan = z.object({
  tier: Tier,
  summary: z.string().min(1),
  /** Why this decomposition (or why no split). Shown to the human at approval. */
  rationale: z.string().default(""),
  nodes: z.array(PlanNode).min(1),
});
export type Plan = z.infer<typeof Plan>;
export type PlanInput = z.input<typeof Plan>;

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
  "closing",
  "done",
  "failed",
]);
export type RunStatus = z.infer<typeof RunStatus>;

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

export const Attempt = z.object({
  n: z.number().int().positive(),
  worker: z.string(),
  status: z.enum(["running", "passed", "failed", "disqualified", "error"]),
  startedAt: z.string(),
  finishedAt: z.string().optional(),
  branch: z.string().optional(),
  score: z.number().optional(),
  notes: z.string().optional(),
});

export const NodeState = PlanNode.extend({
  status: NodeStatus,
  attempts: z.array(Attempt).default([]),
  winner: z.number().int().positive().nullable().default(null),
  decidedBy: z.string().nullable().default(null),
});
export type NodeState = z.infer<typeof NodeState>;

export const LockedFile = z.object({ path: z.string(), sha256: z.string() });
export type LockedFile = z.infer<typeof LockedFile>;

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
  history: z.array(HistoryEntry).default([]),
});
export type Run = z.infer<typeof Run>;
