import { existsSync } from "node:fs";
import { join } from "node:path";
import { formatIssues } from "./config.js";
import {
  CLOSER,
  Plan,
  TIER_DEFAULTS,
  type Config,
  type NodeState,
  type PlanNode,
  type Run,
} from "./schema.js";
import { globBase, globsMayOverlap, isPathPrefix, normalizeRepoPath } from "./util.js";

export interface PlanCheck {
  plan: Plan | null;
  errors: string[];
  warnings: string[];
}

/**
 * Parse and validate a submitted plan. Structural rules enforce the design's
 * accuracy principles: one root, real splits (>=2 children), depth within the
 * tier, disjoint sibling ownership, and executable acceptance for every node.
 */
export function checkPlan(input: unknown, opts: { testsDir?: string } = {}): PlanCheck {
  const errors: string[] = [];
  const warnings: string[] = [];
  const parsed = Plan.safeParse(input);
  if (!parsed.success) {
    return { plan: null, errors: [`plan does not match schema:\n${formatIssues(parsed.error.issues)}`], warnings };
  }
  const plan = parsed.data;

  // Normalize acceptance file paths up front.
  for (const n of plan.nodes) {
    try {
      n.acceptance.files = n.acceptance.files.map(normalizeRepoPath);
    } catch (e) {
      errors.push(`node ${n.id}: ${(e as Error).message}`);
    }
  }

  const byId = new Map<string, PlanNode>();
  for (const n of plan.nodes) {
    if (byId.has(n.id)) errors.push(`duplicate node id: ${n.id}`);
    byId.set(n.id, n);
  }

  const roots = plan.nodes.filter((n) => n.parent === null);
  if (roots.length !== 1) errors.push(`plan must have exactly one root node (parent: null); found ${roots.length}`);

  const children = new Map<string, PlanNode[]>();
  for (const n of plan.nodes) {
    if (n.parent === null) continue;
    const p = byId.get(n.parent);
    if (!p) {
      errors.push(`node ${n.id}: parent "${n.parent}" does not exist`);
      continue;
    }
    if (p.kind !== "split") errors.push(`node ${n.id}: parent "${p.id}" is a leaf; only split nodes have children`);
    children.set(p.id, [...(children.get(p.id) ?? []), n]);
  }

  for (const n of plan.nodes) {
    const kids = children.get(n.id) ?? [];
    if (n.kind === "split" && kids.length < 2) {
      errors.push(`node ${n.id}: a split needs at least 2 children (has ${kids.length}); make it a leaf instead`);
    }
  }

  // Depth (and cycle detection through parent links).
  const maxDepth = TIER_DEFAULTS[plan.tier].maxDepth;
  const depthOf = (n: PlanNode): number | null => {
    let d = 0;
    let cur: PlanNode | undefined = n;
    const seen = new Set<string>();
    while (cur && cur.parent !== null) {
      if (seen.has(cur.id)) return null;
      seen.add(cur.id);
      cur = byId.get(cur.parent);
      d++;
    }
    return d;
  };
  for (const n of plan.nodes) {
    const d = depthOf(n);
    if (d === null) errors.push(`node ${n.id}: parent chain forms a cycle`);
    else if (d > maxDepth) errors.push(`node ${n.id}: depth ${d} exceeds tier "${plan.tier}" max depth ${maxDepth}`);
  }

  // Ownership: siblings disjoint; children inside their parent's ownership.
  for (const [pid, kids] of children) {
    const parent = byId.get(pid)!;
    for (let i = 0; i < kids.length; i++) {
      for (let j = i + 1; j < kids.length; j++) {
        const a = kids[i]!;
        const b = kids[j]!;
        for (const ga of a.ownedPaths) {
          for (const gb of b.ownedPaths) {
            if (globsMayOverlap(ga, gb)) {
              errors.push(
                `siblings ${a.id} and ${b.id} may both modify "${ga}" / "${gb}"; split ownership more finely or move the path to ${pid}.sharedPaths`,
              );
            }
          }
        }
      }
      const kid = kids[i]!;
      for (const g of kid.ownedPaths) {
        const inside = parent.ownedPaths.some((pg) => isPathPrefix(globBase(pg), globBase(g)));
        if (!inside) errors.push(`node ${kid.id}: owned path "${g}" is outside parent ${pid}'s ownedPaths`);
      }
    }
  }

  // dependsOn: must reference siblings, no cycles.
  for (const n of plan.nodes) {
    for (const dep of n.dependsOn) {
      const d = byId.get(dep);
      if (!d) errors.push(`node ${n.id}: dependsOn unknown node "${dep}"`);
      else if (d.parent !== n.parent) errors.push(`node ${n.id}: dependsOn "${dep}" is not a sibling`);
      else if (dep === n.id) errors.push(`node ${n.id}: depends on itself`);
    }
  }
  const visiting = new Set<string>();
  const done = new Set<string>();
  const visit = (id: string): boolean => {
    if (done.has(id)) return false;
    if (visiting.has(id)) return true;
    visiting.add(id);
    const cyc = (byId.get(id)?.dependsOn ?? []).some(visit);
    visiting.delete(id);
    done.add(id);
    return cyc;
  };
  for (const n of plan.nodes) if (visit(n.id)) errors.push(`dependsOn cycle involving ${n.id}`);

  // Acceptance: tests first. Every node needs test files or at least a rubric.
  for (const n of plan.nodes) {
    if (n.acceptance.files.length === 0 && !n.acceptance.rubric) {
      errors.push(`node ${n.id}: acceptance needs test files (tests-first) or a rubric for untestable goals`);
    }
    if (n.acceptance.files.length === 0 && n.acceptance.rubric) {
      warnings.push(`node ${n.id}: rubric only, no executable tests; verification will rely on review`);
    }
    if (opts.testsDir) {
      for (const f of n.acceptance.files) {
        if (!existsSync(join(opts.testsDir, f))) errors.push(`node ${n.id}: acceptance file not drafted: tests/${f}`);
      }
    }
  }

  if (plan.nodes.length === 1 && plan.tier !== "focused") {
    warnings.push(`single-node plan with tier "${plan.tier}"; "focused" gives more attempts per leaf`);
  }

  return { plan: errors.length ? null : plan, errors, warnings };
}

export function nodesFromPlan(plan: Plan): Record<string, NodeState> {
  const out: Record<string, NodeState> = {};
  for (const n of plan.nodes) {
    out[n.id] = { ...n, status: "planned", base: null, targetAttempts: null, attempts: [], recommended: null, winner: null, decidedBy: null, regate: false };
  }
  return out;
}

export function allAcceptanceFiles(plan: Plan): string[] {
  return [...new Set(plan.nodes.flatMap((n) => n.acceptance.files))].sort();
}

/** Tree drawing, e.g. for plan.md and `graftree show`. */
export function renderTree(plan: Plan, label: (n: PlanNode) => string = (n) => `${n.id} [${n.kind}] ${n.goal}`): string {
  const kids = new Map<string | null, PlanNode[]>();
  for (const n of plan.nodes) kids.set(n.parent, [...(kids.get(n.parent) ?? []), n]);
  const lines: string[] = [];
  const walk = (n: PlanNode, prefix: string, last: boolean, isRoot: boolean) => {
    lines.push(isRoot ? label(n) : `${prefix}${last ? "└─ " : "├─ "}${label(n)}`);
    const cs = kids.get(n.id) ?? [];
    cs.forEach((c, i) => walk(c, isRoot ? "" : `${prefix}${last ? "   " : "│  "}`, i === cs.length - 1, false));
  };
  for (const r of kids.get(null) ?? []) walk(r, "", true, true);
  return lines.join("\n");
}

/** Human-readable plan for the approval checkpoint. */
export function renderPlanMarkdown(run: Run, cfg: Config): string {
  const pending = run.pendingRedecomposition;
  const plan = pending?.plan ?? run.plan;
  if (!plan) return `# ${run.id}\n\nNo plan yet.\n`;
  const tier = TIER_DEFAULTS[plan.tier];
  const attempts = cfg.budgets.attemptsPerLeaf ?? tier.attemptsPerLeaf;
  const leaves = plan.nodes.filter((n) => n.kind === "leaf");
  const splits = plan.nodes.filter((n) => n.kind === "split");
  const who = (names: string[]) => names.map((n) => (n === CLOSER ? "closer (root agent)" : n)).join(", ");

  const md: string[] = [];
  md.push(`# graftree plan — ${run.id}`, "");
  md.push(`**Status:** ${run.status}  `, `**Tier:** ${plan.tier} (max depth ${tier.maxDepth}, ${attempts} attempts per leaf)`, "");
  if (pending) {
    const added = plan.nodes.filter((n) => !run.nodes[n.id]);
    md.push(`## ⏸ Proposed re-decomposition of \`${pending.node}\``, "");
    md.push(`**Why:** ${pending.reason}`, "");
    md.push(
      `\`${pending.node}\` becomes a split. It keeps its goal, ownership and locked tests, so the bar does not drop;`,
      `its attempts so far are retired. New nodes: ${added.map((n) => `\`${n.id}\``).join(", ")}.`,
      "",
    );
    if (pending.files.length) md.push(`New test files (locked on approval): ${pending.files.map((f) => `\`${f}\``).join(", ")}`, "");
    md.push("The tree and node list below show the plan as it will be after approval.", "");
  }
  md.push("## Problem", "", run.problem, "");
  md.push("## Summary", "", plan.summary, "");
  if (plan.rationale) md.push("## Why this decomposition", "", plan.rationale, "");
  md.push("## Tree", "", "```", renderTree(plan), "```", "");
  md.push("## Nodes", "");
  for (const n of plan.nodes) {
    md.push(`### ${n.id} — ${n.kind}`, "", n.goal, "");
    md.push(`- **Owns:** ${n.ownedPaths.map((p) => `\`${p}\``).join(", ")}`);
    if (n.sharedPaths.length) md.push(`- **Shared (integrator only):** ${n.sharedPaths.map((p) => `\`${p}\``).join(", ")}`);
    if (n.contract.exposes.length) md.push(`- **Exposes:**`, ...n.contract.exposes.map((c) => `  - \`${c}\``));
    if (n.contract.consumes.length) md.push(`- **Consumes:**`, ...n.contract.consumes.map((c) => `  - \`${c}\``));
    if (n.dependsOn.length) md.push(`- **Depends on:** ${n.dependsOn.join(", ")}`);
    md.push(`- **Acceptance:** \`${n.acceptance.command}\``);
    for (const c of n.acceptance.extraCommands) md.push(`  - hardening: \`${c}\``);
    for (const f of n.acceptance.files) md.push(`  - test: \`${f}\` (draft: \`tests/${f}\`)`);
    if (n.acceptance.rubric) md.push(`  - rubric: ${n.acceptance.rubric}`);
    md.push("");
  }
  md.push("## Workers", "");
  md.push(`| Role | Assigned |`, `|---|---|`);
  for (const [role, names] of Object.entries(cfg.roles)) md.push(`| ${role} | ${who(names)} |`);
  md.push("", "## Estimated work (upper bound before repairs)", "");
  md.push(`- Solver runs: ${leaves.length} leaves × ${attempts} attempts = **${leaves.length * attempts}**`);
  md.push(`- Integrations: **${splits.length}**`);
  md.push(`- Reviews: **${splits.length + 1}** (one per merge + final)`);
  const b = cfg.budgets;
  const warn = [b.warnTokens && `${b.warnTokens.toLocaleString("en-US")} tokens`, b.warnCalls && `${b.warnCalls} calls`, b.warnAttemptTokens && `${b.warnAttemptTokens.toLocaleString("en-US")} tokens in one attempt`].filter(Boolean);
  if (warn.length) md.push(`- Usage warnings at: ${warn.join(", ")}`);
  md.push(
    `- Repair budget: up to ${cfg.budgets.maxRepairRounds} rounds ${cfg.budgets.repairAll ? "per failed attempt" : "per node"}; up to ${cfg.budgets.maxRedecompositions} re-decomposition(s) per leaf`,
    "",
  );
  if (run.feedback.length) {
    md.push("## Previous feedback", "");
    for (const f of run.feedback) md.push(`- ${f.at}: ${f.notes}`);
    md.push("");
  }
  if (run.redecompositions.length) {
    md.push("## Re-decompositions", "");
    for (const r of run.redecompositions) md.push(`- **${r.node}** → ${r.nodes.join(", ")} (${r.at}): ${r.reason}`);
    md.push("");
  }
  if (run.status !== "awaiting_approval") return md.join("\n");
  md.push("## Decision", "");
  md.push(
    pending
      ? "Nothing is spent on the new subtree until this is approved. New tests are locked on approval; rejecting resumes the run as it was."
      : "Nothing is spent on solving until this plan is approved. Acceptance tests are locked on approval.",
    "",
  );
  md.push(
    "```",
    `graftree approve ${run.id}            # lock tests, allow solving`,
    `graftree reject ${run.id} --notes "…"  # ${pending ? "drop the proposal and resume" : "send back for replanning"}`,
    "```",
    "",
  );
  return md.join("\n");
}

/**
 * Siblings this node, or any of its ancestors, depends on. Their winning code
 * is where the node's leaves start, so tests may use the real implementation.
 */
export function effectiveDeps(run: Run, node: Pick<NodeState, "parent" | "dependsOn">): NodeState[] {
  const ids = new Set<string>();
  for (let cur: Pick<NodeState, "parent" | "dependsOn"> | undefined = node; cur; cur = cur.parent ? run.nodes[cur.parent] : undefined) {
    for (const d of cur.dependsOn) ids.add(d);
  }
  return [...ids].map((id) => run.nodes[id]).filter((n): n is NodeState => !!n);
}
