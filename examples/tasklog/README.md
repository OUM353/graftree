# Example: tasklog (a vague ticket on an existing codebase)

On [minisheet](../minisheet/) the spec spelled out every rule, and a strong
single agent got almost all of them. Real work is rarely that explicit. This
benchmark is a short feature ticket for an existing tool, where most of the
rules come from **how the tool already behaves** and have to be found in the
code, the tests and the README:

- `PROBLEM.md`: ticket TL-42. Add `edit`, `export --format csv|json` and
  recurring tasks (`--every week`) to `tasklog`, "consistent with how tasklog
  already works", without breaking existing task files.
- `starter/`: tasklog 1.3, a small CLI (about 350 lines) with its own
  conventions:
  - date forms such as `fri`, `+1m` (clamped) and `none`;
  - tag normalization;
  - `tasklog: <msg>` errors, with exit code 1 for a missing task and 2 for
    bad usage;
  - "a failed command changes nothing";
  - the `list` filters and sort order;
  - an escaped, tab-separated file format.
- `holdout/`: 33 grading tests. **Keep them away from the planner and the
  solvers.** Each test names the source of its rule: the ticket, the README,
  or the existing code. Where the ticket leaves a real choice open (output
  wording, the CSV line ending, how an empty date is written in CSV), the tests
  accept any reasonable answer.
- `setup.mjs` / `grade.mjs`: work the same way as in the other examples.

A reference solution (not included) passes 33/33. The untouched starter passes
2 (the existing-behavior checks).

What this is meant to reward: reading the codebase before writing code,
writing tests for the implied rules (which is graftree's test-first step), and
review against the existing conventions.

## Run it

It's the same flow as [minisheet](../minisheet/README.md), with `tasklog` in
the paths and `$HOME\tl-tree` / `$HOME\tl-solo` as the directories.

## Measured so far

| Setup | Holdout | Worker calls |
|---|---|---|
| Reference solution | 33/33 | – |
| Untouched starter | 2/33 | – |
