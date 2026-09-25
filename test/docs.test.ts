import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { checkPlan } from "../src/plan.js";

// Windows checkouts may have CRLF line endings (core.autocrlf); parse either.
const readText = (p: string) => readFileSync(p, "utf8").replace(/\r\n/g, "\n");

// Keep documentation examples honest: every JSON plan in the skill's reference must validate.
test("plan examples in the skill reference are valid", () => {
  const md = readText("plugins/graftree/skills/graftree/references/plan-format.md");
  const blocks = [...md.matchAll(/```json\n([\s\S]*?)```/g)].map((m) => m[1]!);
  assert.ok(blocks.length >= 2);
  for (const b of blocks) assert.deepEqual(checkPlan(JSON.parse(b)).errors, []);
});

test("plugin, marketplace and package versions agree", () => {
  const pkg = JSON.parse(readFileSync("package.json", "utf8"));
  const plugin = JSON.parse(readFileSync("plugins/graftree/.claude-plugin/plugin.json", "utf8"));
  const market = JSON.parse(readFileSync(".claude-plugin/marketplace.json", "utf8"));
  assert.equal(plugin.version, pkg.version);
  assert.equal(market.plugins[0].version, pkg.version);
  assert.equal(market.plugins[0].name, plugin.name);
});

test("SKILL.md has name + description frontmatter", () => {
  const skill = readText("plugins/graftree/skills/graftree/SKILL.md");
  const fm = /^---\nname: (.+)\ndescription: (.+)\n---\n/.exec(skill);
  assert.ok(fm, "frontmatter missing");
  assert.equal(fm[1], "graftree");
  assert.ok(fm[2]!.length < 1024);
});

test("examples/calculator plan validates against its drafted tests", async () => {
  const plan = JSON.parse(readFileSync("examples/calculator/plan.json", "utf8"));
  assert.deepEqual(checkPlan(plan, { testsDir: "examples/calculator/tests" }).errors, []);
});

test("examples/calculator hardening only adds new test paths", async () => {
  const { readdirSync } = await import("node:fs");
  const plan = JSON.parse(readFileSync("examples/calculator/plan.json", "utf8"));
  const locked = new Set(plan.nodes.flatMap((n: { acceptance: { files: string[] } }) => n.acceptance.files));
  for (const f of readdirSync("examples/calculator/hardening/test")) assert.ok(!locked.has(`test/${f}`), f);
});

test("examples/tasklog: starter tests pass, holdout grades the untouched starter as failing", async () => {
  const { spawnSync } = await import("node:child_process");
  const { mkdtempSync, rmSync } = await import("node:fs");
  const { tmpdir } = await import("node:os");
  const { join } = await import("node:path");
  const dir = join(mkdtempSync(join(tmpdir(), "gt-tl-")), "repo");
  const env = { ...process.env };
  delete env.NODE_TEST_CONTEXT;
  assert.equal(spawnSync(process.execPath, ["examples/tasklog/setup.mjs", dir], { encoding: "utf8" }).status, 0);
  assert.equal(spawnSync(process.execPath, ["--test", join("test", "cli.test.mjs"), join("test", "dates.test.mjs")], { cwd: dir, env, encoding: "utf8" }).status, 0);
  const graded = spawnSync(process.execPath, ["examples/tasklog/grade.mjs", dir], { env, encoding: "utf8" });
  assert.equal(graded.status, 1);
  assert.match(graded.stdout, /holdout: 2\/33 passed/);
  rmSync(join(dir, ".."), { recursive: true, force: true });
});

test("examples/minisheet: starter tests pass, holdout grades the untouched starter as failing", async () => {
  const { spawnSync } = await import("node:child_process");
  const { mkdtempSync, rmSync } = await import("node:fs");
  const { tmpdir } = await import("node:os");
  const { join } = await import("node:path");
  const dir = join(mkdtempSync(join(tmpdir(), "gt-ms-")), "repo");
  const env = { ...process.env };
  delete env.NODE_TEST_CONTEXT;
  assert.equal(spawnSync(process.execPath, ["examples/minisheet/setup.mjs", dir], { encoding: "utf8" }).status, 0);
  assert.equal(spawnSync(process.execPath, ["--test", join("test", "address.test.mjs"), join("test", "sheet.test.mjs")], { cwd: dir, env, encoding: "utf8" }).status, 0);
  const graded = spawnSync(process.execPath, ["examples/minisheet/grade.mjs", dir], { env, encoding: "utf8" });
  assert.equal(graded.status, 1);
  assert.match(graded.stdout, /holdout: 1\/38 passed/);
  assert.match(graded.stdout, /strict: 2\/88 passed/);
  rmSync(join(dir, ".."), { recursive: true, force: true });
});

test("examples/kvstore: starter tests pass, holdout grades the untouched starter as failing", async () => {
  const { spawnSync } = await import("node:child_process");
  const { mkdtempSync, rmSync } = await import("node:fs");
  const { tmpdir } = await import("node:os");
  const { join } = await import("node:path");
  const dir = join(mkdtempSync(join(tmpdir(), "gt-kv-")), "repo");
  const env = { ...process.env };
  delete env.NODE_TEST_CONTEXT;
  const node = (...args: string[]) => spawnSync(process.execPath, args, { cwd: dir, env, encoding: "utf8" });
  assert.equal(spawnSync(process.execPath, ["examples/kvstore/setup.mjs", dir], { encoding: "utf8" }).status, 0);
  assert.equal(node("--test", join("test", "store.test.mjs")).status, 0);
  const graded = spawnSync(process.execPath, ["examples/kvstore/grade.mjs", dir], { env, encoding: "utf8" });
  assert.equal(graded.status, 1);
  assert.match(graded.stdout, /holdout: 0\/\d+ passed/);
  rmSync(join(dir, ".."), { recursive: true, force: true });
});
