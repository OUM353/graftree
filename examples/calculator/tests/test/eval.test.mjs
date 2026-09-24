import { test } from "node:test";
import assert from "node:assert/strict";
import { evaluate } from "../src/eval/index.mjs";

test("evaluates each operator", () => {
  assert.equal(evaluate({ op: "+", a: 2, b: 3 }), 5);
  assert.equal(evaluate({ op: "-", a: 7, b: 2 }), 5);
  assert.equal(evaluate({ op: "*", a: 6, b: 7 }), 42);
  assert.equal(evaluate({ op: "/", a: 9, b: 3 }), 3);
});

test("division by zero throws RangeError", () => {
  assert.throws(() => evaluate({ op: "/", a: 1, b: 0 }), RangeError);
});

test("unknown operator throws TypeError", () => {
  assert.throws(() => evaluate({ op: "%", a: 1, b: 1 }), TypeError);
});
