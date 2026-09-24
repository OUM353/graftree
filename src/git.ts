import { execFile } from "node:child_process";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import { GraftreeError } from "./util.js";

const pexec = promisify(execFile);

export async function git(
  cwd: string,
  args: string[],
  env?: NodeJS.ProcessEnv,
): Promise<string> {
  try {
    const { stdout } = await pexec("git", args, {
      cwd,
      env: env ? { ...process.env, ...env } : process.env,
      maxBuffer: 64 * 1024 * 1024,
    });
    return stdout.trim();
  } catch (e) {
    const err = e as { stderr?: string; message: string };
    throw new GraftreeError(`git ${args.join(" ")} failed: ${(err.stderr || err.message).trim()}`, "git");
  }
}

export async function repoRoot(cwd: string): Promise<string> {
  try {
    return await git(cwd, ["rev-parse", "--show-toplevel"]);
  } catch {
    throw new GraftreeError("not inside a git repository (graftree needs git for worktrees and locking)", "no_repo");
  }
}

export async function headCommit(root: string): Promise<string> {
  try {
    return await git(root, ["rev-parse", "--verify", "HEAD^{commit}"]);
  } catch {
    throw new GraftreeError("repository has no commits yet; commit something first", "no_head");
  }
}

/**
 * Create a commit = HEAD + the given files, without touching the user's
 * working tree, index, or current branch (uses a throwaway index file).
 */
export async function commitOverlay(
  root: string,
  files: { repoPath: string; sourcePath: string }[],
  message: string,
  ref: string,
): Promise<{ commit: string; parent: string }> {
  const parent = await headCommit(root);
  const tmp = await mkdtemp(join(tmpdir(), "graftree-index-"));
  const env = { GIT_INDEX_FILE: join(tmp, "index") };
  try {
    await git(root, ["read-tree", parent], env);
    for (const f of files) {
      const blob = await git(root, ["hash-object", "-w", "--", f.sourcePath]);
      await git(root, ["update-index", "--add", "--cacheinfo", `100644,${blob},${f.repoPath}`], env);
    }
    const tree = await git(root, ["write-tree"], env);
    const commit = await git(
      root,
      ["-c", "user.name=graftree", "-c", "user.email=graftree@localhost", "commit-tree", tree, "-p", parent, "-m", message],
    );
    await git(root, ["update-ref", ref, commit]);
    return { commit, parent };
  } finally {
    await rm(tmp, { recursive: true, force: true });
  }
}

export async function addDetachedWorktree(root: string, path: string, commitish: string): Promise<void> {
  await git(root, ["worktree", "add", "--detach", path, commitish]);
}

export async function removeWorktree(root: string, path: string): Promise<void> {
  await git(root, ["worktree", "remove", "--force", path]).catch(() => undefined);
  await rm(path, { recursive: true, force: true });
  await git(root, ["worktree", "prune"]).catch(() => undefined);
}

/** Files changed between two commits (repo-relative). */
export async function changedFiles(root: string, from: string, to: string): Promise<string[]> {
  const out = await git(root, ["diff", "--name-only", "--no-renames", from, to]);
  return out ? out.split("\n") : [];
}
