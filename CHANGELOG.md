# Changelog

## 1.0.0

The first stable release, after a full audit of the code, docs and examples.

**Fixes**
- A node that depends on another (`dependsOn`) now starts over when that
  dependency is retried or hardened. Before, it could keep building on the
  dependency's old winner.
- `close` holds the run lock, like the other commands that change a run.
- "Latest run" follows creation time. Two runs started in the same minute
  could make `latest` point at the older one.
- A timed-out worker or test command is stopped together with every process it
  started (its process group on macOS and Linux, its process tree on Windows),
  and Ctrl-C on graftree stops them too. Before, a child the agent had started
  could keep running after the timeout.
- API workers: a reply that isn't JSON fails that call instead of crashing the
  run; cached input tokens from OpenAI-style APIs are counted; tool paths on
  another Windows drive are rejected.
- The cost estimate no longer counts a split's plain merge as a worker call,
  and it now counts integrator repairs toward the maximum.

**CLI**
- Readable errors for an invalid `--tier`, a file that isn't valid JSON (named),
  and a `--count` that isn't a positive whole number.
- Exit codes are consistent and documented in `--help` (a rejected
  re-decomposition now exits 2, like a rejected plan). `init --force` is listed.
- Output is flushed before exiting, so large `--json` output isn't cut short on
  a pipe.

**Protocol**
- The unused statuses `verifying`, `selected`, `failed` and `redecomposed`
  (node) and `failed` (run) are gone from the schema; they were never written.
- Node ids in the published JSON Schema accept upper-case letters, matching the
  engine.
- Schema `$id`s point at the files on GitHub.

**Docs and packaging**
- README, DESIGN, the skill and the examples now match the code and the
  benchmark results. DESIGN no longer describes features that were never built
  (a native Anthropic worker, a sandbox wrapper, hard token caps, automatic
  collapse of coupled splits).
- The package no longer ships source maps that pointed at files it doesn't
  include. CI also tests Node 24.
- The README has a logo, badges, a how-it-works diagram in place of the ASCII
  sketch, and a benchmark chart, each in a light and a dark version
  (`npm run images` draws them).

## 0.4.3
- `close` crashed when the root's acceptance command listed many test files
  (the log file name was too long).
- Benchmarks: examples/minisheet (a hard, precise spec with a 38-test holdout
  and an 88-test strict suite) and examples/tasklog (a vague ticket on an
  existing codebase, 50 tests).

## 0.4.2
- A cost estimate in worker calls before approval, in `plan`, `approve` and
  `plan.md`. README, skill and plugin descriptions say plainly that a run costs
  several to dozens of times a single-agent run.

## 0.4.1
- `dependsOn` gives code, not just order: a dependent leaf starts from its
  dependencies' winning code.
- A new plan's drafted tests replace the previous plan's.
- Claude usage counts cache reads and writes as input.

## 0.4.0
- Repair every near-miss (`budgets.repairAll`, default on).
- Re-decomposition: split a stuck leaf into a subtree, with human approval.
- Usage warnings: high tokens, many calls, a runaway attempt, wall time.
- `graftree new --file`; examples/kvstore with a hidden holdout suite.

## 0.3.0
- Hardening: add tests after approval from review findings.
- Reviews cross-check sibling findings; reviewing continues until the leader is
  reviewed.
- Cost tracking per attempt and per run.

## 0.2.0
- Automated solve, verify, repair, review, integrate and close.
- Windows support for CLI workers; compiled `dist/` shipped for GitHub installs.

## 0.1.0
- Planning engine, CLI, workers and the Claude Code skill.
