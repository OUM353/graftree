import assert from "node:assert/strict";
import { test } from "node:test";
import { globBase, globsMayOverlap, normalizeRepoPath } from "../src/util.js";

test("globBase takes the literal directory prefix", () => {
  assert.equal(globBase("src/a/**/*.ts"), "src/a");
  assert.equal(globBase("**"), "");
  assert.equal(globBase("./src/file.ts"), "src/file.ts");
});

test("globsMayOverlap is conservative on shared prefixes", () => {
  assert.equal(globsMayOverlap("src/parser/**", "src/eval/**"), false);
  assert.equal(globsMayOverlap("src/**", "src/eval/x.ts"), true);
  assert.equal(globsMayOverlap("src/a.ts", "src/a.ts"), true);
  assert.equal(globsMayOverlap("src/a.ts", "src/ab.ts"), false);
});

test("normalizeRepoPath rejects escapes", () => {
  assert.equal(normalizeRepoPath("./a//b/./c.ts"), "a/b/c.ts");
  assert.throws(() => normalizeRepoPath("../etc/passwd"));
});
