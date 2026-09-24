import { existsSync, readFileSync } from "node:fs";
import { delimiter, dirname, isAbsolute, join } from "node:path";
/** Extract the script path from an npm cmd-shim (current and older formats). */
export function parseNpmCmdShim(text, shimDir) {
    const re = /"%(?:~dp0|dp0%)\\([^"]+?\.(?:mjs|cjs|js))"/gi;
    let last = null;
    for (const m of text.matchAll(re))
        last = m[1];
    return last ? join(shimDir, ...last.split("\\")) : null;
}
export function findOnPath(cmd, env, platform = process.platform) {
    const win = platform === "win32";
    const exts = win ? (env.PATHEXT ?? ".COM;.EXE;.BAT;.CMD").split(";").filter(Boolean) : [];
    const variants = (base) => [base, ...exts.map((e) => base + e.toLowerCase())];
    if (isAbsolute(cmd) || cmd.includes("/") || cmd.includes("\\"))
        return variants(cmd).find((p) => existsSync(p)) ?? null;
    const pathVar = env.PATH ?? env.Path ?? "";
    for (const dir of pathVar.split(win ? ";" : delimiter)) {
        if (!dir)
            continue;
        // On Windows a bare name without extension is never directly executable; skip it.
        const hit = variants(join(dir, cmd)).slice(win ? 1 : 0).find((p) => existsSync(p));
        if (hit)
            return hit;
    }
    return null;
}
export function resolveCommand(cmd, env = process.env, platform = process.platform) {
    if (platform !== "win32")
        return { file: cmd, prefixArgs: [] };
    const found = findOnPath(cmd, env, platform);
    if (!found)
        return { file: cmd, prefixArgs: [] };
    if (/\.(cmd|bat)$/i.test(found)) {
        const script = parseNpmCmdShim(readFileSync(found, "utf8"), dirname(found));
        if (script && existsSync(script))
            return { file: process.execPath, prefixArgs: [script] };
        throw new Error(`${found} is a batch file graftree can't run safely (not an npm node shim). Point the worker's command at the underlying executable or script instead.`);
    }
    return { file: found, prefixArgs: [] };
}
//# sourceMappingURL=resolve-command.js.map