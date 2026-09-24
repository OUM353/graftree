// Create a fresh git repo from starter/ for a live run (works on Windows, macOS, Linux).
//   node setup.mjs <target-dir>
import { execFileSync } from "node:child_process";
import { cpSync, existsSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

const target = process.argv[2];
if (!target) {
  console.error("usage: node setup.mjs <target-dir>");
  process.exit(2);
}
const dir = resolve(target);
if (existsSync(dir)) {
  console.error(`${dir} already exists; pick a new directory`);
  process.exit(2);
}
cpSync(fileURLToPath(new URL("./starter", import.meta.url)), dir, { recursive: true });
const git = (...args) => execFileSync("git", args, { cwd: dir, stdio: "inherit" });
git("init", "-q");
git("add", ".");
// A fixed author, so this works on machines without a git identity (e.g. CI).
git("-c", "user.name=kvstore starter", "-c", "user.email=starter@example.invalid", "commit", "-q", "-m", "kvstore starter");
console.log(`Ready: ${dir}`);
