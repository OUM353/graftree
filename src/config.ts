import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { parse as parseYaml } from "yaml";
import { CLOSER, Config, type Role, type WorkerConfig } from "./schema.js";
import { GraftreeError } from "./util.js";

/** Package root (works from src/ under tsx and from dist/ when installed). */
export const PACKAGE_ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");

export const CONFIG_TEMPLATE_PATH = join(PACKAGE_ROOT, "templates", "config.yaml");

export async function loadConfig(path: string): Promise<Config> {
  if (!existsSync(path)) return Config.parse({ version: 1 });
  const raw = (parseYaml(await readFile(path, "utf8")) ?? {}) as Record<string, unknown>;
  // A section left with only commented-out entries parses as null; treat it as empty.
  for (const k of Object.keys(raw)) if (raw[k] === null) delete raw[k];
  const parsed = Config.safeParse(raw);
  if (!parsed.success) {
    throw new GraftreeError(`invalid config ${path}:\n${formatIssues(parsed.error.issues)}`, "config");
  }
  checkRoleReferences(parsed.data);
  return parsed.data;
}

function checkRoleReferences(cfg: Config): void {
  for (const [role, names] of Object.entries(cfg.roles)) {
    for (const n of names) {
      if (n !== CLOSER && !cfg.workers[n]) {
        throw new GraftreeError(`roles.${role} references unknown worker "${n}"`, "config");
      }
    }
  }
}

export function workersForRole(cfg: Config, role: Role): string[] {
  return cfg.roles[role];
}

export function getWorker(cfg: Config, name: string): WorkerConfig {
  const w = cfg.workers[name];
  if (!w) throw new GraftreeError(`unknown worker "${name}" (defined: ${Object.keys(cfg.workers).join(", ") || "none"})`, "config");
  return w;
}

export function formatIssues(issues: { path: PropertyKey[]; message: string }[]): string {
  return issues.map((i) => `  - ${i.path.map(String).join(".") || "(root)"}: ${i.message}`).join("\n");
}
