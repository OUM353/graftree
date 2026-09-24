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

**v0.1: planning phase.** Working and tested so far:

- Run store and the `tree.json` protocol, with a JSON Schema in `schema/`.
- Plan validation: seams, depth, disjoint ownership, tests-first.
- Planning by the closer or by a CLI worker in a throwaway worktree.
- The human approval gate, which locks tests into a base commit without touching your branch.
- Lock checks against candidate commits.
- Workers: CLI agents (CommandCode, OpenCode, `claude -p`, …) and OpenAI-compatible APIs (OpenRouter, Ollama, …).
- The Claude Code skill.

Automated `solve` / `integrate` / `close` commands come next. Until then, the
skill walks the closer through those phases with the same protocol. See
[DESIGN.md](DESIGN.md).

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
npm i -g graftree-agent               # after the npm release
npm i -g github:oum353/agent-tree     # straight from GitHub (builds on install)
npx -y graftree-agent --help          # no install
```

This needs Node ≥ 20 and git.

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
```

Add `--json` to any command for machine-readable output.

## Configure workers

`.graftree/config.yaml` (created by `graftree init`):

```yaml
workers:
  cc-deepseek-flash:                 # CommandCode + DeepSeek V4.1 Flash, headless
    type: cli
    command: [cmd, -p, "{prompt}", -m, "{model}", --output-format, json,
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
CommandCode, install it with `npm i -g command-code` and run `cmd login` first.

## Safety

- Workers run model-written code, and CLI workers typically run with their
  permission prompts bypassed. graftree only ever points them at throwaway git
  worktrees and never pushes. Still, run it on machines and repos where that is
  acceptable, or inside a container.
- API keys are read only from environment variables.
- Approval never modifies your working tree, index, or current branch. The base
  commit lives under `refs/graftree/<run>/base`.

## Development

```bash
npm install
npm run check      # typecheck + tests
npm run build
npm run schema     # regenerate schema/*.json after changing src/schema.ts
```

## License

MIT
