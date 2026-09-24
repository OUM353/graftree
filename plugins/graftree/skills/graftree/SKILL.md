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
`npm i -g https://codeload.github.com/oum353/agent-tree/tar.gz/refs/heads/main` before the npm release), then stop.

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

## Phase 4: Solve (the engine drives, you decide)

```bash
$GT run <run> --json
```

The engine walks the tree bottom-up:
- **Leaves:** it runs N attempts per leaf, each in its own worktree, spread
  round-robin across `roles.solver`. Every attempt goes through the gates:
  locked tests untouched, edits only inside `ownedPaths`, `commands.build` if set,
  and the node's acceptance command. Every failing near-miss gets its own repair
  rounds with its failure output, even after another attempt passes
  (`budgets.repairAll: false` stops at the first pass instead). The top passing candidates are reviewed by
  `roles.reviewer` workers.
- **Splits:** once all its children have winners, it merges them and gates the
  merge against the split's own tests plus every descendant's tests. If glue is
  needed and `roles.integrator` has workers, they repair the merge.

`run` returns when only you can move things forward. The JSON has
`status: "awaiting_closer"` and a `decisions` list. Each entry has an
`awaiting` reason and candidates with status, score, diff size and review
verdict. Handle every decision:

| Situation | What you do |
|---|---|
| Passing candidates to choose from | Read the diffs of the top ones yourself (`$GT diff <node> <n> --run <run>`) and any review files, then `$GT decide <node> <n> --run <run> --notes "why"`. Prefer correct and clear over clever. The recommendation is only a hint |
| `escalated`: nothing passed | Read the logs under `.graftree/runs/<run>/nodes/<node>/`. If attempts fail in scattered ways, run `$GT retry <node> --count N` or solve it yourself (below). If the leaf is too big to solve in one piece, re-decompose it (below). If the tests themselves are wrong, stop, tell the user, and get approval before replanning |
| A closer slot (`roles.solver` includes `closer`) | Solve it with your own subagents in a worktree from the node base, then run `$GT attempt <node> --worktree <path> --run <run>` |
| An integration needs glue (integrator is `closer`) | Edit the worktree named in `awaiting`, touching only the split's `sharedPaths` or parent paths no child owns. Then run `$GT attempt <node> --worktree <that path>` and `$GT decide` |

After deciding, run `$GT run <run> --json` again. Repeat until the status is
`ready_to_close`. Changing a winner after its parent was integrated reopens the
parent automatically.

Rules that don't bend: `decide` accepts only attempts that passed every gate,
and an attempt you submit goes through exactly the same gates as a worker's.

### Turning review findings into tests (hardening)

Reviews are advisory until a test enforces them. When a review finding is
**real** (you reproduced it, or it plainly contradicts the goal), and it
applies to the candidate you'd pick (reviewers now check sibling findings
against each candidate; read their `SIBLING FINDINGS` section):

1. Write a small new test file that fails on that input, at a new repo path
   (for example `test/parser.hardening.test.mjs`) inside a scratch dir that
   mirrors repo paths.
2. **Ask the user** with the finding, the test, and why it matters. Hardening
   raises the bar after approval, so it needs their OK.
3. With their OK, run `$GT harden <node> --tests <dir> --command "<runs the new test>" --reason "<the finding>" --yes --run <run>`.
4. Run `$GT run <run>` again. Existing attempts are re-verified against the new
   tests; the ones that now fail go through repair (a fresh repair budget).
   Then decide as usual.

Hardening only adds files. It can never change or remove an approved test.
Every hardening is listed in the report with its reason. Don't harden for
style or speculative issues; for those, put them in the report.

### Splitting a stuck leaf (re-decomposition)

When a leaf escalates because it bundles separable problems (attempts get
different parts right, or the failure logs point at distinct sub-problems),
split it into a subtree instead of retrying the whole thing:

1. Write `subtree.json` (schema: `$GT schema subtree`). The leaf becomes a split
   and keeps its goal, `ownedPaths` and locked tests, so the bar does not drop.
   Each child needs disjoint `ownedPaths` inside the leaf's, and its own new
   tests at new repo paths, drafted in a scratch dir that mirrors repo paths.
   Siblings solve independently, so a child's tests must not need code from
   another child; the split's own (already locked) tests check them together.
   Glue files go in `sharedPaths`.
   ```
   {"rationale": "…", "sharedPaths": ["src/parser/index.ts"],
    "nodes": [{"id": "lexer", "parent": "<leaf>", "kind": "leaf", "goal": "…",
               "ownedPaths": ["src/parser/lex/**"],
               "acceptance": {"files": ["test/lex.test.ts"], "command": "…"}}, …]}
   ```
2. `$GT redecompose <leaf> --file subtree.json --tests <dir> --reason "<why whole-leaf attempts failed>" --run <run>`.
   It validates the new tree, raises the tier if the extra depth needs it, and
   pauses the run at `awaiting_approval`.
3. **Show the user** `.graftree/runs/<run>/plan.md` (the proposal is at the
   top) and wait. Then run `$GT approve <run>` or `$GT reject <run> --notes "…"`.
   Rejecting resumes the run as it was.
4. `$GT run <run>`. The leaf's old attempts are retired (their cost stays in the
   report) and the new children are solved, integrated and gated like any others.

Each leaf can be re-decomposed `budgets.maxRedecompositions` times (default 1).

Cost so far appears in `run`/`show` output (`Cost so far: … calls, … in / … out`).
Mention it when you summarize for the user.

## Phase 5: Close

```bash
$GT close <run> --json
```

This runs every node's acceptance command plus `commands.test`, `build` and `lint`
on the root winner. On success it creates branch `graftree/<run>/final`, which is
based on the user's HEAD and contains the tests and the solution. It also writes
`.graftree/runs/<run>/report.md`.

Before telling the user it's done, read the final diff
(`git diff <their HEAD>..graftree/<run>/final`) and the report. Give them a short
summary: what changed, which worker and attempt won each node and why, what was
rejected, the check results, and any risk you still see. Don't merge the branch
into their work unless they ask you to.

If the final checks fail, the run goes back to `awaiting_closer` with the reason.
Fix it with an `attempt` on the root, then `decide`, then `close` again.

## Non-negotiables

- Never skip the approval pause, for the first plan or for a re-decomposition. Never edit locked acceptance tests after
  approval. If a test is wrong, stop, explain why, and get approval for a replan.
- Only an actual test run you saw counts as evidence, never a worker saying
  "tests pass".
- Report honestly: failed attempts, exhausted budgets, and remaining doubts go in
  the report.
