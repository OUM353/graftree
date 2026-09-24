// Grade a result with the holdout suite, which neither the planner nor the solvers saw.
//   node grade.mjs <repo-dir>              grade the working tree as it is
//   node grade.mjs <repo-dir> --ref REF    grade a commit or branch (e.g. graftree/<run>/final)
// Prints "holdout: P/T passed" and exits 0 only if every test passed.
import { execFileSync, spawnSync } from "node:child_process";
import { cpSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const [target, flag, ref] = process.argv.slice(2);
if (!target || (flag && (flag !== "--ref" || !ref))) {
  console.error("usage: node grade.mjs <repo-dir> [--ref REF]");
  process.exit(2);
}
const repo = resolve(target);
const holdout = fileURLToPath(new URL("./holdout", import.meta.url));
let dir = repo;
let scratch;
const git = (args) => spawnSync("git", args, { cwd: repo, encoding: "utf8" });
if (git(["rev-parse", "--git-dir"]).status !== 0) {
  console.error(`${repo} is not a git repository; pass the directory of the repo you ran graftree in (e.g. . from inside it)`);
  process.exit(2);
}
if (ref && git(["rev-parse", "--verify", "--quiet", `${ref}^{commit}`]).status !== 0) {
  console.error(`${ref} not found in ${repo}${/\/final$/.test(ref) ? " (it is created by `graftree close`; grade graftree/<run>/root/<attempt> before closing)" : ""}`);
  process.exit(2);
}
if (ref) {
  scratch = mkdtempSync(join(tmpdir(), "kv-grade-"));
  dir = join(scratch, "wt");
  execFileSync("git", ["worktree", "add", "--detach", dir, ref], { cwd: repo, stdio: "pipe" });
}
const dest = join(dir, "holdout");
try {
  cpSync(holdout, dest, { recursive: true });
  const env = { ...process.env };
  delete env.NODE_TEST_CONTEXT;
  const r = spawnSync(process.execPath, ["--test", "--test-reporter=tap", join("holdout", "kvstore.holdout.test.mjs")], { cwd: dir, env, encoding: "utf8" });
  const out = r.stdout ?? "";
  for (const m of out.matchAll(/^not ok \d+ - (.+)$/gm)) console.log(`  ✗ ${m[1]}`);
  const pass = Number(/^# pass (\d+)/m.exec(out)?.[1] ?? 0);
  const fail = Number(/^# fail (\d+)/m.exec(out)?.[1] ?? 0);
  console.log(`holdout: ${pass}/${pass + fail} passed${ref ? ` (${ref})` : ""}`);
  process.exitCode = fail === 0 && pass > 0 ? 0 : 1;
} finally {
  rmSync(dest, { recursive: true, force: true });
  if (scratch) {
    execFileSync("git", ["worktree", "remove", "--force", dir], { cwd: repo, stdio: "pipe" });
    rmSync(scratch, { recursive: true, force: true });
  }
}
