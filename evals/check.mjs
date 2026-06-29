#!/usr/bin/env node
// Cherry quality gate. Treat the triage output as a product with a contract,
// and fail loudly when it's violated. Run it over recorded sample outputs in
// CI, or pipe a live result in, before trusting a change to the prompt/model.
//
//   node evals/check.mjs evals/golden.json
//   curl -s -X POST .../api/triage -d '{"name":"Notion"}' | node evals/check.mjs -
//
// The contract is the credibility-critical stuff: every issue is grounded in a
// real source URL, severities are sane, and the list is actually ranked.

import { readFileSync } from "node:fs";

const arg = process.argv[2] || "evals/golden.json";
const raw = arg === "-" ? readFileSync(0, "utf8") : readFileSync(arg, "utf8");
const r = JSON.parse(raw);

const fails = [];
const ok = (cond, msg) => { if (!cond) fails.push(msg); };
const isUrl = (u) => typeof u === "string" && /^https?:\/\/.+/.test(u);

ok(typeof r.product === "string" && r.product.length > 0, "product is missing");
ok(typeof r.takeaway === "string" && r.takeaway.length > 0, "takeaway is missing");
ok(Array.isArray(r.issues), "issues is not an array");

const issues = r.issues || [];
ok(issues.length >= 1 && issues.length <= 5, `issues count ${issues.length} not in 1..5`);

issues.forEach((it, i) => {
  const where = `issue[${i}] "${it.title || "?"}"`;
  ok(typeof it.title === "string" && it.title.length > 0, `${where}: no title`);
  ok(Number.isFinite(it.severity) && it.severity >= 1 && it.severity <= 5, `${where}: severity ${it.severity} not 1..5`);
  ok(Number.isFinite(it.signal), `${where}: signal is not a number`);
  ok(typeof it.owner === "string" && it.owner.length > 0, `${where}: no owner`);
  ok(["fixable gap", "intentional tradeoff"].includes(it.disposition), `${where}: disposition must be "fixable gap" or "intentional tradeoff" (got ${JSON.stringify(it.disposition)})`);
  // The grounding contract: at least one real source URL per issue.
  ok(Array.isArray(it.evidence) && it.evidence.length >= 1, `${where}: NO EVIDENCE (must cite a source)`);
  (it.evidence || []).forEach((ev, j) =>
    ok(isUrl(ev.url) && ev.source, `${where}: evidence[${j}] missing source/url`));
});

// Ranking must be monotonic by signal (top of the list is genuinely the top).
const signals = issues.map((x) => x.signal ?? 0);
for (let i = 1; i < signals.length; i++)
  ok(signals[i] <= signals[i - 1], `not ranked: signal rises at position ${i} (${signals[i - 1]} -> ${signals[i]})`);

// Every recommended action must carry its reasoning.
(r.actions || []).forEach((a, i) =>
  ok(a.action && a.why, `action[${i}]: missing action or why`));

const total = issues.length;
const grounded = issues.filter((it) => (it.evidence || []).some((e) => isUrl(e.url))).length;

if (fails.length) {
  console.error(`\n  ✗ Cherry quality gate FAILED (${fails.length})`);
  fails.forEach((f) => console.error("    · " + f));
  console.error("");
  process.exit(1);
}
console.log(`\n  ✓ Cherry quality gate passed — ${total} issues, ${grounded}/${total} grounded in a source, ranked, actions justified.\n`);
