# graftree

**Tree-structured, test-first, multi-model problem solving for hard coding tasks.**

graftree splits a hard problem into a tree of independent sub-tasks. It writes
acceptance tests *before* any code, then solves each leaf several times in
isolated git worktrees, across different models. The verified results are merged
back up into a single best solution. It trades speed and tokens for accuracy.

The agent that invokes it (Claude Code by default) is always the **closer**: it
makes every final decision. Other models, such as DeepSeek via
[CommandCode](https://www.npmjs.com/package/command-code), anything on
OpenRouter, or local models, can do the planning, solving and review work.

```
            [problem]
                │  triage → plan + acceptance tests
                ▼
        ⏸ human approves the plan         (nothing is spent before this)
                │  tests locked by hash
       ┌────────┼────────┐
      [A]      [B]      [C]               each leaf: N attempts, own worktree,
     a1 a2    b1 b2    c1 c2              mixed models
       └─┬┘     └─┬┘     └─┬┘
       best     best     best             gates: tests pass, locked tests untouched,
         └────────┼────────┘              edits stay in owned paths
             integrate + review           verified at every merge
                  ▼
        closer's final decision → one branch + report
```

## Status

**v0.4: the full loop runs, live.** Plan → approval → solve → verify → repair →
review → harden → integrate → close. It is covered by end-to-end tests with a
scripted fake agent, and has been run end to end on Windows with DeepSeek V4.1
Flash through CommandCode. OpenRouter tool calling still needs a live test. See
[Verification status](#verification-status).

## Install

Pick whichever parts you need. Each one works on its own.

### The skill (Claude Code)

```
/plugin marketplace add oum353/agent-tree
/plugin install graftree@graftree
```

Then ask Claude to "use graftree to …", or run `/graftree`. For other agents
(CommandCode, OpenCode, Codex, …) see [integrations/AGENTS.md](integrations/AGENTS.md).
The skill is a plain folder: [`plugins/graftree/skills/graftree/`](plugins/graftree/skills/graftree/).

### The CLI

```bash
# From GitHub (dist/ is prebuilt, no build step):
npm i -g https://codeload.github.com/oum353/agent-tree/tar.gz/refs/heads/claude/stoic-einstein-6rjiws

# After the npm release:
npm i -g graftree-agent
npx -y graftree-agent --help          # no install
```

This needs Node ≥ 20 and git. It works on Linux, macOS and Windows; CI runs on all three.
Until the code is merged to `main` and published to npm, install from the branch as shown.
(`npm i -g github:…` git installs are unreliable: npm can drop files while extracting them.)

### The library

```ts
import { Store, checkPlan, newRun, submitPlan, approveRun, runWorker } from "graftree-agent";
```

The JSON Schemas ship with the package: `graftree-agent/schema/plan.schema.json`,
`run.schema.json` and `config.schema.json`.

## Quick start (CLI)

```bash
cd your-repo
graftree init                                    # writes .graftree/config.yaml
graftree new "Fix race in the job scheduler's retry path" --tier focused
# draft tests under .graftree/runs/<id>/tests/<repo path>, write plan.json, then:
graftree plan --file plan.json                   # or: graftree plan --worker cc-deepseek-flash
graftree show                                    # review .graftree/runs/<id>/plan.md
graftree approve --notes "go"                    # or: graftree reject --notes "…"

graftree run                                     # solve + verify + integrate; stops for decisions
graftree diff parser 2                           # inspect a candidate
graftree decide parser 2 --notes "smallest correct diff"
graftree run                                     # continue (integration, next decisions)
graftree close                                   # final checks → branch graftree/<run>/final + report.md
```

The engine never picks winners on its own unless you set `budgets.autoSelect: true`
or pass `run --auto-select` (for CI). When a review finds a real bug the tests missed,
`harden NODE --tests DIR --command "…" --reason "…" --yes` adds new tests (with your OK):
they are locked, existing attempts re-verify, and every one that now fails is repaired.
Other commands: `retry NODE` (more attempts),
`attempt NODE --worktree P` (submit your own candidate through the same gates),
`clean` (remove worktrees).

Add `--json` to any command for machine-readable output.

## Configure workers

`.graftree/config.yaml` (created by `graftree init`):

```yaml
workers:
  cc-deepseek-flash:                 # CommandCode + DeepSeek V4.1 Flash, headless
    type: cli
    command: [commandcode, -p, "{prompt}", -m, "{model}", --output-format, json,
              --max-turns, "80", --yolo, --trust, --no-session,
              --skip-onboarding, --no-auto-update]
    model: deepseek/deepseek-v4.1-flash
    output: ndjson
  openrouter-x:                      # any OpenAI-compatible endpoint
    type: openai-compatible
    baseUrl: https://openrouter.ai/api/v1
    apiKeyEnv: OPENROUTER_API_KEY    # keys come from env, never from config
    model: <model-id>

roles:                               # "closer" = the invoking agent does it itself
  planner: [closer]
  test_writer: [closer]
  solver: [cc-deepseek-flash, openrouter-x]   # round-robin: mixed models catch each other's mistakes
  integrator: [closer]
  reviewer: [openrouter-x]
```

Smoke-test a worker with `graftree worker test cc-deepseek-flash`. For
CommandCode, install it with `npm i -g command-code` and run `commandcode login` first.

## What gets verified

Each candidate passes through these gates in order. Failing any one of them rules it out:

1. **Locked tests:** the acceptance tests approved by the human are unchanged.
2. **Ownership:** every edit is inside the node's `ownedPaths`. For an
   integration, edits must be in `sharedPaths` or in parent paths that no child owns.
3. **Build:** `commands.build` passes, if set.
4. **Acceptance:** the node's test command passes. For a split, every
   descendant's command must pass too.

Passing candidates are then scored on diff size, lint, repairs needed and review
verdict. The closer decides which one wins.

Reviews look for what the tests missed. Each reviewer also gets the findings raised
on sibling attempts and must confirm or rule out each one for its own candidate.
A finding that proves real can become a hardening test (see above). A repair
invalidates the old review, so repaired code is reviewed again.

Every worker call is metered: tokens in and out per attempt, totals in `run`/`show`
output, and a cost section in `report.md`.

## Verification status

| Part | How it's verified |
|---|---|
| Engine, gates, repair, integration, close | Automated end-to-end tests using a scripted fake CLI agent |
| API worker tool loop | Tests against a mocked OpenAI-compatible server |
| CommandCode worker | Live: two full runs on Windows with DeepSeek V4.1 Flash (solve, review, hardening + repair, integrate, close). Output parsing is also tested against a captured run |
| OpenRouter | The request format is standard, but **no live call has been made yet** |

## Safety

- Workers run model-written code, and CLI workers typically run with their
  permission prompts bypassed. graftree only ever points them at throwaway git
  worktrees and never pushes. Still, run it on machines and repos where that is
  acceptable, or inside a container.
- API keys are read only from environment variables.
- Approval never modifies your working tree, index, or current branch. The base
  commit lives under `refs/graftree/<run>/base`. Results land on their own branches.
- Attempt worktrees live in `.graftree/runs/<id>/wt/` until `close` (or `clean`)
  removes them. If your test runner scans every directory without respecting
  `.gitignore`, exclude `.graftree/` from it.

## Development

```bash
npm install
npm run check      # typecheck + tests
npm run build
npm run schema     # regenerate schema/*.json after changing src/schema.ts
```

## License

MIT
