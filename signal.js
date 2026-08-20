// Cherry's transparent default signal score.
//
// The three axes stay independent and visible. The default Product view turns
// them into a 0-100 ranking with an explicit weighted average:
//   severity 50% + reach 30% + recency 20%.
// Other persona presets use the same function with different visible weights.

export const DEFAULT_SIGNAL_WEIGHTS = Object.freeze({ sev: 5, reach: 3, rec: 2 });

function axis(value) {
  const n = Number(value);
  return Number.isFinite(n) ? Math.max(0, Math.min(5, n)) : 0;
}

export function signalScore(issue, weights = DEFAULT_SIGNAL_WEIGHTS) {
  const sevWeight = Math.max(0, Number(weights.sev) || 0);
  const reachWeight = Math.max(0, Number(weights.reach) || 0);
  const recWeight = Math.max(0, Number(weights.rec) || 0);
  const denominator = sevWeight + reachWeight + recWeight || 1;
  const weighted =
    sevWeight * axis(issue && issue.severity) +
    reachWeight * axis(issue && issue.reach) +
    recWeight * axis(issue && issue.recency);
  return Math.round((weighted / denominator / 5) * 100);
}

export function normalizeTriageSignal(result) {
  if (!result || !Array.isArray(result.issues)) return result;
  result.issues.forEach((issue) => { issue.signal = signalScore(issue); });
  result.issues.sort((a, b) => b.signal - a.signal);
  return result;
}

export default signalScore;
