# Using graftree from other coding agents

graftree's skill is a standard Agent Skill: a folder with a `SKILL.md` file. So
any agent that supports skills can load it directly, and any agent that can run
shell commands can drive the `graftree` CLI.

The skill folder is `plugins/graftree/skills/graftree/`.

## Claude Code

```
/plugin marketplace add oum353/agent-tree
/plugin install graftree@graftree
```

Or copy the skill folder by hand into `~/.claude/skills/graftree/` (personal) or
`.claude/skills/graftree/` (per project).

## CommandCode

```bash
commandcode --skill path/to/agent-tree/plugins/graftree/skills/graftree
```

## OpenCode, Codex, and other agents with skills or AGENTS.md support

Copy the skill folder into the agent's skills directory. If the agent has no
skills support, paste the snippet below into the project's `AGENTS.md`:

```markdown
## graftree (high-accuracy tree solving)

For hard problems where correctness matters more than speed, follow the
protocol in `<path>/plugins/graftree/skills/graftree/SKILL.md` and drive the
`graftree` CLI (`npx -y graftree-agent …`, always with `--json`). You are the
closer: you make every final decision. Always stop for human approval after
`graftree plan`, and never modify locked acceptance tests.
```

## Headless / CI

The CLI works without any root agent for the planning phase:

```bash
npx -y graftree-agent init
npx -y graftree-agent new "…" --tier standard
npx -y graftree-agent plan --worker cc-deepseek-flash   # a worker plans + drafts tests
npx -y graftree-agent show                              # review .graftree/runs/<id>/plan.md
npx -y graftree-agent approve --notes "ok"
```
