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
  ok(Number.isFinite(it.authenticity) && it.authenticity >= 1 && it.authenticity <= 5, `${where}: authenticity ${it.authenticity} not 1..5 (bot/fake screen)`);
  ok(Number.isFinite(it.signal), `${where}: signal is not a number`);
  ok(typeof it.owner === "string" && it.owner.length > 0, `${where}: no owner`);
  ok(["fixable gap", "intentional tradeoff"].includes(it.disposition), `${where}: disposition must be "fixable gap" or "intentional tradeoff" (got ${JSON.stringify(it.disposition)})`);
  // Capability-signal classification: is this a boundable fix or a systemic capability gap
  // that should feed roadmap/model-training priorities? Plus the use case it surfaced in.
  ok(["surface fix", "capability signal"].includes(it.signalType), `${where}: signalType must be "surface fix" or "capability signal" (got ${JSON.stringify(it.signalType)})`);
  ok(typeof it.useCase === "string" && it.useCase.length > 0, `${where}: no useCase (what the customer was trying to do)`);
  // Newer fields (revenue-at-stake, reach basis) validate when present — golden files
  // recorded before a field existed stay honest instead of being hand-edited to carry it.
  if (it.revenueContext !== undefined)
    ok(typeof it.revenueContext === "string", `${where}: revenueContext must be a string ("" when unknown)`);
  if (it.reachBasis !== undefined)
    ok(["many independent voices", "few amplified voices"].includes(it.reachBasis), `${where}: reachBasis must be "many independent voices" or "few amplified voices" (got ${JSON.stringify(it.reachBasis)})`);
  ok(Array.isArray(it.stakeholders) && it.stakeholders.every((s) => typeof s === "string") && !it.stakeholders.includes(it.owner), `${where}: stakeholders must be an array of team names not repeating the owner`);
  ok(Array.isArray(it.evidence) && it.evidence.length >= 1, `${where}: NO EVIDENCE (must cite a source)`);
  const evs = it.evidence || [];
  evs.forEach((ev, j) =>
    ok(ev && ev.source && ev.quote, `${where}: evidence[${j}] missing source/quote`));

  // Corroboration (when present): fused intake's visible tag. Goldens recorded
  // before the field existed stay honest — we do not hand-edit them to carry it.
  const CORR = ["both", "first-party only", "public only"];
  if (it.corroboration !== undefined) {
    ok(CORR.includes(it.corroboration), `${where}: corroboration must be "both", "first-party only", or "public only" (got ${JSON.stringify(it.corroboration)})`);
    const hasUrl = evs.some((e) => isUrl(e && e.url));
    const hasFp = evs.some((e) => e && e.source && e.quote && !isUrl(e.url));
    if (it.corroboration === "both")
      ok(hasUrl && hasFp, `${where}: corroboration "both" needs a public URL and a first-party quote (no url)`);
    else if (it.corroboration === "public only")
      ok(hasUrl, `${where}: corroboration "public only" needs at least one https URL`);
    else if (it.corroboration === "first-party only")
      ok(hasFp || evs.some((e) => e && e.source && e.quote), `${where}: corroboration "first-party only" needs a verbatim quote`);
  } else {
    // Legacy web contract: every evidence item carries a real source URL.
    evs.forEach((ev, j) =>
      ok(isUrl(ev.url) && ev.source, `${where}: evidence[${j}] missing source/url`));
  }
});

// Ranking must be monotonic by signal (top of the list is genuinely the top).
const signals = issues.map((x) => x.signal ?? 0);
for (let i = 1; i < signals.length; i++)
  ok(signals[i] <= signals[i - 1], `not ranked: signal rises at position ${i} (${signals[i - 1]} -> ${signals[i]})`);

// Coverage (when present): heard/silent segment lists — silence ≠ satisfaction.
if (r.coverage !== undefined) {
  ok(Array.isArray(r.coverage.heard) && r.coverage.heard.every((s) => typeof s === "string"), "coverage.heard must be an array of segment names");
  ok(Array.isArray(r.coverage.silent) && r.coverage.silent.every((s) => typeof s === "string"), "coverage.silent must be an array of segment names");
}

// Every recommended action must carry its reasoning.
(r.actions || []).forEach((a, i) =>
  ok(a.action && a.why, `action[${i}]: missing action or why`));

const total = issues.length;
const grounded = issues.filter((it) => {
  if (it.corroboration === "first-party only")
    return (it.evidence || []).some((e) => e && e.source && e.quote);
  return (it.evidence || []).some((e) => isUrl(e.url));
}).length;

if (fails.length) {
  console.error(`\n  ✗ Cherry quality gate FAILED (${fails.length})`);
  fails.forEach((f) => console.error("    · " + f));
  console.error("");
  process.exit(1);
}
console.log(`\n  ✓ Cherry quality gate passed — ${total} issues, ${grounded}/${total} grounded in a source, ranked, actions justified.\n`);
