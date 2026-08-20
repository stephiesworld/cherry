// Cherry trend/diff — pure matching for "what changed since last run".
// Loaded in the browser via <script type="module"> and tested in CI via Node.

/** Product key for localStorage snaps: trim, collapse whitespace, lowercase. */
export function snapKey(name) {
  return String(name || "").trim().replace(/\s+/g, " ").toLowerCase();
}

/** Significant tokens: lowercase, alnum, words >3 chars, sorted, up to 5. */
export function normTitle(t) {
  return String(t || "")
    .toLowerCase()
    .replace(/[^a-z0-9 ]/g, " ")
    .split(/\s+/)
    .filter((w) => w.length > 3)
    .sort()
    .slice(0, 5)
    .join(" ");
}

/** Up to 3 unique hostnames from evidence URLs (tie-break for matching). */
export function evidenceHosts(evidence) {
  const hosts = [];
  for (const ev of evidence || []) {
    const raw = ev && ev.url;
    if (!raw) continue;
    try {
      const host = new URL(String(raw)).hostname;
      if (host && !hosts.includes(host)) hosts.push(host);
    } catch {
      /* ignore bad urls */
    }
    if (hosts.length >= 3) break;
  }
  return hosts;
}

export function issueToSnap(it) {
  return {
    t: it.title || it.t || "",
    n: it.n || normTitle(it.title || it.t),
    sev: +it.severity || +it.sev || 0,
    reach: +it.reach || 0,
    rec: +it.recency || +it.rec || 0,
    hosts: it.hosts || evidenceHosts(it.evidence),
  };
}

export function buildSnap(issues, now = Date.now()) {
  return { savedAt: now, issues: (issues || []).map(issueToSnap) };
}

function tokenSet(n) {
  return new Set(String(n || "").split(/\s+/).filter(Boolean));
}

function sharedCount(na, nb) {
  const A = tokenSet(na);
  let n = 0;
  for (const t of tokenSet(nb)) if (A.has(t)) n++;
  return n;
}

function hostOverlap(a, b) {
  const A = new Set(a || []);
  let n = 0;
  for (const h of b || []) if (A.has(h)) n++;
  return n;
}

function hasAxes(prior) {
  return prior && ("sev" in prior || "reach" in prior || "rec" in prior);
}

/**
 * Greedy 1:1 match of current issues to prior snap issues.
 * Eligible when exact norm match or ≥2 shared significant tokens.
 * Ties broken by evidence-hostname overlap.
 */
export function matchIssues(currentIssues, priorIssues) {
  const cur = (currentIssues || []).map((it, i) => ({
    i,
    n: it.n || normTitle(it.title || it.t),
    hosts: it.hosts || evidenceHosts(it.evidence),
  }));
  const prior = (priorIssues || []).map((p, j) => ({
    j,
    n: p.n || normTitle(p.t || p.title),
    hosts: p.hosts || [],
    raw: p,
  }));

  const pairs = [];
  for (const c of cur) {
    for (const p of prior) {
      let score;
      if (c.n && p.n && c.n === p.n) score = 100;
      else {
        const shared = sharedCount(c.n, p.n);
        if (shared < 2) continue;
        score = shared;
      }
      pairs.push({
        ci: c.i,
        pj: p.j,
        score,
        hosts: hostOverlap(c.hosts, p.hosts),
      });
    }
  }
  pairs.sort((a, b) => b.score - a.score || b.hosts - a.hosts);

  const usedCur = new Set();
  const usedPrior = new Set();
  const matches = [];
  for (const pair of pairs) {
    if (usedCur.has(pair.ci) || usedPrior.has(pair.pj)) continue;
    usedCur.add(pair.ci);
    usedPrior.add(pair.pj);
    matches.push({
      currentIndex: pair.ci,
      priorIndex: pair.pj,
      prior: prior[pair.pj].raw,
    });
  }

  return {
    matches,
    newIndexes: cur.filter((c) => !usedCur.has(c.i)).map((c) => c.i),
    resolved: prior.filter((p) => !usedPrior.has(p.j)).map((p) => p.raw),
  };
}

/**
 * Worse only when severity +≥1 AND (sev+reach+rec) +≥2.
 * Title-only priors (no axis fields) never flag worse.
 */
export function isWorse(current, prior) {
  if (!hasAxes(prior)) return false;
  const cSev = +(current.severity != null ? current.severity : current.sev) || 0;
  const cReach = +current.reach || 0;
  const cRec = +(current.recency != null ? current.recency : current.rec) || 0;
  const pSev = +prior.sev || 0;
  const pReach = +prior.reach || 0;
  const pRec = +prior.rec || 0;
  const sevDelta = cSev - pSev;
  const sumDelta = cSev + cReach + cRec - (pSev + pReach + pRec);
  return sevDelta >= 1 && sumDelta >= 2;
}

export function snapSavedAt(snap) {
  if (!snap) return null;
  if (typeof snap.savedAt === "number" && snap.savedAt > 0) return snap.savedAt;
  if (typeof snap.at === "number" && snap.at > 0) return snap.at;
  return null;
}

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

/** "since Aug 4" or "since last run" when no timestamp. */
export function formatSince(ts) {
  if (!ts) return "since last run";
  const d = new Date(ts);
  if (Number.isNaN(d.getTime())) return "since last run";
  return "since " + MONTHS[d.getMonth()] + " " + d.getDate();
}

export function summarizeDelta({ newCount, worseCount, resolvedCount, sincePhrase }) {
  const parts = [];
  if (newCount) parts.push(newCount + " new issue" + (newCount === 1 ? "" : "s"));
  if (worseCount) parts.push(worseCount + " worsened");
  if (resolvedCount) parts.push(resolvedCount + " resolved");
  const since = sincePhrase || "since last run";
  if (!parts.length) return "No change " + since;
  return parts.join(", ") + " " + since;
}

/** Diff current live issues against a prior product snap. */
export function diffRuns(currentIssues, priorSnap) {
  const priorIssues = (priorSnap && priorSnap.issues) || [];
  const { matches, newIndexes, resolved } = matchIssues(currentIssues, priorIssues);
  const newSet = new Set(newIndexes);
  const worseSet = new Set();
  for (const m of matches) {
    if (isWorse(currentIssues[m.currentIndex], m.prior)) worseSet.add(m.currentIndex);
  }
  const sincePhrase = formatSince(snapSavedAt(priorSnap));
  return {
    newSet,
    worseSet,
    resolved,
    sincePhrase,
    summary: summarizeDelta({
      newCount: newSet.size,
      worseCount: worseSet.size,
      resolvedCount: resolved.length,
      sincePhrase,
    }),
  };
}

const api = {
  snapKey,
  normTitle,
  evidenceHosts,
  issueToSnap,
  buildSnap,
  matchIssues,
  isWorse,
  snapSavedAt,
  formatSince,
  summarizeDelta,
  diffRuns,
};

if (typeof globalThis !== "undefined") globalThis.CherryTrend = api;

export default api;
