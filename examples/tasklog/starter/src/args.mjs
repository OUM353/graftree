import { UsageError } from "./errors.mjs";

/**
 * Parse argv against a flag spec: { name: "string" | "boolean" | "list" }.
 * Accepts --name value, --name=value and, for booleans, --name. A "list" flag
 * may be repeated. "--" ends the flags. Everything else is positional.
 */
export function parseArgs(argv, spec) {
  const flags = {};
  const positional = [];
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--") {
      positional.push(...argv.slice(i + 1));
      break;
    }
    if (!a.startsWith("--") || a === "-") {
      positional.push(a);
      continue;
    }
    const eq = a.indexOf("=");
    const name = a.slice(2, eq < 0 ? undefined : eq);
    const kind = spec[name];
    if (!kind) throw new UsageError(`unknown option: --${name}`);
    if (kind === "boolean") {
      if (eq >= 0) throw new UsageError(`--${name} does not take a value`);
      flags[name] = true;
      continue;
    }
    let value;
    if (eq >= 0) value = a.slice(eq + 1);
    else if (i + 1 < argv.length) value = argv[++i];
    else throw new UsageError(`--${name} needs a value`);
    if (kind === "list") (flags[name] ??= []).push(value);
    else flags[name] = value;
  }
  return { flags, positional };
}
