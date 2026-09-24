import assert from "node:assert/strict";
import { test } from "node:test";
import { globBase, globsMayOverlap, logFileName, normalizeRepoPath } from "../src/util.js";

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

test("logFileName keeps log names short, safe and unique", () => {
  assert.equal(logFileName("test"), "test.log");
  assert.equal(logFileName("acceptance: node --test t/a.test.mjs"), "acceptance_node_--test_t_a.test.mjs.log");
  const files = Array.from({ length: 12 }, (_, i) => `test/part${i}.test.mjs`).join(" ");
  const a = logFileName(`acceptance: node --test ${files}`);
  const b = logFileName(`acceptance: node --test ${files} test/extra.test.mjs`);
  assert.ok(a.length <= 64 && b.length <= 64, `${a} / ${b}`);
  assert.notEqual(a, b);
  assert.match(a, /^[A-Za-z0-9._-]+-[0-9a-f]{10}\.log$/);
});
