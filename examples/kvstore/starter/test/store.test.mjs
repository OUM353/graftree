import { test } from "node:test";
import assert from "node:assert/strict";
import { Store } from "../src/store.mjs";

test("set, get, del", () => {
  const s = new Store();
  assert.equal(s.get("a"), undefined);
  s.set("a", "1");
  assert.equal(s.get("a"), "1");
  assert.equal(s.del("a"), true);
  assert.equal(s.del("a"), false);
});

test("keys are sorted", () => {
  const s = new Store();
  s.set("b", "2");
  s.set("a", "1");
  assert.deepEqual(s.keys(), ["a", "b"]);
});
