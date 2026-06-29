#!/usr/bin/env node
// Cherry's LLM-as-judge eval. check.mjs enforces the STRUCTURAL contract (every
// issue has a source, the list is ranked, etc.) — necessary but not sufficient.
// This eval grades SYNTHESIS QUALITY: is the clustering clean, the ranking
// defensible, the routing right, the grounding real? A separate Claude call
// scores each dimension 1-5 against a rubric, so a prompt/model change that
// makes triage *structurally valid but worse* is caught — the closed-loop data
// that lets synthesis quality measurably improve over time.
//
//   ANTHROPIC_API_KEY=sk-... node evals/judge.mjs evals/golden.json
//   curl -s -X POST .../api/triage -d '{"name":"Notion"}' | node evals/judge.mjs -
//
// Each run appends one line to evals/judge-history.jsonl so you can track the
// score trend as the prompt evolves. Pass --no-log to skip.

import { readFileSync, appendFileSync } from "node:fs";

const args = process.argv.slice(2);
const noLog = args.includes("--no-log");
const src = args.find((a) => a !== "--no-log") || "evals/golden.json";
const raw = src === "-" ? readFileSync(0, "utf8") : readFileSync(src, "utf8");
const result = JSON.parse(raw);

const MODEL = process.env.CHERRY_JUDGE_MODEL || "claude-sonnet-4-6";
const KEY = process.env.ANTHROPIC_API_KEY;
if (!KEY) { console.error("Set ANTHROPIC_API_KEY to run the judge."); process.exit(2); }

const RUBRIC = `You are a senior product-operations leader grading a customer-feedback triage.
You are given the triage JSON. Score each dimension 1-5 (5 = excellent), strictly:

- grounding: is every issue tied to specific, believable evidence (a quote/source), with no invented feedback?
- clustering: are the issues distinct, well-scoped themes — not overlapping, not one theme split in two, not a grab-bag?
- ranking: are severity/reach/recency and the resulting order defensible? Would a PM agree the top issue is the top issue?
- routing: is each "owner" the single team genuinely accountable for that issue? (e.g. a pricing complaint → Billing/Product, not Engineering)
- actionability: are the actions concrete, specific to THIS product, and justified — something a team could actually pick up?

Be a tough grader: 3 = acceptable, 4 = good, 5 = exemplary. Reserve 5s. Identify the single weakest dimension and say, in one sentence, what would most improve the triage.`;

const SCHEMA = {
  type: "object",
  properties: {
    scores: {
      type: "object",
      properties: {
        grounding: { type: "integer" }, clustering: { type: "integer" },
        ranking: { type: "integer" }, routing: { type: "integer" }, actionability: { type: "integer" },
      },
      required: ["grounding", "clustering", "ranking", "routing", "actionability"],
      additionalProperties: false,
    },
    weakest: { type: "string" },
    improve: { type: "string" },
  },
  required: ["scores", "weakest", "improve"],
  additionalProperties: false,
};

const resp = await fetch("https://api.anthropic.com/v1/messages", {
  method: "POST",
  headers: { "content-type": "application/json", "x-api-key": KEY, "anthropic-version": "2023-06-01" },
  body: JSON.stringify({
    model: MODEL,
    max_tokens: 1024,
    system: RUBRIC,
    messages: [{ role: "user", content: "Grade this triage:\n\n" + JSON.stringify(result, null, 2) }],
    output_config: { format: { type: "json_schema", schema: SCHEMA } },
  }),
});
const data = await resp.json();
if (data.error) { console.error("judge error:", data.error.message); process.exit(2); }
const text = (data.content || []).filter((b) => b.type === "text").map((b) => b.text).join("");
const v = JSON.parse(text);

const s = v.scores;
const dims = ["grounding", "clustering", "ranking", "routing", "actionability"];
const avg = dims.reduce((n, d) => n + s[d], 0) / dims.length;
const bar = (n) => "█".repeat(n) + "░".repeat(5 - n);

console.log(`\n  Cherry synthesis judge · ${result.product || "?"} · ${MODEL}`);
dims.forEach((d) => console.log(`    ${d.padEnd(14)} ${bar(s[d])} ${s[d]}/5`));
console.log(`    ${"OVERALL".padEnd(14)} ${avg.toFixed(2)}/5   (weakest: ${v.weakest})`);
console.log(`    → ${v.improve}\n`);

if (!noLog) {
  // Tracking line — stamp the time at the call site (scripts may run anywhere).
  const line = JSON.stringify({ at: new Date().toISOString(), product: result.product, model: MODEL, overall: +avg.toFixed(2), scores: s });
  try { appendFileSync(new URL("./judge-history.jsonl", import.meta.url), line + "\n"); } catch {}
}
