export declare function git(cwd: string, args: string[], env?: NodeJS.ProcessEnv): Promise<string>;
export declare function repoRoot(cwd: string): Promise<string>;
export declare function headCommit(root: string): Promise<string>;
/**
 * Create a commit = HEAD + the given files, without touching the user's
 * working tree, index, or current branch (uses a throwaway index file).
 */
export declare function commitOverlay(root: string, files: {
    repoPath: string;
    sourcePath: string;
}[], message: string, ref: string, parentCommit?: string): Promise<{
    commit: string;
    parent: string;
}>;
export declare function addDetachedWorktree(root: string, path: string, commitish: string): Promise<void>;
export declare function removeWorktree(root: string, path: string): Promise<void>;
/** Files changed between two commits (repo-relative). */
export declare function changedFiles(root: string, from: string, to: string): Promise<string[]>;
/** Create (or recreate) a worktree on `branch` pointing at `commitish`. */
export declare function addBranchWorktree(root: string, path: string, branch: string, commitish: string): Promise<void>;
/** Snapshot everything in a worktree (agents may or may not commit themselves). Returns HEAD. */
export declare function commitAll(wt: string, message: string, exclude?: string[]): Promise<string>;
export declare function isAncestor(root: string, ancestor: string, descendant: string): Promise<boolean>;
export declare function diffStat(root: string, from: string, to: string): Promise<{
    files: number;
    insertions: number;
    deletions: number;
}>;
export declare function diffText(root: string, from: string, to: string): Promise<string>;
/** Merge `commit` into the worktree's HEAD with a merge commit. Returns false (and aborts) on conflict. */
export declare function mergeCommit(wt: string, commit: string, message: string): Promise<boolean>;
/** Discard uncommitted changes in a worktree (e.g. after a read-only reviewer ran there). */
export declare function resetWorktree(wt: string): Promise<void>;
