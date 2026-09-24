import { test } from "node:test";
import assert from "node:assert/strict";
import { parse } from "../src/parser/index.mjs";
import { evaluate } from "../src/eval/index.mjs";

test("end to end", () => {
  assert.equal(evaluate(parse("6 * 7")), 42);
  assert.equal(evaluate(parse("100 - 1")), 99);
});

test("errors propagate", () => {
  assert.throws(() => evaluate(parse("9/0")), RangeError);
  assert.throws(() => evaluate(parse("9 % 0")), SyntaxError);
});
