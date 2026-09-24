import { z } from "zod";
import { Plan, TIER_DEFAULTS, type Run } from "./schema.js";

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
