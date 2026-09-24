# graftree plan format

A plan is a JSON object with a flat list of nodes. Each node points to its
`parent`, and the root node has `parent: null`. The full JSON Schema is
available via `graftree schema plan`, or in `schema/plan.schema.json` in the
graftree repo.

| Field | Meaning |
|---|---|
| `tier` | `focused` \| `standard` \| `deep`. Sets the max depth and attempts per leaf |
| `summary` | One paragraph describing the overall approach |
| `rationale` | Why this split, or why no split. The human reads this at approval |
| `nodes[].id` | Short slug: letters, digits, `.`, `_`, `-` |
| `nodes[].kind` | `split` (has 2 or more children) or `leaf` (solved directly) |
| `nodes[].goal` | What "done" means for this node, in plain words |
| `nodes[].contract.exposes` | Exact interfaces this node provides |
| `nodes[].contract.consumes` | Exact interfaces it uses from siblings. It codes against these |
| `nodes[].ownedPaths` | Globs it may modify. Disjoint from siblings, inside the parent's |
| `nodes[].sharedPaths` | For split nodes only: files the children need, edited only during integration |
| `nodes[].acceptance.files` | Repo-relative test files, drafted under the run's `tests/` dir |
| `nodes[].acceptance.command` | Runs from the repo root. Exits 0 only when this node is done |
| `nodes[].acceptance.rubric` | Only for goals that tests can't express |
| `nodes[].dependsOn` | Sibling ids whose real code this node's tests need. The node waits for their winners and starts from their merged code. Leave empty when a contract and a test double suffice, so siblings run in parallel |

## Example: `standard` tier, rate limiter for an API server

```json
{
  "tier": "standard",
  "summary": "Add per-client token-bucket rate limiting to the HTTP API, with limits configurable per route and 429 responses carrying Retry-After.",
  "rationale": "The bucket algorithm, the config loading, and the HTTP middleware only meet at two small interfaces (Bucket and LimitsConfig), so they can be built and tested independently. The route wiring is glue and belongs to the root's integration.",
  "nodes": [
    {
      "id": "root",
      "parent": null,
      "kind": "split",
      "goal": "Requests over a client's per-route limit get 429 with Retry-After; others pass unchanged.",
      "ownedPaths": ["src/ratelimit/**", "src/server.ts"],
      "sharedPaths": ["src/server.ts"],
      "acceptance": {
        "files": ["test/ratelimit/e2e.test.ts"],
        "command": "npx vitest run test/ratelimit/e2e.test.ts"
      }
    },
    {
      "id": "bucket",
      "parent": "root",
      "kind": "leaf",
      "goal": "Token bucket with injectable clock; exact refill math, no drift.",
      "contract": {
        "exposes": [
          "class Bucket { constructor(capacity: number, refillPerSec: number, now?: () => number); take(n?: number): { ok: boolean; retryAfterMs: number } }"
        ]
      },
      "ownedPaths": ["src/ratelimit/bucket.ts"],
      "acceptance": {
        "files": ["test/ratelimit/bucket.test.ts"],
        "command": "npx vitest run test/ratelimit/bucket.test.ts"
      }
    },
    {
      "id": "config",
      "parent": "root",
      "kind": "leaf",
      "goal": "Load and validate per-route limits from config/limits.yaml, with defaults.",
      "contract": {
        "exposes": [
          "type LimitsConfig = { default: { capacity: number; refillPerSec: number }; routes: Record<string, { capacity: number; refillPerSec: number }> }",
          "loadLimits(path: string): LimitsConfig  // throws LimitsError on invalid input"
        ]
      },
      "ownedPaths": ["src/ratelimit/config.ts"],
      "acceptance": {
        "files": ["test/ratelimit/config.test.ts"],
        "command": "npx vitest run test/ratelimit/config.test.ts"
      }
    },
    {
      "id": "middleware",
      "parent": "root",
      "kind": "leaf",
      "goal": "Express middleware keyed by client id + route; 429 with Retry-After seconds (rounded up).",
      "contract": {
        "consumes": ["Bucket", "LimitsConfig"],
        "exposes": ["rateLimit(cfg: LimitsConfig, clientId: (req) => string): RequestHandler"]
      },
      "ownedPaths": ["src/ratelimit/middleware.ts"],
      "dependsOn": ["bucket", "config"],
      "acceptance": {
        "files": ["test/ratelimit/middleware.test.ts"],
        "command": "npx vitest run test/ratelimit/middleware.test.ts"
      }
    }
  ]
}
```

Drafted tests for this plan live at:

```
.graftree/runs/<run>/tests/test/ratelimit/e2e.test.ts
.graftree/runs/<run>/tests/test/ratelimit/bucket.test.ts
.graftree/runs/<run>/tests/test/ratelimit/config.test.ts
.graftree/runs/<run>/tests/test/ratelimit/middleware.test.ts
```

## Example: `focused` tier (no split)

A hard bug confined to one area stays a single leaf. It gets more attempts,
not more structure.

```json
{
  "tier": "focused",
  "summary": "Fix the off-by-one in the diff algorithm's hunk merging when two hunks touch.",
  "rationale": "One function, tightly coupled logic; splitting would only add seams.",
  "nodes": [
    {
      "id": "root",
      "parent": null,
      "kind": "leaf",
      "goal": "Adjacent hunks merge correctly; all existing diff tests still pass.",
      "ownedPaths": ["src/diff/**"],
      "acceptance": {
        "files": ["test/diff/adjacent-hunks.test.ts"],
        "command": "npm test -- test/diff"
      }
    }
  ]
}
```

## What the validator rejects

- Anything other than exactly one root, and unknown or cyclic parents.
- A `split` with fewer than 2 children, or a `leaf` with children.
- Depth beyond the tier's maximum.
- Sibling `ownedPaths` that may overlap. The check is conservative: globs that
  share a directory prefix count as overlapping.
- A child path outside its parent's `ownedPaths`.
- `dependsOn` pointing to a non-sibling, or forming a cycle.
- A node with neither acceptance test files nor a rubric.
- Test files listed in the plan but missing from the run's `tests/` dir.
- Paths that escape the repo (`..`).
