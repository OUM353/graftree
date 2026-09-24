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
- `holdout/`: 38 grading tests. **Keep them away from the planner and the
  solvers.**
- `setup.mjs` / `grade.mjs`: the same as for kvstore.

A reference solution (not included) passes 38/38. The untouched starter passes
1 (the address-helper check).

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

| Setup | Holdout | Calls |
|---|---|---|
| Reference solution | 38/38 | – |
| Untouched starter | 1/38 | – |
| Single agent: Claude Haiku 4.5 (Claude Code, one prompt) | 12/38 | 1 |
