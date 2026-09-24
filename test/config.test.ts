import assert from "node:assert/strict";
import { test } from "node:test";
import { join } from "node:path";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { CONFIG_TEMPLATE_PATH, loadConfig } from "../src/config.js";

test("shipped config template is valid", async () => {
  const cfg = await loadConfig(CONFIG_TEMPLATE_PATH);
  assert.equal(cfg.workers["cc-deepseek-flash"]?.type, "cli");
  assert.deepEqual(cfg.roles.solver, ["cc-deepseek-flash"]);
});

test("missing config falls back to closer-only defaults", async () => {
  const cfg = await loadConfig("/nonexistent/config.yaml");
  assert.deepEqual(cfg.roles.planner, ["closer"]);
  assert.equal(cfg.budgets.maxRepairRounds, 2);
});

test("unknown worker in roles is an error", async () => {
  const dir = mkdtempSync(join(tmpdir(), "gt-cfg-"));
  const p = join(dir, "config.yaml");
  writeFileSync(p, "version: 1\nroles:\n  solver: [ghost]\n");
  await assert.rejects(loadConfig(p), /unknown worker "ghost"/);
});
