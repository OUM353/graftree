**Ticket TL-42: edit, export and recurring tasks**

Our team has used tasklog daily for a year. Three things keep coming up:

1. **Editing.** Right now fixing a typo or moving a due date means adding a
   new task and marking the old one done. We need something like
   `tasklog edit 3 --title "Send the report" --due fri --tags work,urgent`.
   Any of those can be given on their own. It must also be possible to remove
   a task's due date or its tags.

2. **Export.** For the weekly report we want the tasks as CSV (for the
   spreadsheet) or JSON (for the dashboard): `tasklog export --format csv`.
   It should take the same filters as `list`, so we can export, say, only
   `--status done --tag work`. Output goes to stdout.

3. **Recurring tasks.** Things like a weekly review:
   `tasklog add Weekly review --due mon --every week`. When a recurring task is
   marked done, the next one should appear on its own, due one interval after
   the previous due date. Intervals like `day`, `week` and `month`, or a step
   like `2w`, would cover us. A recurring task needs a due date.

Please keep everything consistent with how tasklog already works (see the
README and the existing code and tests). People have years of task files,
so existing files must keep working.
