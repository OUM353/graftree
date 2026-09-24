import { test } from "node:test";
import assert from "node:assert/strict";
import { parse } from "../src/parser/index.mjs";

test("parses each operator", () => {
  assert.deepEqual(parse("2+3"), { op: "+", a: 2, b: 3 });
  assert.deepEqual(parse("7-2"), { op: "-", a: 7, b: 2 });
  assert.deepEqual(parse("10*4"), { op: "*", a: 10, b: 4 });
  assert.deepEqual(parse("8/2"), { op: "/", a: 8, b: 2 });
});

test("tolerates whitespace", () => {
  assert.deepEqual(parse("  6 *  7 "), { op: "*", a: 6, b: 7 });
});

test("multi-digit integers", () => {
  assert.deepEqual(parse("123+4567"), { op: "+", a: 123, b: 4567 });
});

test("rejects invalid input with SyntaxError", () => {
  for (const bad of ["", "2", "2+", "+3", "2^3", "a+b", "2+3+4", "2.5+1"]) {
    assert.throws(() => parse(bad), SyntaxError, `should reject ${JSON.stringify(bad)}`);
  }
});
