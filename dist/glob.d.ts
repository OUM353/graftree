/** Minimal, dependency-free glob matching for repo-relative paths (`**`, `*`, `?`). */
export declare function globToRegExp(pattern: string): RegExp;
/** A path matches a pattern if the glob matches it, or a literal pattern names it or an ancestor dir. */
export declare function matchesPath(pattern: string, path: string): boolean;
export declare const matchesAny: (patterns: string[], path: string) => boolean;
