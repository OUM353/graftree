// Regenerates schema/*.json from the zod definitions (run: npm run schema).
import { writeFileSync } from "node:fs";
import { z } from "zod";
import { Config, Plan, Run, Subtree } from "../src/schema.js";

for (const [name, s] of Object.entries({ plan: Plan, subtree: Subtree, run: Run, config: Config })) {
  const json = { $id: `https://raw.githubusercontent.com/OUM353/graftree/main/schema/${name}.schema.json`, ...z.toJSONSchema(s, { io: "input" }) };
  writeFileSync(`schema/${name}.schema.json`, `${JSON.stringify(json, null, 2)}\n`);
}
