import { UsageError } from "./errors.mjs";

/**
 * Tags are lower-case words of letters, digits and dashes. Input is a
 * comma-separated list; it is trimmed, lower-cased, de-duplicated and sorted.
 * An empty list ("" or "none") means no tags.
 */
export function parseTags(input) {
  const s = String(input).trim();
  if (s === "" || s.toLowerCase() === "none") return [];
  const out = new Set();
  for (const raw of s.split(",")) {
    const t = raw.trim().toLowerCase();
    if (t === "") continue;
    if (!/^[a-z0-9-]+$/.test(t)) throw new UsageError(`invalid tag: "${raw.trim()}"`);
    out.add(t);
  }
  return [...out].sort();
}
