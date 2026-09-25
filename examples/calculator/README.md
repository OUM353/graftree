# Example: tiny calculator (first live run)

This is a small `standard`-tier tree: a **parser** leaf and an **eval** leaf that
meet only at the AST shape, merged at a **root** split. It runs the whole loop
(plan → approval → solve → gates → review → merge → close) at a low cost.

- `plan.json`: the decomposition, contracts, owned paths and acceptance commands.
- `tests/`: the acceptance tests, laid out at their repo-relative paths
  (`tests/test/parser.test.mjs` becomes `test/parser.test.mjs`).
  Without an implementation they fail; with a correct one all 9 pass.

## Run it (Windows `cmd.exe`)

Use any git repo that has at least one commit. It doesn't need a
`package.json`; the tests only need Node. `graftree init` writes
`.graftree\config.yaml` with DeepSeek V4.1 Flash through CommandCode as solver
and reviewer (install `command-code` and run `commandcode login` first; check it
with `graftree worker test cc-deepseek-flash`). Without a config, every role
falls back to the closer, and `run` would wait for you to submit each attempt.

```bat
cd /d %USERPROFILE%\graftree-test
graftree init
graftree new "Build a tiny calculator: parse 'a op b' and evaluate it" --tier standard
graftree plan --file %USERPROFILE%\graftree-src\examples\calculator\plan.json --tests %USERPROFILE%\graftree-src\examples\calculator\tests
graftree show
graftree approve --notes "first live run"
graftree run
```

On macOS/Linux, replace the paths with `~/graftree-src/examples/calculator/...`.

`graftree run` stops when a decision is yours:

```bat
graftree diff parser 1
graftree decide parser 1 --notes "why this one"
graftree decide eval 2 --notes "…"
graftree run
graftree decide root 1
graftree close
```

`close` creates the branch `graftree/<run>/final` and writes
`.graftree\runs\<run>\report.md`.

## Cost

The defaults give 2 leaves × 3 attempts = 6 solver runs, plus up to 2
reviews per leaf and 1 at the root. Each CommandCode call starts at about 18K
input tokens. To make the first run cheaper, set `attemptsPerLeaf: 2` under
`budgets:` in `.graftree\config.yaml` before `graftree run`.

## Try hardening

In the first live run, the reviewer found that `parse("9".repeat(400) + "+1")`
returns `a: Infinity` instead of rejecting the input. The winning parser has that
bug too. `hardening/` holds a test for it: the live-run winner fails it, and
a parser that checks `Number.isSafeInteger` passes it.

Start a fresh run as above. Once `graftree run` stops at the parser decision,
harden the parser node instead of accepting it:

```bat
graftree harden parser --tests %USERPROFILE%\graftree-src\examples\calculator\hardening --command "node --test test/parser.overflow.test.mjs" --reason "Huge operands parse to Infinity / lose precision (review finding)" --yes
graftree run
```

What happens next:
1. The engine locks the new test and brings every parser attempt onto the new base.
2. It re-runs the gates. Attempts that now fail go back to DeepSeek with the test failure.
3. Once they're fixed, it stops for your decision again.

`show` and the final report record the hardening and its cost.
