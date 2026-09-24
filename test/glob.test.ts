import assert from "node:assert/strict";
import { test } from "node:test";
import { matchesPath } from "../src/glob.js";
import { _test } from "../src/solve.js";

test("matchesPath handles **, *, ? and literal dirs", () => {
  assert.ok(matchesPath("src/**", "src/a/b.ts"));
  assert.ok(matchesPath("src/**/*.ts", "src/x.ts"));
  assert.ok(matchesPath("src/**/*.ts", "src/a/b/x.ts"));
  assert.ok(!matchesPath("src/**/*.ts", "src/a/x.js"));
  assert.ok(matchesPath("src/*.ts", "src/x.ts"));
  assert.ok(!matchesPath("src/*.ts", "src/a/x.ts"));
  assert.ok(matchesPath("src/parser", "src/parser/index.ts"));
  assert.ok(!matchesPath("src/parser", "src/parser2/index.ts"));
  assert.ok(matchesPath("a?.md", "ab.md"));
  assert.ok(matchesPath("src/a.b.ts", "src/a.b.ts"));
  assert.ok(!matchesPath("src/a.b.ts", "src/aXb.ts"));
});

test("integration may touch shared or unowned parent paths only", () => {
  type Args = Parameters<typeof _test.integrationAllows>;
  const root = { id: "root", parent: null, ownedPaths: ["src/**"], sharedPaths: ["src/index.ts"] } as unknown as Args[1];
  const child = { id: "a", parent: "root", ownedPaths: ["src/a/**"], sharedPaths: [] };
  const run = { nodes: { root, a: child } } as unknown as Args[0];
  assert.ok(_test.integrationAllows(run, root, "src/index.ts"));
  assert.ok(_test.integrationAllows(run, root, "src/glue.ts"));
  assert.ok(!_test.integrationAllows(run, root, "src/a/x.ts"));
  assert.ok(!_test.integrationAllows(run, root, "lib/x.ts"));
});
