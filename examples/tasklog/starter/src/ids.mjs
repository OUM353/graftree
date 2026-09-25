import { UsageError } from "./errors.mjs";

/**
 * Task selectors, wherever a command picks tasks by id:
 *   7         one task
 *   last      the task with the highest id
 *   2-4       a range (only where a command takes several tasks)
 *   2,5,9     a list (likewise); selectors can be mixed: 1,3-4,last
 * Returns ids in the order given, without duplicates.
 */
export function parseIds(input, tasks, { many = true } = {}) {
  const out = [];
  for (const part of String(input).split(",")) {
    const s = part.trim().toLowerCase();
    let ids;
    if (s === "last") {
      if (!tasks.length) throw new UsageError(`no tasks yet, so "last" means nothing`);
      ids = [Math.max(...tasks.map((t) => t.id))];
    } else if (/^[1-9]\d*$/.test(s)) {
      ids = [Number(s)];
    } else if (/^[1-9]\d*-[1-9]\d*$/.test(s)) {
      const [a, b] = s.split("-").map(Number);
      if (b < a) throw new UsageError(`invalid range: "${part.trim()}"`);
      if (b - a > 1000) throw new UsageError(`range too large: "${part.trim()}"`);
      ids = Array.from({ length: b - a + 1 }, (_, i) => a + i);
    } else {
      throw new UsageError(`invalid id: "${part.trim()}"`);
    }
    for (const id of ids) if (!out.includes(id)) out.push(id);
  }
  if (!many && (out.length !== 1 || String(input).includes(",") || /\d-\d/.test(String(input)))) {
    throw new UsageError(`this command takes a single task, got "${input}"`);
  }
  return out;
}

/** The single id a one-task command was given. */
export function parseId(input, tasks) {
  return parseIds(input, tasks, { many: false })[0];
}
