import { z } from "zod";
import { Plan, TIER_DEFAULTS, type NodeState, type Run } from "./schema.js";

export const PLANNER_OUT_DIR = ".graftree-out";

export function planJsonSchema(): string {
  return JSON.stringify(z.toJSONSchema(Plan, { io: "input" }), null, 2);
}

/** Prompt for a planner/test-writer worker running in a throwaway worktree. */
export function plannerPrompt(run: Run): string {
  const tiers = Object.entries(TIER_DEFAULTS)
    .map(([t, d]) => `- ${t}: max depth ${d.maxDepth}`)
    .join("\n");
  const feedback = run.feedback.length
    ? `\n## Feedback on the previous plan (address all of it)\n\n${run.feedback.map((f) => `- ${f.notes}`).join("\n")}\n`
    : "";
  const tier = run.requestedTier === "auto" ? "Choose the tier yourself from the problem's size." : `Use tier "${run.requestedTier}".`;

  return `You are the PLANNER and TEST WRITER for graftree, a tree-structured coding system that
prioritizes correctness over speed. You are inside a scratch copy of the repository.
Do NOT implement the solution. Your job is to explore the code, then produce a
decomposition plan and acceptance tests.

## Problem

${run.problem}
${feedback}
## Rules

1. Split only along real seams. Split a node only when its parts can be built
   independently against explicit interface contracts. If parts are coupled,
   keep one leaf. A split needs at least 2 children.
2. Tier and depth. ${tier}
${tiers}
3. Ownership. Every node lists ownedPaths (paths/globs it may modify). Sibling
   ownership must not overlap, and a child's paths must lie inside its parent's.
   Files several children would touch go in the parent's sharedPaths.
4. Contracts. For each node, write exposes/consumes as precise signatures or
   data shapes, so siblings can code against them without seeing each other.
5. Tests first. Every node gets acceptance tests that fail now and pass when the
   node is done: leaf tests for leaf contracts, integration tests at split nodes,
   end-to-end tests at the root. Use the repo's existing test framework and
   conventions. Only if a goal cannot be tested, add a rubric.
6. acceptance.command runs from the repo root and must exit 0 only when that
   node's tests pass.

## Output (required)

Write these files, and change nothing else in the repository:

- ${PLANNER_OUT_DIR}/plan.json: a JSON object matching the schema below.
- ${PLANNER_OUT_DIR}/tests/<repo-relative path>: each acceptance test file, at the
  same repo-relative path you list in acceptance.files. For example, a test meant
  for tests/parser.test.ts goes to ${PLANNER_OUT_DIR}/tests/tests/parser.test.ts.

Plan JSON schema:

\`\`\`json
${planJsonSchema()}
\`\`\`

When done, reply with one line: PLAN WRITTEN.
`;
}

// ---------------------------------------------------------------------------
// Solve / integrate / review prompts
// ---------------------------------------------------------------------------

const bullet = (xs: string[]) => (xs.length ? xs.map((x) => `- ${x}`).join("\n") : "- (none)");

function nodeBrief(run: Run, node: NodeState): string {
  const siblings = Object.values(run.nodes).filter((n) => n.parent === node.parent && n.id !== node.id);
  const consumed = siblings.filter((s) => node.dependsOn.includes(s.id) || s.contract.exposes.some((e) => node.contract.consumes.some((c) => e.includes(c))));
  return `## Overall problem

${run.problem}

## Your node: ${node.id}

Goal: ${node.goal}

Interfaces you must PROVIDE (exactly):
${bullet(node.contract.exposes)}

Interfaces you CONSUME (code against these; siblings are building them in parallel):
${bullet(node.contract.consumes)}
${consumed.length ? `\nSibling contracts you rely on:\n${consumed.map((s) => `- ${s.id}: ${s.contract.exposes.join("; ") || s.goal}`).join("\n")}\n` : ""}
You may ONLY modify files matching:
${bullet(node.ownedPaths)}

Acceptance: this command must exit 0 from the repo root:
    ${node.acceptance.command}
Acceptance test files (read them first; they define "done"):
${bullet(node.acceptance.files)}
${node.acceptance.rubric ? `\nAlso satisfy this rubric: ${node.acceptance.rubric}\n` : ""}`;
}

const HARD_RULES = `## Hard rules

- NEVER modify, delete, or rename acceptance test files. Changing them disqualifies your work.
- Edit only the allowed paths. Edits elsewhere disqualify your work.
- Run the acceptance command yourself and iterate until it passes.
- Prefer the smallest correct change that fits the codebase's existing style.
- Do not commit or push; the engine snapshots your working tree.`;

export function solverPrompt(run: Run, node: NodeState): string {
  return `You are a SOLVER in graftree, a system that values correctness over speed.
Several independent solvers work on this same node; the best verified result wins.

${nodeBrief(run, node)}
${HARD_RULES}

When finished, reply with a short summary of the change and the final acceptance result.
`;
}

export function repairPrompt(run: Run, node: NodeState, failure: string): string {
  return `You are REPAIRING a graftree attempt. The working tree already contains a previous attempt at
this node, and it FAILED verification. Fix it. Do not start over unless the approach is wrong.

## Failure

\`\`\`
${failure}
\`\`\`

${nodeBrief(run, node)}
${HARD_RULES}
`;
}

export function integratorPrompt(run: Run, node: NodeState, allowed: string[], failure: string): string {
  const kids = Object.values(run.nodes).filter((n) => n.parent === node.id);
  return `You are the INTEGRATOR for graftree node "${node.id}". The working tree contains the merged,
individually verified results of its children:
${kids.map((k) => `- ${k.id}: ${k.goal}`).join("\n")}

Wire them together so the node's goal is met. Change as little as possible; the children's
code already passed their own tests, so prefer glue over rewrites.

## Node goal

${node.goal}

## Current failure

\`\`\`
${failure}
\`\`\`

You may ONLY modify files matching:
${bullet(allowed)}

Acceptance: this command must exit 0 from the repo root:
    ${node.acceptance.command}

${HARD_RULES}
`;
}

export function reviewerPrompt(run: Run, node: NodeState, diff: string): string {
  return `You are an ADVERSARIAL REVIEWER in graftree. The change below already passes its tests.
Your job is to find what the tests missed: inputs, edge cases, concurrency, error paths,
or contract violations where the code is WRONG. Do not modify any files.

${nodeBrief(run, node)}
## Diff

\`\`\`diff
${diff}
\`\`\`

Reply in this format:
VERDICT: pass | concerns | fail
ISSUES:
- [severity high|medium|low] <file:line> <what is wrong> — <input or case that shows it>
(write "ISSUES: none" if you find nothing real; do not invent problems)
`;
}
