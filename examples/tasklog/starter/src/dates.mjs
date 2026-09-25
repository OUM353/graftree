import { UsageError } from "./errors.mjs";

// Dates are plain calendar days, "YYYY-MM-DD", with no time zone. Arithmetic
// runs in UTC so daylight-saving changes never shift a day.

const ISO = /^(\d{4})-(\d{2})-(\d{2})$/;
const WEEKDAYS = ["sun", "mon", "tue", "wed", "thu", "fri", "sat"];
const FULL = ["sunday", "monday", "tuesday", "wednesday", "thursday", "friday", "saturday"];

function toUtc(day) {
  const [, y, m, d] = ISO.exec(day);
  return new Date(Date.UTC(Number(y), Number(m) - 1, Number(d)));
}

function fromUtc(date) {
  return date.toISOString().slice(0, 10);
}

export function isValidDay(day) {
  if (!ISO.test(day)) return false;
  return fromUtc(toUtc(day)) === day;
}

/** Today's date. TASKLOG_NOW (YYYY-MM-DD) overrides the clock, e.g. in tests. */
export function today() {
  const fixed = process.env.TASKLOG_NOW;
  if (fixed) {
    if (!isValidDay(fixed)) throw new UsageError(`invalid TASKLOG_NOW: "${fixed}"`);
    return fixed;
  }
  const now = new Date();
  return fromUtc(new Date(Date.UTC(now.getFullYear(), now.getMonth(), now.getDate())));
}

export function addDays(day, n) {
  const d = toUtc(day);
  d.setUTCDate(d.getUTCDate() + n);
  return fromUtc(d);
}

/** Add months, clamping to the last day of the target month (Jan 31 + 1 month = Feb 28/29). */
export function addMonths(day, n) {
  const d = toUtc(day);
  const want = d.getUTCDate();
  const target = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + n, 1));
  const last = new Date(Date.UTC(target.getUTCFullYear(), target.getUTCMonth() + 1, 0)).getUTCDate();
  target.setUTCDate(Math.min(want, last));
  return fromUtc(target);
}

/**
 * Parse a date as users type it. Case-insensitive.
 *   today, tomorrow, yesterday
 *   +3d, -2d, +1w, +2m       relative to today (m = calendar months, clamped)
 *   mon .. sunday            the next such weekday, strictly after today (3+ letters)
 *   2027-03-14               an exact day
 *   none                     no date (returns null)
 */
export function parseDate(input, base = today()) {
  const s = String(input).trim().toLowerCase();
  if (s === "none") return null;
  if (s === "today") return base;
  if (s === "tomorrow") return addDays(base, 1);
  if (s === "yesterday") return addDays(base, -1);
  const rel = /^([+-])(\d{1,4})([dwm])$/.exec(s);
  if (rel) {
    const n = Number(rel[2]) * (rel[1] === "-" ? -1 : 1);
    if (rel[3] === "d") return addDays(base, n);
    if (rel[3] === "w") return addDays(base, 7 * n);
    return addMonths(base, n);
  }
  const wd = WEEKDAYS.findIndex((w, i) => s.length >= 3 && FULL[i].startsWith(s));
  if (wd >= 0) {
    const cur = toUtc(base).getUTCDay();
    const ahead = (wd - cur + 7) % 7 || 7;
    return addDays(base, ahead);
  }
  if (isValidDay(s)) return s;
  throw new UsageError(`invalid date: "${input}"`);
}
