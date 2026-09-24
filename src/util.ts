import { createHash } from "node:crypto";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { dirname } from "node:path";

export class GraftreeError extends Error {
  constructor(
    message: string,
    readonly code: string = "error",
  ) {
    super(message);
    this.name = "GraftreeError";
  }
}

export const now = () => new Date().toISOString();

export async function sha256File(path: string): Promise<string> {
  return createHash("sha256").update(await readFile(path)).digest("hex");
}

/** Write via temp file + rename so a crash never leaves half-written state. */
export async function writeFileAtomic(path: string, data: string): Promise<void> {
  await mkdir(dirname(path), { recursive: true });
  const tmp = `${path}.${process.pid}.${Date.now()}.tmp`;
  await writeFile(tmp, data);
  await rename(tmp, path);
}

/** Normalize a repo-relative path and reject anything escaping the repo. */
export function normalizeRepoPath(p: string): string {
  const parts: string[] = [];
  for (const seg of p.replace(/\\/g, "/").split("/")) {
    if (seg === "" || seg === ".") continue;
    if (seg === "..") throw new GraftreeError(`path escapes repository: ${p}`, "invalid_path");
    parts.push(seg);
  }
  if (parts.length === 0) throw new GraftreeError(`empty path: ${p}`, "invalid_path");
  return parts.join("/");
}

/** Literal directory prefix of a glob ("src/a/**\/*.ts" -> "src/a"); "" means repo root. */
export function globBase(pattern: string): string {
  const segs = pattern.replace(/\\/g, "/").split("/").filter((s) => s && s !== ".");
  const out: string[] = [];
  for (const s of segs) {
    if (/[*?[\]{}!]/.test(s)) break;
    out.push(s);
  }
  return out.join("/");
}

/** True if `a` equals `b` or is an ancestor directory of it (segment-wise). */
export function isPathPrefix(a: string, b: string): boolean {
  if (a === "") return true;
  return b === a || b.startsWith(`${a}/`);
}

/** Conservative overlap test between two ownership globs: overlap unless their bases are disjoint. */
export function globsMayOverlap(a: string, b: string): boolean {
  const ba = globBase(a);
  const bb = globBase(b);
  return isPathPrefix(ba, bb) || isPathPrefix(bb, ba);
}
