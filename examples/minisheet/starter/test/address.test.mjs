import { test } from "node:test";
import assert from "node:assert/strict";
import { colToNumber, numberToCol, parseAddress, formatAddress } from "../src/address.mjs";

test("columns round-trip", () => {
  for (const [s, n] of [["A", 1], ["Z", 26], ["AA", 27], ["AZ", 52], ["BA", 53], ["ZZ", 702]]) {
    assert.equal(colToNumber(s), n);
    assert.equal(numberToCol(n), s);
  }
  assert.equal(colToNumber("zz"), 702);
  assert.throws(() => colToNumber("AAA"), RangeError);
  assert.throws(() => numberToCol(703), RangeError);
});

test("addresses parse and format", () => {
  assert.deepEqual(parseAddress("b7"), { col: 2, row: 7 });
  assert.equal(formatAddress({ col: 28, row: 9999 }), "AB9999");
  for (const bad of ["A0", "A10000", "A01", "1A", "", "AAA1"]) assert.throws(() => parseAddress(bad), RangeError, bad);
});
