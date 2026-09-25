// Output for `list`.

const TITLE_WIDTH = 40;

/** Open tasks due before today get a "!" after the date. */
function dueCell(t, today) {
  if (!t.due) return "-";
  return t.status === "open" && t.due < today ? `${t.due}!` : t.due;
}

function truncate(s, n) {
  const flat = s.replace(/\s+/g, " ");
  return flat.length <= n ? flat : `${flat.slice(0, n - 1)}…`;
}

export function table(tasks, today) {
  if (tasks.length === 0) return "No tasks.";
  const rows = [["ID", "STATUS", "DUE", "TAGS", "TITLE"]];
  for (const t of tasks) rows.push([String(t.id), t.status, dueCell(t, today), t.tags.join(",") || "-", truncate(t.title, TITLE_WIDTH)]);
  const widths = rows[0].map((_, c) => Math.max(...rows.map((r) => r[c].length)));
  return rows.map((r) => r.map((cell, c) => (c === r.length - 1 ? cell : cell.padEnd(widths[c]))).join("  ")).join("\n");
}

/** The JSON shape used by `list --json`. Keep the field order stable. */
export function toJson(t) {
  return { id: t.id, status: t.status, created: t.created, updated: t.updated, due: t.due, tags: t.tags, title: t.title };
}
