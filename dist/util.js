import { createHash } from "node:crypto";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
export class GraftreeError extends Error {
    code;
    constructor(message, code = "error") {
        super(message);
        this.code = code;
        this.name = "GraftreeError";
    }
}
export const now = () => new Date().toISOString();
export async function sha256File(path) {
    return createHash("sha256").update(await readFile(path)).digest("hex");
}
/** Write via temp file + rename so a crash never leaves half-written state. */
export async function writeFileAtomic(path, data) {
    await mkdir(dirname(path), { recursive: true });
    const tmp = `${path}.${process.pid}.${Date.now()}.tmp`;
    await writeFile(tmp, data);
    await rename(tmp, path);
}
/**
 * A safe, short file name for a label such as "acceptance: <command>". Long
 * labels are cut and get a hash suffix so they stay unique and well under
 * file-name and Windows path limits.
 */
export function logFileName(label, ext = ".log") {
    const slug = label.replace(/[^a-z0-9._-]+/gi, "_").replace(/^_+|_+$/g, "");
    if (slug.length <= 60)
        return `${slug || "log"}${ext}`;
    const hash = createHash("sha256").update(label).digest("hex").slice(0, 10);
    return `${slug.slice(0, 48).replace(/_+$/, "")}-${hash}${ext}`;
}
/** Normalize a repo-relative path and reject anything escaping the repo. */
export function normalizeRepoPath(p) {
    const parts = [];
    for (const seg of p.replace(/\\/g, "/").split("/")) {
        if (seg === "" || seg === ".")
            continue;
        if (seg === "..")
            throw new GraftreeError(`path escapes repository: ${p}`, "invalid_path");
        parts.push(seg);
    }
    if (parts.length === 0)
        throw new GraftreeError(`empty path: ${p}`, "invalid_path");
    return parts.join("/");
}
/** Literal directory prefix of a glob ("src/a/**\/*.ts" -> "src/a"); "" means repo root. */
export function globBase(pattern) {
    const segs = pattern.replace(/\\/g, "/").split("/").filter((s) => s && s !== ".");
    const out = [];
    for (const s of segs) {
        if (/[*?[\]{}!]/.test(s))
            break;
        out.push(s);
    }
    return out.join("/");
}
/** True if `a` equals `b` or is an ancestor directory of it (segment-wise). */
export function isPathPrefix(a, b) {
    if (a === "")
        return true;
    return b === a || b.startsWith(`${a}/`);
}
/** Conservative overlap test between two ownership globs: overlap unless their bases are disjoint. */
export function globsMayOverlap(a, b) {
    const ba = globBase(a);
    const bb = globBase(b);
    return isPathPrefix(ba, bb) || isPathPrefix(bb, ba);
}
//# sourceMappingURL=util.js.map