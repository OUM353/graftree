import { test } from "node:test";
import assert from "node:assert/strict";
import { parse } from "../src/parser/index.mjs";

// From the live run's review: grammar-valid but huge operands became Infinity
// or silently lost precision instead of being rejected.
test("rejects operands that are not exactly representable integers", () => {
  assert.throws(() => parse("9".repeat(400) + "+1"), SyntaxError);
  assert.throws(() => parse("1+" + "9".repeat(400)), SyntaxError);
  assert.throws(() => parse("9007199254740993+0"), SyntaxError);
});

test("still accepts the largest safe integer", () => {
  assert.deepEqual(parse("9007199254740991+0"), { op: "+", a: 9007199254740991, b: 0 });
});
