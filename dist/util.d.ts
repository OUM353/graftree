export declare class GraftreeError extends Error {
    readonly code: string;
    constructor(message: string, code?: string);
}
export declare const now: () => string;
export declare function sha256File(path: string): Promise<string>;
/** Write via temp file + rename so a crash never leaves half-written state. */
export declare function writeFileAtomic(path: string, data: string): Promise<void>;
/** Normalize a repo-relative path and reject anything escaping the repo. */
export declare function normalizeRepoPath(p: string): string;
/** Literal directory prefix of a glob ("src/a/**\/*.ts" -> "src/a"); "" means repo root. */
export declare function globBase(pattern: string): string;
/** True if `a` equals `b` or is an ancestor directory of it (segment-wise). */
export declare function isPathPrefix(a: string, b: string): boolean;
/** Conservative overlap test between two ownership globs: overlap unless their bases are disjoint. */
export declare function globsMayOverlap(a: string, b: string): boolean;
