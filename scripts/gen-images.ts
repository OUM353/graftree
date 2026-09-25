// Draws the README images in docs/images/ (run: npm run images). Each image comes in a light
// and a dark version; the README's <picture> tags show the one that matches the viewer's theme.
import { mkdirSync, writeFileSync } from "node:fs";

interface Tone { fg: string; bg: string; border: string }
interface Theme {
  page: string; surface: string; border: string; text: string; muted: string;
  line: string; grid: string; axis: string;
  ok: Tone & { solid: string }; bad: string; wait: Tone; closer: Tone;
  models: [string, string, string]; // attempts: one color per model
  series: [string, string]; // benchmarks: single agent, graftree
}

// The chrome uses GitHub's own colors, so the images sit naturally on the page. The model and
// series colors are a categorical palette checked for contrast and color-blind separation.
const THEMES: Record<"light" | "dark", Theme> = {
  light: {
    page: "#ffffff", surface: "#f6f8fa", border: "#d1d9e0", text: "#1f2328", muted: "#59636e",
    line: "#818b98", grid: "#e8ecf0", axis: "#c8d1da",
    ok: { fg: "#1a7f37", bg: "#dafbe1", border: "#4ac26b", solid: "#1f883d" }, bad: "#d1242f",
    wait: { fg: "#9a6700", bg: "#fff8c5", border: "#d4a72c" },
    closer: { fg: "#8250df", bg: "#fbefff", border: "#c297ff" },
    models: ["#2a78d6", "#eb6834", "#1baf7a"], series: ["#2a78d6", "#eb6834"],
  },
  dark: {
    page: "#0d1117", surface: "#151b23", border: "#3d444d", text: "#f0f6fc", muted: "#9198a1",
    line: "#6e7681", grid: "#21262d", axis: "#3d444d",
    ok: { fg: "#3fb950", bg: "#12261e", border: "#238636", solid: "#238636" }, bad: "#f85149",
    wait: { fg: "#d29922", bg: "#272215", border: "#9e6a03" },
    closer: { fg: "#ab7df8", bg: "#252139", border: "#8957e5" },
    models: ["#3987e5", "#d95926", "#199e70"], series: ["#3987e5", "#d95926"],
  },
};

const SANS = `-apple-system, BlinkMacSystemFont, "Segoe UI", "Noto Sans", Helvetica, Arial, sans-serif`;
const MONO = `ui-monospace, SFMono-Regular, "SF Mono", Menlo, Consolas, "Liberation Mono", monospace`;

const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

function svg(t: Theme, w: number, h: number, title: string, desc: string, body: string[]): string {
  const styles = body.some((b) => b.includes("<text")) ? [
    "<style>",
    `text { font-family: ${SANS}; font-size: 12px; fill: ${t.muted}; }`,
    `.mono { font-family: ${MONO}; font-size: 11.5px; }`,
    `.head { font-size: 14px; font-weight: 600; fill: ${t.text}; }`,
    `.ink { fill: ${t.text}; }`,
    `.bold { font-weight: 600; fill: ${t.text}; }`,
    ".lg { font-size: 13px; }",
    ".num { font-variant-numeric: tabular-nums; }",
    ".pill { font-size: 11px; font-weight: 600; fill: #ffffff; }",
    "</style>",
  ] : [];
  return [
    `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}" role="img" aria-labelledby="title desc">`,
    `<title id="title">${esc(title)}</title>`,
    `<desc id="desc">${esc(desc)}</desc>`,
    ...styles,
    ...body,
    "</svg>",
    "",
  ].join("\n");
}

function text(x: number, y: number, s: string, cls = "", anchor?: "middle" | "end"): string {
  return `<text x="${x}" y="${y}"${cls ? ` class="${cls}"` : ""}${anchor ? ` text-anchor="${anchor}"` : ""}>${esc(s)}</text>`;
}

const card = (t: Theme, w: number, h: number) =>
  `<rect x="0.5" y="0.5" width="${w - 1}" height="${h - 1}" rx="12" fill="${t.page}" stroke="${t.border}"/>`;

// 16×16 icons, drawn with plain strokes so they render the same everywhere.
type Icon = (x: number, y: number, c: string, scale?: number) => string;
const lines = (c: string, w = 1.5) => `fill="none" stroke="${c}" stroke-width="${w}" stroke-linecap="round" stroke-linejoin="round"`;
const icon = (draw: (c: string) => string): Icon => (x, y, c, scale = 1) =>
  `<g transform="translate(${x} ${y})${scale === 1 ? "" : ` scale(${scale})`}">${draw(c)}</g>`;
const dot = (x: number, y: number, r: number, c: string) => `<circle cx="${x}" cy="${y}" r="${r}" fill="${c}"/>`;
const ring = (x: number, y: number, r: number, c: string) => `<circle cx="${x}" cy="${y}" r="${r}" ${lines(c)}/>`;
const ICONS = {
  issue: icon((c) => ring(8, 8, 6.5, c) + dot(8, 8, 1.75, c)),
  tree: icon((c) => dot(8, 2.75, 1.9, c) + dot(2.75, 13.25, 1.9, c) + dot(8, 13.25, 1.9, c) + dot(13.25, 13.25, 1.9, c)
    + `<path d="M8 4.5V11.5M8 7.25C4.25 7.25 2.75 8.5 2.75 11.5M8 7.25C11.75 7.25 13.25 8.5 13.25 11.5" ${lines(c)}/>`),
  pause: icon((c) => ring(8, 8, 6.5, c) + `<path d="M6.25 5.5V10.5M9.75 5.5V10.5" ${lines(c)}/>`),
  merge: icon((c) => ring(4, 3, 1.75, c) + ring(4, 13, 1.75, c) + ring(12, 8.5, 1.75, c)
    + `<path d="M4 4.75V11.25M4 4.75C4 7.5 6.25 8.5 10.25 8.5" ${lines(c)}/>`),
  sparkle: icon((c) => `<path d="M8 1.5C8.55 5.35 10.65 7.45 14.5 8C10.65 8.55 8.55 10.65 8 14.5C7.45 10.65 5.35 8.55 1.5 8C5.35 7.45 7.45 5.35 8 1.5Z" fill="${c}"/>`),
  branch: icon((c) => ring(4, 3, 1.75, c) + ring(4, 13, 1.75, c) + ring(12, 3.5, 1.75, c)
    + `<path d="M4 4.75V11.25M12 5.25C12 9.25 4 7.75 4 11.25" ${lines(c)}/>`),
  check: icon((c) => `<path d="M3 8.5L6.5 12L13 4.5" ${lines(c, 2)}/>`),
  cross: icon((c) => `<path d="M4.5 4.5L11.5 11.5M11.5 4.5L4.5 11.5" ${lines(c, 2)}/>`),
};

/** The logo: a problem splits into attempts by different models, which merge into one verified result. */
function logoMark(t: Theme): string[] {
  const edge = (d: string) => `<path d="${d}" ${lines(t.line, 2.5)}/>`;
  const [a, b, c] = t.models;
  return [
    edge("M32 7V31M32 7C32 19 12 18 12 31M32 7C32 19 52 18 52 31"),
    edge("M32 31V54M12 31C12 44 32 42 32 54M52 31C52 44 32 42 32 54"),
    `<circle cx="32" cy="7" r="4.75" fill="${t.page}" stroke="${t.text}" stroke-width="2.5"/>`,
    ...[[12, a], [32, b], [52, c]].map(([x, col]) => `<circle cx="${x}" cy="31" r="6.5" fill="${col}" stroke="${t.page}" stroke-width="2.5"/>`),
    `<circle cx="32" cy="54" r="7.5" fill="${t.ok.solid}" stroke="${t.page}" stroke-width="2.5"/>`,
    `<path d="M28.75 54.25L31.1 56.6L35.5 51.75" ${lines("#ffffff", 2)}/>`,
  ];
}

const logo = (t: Theme) =>
  svg(t, 64, 64, "graftree", "A problem splits into attempts by three models that merge into one verified result.", logoMark(t));

type Status = "passed" | "failed" | "repaired";
interface Leaf { name: string; path: string; attempts: [Status, Status, Status]; best: number }

/** The how-it-works diagram: plan, approve, solve every leaf several ways, merge, close. */
function flow(t: Theme): string {
  const W = 880, H = 504, stepH = 80, leafW = 256, leafH = 142;
  const box = (x: number, y: number, w: number, h: number, tone?: Tone) =>
    `<rect x="${x + 0.5}" y="${y + 0.5}" width="${w - 1}" height="${h - 1}" rx="10" fill="${tone?.bg ?? t.surface}" stroke="${tone?.border ?? t.border}"/>`;
  const step = (x: number, y: number, w: number, draw: Icon, title: string, sub: string[], tone?: Tone, mono = false) =>
    box(x, y, w, stepH, tone) + draw(x + 16, y + 17, tone?.fg ?? t.muted) + text(x + 44, y + 30, title, "head")
    + sub.map((s, i) => text(x + 44, y + 51 + i * 16, s, mono ? "mono" : "")).join("");
  const wire = (d: string) => `<path d="${d}" ${lines(t.line)}/>`;
  const down = (x: number, y: number) => `<path d="M${x - 4.5} ${y - 6.5}L${x} ${y}L${x + 4.5} ${y - 6.5}Z" fill="${t.line}"/>`;
  const right = (x1: number, x2: number, y: number) =>
    wire(`M${x1 + 6} ${y}H${x2 - 11}`) + `<path d="M${x2 - 12.5} ${y - 4.5}L${x2 - 6} ${y}L${x2 - 12.5} ${y + 4.5}Z" fill="${t.line}"/>`;

  const leaf = (x: number, y: number, l: Leaf) => {
    const rows = l.attempts.map((status, i) => {
      const top = y + 48 + i * 30, best = i === l.best;
      return (best ? `<rect x="${x + 8.5}" y="${top + 0.5}" width="${leafW - 17}" height="25" rx="6" fill="${t.ok.bg}" stroke="${t.ok.border}"/>` : "")
        + dot(x + 24, top + 13, 4.5, t.models[i]!)
        + text(x + 36, top + 17, `${l.name.toLowerCase()}${i + 1}`, "mono ink")
        + (status === "failed" ? ICONS.cross : ICONS.check)(x + 66, top + 6, status === "failed" ? t.bad : t.ok.fg, 0.875)
        + text(x + 86, top + 17, status)
        + (best ? `<rect x="${x + leafW - 56}" y="${top + 5}" width="40" height="16" rx="8" fill="${t.ok.solid}"/>` + text(x + leafW - 36, top + 16.5, "best", "pill", "middle") : "");
    });
    return box(x, y, leafW, leafH) + text(x + 16, y + 27, `Leaf ${l.name}`, "head") + text(x + leafW - 16, y + 27, l.path, "mono", "end")
      + `<path d="M${x + 1} ${y + 40.5}H${x + leafW - 1}" stroke="${t.border}"/>` + rows.join("");
  };

  const top = 24, fanOut = top + stepH + 20, leafTop = 148, leafBottom = leafTop + leafH, low = 334, foot = low + stepH + 22;
  const leafX = (i: number) => 32 + i * (leafW + 24);
  const [a, b, c] = [0, 1, 2].map((i) => leafX(i) + leafW / 2) as [number, number, number];
  const leaves: Leaf[] = [
    { name: "A", path: "src/parser/", attempts: ["passed", "failed", "passed"], best: 2 },
    { name: "B", path: "src/eval/", attempts: ["passed", "repaired", "failed"], best: 0 },
    { name: "C", path: "src/cli/", attempts: ["failed", "passed", "repaired"], best: 1 },
  ];
  return svg(t, W, H, "How graftree works",
    "A problem becomes a plan: a tree of sub-tasks with acceptance tests. You approve it, which locks the tests. "
    + "Each leaf is solved several times, by different models, each in its own git worktree; attempts must pass the gates, "
    + "and the closer picks the best. Winners are integrated and reviewed up the tree, and the closer makes the final "
    + "call: one branch and a report.",
    [
      card(t, W, H),
      step(32, top, 200, ICONS.issue, "Problem", ["a hard coding task:", "an issue, a spec, a bug"]),
      step(268, top, 288, ICONS.tree, "Plan + acceptance tests", ["a tree of independent sub-tasks,", "with tests written before any code"]),
      step(592, top, 256, ICONS.pause, "You approve the plan", ["locks the tests by hash;", "no attempt runs before this"], t.wait),
      right(232, 268, top + stepH / 2),
      right(556, 592, top + stepH / 2),

      // fan out from the approval to every leaf
      wire(`M${c} ${top + stepH}V${leafTop - 9}`),
      wire(`M${c} ${fanOut}H${a + 8}A8 8 0 0 0 ${a} ${fanOut + 8}V${leafTop - 9}`),
      wire(`M${b} ${fanOut}V${leafTop - 9}`),
      down(a, leafTop - 3), down(b, leafTop - 3), down(c, leafTop - 3),
      ...leaves.map((l, i) => leaf(leafX(i), leafTop, l)),

      // fan in: the winners merge up the tree
      wire(`M${a} ${leafBottom}V${low - 9}`),
      wire(`M${c} ${leafBottom}V${leafBottom + 12}A8 8 0 0 1 ${c - 8} ${leafBottom + 20}H${a}`),
      wire(`M${b} ${leafBottom}V${leafBottom + 20}`),
      down(a, low - 3),

      step(32, low, 256, ICONS.merge, "Integrate + review", ["winners merge up the tree,", "tests run again at every merge"]),
      step(324, low, 244, ICONS.sparkle, "Closer decides", ["the agent that runs graftree", "(Claude Code by default)"], t.closer),
      step(604, low, 244, ICONS.branch, "One branch + report", ["graftree/<run>/final", "report.md"], t.ok, true),
      right(288, 324, low + stepH / 2),
      right(568, 604, low + stepH / 2),

      // legend
      `<path d="M24 ${foot + 0.5}H${W - 24}" stroke="${t.border}"/>`,
      ...t.models.map((m, i) => dot(36 + i * 12, foot + 22, 4.5, m)),
      text(76, foot + 26, "Attempts are spread across models, one color per model, each in its own git worktree."),
      ICONS.check(38, foot + 36, t.ok.fg, 0.875),
      text(76, foot + 48, "Passed: locked tests untouched, edits inside owned paths, build and tests pass. The closer picks the best."),
    ]);
}

interface Bench { name: string; calls: [number, number | null]; suites: { name: string; tests: number; passed: [number, number | null] }[] }

// Measured results; the table in README.md#benchmarks has the same numbers.
const BENCHMARKS: Bench[] = [
  { name: "kvstore", calls: [1, 6], suites: [{ name: "holdout", tests: 25, passed: [25, 25] }] },
  { name: "minisheet", calls: [1, 11], suites: [{ name: "holdout", tests: 38, passed: [38, 38] }, { name: "strict", tests: 88, passed: [86, 88] }] },
  { name: "tasklog", calls: [1, null], suites: [{ name: "holdout", tests: 50, passed: [50, null] }] },
];

/** Benchmark chart: hidden tests passed, and worker calls per run, for a single agent and graftree. */
function benchmarks(t: Theme): string {
  const W = 880, rowH = 44, gap = 10;
  const A = 288, AW = 260, B = 648, perCall = 14; // panel origins and scales
  const first = 96;
  // A bar grows from the baseline, with a rounded data end.
  const bar = (x: number, y: number, len: number, h: number, c: string) => {
    const r = Math.min(4, len / 2);
    return `<path d="M${x} ${y}H${x + len - r}A${r} ${r} 0 0 1 ${x + len} ${y + r}V${y + h - r}A${r} ${r} 0 0 1 ${x + len - r} ${y + h}H${x}Z" fill="${c}"/>`;
  };
  const body: string[] = [];
  let y = first;
  for (const [g, bench] of BENCHMARKS.entries()) {
    if (g > 0) { body.push(`<path d="M32 ${y + gap / 2 + 0.5}H${W - 32}" stroke="${t.grid}"/>`); y += gap; }
    const groupTop = y;
    for (const [s, suite] of bench.suites.entries()) {
      if (s === 0) body.push(text(32, y + 26, bench.name, "bold lg"));
      body.push(text(124, y + 26, `${suite.name} · ${suite.tests} tests`, "lg"));
      suite.passed.forEach((p, i) => {
        const by = y + 10 + i * 14;
        if (p === null) { body.push(text(A + 6, by + 9.5, "not run", "lg")); return; }
        const len = (AW * p) / suite.tests;
        body.push(bar(A, by, len, 10, t.series[i]!), text(A + len + 8, by + 9.5, `${p}/${suite.tests}`, "ink num lg"));
      });
      y += rowH;
    }
    const mid = (groupTop + y) / 2 - 12; // calls are per run, so they sit centered on the benchmark
    bench.calls.forEach((n, i) => {
      const by = mid + i * 14;
      if (n === null) { body.push(text(B + 6, by + 9.5, "not run", "lg")); return; }
      body.push(bar(B, by, n * perCall, 10, t.series[i]!), text(B + n * perCall + 8, by + 9.5, String(n), "ink num lg"));
    });
  }
  const plotTop = first - 6, plotBottom = y + 2;
  const grid = (x: number, base: boolean) => `<path d="M${x + 0.5} ${plotTop}V${plotBottom}" stroke="${base ? t.axis : t.grid}"/>`;
  const ticks = [
    ...[0, 50, 100].map((p) => ({ x: A + (AW * p) / 100, label: `${p}%` })),
    ...[0, 5, 10].map((n) => ({ x: B + n * perCall, label: String(n) })),
  ];
  const H = plotBottom + 78;
  const [single, tree] = t.series;
  return svg(t, W, H, "Benchmark results",
    "Hidden tests passed and worker calls per run. kvstore: 25/25 for both; graftree used 6 worker calls, the single agent 1. "
    + "minisheet: 38/38 for both on the holdout; on the strict suite, 86/88 for the single agent and 88/88 for graftree, "
    + "which used 11 worker calls. tasklog: 50/50 for the single agent; graftree was not run.",
    [
      card(t, W, H),
      `<rect x="32" y="27" width="10" height="10" rx="2" fill="${single}"/>`,
      text(50, 36.5, "Single agent: DeepSeek V4.1 Flash, one prompt", "ink lg"),
      `<rect x="424" y="27" width="10" height="10" rx="2" fill="${tree}"/>`,
      text(442, 36.5, "graftree: Claude Code closer + DeepSeek solver", "ink lg"),
      text(A, 76, "Hidden tests passed", "bold lg"),
      text(B, 76, "Worker calls per run", "bold lg"),
      ...ticks.map((k) => grid(k.x, k.x === A || k.x === B)),
      ...body,
      ...ticks.map((k) => text(k.x, plotBottom + 16, k.label, "num", "middle")),
      text(32, plotBottom + 46, "Hidden tests: holdout suites that no one in the run saw. minisheet's strict suite was written after both runs."),
      text(32, plotBottom + 64, "Worker calls: the agent runs graftree started (solve, repair, review). The closer's own usage is not included."),
    ]);
}

/**
 * The repository's social preview (GitHub: Settings → General → Social preview), the picture on repo
 * cards and link previews. GitHub wants a 1280×640 PNG, and cards crop it to a wider strip, so
 * everything stays inside the middle band. docs/images/social-preview.png is this, rendered with the
 * Inter and JetBrains Mono fonts.
 */
function social(t: Theme): string {
  const W = 1280, H = 640, cardW = 152, cardH = 136, gap = 14, cardsX = 710, cardsY = 222;
  const cx = cardsX + (3 * cardW + 2 * gap) / 2, topY = 136, endY = 442;
  const leaves: [string, Status[], number][] = [["A", ["passed", "failed", "passed"], 2], ["B", ["passed", "passed", "failed"], 0], ["C", ["failed", "passed", "passed"], 1]];
  const edge = (d: string) => `<path d="${d}" ${lines(t.line, 2.5)}/>`;
  const cards = leaves.map(([name, attempts, best], k) => {
    const x = cardsX + k * (cardW + gap), mid = x + cardW / 2;
    const rows = attempts.map((status, i) => {
      const y = cardsY + 44 + i * 30;
      return (i === best ? `<rect x="${x + 8.5}" y="${y + 0.5}" width="${cardW - 17}" height="26" rx="7" fill="${t.ok.bg}" stroke="${t.ok.border}"/>`
        + `<rect x="${x + cardW - 62}" y="${y + 4}" width="50" height="19" rx="9.5" fill="${t.ok.solid}"/>` + text(x + cardW - 37, y + 18, "best", "pill", "middle") : "")
        + dot(x + 23, y + 13.5, 6, t.models[i]!)
        + text(x + 36, y + 19, `${name.toLowerCase()}${i + 1}`, "mono ink")
        + (status === "failed" ? ICONS.cross : ICONS.check)(x + 64, y + 5, status === "failed" ? t.bad : t.ok.fg, 1.05);
    });
    return edge(`M${cx} ${topY + 18}C${cx} ${topY + 60} ${mid} ${cardsY - 44} ${mid} ${cardsY - 2}`)
      + edge(`M${mid} ${cardsY + cardH + 2}C${mid} ${cardsY + cardH + 40} ${cx} ${endY - 60} ${cx} ${endY - 24}`)
      + `<rect x="${x + 0.5}" y="${cardsY + 0.5}" width="${cardW - 1}" height="${cardH - 1}" rx="12" fill="${t.surface}" stroke="${t.border}"/>`
      + text(x + 16, cardsY + 29, `Leaf ${name}`, "leaf") + `<path d="M${x + 1} ${cardsY + 40.5}H${x + cardW - 1}" stroke="${t.border}"/>` + rows.join("");
  });
  return [
    `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}" role="img" aria-labelledby="title desc">`,
    "<title id=\"title\">graftree</title>",
    "<desc id=\"desc\">graftree: tree-structured, test-first, multi-model problem solving for hard coding tasks. Every sub-task is solved several times by different models, and only verified code merges into one branch.</desc>",
    "<style>",
    `text { font-family: Inter, ${SANS}; fill: #c9d1d9; }`,
    `.mono { font-family: "JetBrains Mono", ${MONO}; font-size: 17px; }`,
    `.ink { fill: ${t.text}; }`,
    `.name { font-size: 92px; font-weight: 700; letter-spacing: -2px; fill: ${t.text}; }`,
    ".tag { font-size: 32px; font-weight: 500; }",
    `.leaf { font-size: 17px; font-weight: 600; fill: ${t.text}; }`,
    `.label { font-size: 19px; fill: ${t.muted}; }`,
    ".chip { font-size: 20px; }",
    ".pill { font-size: 13px; font-weight: 700; fill: #ffffff; }",
    "</style>",
    "<defs>",
    `<radialGradient id="glow-blue" cx="0.1" cy="0.05" r="0.75"><stop offset="0" stop-color="#1f6feb" stop-opacity="0.2"/><stop offset="1" stop-color="#1f6feb" stop-opacity="0"/></radialGradient>`,
    `<radialGradient id="glow-green" cx="0.75" cy="0.75" r="0.5"><stop offset="0" stop-color="#238636" stop-opacity="0.25"/><stop offset="1" stop-color="#238636" stop-opacity="0"/></radialGradient>`,
    `<pattern id="dots" width="24" height="24" patternUnits="userSpaceOnUse"><circle cx="12" cy="12" r="1.1" fill="#ffffff" fill-opacity="0.06"/></pattern>`,
    "</defs>",
    `<rect width="${W}" height="${H}" fill="${t.page}"/>`,
    `<rect width="${W}" height="${H}" fill="url(#dots)"/>`,
    `<rect width="${W}" height="${H}" fill="url(#glow-blue)"/>`,
    `<rect width="${W}" height="${H}" fill="url(#glow-green)"/>`,
    `<g transform="translate(92 164) scale(1.5)">${logoMark(t).join("")}</g>`,
    text(206, 246, "graftree", "name"),
    ...["Tree-structured, test-first,", "multi-model problem solving", "for hard coding tasks."].map((s, i) => text(96, 318 + i * 42, s, "tag")),
    `<rect x="96.5" y="436.5" width="311" height="47" rx="23.5" fill="${t.surface}" stroke="${t.border}"/>`,
    text(120, 467, "npm i -g graftree-agent", "mono ink chip"),
    `<rect x="423.5" y="436.5" width="219" height="47" rx="23.5" fill="${t.surface}" stroke="${t.border}"/>`,
    text(533, 467, "Claude Code skill", "ink chip", "middle"),
    ...cards,
    `<circle cx="${cx}" cy="${topY}" r="15" fill="${t.page}" stroke="${t.text}" stroke-width="4"/>`,
    text(cx + 30, topY + 7, "plan + tests", "label"),
    `<circle cx="${cx}" cy="${endY}" r="24" fill="${t.ok.solid}" stroke="${t.page}" stroke-width="4"/>`,
    ICONS.check(cx - 13, endY - 13, "#ffffff", 1.625),
    text(cx, endY + 58, "one verified branch", "label", "middle"),
    "</svg>",
    "",
  ].join("\n");
}

mkdirSync("docs/images", { recursive: true });
for (const [mode, t] of Object.entries(THEMES)) {
  writeFileSync(`docs/images/logo-${mode}.svg`, logo(t));
  writeFileSync(`docs/images/how-it-works-${mode}.svg`, flow(t));
  writeFileSync(`docs/images/benchmarks-${mode}.svg`, benchmarks(t));
}
writeFileSync("docs/images/social-preview.svg", social(THEMES.dark));
