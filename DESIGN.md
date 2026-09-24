# graftree — Design (v0.1)

An open-source, provider-agnostic engine for solving **hard coding problems** with
tree logic: decompose a problem into independent sub-tasks, solve each with
redundant attempts across multiple models, and merge the verified results back
up into a single best solution.

**Priorities:** accuracy first, then auditability. Speed and token cost come last.

---

## 1. Principles

1. **The closer is fixed.** The root agent that invokes the skill (Claude by
   default) owns every decision that matters: triage, decomposition approval
   (with the human), test approval, candidate selection when tests tie, and the
   final merge. Worker models can *propose*. Only the closer *decides*.
2. **Tests before code.** Acceptance tests are generated and approved before any
   solving starts. After approval they are locked, and solvers cannot change them.
3. **Split on seams, not on size.** A node is decomposed only when its parts are
   genuinely independent and interface contracts can pin them down. If the parts
   are coupled, the node stays a leaf and gets more attempts instead.
4. **Verify at every merge.** No result moves up the tree until it passes its
   node's tests. A failure is repaired locally, in the smallest subtree that
   contains it.
5. **Portable by protocol.** All state lives in plain files (`.graftree/`) and
   the engine is driven by a CLI. Any root agent that can run shell commands
   and read JSON can act as the closer.
6. **Human gate before spending.** The run pauses after planning. Nothing is
   spent on solving until the human approves the plan.

---

## 2. Architecture

```
┌──────────────────────────────────────────────────────────────┐
│  Closer (root agent: Claude Code via SKILL.md, or Claude via │
│  API in standalone mode)                                     │
│   • triage  • approve plan  • select  • final merge          │
└───────────────▲──────────────────────────┬───────────────────┘
                │ reads tree.json / reports │ graftree CLI commands
┌───────────────┴──────────────────────────▼───────────────────┐
│  Engine (graftree CLI)                                     │
│   Tree scheduler · Worktree manager · Test runner · Budgets  │
│   Run store (.graftree/runs/<id>/)                         │
└───────────────┬──────────────────────────────────────────────┘
                │ role → worker mapping (config)
┌───────────────▼──────────────────────────────────────────────┐
│  Worker adapters                                             │
│   API workers: Anthropic · OpenRouter · any OpenAI-compatible│
│                (Ollama, vLLM, LM Studio, …)                  │
│   CLI-agent workers: claude -p · opencode · CommandCode ·    │
│                codex · aider · any command template          │
└──────────────────────────────────────────────────────────────┘
```

### 2.1 Two kinds of workers

| Kind | How it works | Tools |
|---|---|---|
| **API worker** | The engine runs the agent loop and calls the model over HTTP | The engine provides a minimal toolset scoped to the node's worktree: read, write, list, search, run tests |
| **CLI-agent worker** | The engine spawns an existing coding agent inside the node's worktree with a prompt file | The agent's own tools. The engine only checks the resulting diff |

CLI-agent workers are defined by a **command template**, so new tools can be
added without code changes:

```yaml
workers:
  opencode-sonnet:
    type: cli
    command: ["opencode", "run", "--model", "{model}", "{prompt}"]
    model: anthropic/claude-sonnet-5
  cc-deepseek-flash:                # CommandCode v1.65 headless flags, verified via `commandcode --help`
    type: cli
    command: [commandcode, -p, "{prompt}", -m, "{model}", --output-format, json,
              --max-turns, "80", --yolo, --trust, --no-session,
              --skip-onboarding, --no-auto-update]
    model: deepseek/deepseek-v4.1-flash
    output: ndjson
```

> The flags come from each CLI's own `--help`. The NDJSON result parser looks
> for the last event with a result-like field, because the exact event shapes
> differ between agents. That parser still needs to be checked against a live
> CommandCode run.

### 2.2 Roles

| Role | Job | Who can fill it |
|---|---|---|
| `closer` | Triage, approvals, final selection, final merge | **Root agent only** (not configurable) |
| `planner` | Proposes the decomposition and interface contracts | Any worker, or the closer itself |
| `test_writer` | Writes acceptance tests from the spec | Any worker. The closer approves the tests |
| `solver` | Implements one leaf | Any worker(s). Mixing models is encouraged |
| `integrator` | Merges children at a parent and fixes seam issues | Any worker |
| `reviewer` | Adversarial review: tries to break a result | Any worker, ideally a different model family than the solver |

Mapping in config:

```yaml
roles:
  planner:     [closer]                       # default: the closer plans
  test_writer: [openrouter/openai/gpt-5, closer]
  solver:      [opencode-sonnet, openrouter/deepseek/deepseek-v3, claude-api]
  integrator:  [claude-api]
  reviewer:    [openrouter/google/gemini-2.5-pro]
```

When a role lists several workers, attempts are spread across them round-robin.
**Model diversity at the leaves is a deliberate accuracy lever:** different
models make different mistakes, and the tests catch them.

---

## 3. Lifecycle of a run

```
triage → plan (+ tests) → ⏸ HUMAN APPROVAL → solve leaves → verify/select
       → integrate upward → review → closer final decision → deliver
```

### 3.1 Triage (adaptive sizing)

The closer inspects the problem and the repo, then picks a **tier**. The tier
sets the defaults and can be overridden per node later.

| Tier | Typical problem | Max depth | Attempts/leaf | Review |
|---|---|---|---|---|
| `focused` | A hard bug or algorithm in 1–3 files | 0 (single leaf) | 3–5 | 1 reviewer |
| `standard` | A feature across a few modules | 2 | 2–3 | 1 per merge |
| `deep` | A cross-cutting change or subsystem | 3–4 | 2 | per merge + final |

The tree is also **dynamic below the root**. Each node re-runs the split
decision against its own sub-problem. A leaf that repeatedly fails can be
promoted to a split node (re-decomposition). A planned split whose children turn
out to be tightly coupled can be collapsed back into a leaf.

### 3.2 Plan + acceptance tests

For each node the planner produces:

- `goal`: what the node must achieve.
- `contract`: the interfaces this node exposes to and consumes from its siblings
  (signatures, data shapes, file ownership).
- `owned_paths`: files this node may modify. Siblings must not overlap, except
  for paths explicitly marked as shared, which only the integrator may touch.
- `acceptance`: test files and commands that define "done".

The test writer produces tests at **every level**:

- Leaf tests exercise the leaf's own contract.
- Parent tests exercise how the children integrate.
- Root tests exercise the original problem end to end.

Where the problem cannot be fully expressed as tests (UX, performance intent,
refactor quality), the node gets a **rubric** instead, judged by the reviewer and
finally by the closer.

### 3.3 ⏸ Approval checkpoint

The engine writes `plan.md`, a human-readable summary with the tree, the contracts,
the tests, the chosen tier, a cost and time estimate, and the worker assignment.
It then stops with status `awaiting_approval`.

- In **Claude Code**, the skill presents the plan and waits for the user.
- In **standalone mode**, the CLI prompts on the terminal, or you run
  `graftree approve <run>` later.

The human can approve, reject with notes (the planner revises), or edit the plan
files directly and then approve.

After approval, acceptance test files are **hash-locked**. If a candidate's diff
touches a locked file, the candidate is disqualified automatically.

### 3.4 Solve

- Each attempt runs in its own **git worktree** branched from the node's base.
- Leaves with no dependencies run in parallel, up to a concurrency limit.
- A leaf that depends on a sibling's interface codes against the **contract**, using
  stubs generated from the contract, so it doesn't have to wait.

### 3.5 Verify and select (per node)

1. **Hard gates:** the build passes, the node's acceptance tests pass, locked files
   are untouched, and there are no edits outside `owned_paths`.
2. Among candidates that pass the gates, compute **scores**: the full existing test
   suite (regressions), lint and typecheck, diff size (smaller is better, all else
   equal), and reviewer findings.
3. **Tie-breaks and judgment calls go to the closer.** A worker model never makes
   the final pick.
4. **No candidate passes:** repair the best near-miss (a bounded number of rounds,
   with the failure output fed back), then retry with fresh attempts, possibly on
   different models. If that also fails, re-decompose the node. If the budget is
   exhausted, escalate to the closer and the human with a diagnosis.

### 3.6 Integrate upward

At each parent, the integrator merges the winning child branches into the parent
worktree and resolves seam issues. It may touch only the shared paths and glue code.
The parent's integration tests must then pass. On failure, the engine localizes the
failure to a child when possible and reopens only that child's subtree.

### 3.7 Close

At the root, the full acceptance suite, the regression suite, and a final
adversarial review run. **The closer reads the final diff, the tree log, and the
review, then makes the ship / revise decision.** The output is a single branch
(or patch) plus `report.md`, which explains what was built, why each winner was
chosen, and what was rejected and why.

---

## 4. Run store (the portable protocol)

```
.graftree/
  config.yaml                 # workers, roles, budgets, test commands
  runs/<run-id>/
    tree.json                 # authoritative state (schema below)
    plan.md                   # human-readable plan for approval
    report.md                 # final report
    nodes/<node-id>/
      spec.md                 # goal, contract, owned paths
      tests/                  # acceptance tests (locked after approval)
      attempts/<n>/
        worker.json           # which worker/model, tokens, time
        transcript.jsonl
        diff.patch
        results.json          # gate + score results
```

`tree.json` node shape (sketch):

```json
{
  "id": "n2.1",
  "parent": "n2",
  "kind": "leaf",
  "status": "solving",
  "goal": "…",
  "contract": { "exposes": ["…"], "consumes": ["…"] },
  "owned_paths": ["src/parser/**"],
  "acceptance": { "files": ["…"], "command": "pytest tests/at/n2_1" },
  "attempts": [{ "n": 1, "worker": "opencode-sonnet", "status": "passed", "score": 0.92 }],
  "winner": 1,
  "decided_by": "closer"
}
```

Status values: `pending → planned → awaiting_approval → solving → verifying →
selected → integrating → done`, plus `failed`, `escalated`, `redecomposed`.

---

## 5. CLI surface

Implemented in v0.1 (every command accepts `--json`; `[run]` defaults to the latest run):

```
graftree init                              # create .graftree/config.yaml (+ .gitignore for runs/)
graftree new "<problem>" [--tier T]        # T: auto|focused|standard|deep
graftree plan [run] --file plan.json [--tests DIR]   # closer-authored plan
graftree plan [run] --worker NAME          # CLI worker plans + drafts tests in a throwaway worktree
graftree show [run] | list
graftree approve [run] [--notes …]         # human gate: lock tests, create refs/graftree/<run>/base
graftree reject  [run] --notes "…"         # feedback goes to the next planning round
graftree lock-check [run] --commit REV     # exit 3 if a candidate touched locked tests
graftree worker test NAME ["prompt"]
graftree schema [plan|run|config]
```

Solve phase (v0.2):

```
graftree run [run] [--auto-select]         # solve → verify → repair → review → integrate; resumable
graftree diff NODE N [--run R]             # candidate diff vs. node base
graftree decide NODE N [--run R] [--notes] # closer's selection (passing attempts only)
graftree retry NODE [--count N]            # more engine attempts for a leaf
graftree attempt NODE --worktree P | --commit REV   # closer-made candidate, same gates
graftree close [run]                       # final checks → graftree/<run>/final + report.md
graftree clean [run]                       # remove worktrees (branches kept)
```

Engine details:
- Leaf attempts branch from `refs/graftree/<run>/base`. A split's base is a merge
  commit of its children's winners (branch `graftree/<run>/<node>/merge`).
- Attempt 1 of a split is the plain merge. Glue comes from integrator workers
  (as repair rounds) or from the closer (`attempt`).
- A crashed `run` resumes: unfinished attempts are dropped and rerun. A lock file
  prevents two engines from working on the same run.
- Changing a winner resets every ancestor, because their merges are now stale.

The engine **pauses and returns control** every time a closer decision is needed
(status `awaiting_closer`). This is how a root agent like Claude Code stays the
decision-maker without the engine having to call it.

---

## 6. Distribution

The repo is set up so that each piece can be pulled in on its own:

| Component | Where | How people get it |
|---|---|---|
| Engine CLI | `src/` → `dist/cli.js`, npm package `graftree-agent` (bin `graftree`) | `npx -y graftree-agent`, `npm i -g graftree-agent`, or `npm i -g github:oum353/agent-tree` |
| Library | `graftree-agent` exports (schema, store, plan checks, workers) | `import … from "graftree-agent"` |
| JSON Schemas | `schema/{plan,run,config}.schema.json` (generated from zod) | In the package, or straight from GitHub |
| Claude Code skill | `plugins/graftree/skills/graftree/` | `/plugin marketplace add oum353/agent-tree` → `/plugin install graftree@graftree` |
| Skill for other agents | The same folder (standard `SKILL.md`) | Copy it in, `commandcode --skill <dir>`, or use the AGENTS.md snippet in `integrations/` |

The engine is written in TypeScript, which means Node ≥ 20. Every supported
CLI agent already needs Node, and the dependencies are only `zod` and `yaml`.
---

## 7. Safety and budgets

- Workers execute model-written code. The engine runs tests only inside worktrees,
  supports an optional container or sandbox command wrapper, and never pushes on its
  own.
- API keys come only from environment variables (`ANTHROPIC_API_KEY`,
  `OPENROUTER_API_KEY`, and so on). They are never written into the run store.
- Hard budgets for each run and each node: tokens, dollars, wall time, repair rounds,
  and re-decompositions. Hitting a budget always escalates to the closer. The run
  never silently gives up.

---

## 8. v1 scope

**In:** the tiers and dynamic split decision, test-first planning, the approval gate,
worktree attempts, hard gates plus scoring, closer selection, integration upward,
repair/retry/re-decompose, the Anthropic, OpenRouter and OpenAI-compatible API
workers, a generic CLI-agent worker (templates for `claude -p` and OpenCode), the
Claude Code skill, and the report.

**Later:** more CLI templates after their flags are verified (CommandCode and
others), a live tree viewer, cost-aware worker routing, and a benchmark harness
(e.g. SWE-bench-style tasks) that measures accuracy against single-agent baselines.

## 9. Decisions made

- Name: **graftree**. Grafting joins branches into one tree, which is the merge
  step. The npm package is `graftree-agent`.
- Language: TypeScript. Node is already present wherever the CLI agents run, and
  the typed schema is the protocol.
- First external worker: CommandCode with `deepseek/deepseek-v4.1-flash`.
- License: MIT.
