#!/usr/bin/env node
// Cherry's classification ACCURACY eval — the other half of the eval story.
//
// check.mjs is the CONTRACT eval: is the output well-formed (grounded, ranked,
// fields valid)? A wrong-but-well-formed classification passes it happily.
// This file is the ACCURACY eval: given human-labeled inputs, did Cherry put
// each issue in the right box (disposition, signalType, owner)? Classification
// grades with === — no LLM judge needed, the cheapest and most trustworthy
// grader tier. The interesting output isn't the accuracy number, it's the
// CONFUSION PAIRS: which boundary blurs (surface fix vs capability signal is
// the hard one), because that tells you which prompt definition to sharpen.
//
// Each labeled case is a short paste-mode bundle with ONE dominant issue, so
// the top-ranked issue is the one being graded (paste mode = deterministic
// input, no web-search noise between runs).
//
// Run against a live deployment (or `vercel dev` locally):
//   CHERRY_URL=https://your-cherry.vercel.app node evals/classify.mjs
//   node evals/classify.mjs --limit 3          # cheap iteration
//   node evals/classify.mjs --only crash-on-export
//   node evals/classify.mjs --save evals/classify-run.json   # record outputs
//   node evals/classify.mjs --from evals/classify-run.json   # regrade offline, free
//
// Calls are sequential with a delay (default 11s) to stay under the API's
// per-IP rate limit; override with CLASSIFY_DELAY_MS (and raise
// CHERRY_PER_IP_PER_MIN on the server when eval-ing your own deployment).

import { readFileSync, writeFileSync } from "node:fs";

const BASE = process.env.CHERRY_URL || "http://localhost:3000";
const DELAY_MS = Number(process.env.CLASSIFY_DELAY_MS || 11000);
const PASS_BAR = Number(process.env.CLASSIFY_PASS || 0.8); // per-field accuracy to pass

const args = process.argv.slice(2);
const flag = (name) => { const i = args.indexOf(name); return i >= 0 ? args[i + 1] : null; };
const limit = flag("--limit") ? Number(flag("--limit")) : Infinity;
const only = flag("--only");
const savePath = flag("--save");
const fromPath = flag("--from");

const { cases } = JSON.parse(readFileSync(new URL("./labeled.json", import.meta.url), "utf8"));
let selected = cases.filter((c) => !only || c.id === only).slice(0, limit);
if (!selected.length) { console.error(`no cases matched (only=${only})`); process.exit(1); }

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const norm = (s) => String(s || "").trim().toLowerCase();

async function triage(feedback) {
  const resp = await fetch(BASE + "/api/triage", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ feedback }),
  });
  const data = await resp.json();
  if (!resp.ok || data.error) throw new Error(data.error || `HTTP ${resp.status}`);
  return data;
}

const recorded = fromPath ? JSON.parse(readFileSync(fromPath, "utf8")) : null;
const outputs = {};
const FIELDS = ["disposition", "signalType", "owner"];
const score = { disposition: 0, signalType: 0, owner: 0 };
const confusion = {}; // "field: expected -> got" -> count
const rows = [];

console.log(`\n  Cherry classification accuracy — ${selected.length} labeled case${selected.length > 1 ? "s" : ""}${recorded ? " (regrading recorded outputs)" : ` against ${BASE}`}\n`);

for (const [i, c] of selected.entries()) {
  let r;
  try {
    r = recorded ? recorded[c.id] : await triage(c.feedback);
    if (!recorded && savePath) outputs[c.id] = r;
    if (!recorded && i < selected.length - 1) await sleep(DELAY_MS);
  } catch (e) {
    rows.push(`  ✗ ${c.id} — call failed: ${e.message}`);
    continue;
  }
  const top = r && (r.issues || [])[0];
  if (!top) { rows.push(`  ✗ ${c.id} — no issues returned`); continue; }

  const got = { disposition: top.disposition, signalType: top.signalType, owner: top.owner };
  const hit = {
    disposition: norm(got.disposition) === norm(c.expect.disposition),
    signalType: norm(got.signalType) === norm(c.expect.signalType),
    owner: c.expect.owner.map(norm).includes(norm(got.owner)),
  };
  for (const f of FIELDS) {
    if (hit[f]) score[f]++;
    else {
      const key = `${f}: expected "${Array.isArray(c.expect[f]) ? c.expect[f].join('" or "') : c.expect[f]}" → got "${got[f]}"`;
      confusion[key] = (confusion[key] || 0) + 1;
    }
  }
  const marks = FIELDS.map((f) => `${hit[f] ? "✓" : "✗"} ${f}`).join("  ");
  rows.push(`  ${FIELDS.every((f) => hit[f]) ? "✓" : "✗"} ${c.id.padEnd(24)} ${marks}`);
}

rows.forEach((r) => console.log(r));
if (savePath && !recorded) { writeFileSync(savePath, JSON.stringify(outputs, null, 2)); console.log(`\n  outputs recorded to ${savePath} — regrade free with --from`); }

const graded = rows.filter((r) => !r.includes("call failed") && !r.includes("no issues")).length;
if (!graded) { console.error("\n  ✗ nothing graded — is the server up? (CHERRY_URL, vercel dev)\n"); process.exit(1); }

console.log("\n  Per-field accuracy:");
let failed = false;
for (const f of FIELDS) {
  const acc = score[f] / graded;
  const bar = acc >= PASS_BAR ? "✓" : "✗";
  if (acc < PASS_BAR) failed = true;
  console.log(`    ${bar} ${f.padEnd(12)} ${score[f]}/${graded}  (${Math.round(acc * 100)}%, bar ${Math.round(PASS_BAR * 100)}%)`);
}
const confused = Object.entries(confusion).sort((a, b) => b[1] - a[1]);
if (confused.length) {
  console.log("\n  Confusion pairs (what to sharpen in the prompt):");
  confused.forEach(([k, n]) => console.log(`    ·${n > 1 ? ` ${n}×` : ""} ${k}`));
}
console.log(failed ? "\n  ✗ classification accuracy below the bar\n" : "\n  ✓ classification accuracy passes\n");
process.exit(failed ? 1 : 0);
