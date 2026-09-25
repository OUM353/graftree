# graftree — Design (v1.0)

An open-source, provider-agnostic engine for solving **hard coding problems** with
tree logic: decompose a problem into independent sub-tasks, solve each with
redundant attempts across multiple models, and merge the verified results back
up into a single best solution.

**Priorities:** accuracy first, then auditability. Speed and token cost come last.

---

## 1. Principles

1. **The closer is fixed.** The root agent that invokes the skill (Claude Code by
   default) owns every decision that matters: triage, decomposition approval
   (with the human), test approval, candidate selection, and the final merge.
   Worker models can *propose*. Only the closer *decides* (unless
   `budgets.autoSelect` is on, for headless use).
2. **Tests before code.** Acceptance tests are written and approved before any
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
│  Closer: the root agent (Claude Code via SKILL.md, or any    │
│  agent that can run the CLI and read JSON)                   │
│   • triage  • plan  • approve with the human  • select       │
│   • glue and own attempts  • final decision                  │
└───────────────▲──────────────────────────┬───────────────────┘
                │ JSON output, tree.json,   │ graftree CLI commands
                │ plan.md, report.md        │
┌───────────────┴──────────────────────────▼───────────────────┐
│  Engine (graftree CLI)                                       │
│   Tree scheduler · Worktree manager · Gates · Budgets        │
│   Run store (.graftree/runs/<id>/)                           │
└───────────────┬──────────────────────────────────────────────┘
                │ role → worker mapping (config.yaml)
┌───────────────▼──────────────────────────────────────────────┐
│  Workers                                                     │
│   CLI agents: CommandCode · claude -p · OpenCode · any       │
│               command template                               │
│   API models: any OpenAI-compatible endpoint (OpenRouter,    │
│               Ollama, vLLM, LM Studio, …)                    │
└──────────────────────────────────────────────────────────────┘
```

### 2.1 Two kinds of workers

| Kind | How it works | Tools |
|---|---|---|
| **CLI-agent worker** | The engine spawns an existing coding agent inside the attempt's worktree. The prompt goes on the command line, or in `.graftree-task.md` when it is too long for one (Windows caps a command line at 32,767 characters). Output is plain text or NDJSON events | The agent's own. The engine only checks the resulting diff |
| **API worker** | The engine runs the agent loop and calls an OpenAI-compatible chat endpoint | A minimal toolset confined to the worktree: list, read, write, replace, search, run a command, finish |

CLI-agent workers are defined by a **command template**, so new tools can be
added without code changes. Placeholders: `{prompt}`, `{promptFile}`, `{model}`,
`{cwd}`. No shell is involved.

```yaml
workers:
  cc-deepseek-flash:                # CommandCode headless flags, checked against `commandcode --help` (v1.65)
    type: cli
    command: [commandcode, -p, "{prompt}", -m, "{model}", --output-format, json,
              --max-turns, "80", --yolo, --trust, --no-session,
              --skip-onboarding, --no-auto-update]
    model: deepseek/deepseek-v4.1-flash
    output: ndjson
  opencode:
    type: cli
    command: [opencode, run, --model, "{model}", "{prompt}"]
    model: <provider/model>
```

The NDJSON parser reads the final result event (CommandCode's `result` event,
Claude Code's `stream-json` result) and falls back to the last event with a
result-like field. It is tested against output captured from a live CommandCode
run. On Windows, npm `.cmd` shims are resolved to the script they wrap and run
with node directly, so multi-line prompts reach the agent intact.

### 2.2 Roles

| Role | Job | Who can fill it |
|---|---|---|
| `closer` | Triage, approvals, final selection, final merge | **Root agent only** (not configurable) |
| `planner` | Proposes the decomposition, contracts and tests | The closer, or a worker via `graftree plan --worker NAME` |
| `test_writer` | Writes acceptance tests from the spec | The closer, or the planner worker, which drafts them with its plan |
| `solver` | Implements one leaf | Any worker(s). Mixing models is encouraged |
| `integrator` | Glue at a split when the plain merge of its children fails | Any worker (as repair rounds), or the closer (`graftree attempt`) |
| `reviewer` | Adversarial review: tries to break a passing candidate | Any worker, ideally a different model family than the solver, or the closer |

Mapping in config:

```yaml
roles:
  planner:     [closer]                        # default: the closer plans
  test_writer: [closer]
  solver:      [cc-deepseek-flash, openrouter-kimi, opencode]
  integrator:  [closer]
  reviewer:    [openrouter-gemini]
```

The engine reads `solver`, `integrator` and `reviewer`. `planner` and
`test_writer` tell the closer who plans and writes tests (the skill reads them);
planning by a worker is always an explicit `graftree plan --worker NAME`.
When a role lists several workers, attempts are spread across them round-robin.
**Model diversity at the leaves is a deliberate accuracy lever:** different
models make different mistakes, and the tests catch them. A role set to
`closer` means the root agent does that job itself: a `closer` solver slot waits
for `graftree attempt`, and with a `closer` reviewer the review is the closer's
own reading of the diffs.

---

## 3. Lifecycle of a run

```
triage → plan (+ tests) → ⏸ HUMAN APPROVAL → solve leaves → verify/repair/review
       → closer selects → integrate upward → closer selects → close
```

### 3.1 Triage (adaptive sizing)

The closer inspects the problem and the repo, decides whether graftree is worth
its cost at all, then picks a **tier**. The tier sets the maximum depth and the
default number of attempts per leaf (`budgets.attemptsPerLeaf` overrides it).

| Tier | Typical problem | Max depth | Attempts/leaf |
|---|---|---|---|
| `focused` | A hard bug or algorithm in 1–3 files | 0 (single leaf) | 4 |
| `standard` | A feature across a few modules | 2 | 3 |
| `deep` | A cross-cutting change or subsystem | 4 | 2 |

When in doubt, the shallower tier: over-splitting coupled code is the most
common way tree-based solving fails. The tree can still grow after approval: a
leaf that escalates because it bundles separable problems can be
re-decomposed by the closer, with the human's approval (§9).

### 3.2 Plan + acceptance tests

For each node the planner produces (see `graftree schema plan`):

- `goal`: what the node must achieve.
- `contract.exposes` / `contract.consumes`: the interfaces this node provides
  and uses (signatures, data shapes).
- `ownedPaths`: files this node may modify. Siblings must not overlap; a child's
  paths lie inside its parent's. `sharedPaths` on a split lists files several
  children need, which only integration may touch.
- `acceptance`: test files and the command that defines "done" (or a `rubric`
  for what tests can't express, judged by review and the closer).
- `dependsOn`: siblings whose real code this node's tests need (§3.4).

Tests exist at **every level**: leaf tests for each contract, integration tests
at each split, end-to-end tests at the root. The engine validates the plan
before it can be approved: one root, splits with at least two children, depth
within the tier, disjoint sibling ownership, children inside their parent,
sibling-only and acyclic `dependsOn`, tests drafted for every listed file, no
paths escaping the repo.

### 3.3 ⏸ Approval checkpoint

The engine writes `plan.md`, a human-readable summary: the tree, contracts,
ownership, tests, tier, worker assignment, and a cost estimate in worker calls.
It then stops with status `awaiting_approval`.

- In **Claude Code**, the skill presents the plan, quotes the cost estimate and
  waits for the user.
- From the command line: `graftree approve <run>`, or
  `graftree reject <run> --notes "…"` to send it back. A revised plan can be
  resubmitted with `graftree plan` while the run awaits approval.

Approval **hash-locks** the acceptance tests and commits them on top of the
user's HEAD as the run base, `refs/graftree/<run>/base`. The user's working tree,
index and branch are never touched. A candidate whose diff touches a locked file
is disqualified automatically.

### 3.4 Solve

- Each attempt runs in its own **git worktree** on its own branch, starting from
  the node's base.
- Leaves with no dependencies run in parallel, up to `budgets.concurrency`.
- A leaf that only needs a sibling's interface codes against the **contract** and
  tests with a double, so it doesn't have to wait.
- A node with `dependsOn` (its own, or an ancestor's) waits for those siblings'
  winners and starts from the run base merged with their code. Its gates still
  measure only its own diff against that base. If a dependency's winner changes
  (a new decision, a `retry`, a hardening), its dependents start over. (Added in
  v0.4.1 after a live Opus plan gave a CLI leaf tests that ran the real store and
  protocol.)

### 3.5 Verify, repair, review, select (per node)

1. **Hard gates**, in order: locked tests untouched; every edit inside the node's
   `ownedPaths` (for a split: in `sharedPaths` or parent paths no child owns);
   `commands.build` if set; the node's acceptance command, and for a split every
   descendant's too. Failing any gate rules the candidate out.
2. **Repair.** Every failed (not disqualified) attempt gets repair rounds in its
   own worktree, with its failure output fed back, even when a sibling already
   passes (`budgets.repairAll`, default on; off means one node budget that stops
   at the first pass).
3. **Review.** When `roles.reviewer` has workers, the top-ranked passing
   candidate is reviewed, and reviewing continues until the leader is a reviewed
   candidate. Each reviewer also checks the findings raised on sibling attempts.
4. **Score.** Passing candidates are ranked by diff size, lint (if configured),
   repairs needed and review verdict. The ranking is only a recommendation.
5. **Select.** The run pauses (`awaiting_closer`) and the closer picks a winner
   with `graftree decide`. Only passing attempts can win. With
   `budgets.autoSelect`, the engine takes its top-ranked candidate instead.
6. **Nothing passes:** the node is `escalated`. The closer diagnoses it and
   either asks for fresh attempts (`retry`), submits its own candidate
   (`attempt`, same gates), re-decomposes the leaf (§9), or, if the tests
   themselves are wrong, stops and asks the human.

### 3.6 Integrate upward

When all children of a split have winners, attempt 1 of the split is the plain
merge of those winners onto the run base. It goes through the same gates: the
split's own tests plus every descendant's. If glue is needed, integrator workers
repair the merge within the split's allowed paths, or the closer submits it with
`graftree attempt`. A merge conflict escalates to the closer. Changing a winner
anywhere reopens every ancestor, because their merges are stale.

### 3.7 Close

`graftree close` checks out the root winner in a fresh worktree and runs every
node's acceptance commands plus `commands.setup`, `build`, `test` and `lint`. On
success the result lands on branch `graftree/<run>/final` (the user's HEAD, the
tests and the solution) and the run is `done`. `report.md` records the tree,
each node's winner and who decided it, every attempt with its status, diff size,
score, review verdict and tokens, the hardenings, the cost and the usage
warnings. If a final check fails, the root goes back to `awaiting_closer` with
the failed checks named.

---

## 4. Run store (the portable protocol)

```
.graftree/
  config.yaml                     # workers, roles, budgets, commands (committable)
  .gitignore                      # "runs/": per-run state stays out of git
  runs/<run-id>/
    tree.json                     # authoritative state (schema/run.schema.json)
    plan.md                       # human-readable plan, rewritten as the run changes
    report.md                     # written by close
    .lock                         # pid of the engine process working on this run
    planner.log                   # output of a planner worker, if one planned
    tests/<repo path>             # drafted acceptance tests (locked on approval)
    redecompose/tests/<repo path> # staged tests of a pending re-decomposition
    nodes/<node>/a<n>/            # worker.log, repair<k>.log, build.log,
                                  # acceptance.log, lint.log, review.md
    wt/<node>/a<n>/               # attempt worktrees (removed by close or clean)
    final/                        # logs of close's final checks
```

Git objects: the run base `refs/graftree/<run>/base`; attempt branches
`graftree/<run>/<node>/a<n>`; a split's merge base `graftree/<run>/<node>/merge`;
a dependent leaf's base `graftree/<run>/<node>/base`; the result
`graftree/<run>/final`.

`tree.json` node shape (abridged):

```json
{
  "id": "parser",
  "parent": "root",
  "kind": "leaf",
  "status": "awaiting_closer",
  "goal": "…",
  "contract": { "exposes": ["parse(src: string): Ast"], "consumes": [] },
  "ownedPaths": ["src/parser/**"],
  "acceptance": { "files": ["test/parser.test.ts"], "command": "npm test -- test/parser.test.ts", "extraCommands": [] },
  "dependsOn": [],
  "base": "<commit>",
  "attempts": [
    { "n": 1, "kind": "solve", "worker": "cc-deepseek-flash", "status": "passed", "score": 96.5, "repairs": 0,
      "reviewVerdict": "pass", "usage": { "calls": 2, "inputTokens": 41000, "outputTokens": 3200 } }
  ],
  "recommended": 1,
  "winner": null,
  "decidedBy": null
}
```

Status values:

- **Run:** `draft` → `awaiting_approval` (↔ `needs_replan`) → `approved` →
  `solving` ↔ `awaiting_closer` → `ready_to_close` → `done`. A proposed
  re-decomposition returns the run to `awaiting_approval` until the human decides.
- **Node:** `planned` → `solving` (leaf) or `integrating` (split) →
  `awaiting_closer` or `escalated` → `done`.
- **Attempt:** `running` → `passed` | `failed` | `disqualified` | `error`.

---

## 5. CLI surface

Every command accepts `--json`; `[run]` and `--run` default to the latest run.

```
graftree init [--force]                      # create .graftree/config.yaml (+ .gitignore for runs/)
graftree schema [plan|subtree|run|config]    # print a JSON Schema
graftree new "<problem>" | --file F [--tier T]  # T: auto|focused|standard|deep
graftree plan [run] --file plan.json [--tests DIR]   # closer-authored plan
graftree plan [run] --worker NAME            # a worker plans + drafts tests in a throwaway worktree
graftree show [run] | list
graftree approve [run] [--notes …]           # human gate (also for a pending re-decomposition)
graftree reject  [run] --notes "…"
graftree run [run] [--auto-select]           # solve → verify → repair → review → integrate; resumable
graftree diff NODE ATTEMPT [--run R]         # candidate diff vs. node base
graftree decide NODE ATTEMPT [--run R] [--notes …]   # closer's selection (passing attempts only)
graftree retry NODE [--count N]              # more engine attempts for a leaf
graftree attempt NODE --worktree P | --commit REV    # closer-made candidate, same gates
graftree harden NODE --tests DIR --command "…" --reason "…" --yes   # tests from review findings
graftree redecompose NODE --file subtree.json [--tests DIR] --reason "…"
graftree close [run] [--keep-worktrees]      # final checks → graftree/<run>/final + report.md
graftree clean [run]                         # remove worktrees (branches kept)
graftree lock-check [run] --commit REV       # did a commit touch locked tests?
graftree worker test NAME ["prompt"]         # smoke-test a configured worker
```

Exit codes: `0` ok, `1` error, `2` not accepted (a plan or subtree failed
validation, or `harden` without `--yes`), `3` `lock-check` found changed locked
tests, `4` an `attempt` did not pass its gates, `5` `close`: final checks failed.
With `--json`, errors print `{"ok": false, "error": "…", "code": "…"}`.

Engine details:

- The engine **pauses and returns control** every time a closer decision is
  needed (status `awaiting_closer`). This is how a root agent like Claude Code
  stays the decision-maker without the engine having to call it.
- A crashed or interrupted `run` resumes: unfinished attempts are dropped and
  rerun. A lock file (with the owner's pid) keeps two engine processes off the
  same run: `run`, `decide`, `retry`, `attempt`, `harden`, `redecompose` and
  `close` all take it.
- Workers and the configured commands run in their own process groups. A
  timeout, or Ctrl-C on graftree, stops them with everything they started.

---

## 6. Distribution

The repo is set up so that each piece can be pulled in on its own:

| Component | Where | How people get it |
|---|---|---|
| Engine CLI | `src/` → `dist/cli.js`, npm package `graftree-agent` (bin `graftree`) | `npm i -g graftree-agent`, `npx -y graftree-agent`, or the GitHub tarball of `main` |
| Library | `graftree-agent` exports (schema, store, plan checks, lifecycle, engine, workers) | `import … from "graftree-agent"` |
| JSON Schemas | `schema/{plan,subtree,run,config}.schema.json` (generated from zod) | In the package, or straight from GitHub |
| Claude Code skill | `plugins/graftree/skills/graftree/` | `/plugin marketplace add OUM353/graftree` → `/plugin install graftree@graftree` |
| Skill for other agents | The same folder (a standard `SKILL.md`) | Copy it in, `commandcode --skill <dir>`, or the AGENTS.md snippet in `integrations/` |

The engine is written in TypeScript and needs Node ≥ 20 and git. Its only
dependencies are `zod` and `yaml`.

---

## 7. Safety and budgets

- Workers execute model-written code, usually with their permission prompts
  bypassed. The engine points them only at throwaway worktrees and never pushes.
  There is no built-in sandbox: run graftree in a container or VM when that
  matters.
- API keys come only from environment variables named in the config
  (`apiKeyEnv`). They are never written into the run store.
- Budgets that bound the work: `attemptsPerLeaf`, `maxRepairRounds` (per failed
  attempt, renewed by each hardening), `maxRedecompositions` per leaf, and
  `maxWallMinutes` per `graftree run` (no new work starts after it; re-run to
  continue). Worker and command timeouts stop runaway processes.
- Usage warnings (`warnTokens`, `warnCalls`, `warnAttemptTokens`,
  `warnWallPercent`) tell the closer and the human when a run gets expensive.
  They never stop the engine; the skill tells the closer to pause and ask.
  There are no hard token or dollar caps.

---

## 8. Scope of 1.0

**In:** the tiers, test-first planning (by the closer or a worker), the approval
gate, worktree attempts, hard gates plus scoring, repair of every near-miss,
cross-checked reviews, closer selection, `dependsOn` with real code, integration
upward, hardening, re-decomposition, cost metering and warnings, the cost
estimate before approval, CLI-agent workers (CommandCode, `claude -p`, OpenCode,
any template) and OpenAI-compatible API workers with a tool loop, the Claude Code
skill, the report, and benchmark examples with hidden holdout suites.

**Not in 1.0:** a native Anthropic API worker (use an OpenAI-compatible endpoint
or `claude -p`), a sandbox wrapper, hard token or dollar caps, automatic
re-decomposition or collapsing of coupled splits (the closer does it by hand), a
live tree viewer, cost-aware worker routing, and a benchmark at SWE-bench scale.

---

## 9. Design notes by version

- **Hardening (v0.3).** Tests are added after approval, from real review
  findings. The new files are committed on top of the current run base, so the
  base moves forward and the originally approved tests are never touched. They
  are locked and their command joins the node's `acceptance.extraCommands`. A
  hardened leaf merges the new base into each existing attempt (a clean, add-only
  merge) and re-runs the gates; failures get a fresh repair budget. A hardened
  split re-integrates, and every ancestor re-integrates as well. The lock check
  compares each candidate against its own node base.
- **Cross-checked reviews (v0.3).** Every reviewer receives the issues found on
  sibling attempts and must mark each one as applying or not. A repair clears the
  attempt's old review.
- **Cost metering (v0.3).** Worker usage is normalized across CommandCode,
  Claude and OpenAI-style APIs into calls, tokens in and out, cached tokens and
  time, recorded per attempt (plus planning overhead) and summed in `run`,
  `show` and the report.
- **Repair every near-miss (v0.4).** The live hardening run showed the cost of
  stopping at the first pass: three parser attempts failed the new test, one was
  repaired, and the other two stayed failed, so the closer had one candidate
  instead of three. `budgets.repairAll` (default true) gives each failed attempt
  its own budget of `maxRepairRounds × (1 + hardenings of the node)` and repairs
  them in parallel under `budgets.concurrency`. Costs about one extra call per
  near-miss per round.
- **Re-decomposition (v0.4).** A leaf that escalates may be too big rather than
  unlucky. `graftree redecompose` turns it into a split. The node keeps its id,
  goal, `ownedPaths` and acceptance (including hardening commands), so its locked
  tests still gate the merged children and the bar can only rise. New children
  bring new, additive test files. The whole resulting plan is re-validated, and
  the tier is raised if the extra depth needs it. The proposal pauses the run at
  `awaiting_approval`; nothing else can change the tree until the human decides,
  and rejecting restores the previous status. On approval the leaf's attempts
  are retired (usage kept as run overhead) and ancestors re-integrate. Only
  leaves can be re-decomposed; restructuring a split means replanning the run.
- **Usage warnings (v0.4).** After every worker call the engine compares usage
  with the warning thresholds. Each crossed threshold is logged once in the run
  history (totals again at each multiple), printed during `run`, returned in the
  summary's `warnings`, and listed in the report.
- **`dependsOn` gives code (v0.4.1).** Dependencies used to be an ordering hint
  only; see §3.4.
- **Cost before approval (v0.4.2).** `plan`, `approve` and `plan.md` show the
  expected range of worker calls against a single agent's one call, after a
  benchmark showed a single agent matching graftree at 6× less.
- **1.0.** A full audit: dependents restart when a dependency is retried or
  hardened, `close` takes the run lock, "latest" follows creation time,
  timed-out agents are stopped with their child processes, clearer CLI errors
  and documented exit codes, and docs that match the code.

---

## 10. Evidence

Three benchmarks in `examples/` grade results with hidden holdout tests (details
in the README). A strong single agent that tests its own work (DeepSeek V4.1
Flash through CommandCode) matched graftree on the original holdouts of kvstore
(25/25) and minisheet (38/38), and scored 50/50 alone on tasklog. On minisheet,
graftree's review caught spec violations that the holdout did not test; a
stricter suite later showed the single agent missed two of those rules (86/88 vs
88/88). graftree cost 6–11× the worker calls plus the closer's own work. Its
expected advantage on work too large for one agent session is not yet measured.

---

## 11. Decisions made

- Name: **graftree**. Grafting joins branches into one tree, which is the merge
  step. The npm package is `graftree-agent`.
- Language: TypeScript. Node is already present wherever the CLI agents run, and
  the typed schema is the protocol.
- First external worker: CommandCode with `deepseek/deepseek-v4.1-flash`.
- License: MIT.
