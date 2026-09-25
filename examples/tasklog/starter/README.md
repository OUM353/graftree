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
  show tasks, open ones by default. `--tag` can be repeated; a task must have
  every tag given. `--due-before` keeps tasks due strictly before that date.
  Tasks are sorted by due date (tasks without one last), then by id. An open
  task that is overdue shows `!` after its date. `--json` prints an array of
  `{ id, status, created, due, tags, title }` (`due` is `null` when unset).
- `done <id...>`: mark tasks done. Prints `done: <id> <title>` for each.

Every command takes `--file PATH`. Without it, tasklog uses `$TASKLOG_FILE`,
then `./tasks.txt`.

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

## Errors

Errors go to stderr as `tasklog: <message>`. Exit codes: `0` success, `1` a
task that does not exist, `2` bad usage (unknown option, invalid date, tag, id
or status, missing argument). A command that fails changes nothing.
