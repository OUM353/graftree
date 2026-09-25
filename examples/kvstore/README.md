# Example: kvstore (does the tree beat a single agent?)

The calculator example comes with a finished plan. This one doesn't: the planner
has to decompose a real feature request on an existing codebase, and a **holdout
suite** that nobody in the run ever sees grades the result afterwards.

- `starter/`: a small in-memory key-value store with its tests (the "existing repo").
- `PROBLEM.md`: the feature request: key expiry, nested transactions with
  rollback, a text command protocol, and a stdin/stdout CLI. The pieces interact
  (rollback must restore expiry times, the protocol drives transactions), so how
  the work is split and integrated matters.
- `holdout/`: 25 grading tests. **Keep them away from the planner and the
  solvers.** They check the spec's edge cases, including some that are easy to
  miss.
- `setup.mjs`: creates a fresh git repo from `starter/`.
- `grade.mjs`: runs the holdout suite against a directory or a branch and prints
  `holdout: P/25 passed`.

A reference solution (not included) passes all 25; the untouched starter passes none.

## 1. Graftree run (PowerShell)

Get the latest example files first (`git -C $HOME\graftree-src pull`, or clone
`https://github.com/OUM353/graftree.git` to `$HOME\graftree-src`).

```powershell
$EX = "$HOME\graftree-src\examples\kvstore"
node $EX\setup.mjs $HOME\kv-tree
cd $HOME\kv-tree
graftree init
graftree new --file $EX\PROBLEM.md          # tier: auto, the planner chooses
```

Then plan it, with one of these:

- **Claude Code as planner and closer (recommended; this is what the skill is
  for).** Open Claude Code in `$HOME\kv-tree` and run:
  `/graftree:graftree Solve run latest in this repo. Plan it yourself, then stop for my approval.`
  Calling the skill by name keeps other installed skills from taking over.
  Don't give Claude access to `graftree-src`, so it can't see the holdout.
- **A worker as planner:** `graftree plan --worker cc-deepseek-flash`.

Review the proposed tree in `.graftree\runs\<run>\plan.md`, then:

```powershell
graftree approve --notes "kvstore live run"
graftree run            # then diff / decide / run … as usual, and finally:
graftree close
node $EX\grade.mjs . --ref graftree/<run>/final
```

Note what you'd judge about the plan itself: did it split along the natural
seams (store core / transactions / protocol / CLI), keep sibling ownership
disjoint, and put interactions (rollback × expiry, protocol × transactions)
under a node whose tests cover them?

## 2. Single-agent baseline (optional, same model)

```powershell
node $EX\setup.mjs $HOME\kv-solo
cd $HOME\kv-solo
copy $EX\PROBLEM.md .
commandcode -p "Implement everything described in PROBLEM.md. Run npm test when done." -m deepseek/deepseek-v4.1-flash --yolo --trust --no-session --skip-onboarding
node $EX\grade.mjs .
```

## What to compare

| | holdout score | calls | tokens in / out | wall time |
|---|---|---|---|---|
| graftree | `grade.mjs` output | `report.md` → Cost | `report.md` → Cost | `report.md` |
| single agent | `grade.mjs` output | 1 | CommandCode's summary | your clock |

If the tree scores higher, the extra cost bought accuracy. If both reach 25/25,
the problem was too easy to separate them; the planner's decomposition is still
worth reading.

## Measured

| Setup | Holdout | Worker calls | Notes |
|---|---|---|---|
| Reference solution | 25/25 | – | not included |
| Untouched starter | 0/25 | – | |
| Single agent: DeepSeek V4.1 Flash (CommandCode, one prompt) | **25/25** | 1 | its own test suite: 41 tests, including the 2 it started with |
| graftree: Claude Code (Opus) plans, reviews and closes; DeepSeek V4.1 Flash solves | **25/25** | 6 | 3 leaves (store, protocol, cli with `dependsOn`), 2 attempts each, all passed first time; 52 acceptance tests; 2.5M tokens in (2.35M cached), 72K out |

A tie: the spec is clear enough that one careful agent gets it all. The harder
benchmarks are [minisheet](../minisheet/) and [tasklog](../tasklog/).

On macOS/Linux, use `$HOME/graftree-src/examples/kvstore` and `/` paths.
