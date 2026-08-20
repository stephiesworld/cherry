#!/usr/bin/env node
// Structural CI gate for Cherry's trend/diff matcher (trend.js).
// Deterministic, table-driven — runs alongside evals/check.mjs.

import {
  snapKey,
  normTitle,
  matchIssues,
  isWorse,
  diffRuns,
  formatSince,
  summarizeDelta,
} from "../trend.js";

let failed = 0;
function ok(cond, msg) {
  if (!cond) {
    failed++;
    console.error("FAIL:", msg);
  } else {
    console.log("ok:", msg);
  }
}

// --- snapKey ---
ok(snapKey("  Notion  AI ") === "notion ai", "snapKey trims and collapses whitespace");
ok(snapKey("Notion") === snapKey("  notion "), "snapKey equates Notion and spaced notion");

// --- 1. Two near-duplicate current titles compete for one prior ---
{
  const prior = [{ t: "Slow mobile sync on offline", n: normTitle("Slow mobile sync on offline"), sev: 3, reach: 3, rec: 3 }];
  const current = [
    { title: "Mobile sync is slow offline", severity: 3, reach: 3, recency: 3 },
    { title: "Slow sync issues on mobile app", severity: 4, reach: 2, recency: 3 },
  ];
  const { matches, newIndexes, resolved } = matchIssues(current, prior);
  ok(matches.length === 1, "competitor titles: only one match against a single prior");
  ok(newIndexes.length === 1, "competitor titles: the other current issue is new");
  ok(resolved.length === 0, "competitor titles: prior is claimed, not resolved");
}

// --- 2. Reworded title that still shares ≥2 significant tokens matches ---
{
  const prior = [{ t: "Billing double charges at renewal", n: normTitle("Billing double charges at renewal"), sev: 4, reach: 3, rec: 2 }];
  const current = [
    { title: "Renewal billing charges customers twice", severity: 4, reach: 3, recency: 2 },
  ];
  // shared tokens among significant words (>3): billing, charges, renewal / renewal, billing, charges, twice, customers
  const { matches, newIndexes } = matchIssues(current, prior);
  ok(matches.length === 1, "reworded title still matches (≥2 shared tokens)");
  ok(newIndexes.length === 0, "reworded title is not flagged new");
}

// --- 3. Old title-only snap: never false worse ---
{
  const priorSnap = {
    at: Date.UTC(2026, 7, 4), // Aug 4 (legacy `at`, no savedAt)
    issues: [{ t: "Auth tokens expire early", n: normTitle("Auth tokens expire early") }],
  };
  const current = [
    { title: "Auth tokens expire early in CI", severity: 5, reach: 5, recency: 5 },
  ];
  const d = diffRuns(current, priorSnap);
  ok(d.newSet.size === 0, "title-only prior: reworded auth issue still matches");
  ok(d.worseSet.size === 0, "title-only prior: never flags worse");
  ok(d.sincePhrase === "since Aug 4", "legacy at → since Aug 4");
}

// --- 4. Worse-threshold boundary ---
{
  const prior = { sev: 3, reach: 3, rec: 3 }; // sum 9
  // sev+1, sum+1 → not worse
  ok(!isWorse({ severity: 4, reach: 3, recency: 3 }, prior), "sev+1 with axis-sum+1 is not worse");
  // sev+1, sum+2 → worse
  ok(isWorse({ severity: 4, reach: 4, recency: 3 }, prior), "sev+1 with axis-sum+2 is worse");
  // sev unchanged, sum+2 → not worse
  ok(!isWorse({ severity: 3, reach: 4, recency: 4 }, prior), "sev flat with axis-sum+2 is not worse");
}

// --- summary copy + missing timestamp ---
ok(formatSince(null) === "since last run", "missing timestamp → since last run");
ok(
  summarizeDelta({ newCount: 2, worseCount: 1, resolvedCount: 1, sincePhrase: "since Aug 4" })
    === "2 new issues, 1 worsened, 1 resolved since Aug 4",
  "prose delta summary shape"
);
ok(
  summarizeDelta({ newCount: 0, worseCount: 0, resolvedCount: 0, sincePhrase: "since last run" })
    === "No change since last run",
  "no-change summary"
);

// Host tie-break: when token scores tie, prefer overlapping evidence hosts
{
  const prior = [
    {
      t: "Search results feel broken",
      n: normTitle("Search results feel broken"),
      hosts: ["reddit.com"],
      sev: 3, reach: 3, rec: 3,
    },
    {
      t: "Search results look broken",
      n: normTitle("Search results look broken"),
      hosts: ["g2.com"],
      sev: 3, reach: 3, rec: 3,
    },
  ];
  // Both priors share broken/results/search (score 3). Host overlap picks g2.
  const current = [
    {
      title: "Broken search results today",
      severity: 3, reach: 3, recency: 3,
      evidence: [{ source: "G2", url: "https://g2.com/products/x/reviews" }],
    },
  ];
  const { matches } = matchIssues(current, prior);
  ok(matches.length === 1, "host tie-break: one match");
  ok(matches[0].prior.hosts[0] === "g2.com", "host tie-break prefers overlapping hostname");
}

if (failed) {
  console.error(`\n${failed} trend check(s) failed`);
  process.exit(1);
}
console.log("\nAll trend checks passed.");
