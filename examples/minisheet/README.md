# Example: minisheet (a hard benchmark)

[kvstore](../kvstore/) turned out to be too easy: a single DeepSeek agent and a
graftree run both scored 25/25. This benchmark is built to separate them. It
asks for a small spreadsheet engine, and the spec is full of rules that
interact and are easy to get subtly wrong:

- **Precedence:** `-2^2` is 4, and `^` is left-associative.
- **Numbers:** display and `=` comparisons use 15 significant digits, so
  `0.1+0.2=0.3` is TRUE. `ROUND` rounds the decimal value, so `ROUND(1.005,2)`
  is 1.01.
- **Coercion:** it differs for reference and expression arguments (`SUM(A1)`
  ignores the text "3", `SUM("3")` counts it) and for empty cells in comparisons.
- **Laziness vs dependencies:** `IF` evaluates only one branch, but cycles count
  both.
- **Scale:** 9,999-cell dependency chains and cycles must not overflow the stack.
- **Structural edits:** row and column insertion and deletion rewrite every
  reference. That includes ranges that grow, shrink or become `#REF!`,
  per-coordinate `$`, reversed ranges, and string literals that look like
  references.
- **Copy:** relative references move when a formula is copied, and ones that
  leave the sheet become `#REF!`.

Contents:

- `starter/`: a plain cell store and A1-address helpers, with tests (the
  "existing repo").
- `PROBLEM.md`: the full spec. Every holdout test checks a rule written here;
  nothing is hidden.
- `holdout/`: two grading suites. **Keep them away from the planner and the
  solvers.**
  - `minisheet.holdout.test.mjs`: the original 38 tests.
  - `minisheet.strict.test.mjs`: 88 more, one per rule, covering what the
    first suite skips (input edge cases, precedence chains, coercion corners,
    display, every function's argument rules, cycles vs lazy `IF`, untouched
    reference text, column edits at ZZ, and copy). They were written from the
    spec alone, before looking at any graded solution.
- `setup.mjs` / `grade.mjs`: the same as for kvstore.

A reference solution (not included) passes 38/38 and 88/88. The untouched
starter passes 1 and 2. `grade.mjs` prints one line per suite.

## Run it

It's the same flow as [kvstore](../kvstore/README.md), with `minisheet` in the
paths:

```powershell
$EX = "$HOME\graftree-src\examples\minisheet"
node $EX\setup.mjs $HOME\ms-tree
cd $HOME\ms-tree
graftree init            # then put your workers and roles in .graftree\config.yaml
graftree new --file $EX\PROBLEM.md
# plan (closer or --worker), approve, run, close, then:
node $EX\grade.mjs . --ref graftree/<run>/final
```

Single-agent baseline with the same solver model:

```powershell
node $EX\setup.mjs $HOME\ms-solo
cd $HOME\ms-solo
copy $EX\PROBLEM.md .
commandcode -p "Implement everything described in PROBLEM.md. Run npm test when done." -m deepseek/deepseek-v4.1-flash --yolo --trust --no-session --skip-onboarding
node $EX\grade.mjs .
```

Expect a graftree run to be expensive here. The problem has four or five natural
parts (parser, values and functions, the dependency engine, reference
rewriting, maybe copy), each worth several attempts.

## Measured so far

| Setup | Holdout | Strict | Worker calls | Tokens |
|---|---|---|---|---|
| Reference solution | 38/38 | 88/88 | – | – |
| Untouched starter | 1/38 | 2/88 | – | – |
| Single agent: Claude Haiku 4.5 (Claude Code, one prompt) | 12/38 | 66/88 | 1 | not measured |
| Single agent: DeepSeek V4.1 Flash (CommandCode, one prompt) | **38/38** | 86/88 | 1 | not measured |
| graftree: Opus 5.5 as closer (plans, tests, reviews, integrates), DeepSeek V4.1 Flash solving | **38/38** | **88/88** | 11 | 15.4M in (14.8M cached), 0.5M out, plus the closer's own usage |

**What the numbers say.** On the holdout, graftree tied with DeepSeek alone at
about 11× the worker calls, plus the closer's time and about 51 minutes of
worker time. DeepSeek through CommandCode tests its own work: it wrote 35 tests
and about 100 probe checks, and fixed three of its own bugs. A precise spec plus
an agent like that is enough, so this benchmark separates weak single agents
from strong ones, not strong single agents from graftree.

**What the numbers miss.** Reading the candidates' code, the closer found three
spec violations that none of the 38 holdout tests exercise:

- a range such as `A2:B1` written back as-is instead of top-left:bottom-right
  (section 8);
- references re-uppercased even when an edit did not move them (section 8);
- `IF(" true ",1,2)` trimming spaces when converting text to a boolean, so it
  gave 1 instead of `#VALUE!` (section 4).

It picked the attempts without these slips, and fixed one other bug by hand:
`ROUND` returned `Infinity` instead of `#NUM!`. The DeepSeek-only result has not
been checked for such slips. A holdout that covers them would show whether
the review step buys correctness that plain test counts don't see.

**The strict suite.** To check, the 88-test strict suite was written from the
spec, one test per rule the first suite skips, and both results were graded
again. graftree scored 88/88; DeepSeek alone 86/88. DeepSeek's two misses:

- `=SUM (1)` treated as a function call, though §3 says the name must be
  *immediately* followed by `(`. DeepSeek listed this as an ambiguity it had
  resolved the other way, so it was a judgment call, not an oversight.
- Unmoved references re-uppercased by row/column edits (§8): the same slip the
  graftree closer found in one of its candidates and rejected.

So the review step bought something real, but small: 2 rules out of 126, at
about 11× the worker calls plus the closer's work. Caveat: the strict suite was
written after the closer's findings were known, so one of the two misses is a
rule we already knew to test for; it was checked the same way for both
results, and DeepSeek passed the other two rules the closer had flagged.

The graftree run also exposed a bug in graftree itself: `close` crashed when the
root's acceptance command listed many test files (the log file name was too
long). Fixed in v0.4.3.
