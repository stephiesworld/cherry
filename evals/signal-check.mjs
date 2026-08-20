#!/usr/bin/env node
import { DEFAULT_SIGNAL_WEIGHTS, signalScore, normalizeTriageSignal } from "../signal.js";

let failed = 0;
function ok(condition, message) {
  if (condition) console.log("ok:", message);
  else { failed++; console.error("FAIL:", message); }
}

ok(signalScore({ severity: 5, reach: 5, recency: 5 }) === 100, "all max axes score 100");
ok(signalScore({ severity: 0, reach: 0, recency: 0 }) === 0, "all zero axes score 0");
ok(signalScore({ severity: 5, reach: 3, recency: 2 }) === 76, "default score uses 50/30/20 weighting");
ok(signalScore({ severity: 2, reach: 5, recency: 4 }, { sev: 2, reach: 5, rec: 4 }) === 82, "custom persona weights stay transparent");
ok(DEFAULT_SIGNAL_WEIGHTS.sev === 5 && DEFAULT_SIGNAL_WEIGHTS.reach === 3 && DEFAULT_SIGNAL_WEIGHTS.rec === 2, "default weights are stable");

const result = { issues: [
  { title: "low", severity: 1, reach: 1, recency: 1, signal: 999 },
  { title: "high", severity: 5, reach: 4, recency: 5, signal: 0 },
] };
normalizeTriageSignal(result);
ok(result.issues[0].title === "high", "server normalization sorts by deterministic score");
ok(result.issues[1].signal === 20, "server normalization replaces model-invented score");

if (failed) {
  console.error(`\n${failed} signal check(s) failed`);
  process.exit(1);
}
console.log("\nAll signal checks passed.");
