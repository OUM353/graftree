# tasklog

A small command-line task list kept in a plain text file. No dependencies;
Node >= 20.

```
tasklog add Write the report --due fri --tags work
tasklog list
tasklog done 3
```

## Commands

- `add <title...> [--due DATE] [--tags a,b]`: add an open task. The title is
  the rest of the arguments. Prints `added: <id> <title>`.
- `list [--status open|done|all] [--tag TAG]... [--due-before DATE] [--json]`:
  show tasks, open ones by default (see `defaultStatus`). `--tag` can be repeated; a task must have
  every tag given. `--due-before` keeps tasks due strictly before that date.
  Tasks are sorted by due date (tasks without one last), then by id. An open
  task that is overdue shows `!` after its date. `--json` prints an array of
  `{ id, status, created, updated, due, tags, title }` (`due` is `null` when
  unset). `updated` is the day the task last changed.
- `done <id...>`: mark tasks done. Prints `done: <id> <title>` for each.
- `undo`: revert the last command that changed the file, whole (one `done`
  of five tasks is one step). Prints `undone: <command>`. Up to 20 steps.

Every command takes `--file PATH`. Without it, tasklog uses `$TASKLOG_FILE`,
then `./tasks.txt`.

## Picking tasks

Wherever a command takes a task id you can write `last` for the most recently
added task (the highest id). Commands that take several tasks also accept
ranges and lists: `done 2-4,7,last`.

## Dates

Anywhere a date is accepted you can write `today`, `tomorrow`, `yesterday`,
a step from today (`+3d`, `-1d`, `+2w`, `+1m`), a weekday (`fri`, `friday`:
the next one, never today), an exact day (`2027-03-14`), or `none` for no
date. Months are calendar months: `+1m` from January 31 is the last day of
February. `TASKLOG_NOW=YYYY-MM-DD` fixes "today", which the tests rely on.

## Tags

Comma-separated, case-insensitive, letters, digits and dashes only. They are
stored lower-case, without duplicates, sorted. `none` or an empty value means
no tags.

## Settings

`.tasklogrc` in the same directory as the task file (or the file named by
`$TASKLOG_CONFIG`) is a JSON object:

- `defaultStatus`: the status `list` shows without `--status` (default `open`).
- `defaultTags`: tags every new task starts with, e.g. `"inbox"`.

## Safety

- Commands that change the task file lock it (`tasks.txt.lock`) while they
  run. If another tasklog holds the lock, they stop with exit code 3 and
  change nothing. Commands that only read, like `list`, never lock.
- Every change is recorded in `tasks.txt.undo` so `undo` can revert it.
- tasklog 2 writes the v2 file format (with `updated`) and still reads v1
  files from tasklog 1.x.

## Errors

Errors go to stderr as `tasklog: <message>`. Exit codes: `0` success, `1` a
task that does not exist (or nothing to undo), `2` bad usage (unknown option,
invalid date, tag, id or status, missing argument), `3` the file is locked. A
command that fails changes nothing.
