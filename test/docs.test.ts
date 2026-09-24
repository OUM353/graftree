import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { checkPlan } from "../src/plan.js";

// Keep documentation examples honest: every JSON plan in the skill's reference must validate.
test("plan examples in the skill reference are valid", () => {
  const md = readFileSync("plugins/graftree/skills/graftree/references/plan-format.md", "utf8");
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
  const skill = readFileSync("plugins/graftree/skills/graftree/SKILL.md", "utf8");
  const fm = /^---\nname: (.+)\ndescription: (.+)\n---\n/.exec(skill);
  assert.ok(fm, "frontmatter missing");
  assert.equal(fm[1], "graftree");
  assert.ok(fm[2]!.length < 1024);
});

test("examples/calculator plan validates against its drafted tests", async () => {
  const plan = JSON.parse(readFileSync("examples/calculator/plan.json", "utf8"));
  assert.deepEqual(checkPlan(plan, { testsDir: "examples/calculator/tests" }).errors, []);
});
