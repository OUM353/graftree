import { execFile } from "node:child_process";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import { GraftreeError } from "./util.js";

const pexec = promisify(execFile);

const IDENT = ["-c", "user.name=graftree", "-c", "user.email=graftree@localhost", "-c", "commit.gpgsign=false"];

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
  parentCommit?: string,
): Promise<{ commit: string; parent: string }> {
  const parent = parentCommit ?? (await headCommit(root));
  const tmp = await mkdtemp(join(tmpdir(), "graftree-index-"));
  const env = { GIT_INDEX_FILE: join(tmp, "index") };
  try {
    await git(root, ["read-tree", parent], env);
    for (const f of files) {
      const blob = await git(root, ["hash-object", "-w", "--", f.sourcePath]);
      await git(root, ["update-index", "--add", "--cacheinfo", `100644,${blob},${f.repoPath}`], env);
    }
    const tree = await git(root, ["write-tree"], env);
    const commit = await git(root, [...IDENT, "commit-tree", tree, "-p", parent, "-m", message]);
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

/** Create (or recreate) a worktree on `branch` pointing at `commitish`. */
export async function addBranchWorktree(root: string, path: string, branch: string, commitish: string): Promise<void> {
  await removeWorktree(root, path);
  await git(root, ["worktree", "add", "-f", "-B", branch, path, commitish]);
}

/** Snapshot everything in a worktree (agents may or may not commit themselves). Returns HEAD. */
export async function commitAll(wt: string, message: string, exclude: string[] = []): Promise<string> {
  // .graftree-task.md is the long-prompt handoff file for CLI workers; never part of a result.
  const ex = [".graftree-task.md", ...exclude];
  await git(wt, ["add", "-A", "--", ".", ...ex.map((p) => `:(exclude,glob)${p}`)]);
  await git(wt, [...IDENT, "commit", "-q", "--no-verify", "--allow-empty", "-m", message]);
  return git(wt, ["rev-parse", "HEAD"]);
}

export async function isAncestor(root: string, ancestor: string, descendant: string): Promise<boolean> {
  return git(root, ["merge-base", "--is-ancestor", ancestor, descendant]).then(
    () => true,
    () => false,
  );
}

export async function diffStat(root: string, from: string, to: string): Promise<{ files: number; insertions: number; deletions: number }> {
  const out = await git(root, ["diff", "--shortstat", from, to]);
  const num = (re: RegExp) => Number(re.exec(out)?.[1] ?? 0);
  return { files: num(/(\d+) files? changed/), insertions: num(/(\d+) insertions?/), deletions: num(/(\d+) deletions?/) };
}

export async function diffText(root: string, from: string, to: string): Promise<string> {
  return git(root, ["diff", from, to]);
}

/** Merge `commit` into the worktree's HEAD with a merge commit. Returns false (and aborts) on conflict. */
export async function mergeCommit(wt: string, commit: string, message: string): Promise<boolean> {
  try {
    await git(wt, [...IDENT, "merge", "--no-ff", "--no-edit", "-m", message, commit]);
    return true;
  } catch {
    await git(wt, ["merge", "--abort"]).catch(() => undefined);
    return false;
  }
}

/** Discard uncommitted changes in a worktree (e.g. after a read-only reviewer ran there). */
export async function resetWorktree(wt: string): Promise<void> {
  await git(wt, ["reset", "-q", "--hard"]);
  await git(wt, ["clean", "-q", "-fd"]);
}
