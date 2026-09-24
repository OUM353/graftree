---
name: graftree
description: Solve hard, high-stakes coding problems with maximum accuracy by decomposing them into a tree of independent sub-tasks, writing acceptance tests first, solving each leaf with several independent attempts (optionally across multiple models such as DeepSeek via CommandCode or OpenRouter), and merging verified results upward into one best solution. You remain the final decision-maker (the "closer"). Pauses for human approval of the decomposition before spending effort on solving. Use when the user asks for graftree, a tree/deep/high-accuracy solve, or for a difficult bug, algorithm, or multi-module feature where correctness matters more than speed. Not for quick edits.
---

# graftree: tree-structured, test-first problem solving

You are the **closer**: the root agent that owns every decision that matters.
Worker models (DeepSeek, Kimi, GLM, other Claude sessions, and so on) may plan,
write tests, solve, and review, but **only you** decide: triage, what to show the
human, candidate selection, integration sign-off, and the final ship/revise call.
Never delegate those decisions, and never let a worker's claim stand in for a
test result you did not see.

The engine is the `graftree` CLI. It keeps all state in `.graftree/` inside the
repo and prints JSON with `--json`. **Always pass `--json`** and read the output;
don't guess at state.

```bash
graftree --version || npx -y graftree-agent --version   # use whichever works as $GT
```

If neither works, tell the user to install it (`npm i -g graftree-agent`, or
`npm i -g github:oum353/agent-tree` before the npm release), then stop.

## Phase 0: Setup (once per repo)

- If `.graftree/config.yaml` is missing, run `$GT init --json` and tell the user
  which workers and roles it configured. Workers are defined in that file. A
  role set to `closer` means you do it yourself.
- To check that a configured worker actually works, run
  `$GT worker test <name> --json` before relying on it.

## Phase 1: Understand and triage

Read the relevant code before planning. Identify the real problem, the existing
test framework, and how to run tests. Then pick a tier:

| Tier | Use for | Max depth | Attempts per leaf |
|---|---|---|---|
| `focused` | A hard bug or algorithm confined to 1–3 files | 0 (single leaf) | 4 |
| `standard` | A feature spanning a few modules | 2 | 3 |
| `deep` | A cross-cutting change or subsystem | 4 | 2 |

When in doubt, choose the **shallower** tier. Over-splitting coupled code is the
most common way tree-based solving fails.

```bash
$GT new "<precise problem statement>" --tier <tier> --json   # -> run id, testsDir
```

## Phase 2: Plan and write acceptance tests (before any code)

If `roles.planner` is `closer` (the default), write the plan yourself. Otherwise
run `$GT plan <run> --worker <name> --json`, then **review the worker's plan as
critically as your own**. You are accountable for it.

Rules. The engine also enforces most of these:

1. **Split only on real seams.** Split a node only if its children can be built
   independently against explicit contracts. A split needs at least 2 children.
2. **Contracts:** give each node's `contract.exposes` / `consumes` exact signatures
   or data shapes, precise enough that siblings never need to read each other's code.
3. **Ownership:** each node's `ownedPaths` must be disjoint from its siblings' and
   lie inside its parent's. Files several children need go in the parent's
   `sharedPaths`, and only integration touches them.
4. **Tests first, at every level:** leaf tests for each contract, integration
   tests at each split, end-to-end tests at the root. Use the repo's own test
   framework. Use a `rubric` only for what genuinely can't be tested.
5. Draft every test file at `<testsDir>/<repo-relative path>`. The run's tests
   directory mirrors the repo.
6. **Prove the tests are meaningful:** in a scratch worktree at HEAD, copy the
   tests in and run each `acceptance.command`. The tests should **fail** for the
   right reason (the missing behavior), not because of a syntax error or a wrong
   import path. Fix any test that fails for the wrong reason or already passes.

Plan format and a full example: see `references/plan-format.md`, or run
`$GT schema plan`.

```bash
$GT plan <run> --file plan.json --json        # tests already in testsDir
# or: --tests <dir> to copy drafted tests in
```

If the output has `ok: false`, fix every listed error and resubmit.

## Phase 3: ⏸ Human approval (mandatory)

Show the user a short summary of the plan: the tree, what each node does, the
contracts, the test files, the tier, which workers will run, and the estimated
number of solver runs. Give them the path to `plan.md`. Then **stop and wait**.

- Run `$GT approve <run> --json` **only after the user explicitly approves.**
  Never approve on their behalf, and never treat silence as approval.
- If they want changes, run `$GT reject <run> --notes "<their feedback>" --json`,
  replan, and resubmit.

Approval locks the acceptance tests by hash and creates a base commit at
`refs/graftree/<run>/base` (HEAD plus the tests). The user's branch and working
tree are not touched.

## Phase 4: Solve (per leaf, bottom-up)

> The engine's automated `solve` / `integrate` commands are in development.
> Until they ship, run this phase yourself, following exactly this protocol.
> It matches what the engine will automate.

For each leaf, with independent leaves in parallel:

1. **Attempts:** the tier sets the count (or `budgets.attemptsPerLeaf`). Give each
   attempt its own worktree:
   `git worktree add -b graftree/<run>/<node>/a<n> <tmpdir> refs/graftree/<run>/base`.
2. **Dispatch** each attempt to a worker from `roles.solver`, round-robin across
   the list. Mixing models is deliberate: they make different mistakes.
   - For a CLI worker, run its configured command template inside the worktree,
     with a prompt that includes the node's goal, contract, owned paths, the
     acceptance command, and "do not modify the acceptance tests".
   - For the `closer` role, use your own subagents, one per worktree.
3. **Commit** the attempt's result on its branch.
4. **Gate** every attempt:
   - `$GT lock-check <run> --commit <branch> --json` must be ok. If it isn't, the
     attempt is disqualified.
   - All changed files must be inside the node's `ownedPaths`.
   - The node's `acceptance.command` passes in that worktree.
   - Repo-wide `commands.test` / `build` / `lint` from the config don't regress.
5. **Select (your decision):** among attempts that pass the gates, prefer fewer
   regressions and warnings, then a smaller and clearer diff, then reviewer
   findings. Read the diffs of the top candidates yourself before choosing.
6. **No attempt passes:** give the best near-miss its failure output and repair it,
   up to `maxRepairRounds` times. If that fails, run fresh attempts, preferably on
   different workers. If that also fails, re-decompose this leaf, which requires
   **re-approval** from the user if the tree shape changes. Once the budget is
   exhausted, stop and report a diagnosis. Never quietly lower the bar.

## Phase 5: Integrate upward

At each split node, once all its children have winners:

1. Merge the winning child branches into a fresh worktree from the base ref.
   Resolve seam issues, touching only `sharedPaths` and glue code.
2. Run the split node's acceptance command and the children's commands. If a
   failure traces to one child, reopen only that child's subtree.
3. Get an adversarial review, ideally from a worker of a different model family
   than the solvers. Its prompt: "find inputs or cases where this is wrong".
   Verify each finding yourself before acting on it.

## Phase 6: Close

At the root, run all acceptance commands, the full test suite, and a final
review. Read the final diff in full. Only then decide to ship or revise.

Deliver:
- One branch, `graftree/<run>/final`, based on the user's HEAD with the solution
  plus the acceptance tests.
- A report covering what was built, the tree, which attempt and worker won each
  node and why, what was rejected and why, test results, and any residual risks.

Clean up the attempt worktrees (`git worktree remove`). Keep the branches unless
the user asks you to delete them.

## Non-negotiables

- Never skip the approval pause. Never edit locked acceptance tests after
  approval. If a test is wrong, stop, explain why, and get approval for a replan.
- Only an actual test run you saw counts as evidence, never a worker saying
  "tests pass".
- Report honestly: failed attempts, exhausted budgets, and remaining doubts go in
  the report.
