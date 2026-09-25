import { test } from "node:test";
import assert from "node:assert/strict";
import { addMonths, parseDate } from "../src/dates.mjs";

const base = "2027-03-10"; // a Wednesday

test("relative dates", () => {
  assert.equal(parseDate("today", base), base);
  assert.equal(parseDate("Tomorrow", base), "2027-03-11");
  assert.equal(parseDate("+2w", base), "2027-03-24");
  assert.equal(parseDate("-1d", base), "2027-03-09");
  assert.equal(parseDate("+1m", "2027-01-31"), "2027-02-28");
});

test("weekdays are strictly after today", () => {
  assert.equal(parseDate("wed", base), "2027-03-17");
  assert.equal(parseDate("friday", base), "2027-03-12");
});

test("none and exact days", () => {
  assert.equal(parseDate("none", base), null);
  assert.equal(parseDate("2028-02-29", base), "2028-02-29");
  assert.throws(() => parseDate("2027-02-29", base), /invalid date/);
});

test("addMonths clamps", () => {
  assert.equal(addMonths("2028-01-31", 1), "2028-02-29");
  assert.equal(addMonths("2027-08-31", -2), "2027-06-30");
});
