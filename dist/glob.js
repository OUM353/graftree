/** Minimal, dependency-free glob matching for repo-relative paths (`**`, `*`, `?`). */
export function globToRegExp(pattern) {
    const p = pattern.replace(/\\/g, "/").replace(/^\.\//, "").replace(/\/+$/, "");
    let re = "";
    for (let i = 0; i < p.length; i++) {
        const c = p[i];
        if (c === "*") {
            if (p[i + 1] === "*") {
                const slashAfter = p[i + 2] === "/";
                re += slashAfter ? "(?:.*/)?" : ".*";
                i += slashAfter ? 2 : 1;
            }
            else
                re += "[^/]*";
        }
        else if (c === "?")
            re += "[^/]";
        else
            re += c.replace(/[.+^${}()|[\]\\]/g, "\\$&");
    }
    return new RegExp(`^${re}$`);
}
/** A path matches a pattern if the glob matches it, or a literal pattern names it or an ancestor dir. */
export function matchesPath(pattern, path) {
    const p = pattern.replace(/\\/g, "/").replace(/^\.\//, "").replace(/\/+$/, "");
    if (!/[*?]/.test(p))
        return path === p || path.startsWith(`${p}/`);
    return globToRegExp(p).test(path);
}
export const matchesAny = (patterns, path) => patterns.some((g) => matchesPath(g, path));
