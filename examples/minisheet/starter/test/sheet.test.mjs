import { test } from "node:test";
import assert from "node:assert/strict";
import { Sheet } from "../src/sheet.mjs";

test("stores text per cell", () => {
  const s = new Sheet();
  s.set("a1", "hello");
  assert.deepEqual(s.get("A1"), { type: "string", value: "hello" });
  assert.equal(s.display("A1"), "hello");
  assert.deepEqual(s.get("B2"), { type: "empty" });
  s.set("A1", "");
  assert.deepEqual(s.get("A1"), { type: "empty" });
});

test("cells() lists non-empty cells row by row", () => {
  const s = new Sheet();
  s.set("B2", "x");
  s.set("C1", "y");
  s.set("A2", "z");
  assert.deepEqual(s.cells(), ["C1", "A2", "B2"]);
});

test("rejects bad input", () => {
  const s = new Sheet();
  assert.throws(() => s.set("A1", 5), TypeError);
  assert.throws(() => s.set("A0", "x"), RangeError);
});
