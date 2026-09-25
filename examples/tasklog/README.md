# Example: tasklog (a vague ticket on an existing codebase)

On [minisheet](../minisheet/) the spec spelled out every rule, and a strong
single agent got almost all of them. Real work is rarely that explicit. This
benchmark is a short feature ticket for an existing tool, where most of the
rules come from **how the tool already behaves** and have to be found in the
code, the tests and the README:

- `PROBLEM.md`: ticket TL-42. Add `edit`, `export --format csv|json`,
  recurring tasks (`--every week`) and `show` to `tasklog`, "consistent with
  how tasklog already works", without breaking existing task files.
- `starter/`: tasklog 2.0, a CLI of about 530 lines in nine modules. Some of its
  conventions are local, and reusing a helper is enough:
  - date forms such as `fri`, `+1m` (clamped) and `none`;
  - tag normalization;
  - `tasklog: <msg>` errors, with exit code 1 for a missing task and 2 for bad
    usage;
  - the `list` filters and sort order.

  Others cut across every command, and a new command must join them on
  purpose:
  - an **undo journal**: each command that changes the file records one step,
    and read-only commands record none;
  - a **file lock**: writers take it and stop with exit code 3 if another
    tasklog holds it; readers never lock;
  - an **`updated` date** on every change;
  - **`last`** and ranges wherever tasks are picked by id;
  - **`.tasklogrc` defaults**, such as the status `list` shows without
    `--status`;
  - **two file formats** (v1 and v2) that must both keep loading.
- `holdout/`: 50 grading tests. **Keep them away from the planner and the
  solvers.** Each test names the source of its rule: the ticket, the README,
  or the existing code. Where the ticket leaves a real choice open (output
  wording, the CSV line ending, how an empty date is written in CSV, whether
  `export` has a default format), the tests accept any reasonable answer.
- `setup.mjs` / `grade.mjs`: work the same way as in the other examples.

A reference solution (not included) passes 50/50. The untouched starter passes
1 (the existing-behavior check).

What this is meant to reward: reading the codebase before writing code,
writing tests for the implied rules (which is graftree's test-first step), and
review against the existing conventions.

**Calibration history.** A first version (tasklog 1.3, three features, 33 tests,
no cross-cutting rules) was too easy: Haiku 4.5 alone scored 31/33 in two
minutes and DeepSeek V4.1 Flash alone 33/33, because reusing the starter's
helpers gave consistency for free. Version 2.0 added the cross-cutting rules
above and the `show` feature.

## Run it

It's the same flow as [minisheet](../minisheet/README.md), with `tasklog` in
the paths and `$HOME\tl-tree` / `$HOME\tl-solo` as the directories.

## Measured so far

| Setup | Holdout | Worker calls |
|---|---|---|
| Reference solution | 50/50 | – |
| Untouched starter | 1/50 | – |
