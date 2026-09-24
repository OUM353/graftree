/**
 * Windows can't spawn npm's `.cmd` shims without going through cmd.exe, which
 * mangles multi-line prompts and metacharacters. Instead, find the shim and run
 * the JavaScript entry point it wraps with node directly, keeping argv exact.
 * On other platforms commands are spawned as-is.
 */
export interface ResolvedCommand {
    file: string;
    prefixArgs: string[];
}
/** Extract the script path from an npm cmd-shim (current and older formats). */
export declare function parseNpmCmdShim(text: string, shimDir: string): string | null;
export declare function findOnPath(cmd: string, env: NodeJS.ProcessEnv, platform?: NodeJS.Platform): string | null;
export declare function resolveCommand(cmd: string, env?: NodeJS.ProcessEnv, platform?: NodeJS.Platform): ResolvedCommand;
