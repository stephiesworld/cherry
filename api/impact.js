// POST /api/impact — re-check whether a shipped issue's customer signal changed.
//
// This intentionally researches fresh public feedback rather than reusing the
// triage response. The browser keeps the local baseline; this endpoint compares
// it with new, cited evidence and refuses a conclusive outcome when the evidence
// is too thin.

export const config = { maxDuration: 60 };

const MODEL = process.env.CHERRY_MODEL || "claude-sonnet-4-6";
const MAX_USES = Number(process.env.CHERRY_IMPACT_MAX_SEARCHES || 3);
const DAILY_CAP = Number(process.env.CHERRY_IMPACT_DAILY_CAP || 100);
const PER_IP_PER_MIN = Number(process.env.CHERRY_PER_IP_PER_MIN || 6);

const ipHits = new Map();
let day = "", dayCount = 0;
function rateLimited(ip) {
  const now = Date.now();
  const hits = (ipHits.get(ip) || []).filter((t) => now - t < 60_000);
  hits.push(now); ipHits.set(ip, hits);
  return hits.length > PER_IP_PER_MIN;
}
function overDailyCap() {
  const today = new Date().toISOString().slice(0, 10);
  if (today !== day) { day = today; dayCount = 0; }
  dayCount += 1; return dayCount > DAILY_CAP;
}

const SYSTEM = `You are Cherry's shipped-impact analyst. Compare a saved baseline
for one customer issue against FRESH public customer feedback found with web
search. This is an evidence check, not a status report: do not assume that shipped
work helped merely because it was shipped.

Return only JSON matching the supplied schema.

Research the product and the precise issue in the last 90 days where possible.
Compare the new evidence against the saved baseline across:
- volume: independent customer voices raising the same problem
- severity: how painful it is for affected customers
- recency: whether complaints are still current
- source mix: whether the same signal appears across a broader, similar, or
  narrower set of credible customer-source types

Use "improving" ONLY when recent, cited customer evidence supports a reduction in
the problem. Use "worsening" ONLY when it supports an increase. Use "unchanged"
when the signal is materially similar. Use "inconclusive" when current evidence is
too sparse, stale, contradictory, or cannot be matched confidently to the saved
issue. Never infer product changes, causality, metrics, or customer benefit that
the sources do not establish.

Set grounded true only when at least two specific, real, independent current
sources support the comparison. An "improving" outcome with grounded false is not
allowed. Keep quotes short and verbatim (12 words or fewer). Prefer places where
customers speak directly (app stores, G2/Capterra, Reddit, forums) over SEO
roundups.`;

const EVIDENCE = {
  type: "object",
  properties: {
    source: { type: "string" },
    url: { type: "string" },
    quote: { type: "string" },
  },
  required: ["source", "url", "quote"],
  additionalProperties: false,
};

const SCHEMA = {
  type: "object",
  properties: {
    outcome: { type: "string", enum: ["improving", "unchanged", "worsening", "inconclusive"] },
    grounded: { type: "boolean" },
    summary: { type: "string" },
    comparison: {
      type: "object",
      properties: {
        volume: { type: "string", enum: ["lower", "similar", "higher", "unclear"] },
        severity: { type: "string", enum: ["lower", "similar", "higher", "unclear"] },
        recency: { type: "string", enum: ["less recent", "similar", "more recent", "unclear"] },
        sourceMix: { type: "string", enum: ["broader", "similar", "narrower", "unclear"] },
      },
      required: ["volume", "severity", "recency", "sourceMix"],
      additionalProperties: false,
    },
    evidence: { type: "array", items: EVIDENCE },
  },
  required: ["outcome", "grounded", "summary", "comparison", "evidence"],
  additionalProperties: false,
};

function safeBaseline(raw) {
  const baseline = raw && typeof raw === "object" ? raw : {};
  const scores = baseline.scores && typeof baseline.scores === "object" ? baseline.scores : {};
  const axis = (v) => Number.isInteger(v) && v >= 1 && v <= 5 ? v : null;
  const evidence = Array.isArray(baseline.evidence) ? baseline.evidence.slice(0, 3).map((ev) => ({
    source: String(ev && ev.source || "").slice(0, 100),
    url: String(ev && ev.url || "").slice(0, 500),
    quote: String(ev && ev.quote || "").slice(0, 180),
  })) : [];
  return {
    capturedAt: Number.isFinite(baseline.capturedAt) ? baseline.capturedAt : null,
    scores: { volume: axis(scores.volume), severity: axis(scores.severity), recency: axis(scores.recency) },
    sourceMix: baseline.sourceMix && typeof baseline.sourceMix === "object" ? baseline.sourceMix : {},
    evidence,
  };
}

export default async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", process.env.CHERRY_ALLOW_ORIGIN || "*");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "content-type");
  if (req.method === "OPTIONS") return res.status(204).end();
  if (req.method !== "POST") return res.status(405).json({ error: "POST only" });
  if (!process.env.ANTHROPIC_API_KEY) return res.status(500).json({ error: "server is missing its API key" });

  let body = req.body;
  if (typeof body === "string") { try { body = JSON.parse(body); } catch { body = {}; } }
  const product = String(body && body.product || "").trim().slice(0, 80);
  const rawIssue = body && body.issue && typeof body.issue === "object" ? body.issue : {};
  const issue = {
    title: String(rawIssue.title || "").trim().slice(0, 160),
    gist: String(rawIssue.gist || "").trim().slice(0, 500),
  };
  const baseline = safeBaseline(body && body.baseline);
  if (!product || !issue.title) return res.status(400).json({ error: "missing product or shipped issue" });
  if (!baseline.capturedAt || !baseline.evidence.length)
    return res.status(400).json({ error: "this issue needs a saved evidence baseline first" });

  const ip = (req.headers["x-forwarded-for"] || "").split(",")[0].trim() || "anon";
  if (rateLimited(ip)) return res.status(429).json({ error: "easy there — give it a few seconds." });
  if (overDailyCap()) return res.status(429).json({ error: "Cherry's impact-check limit for today is reached." });

  const baselineForPrompt = JSON.stringify(baseline);
  const user = `Product: ${product}\nShipped issue: ${issue.title}\nIssue detail: ${issue.gist}\n\nSaved baseline (captured ${new Date(baseline.capturedAt).toISOString()}):\n${baselineForPrompt}\n\nFind fresh customer feedback now and produce an evidence-grounded comparison.`;
  try {
    const resp = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-api-key": process.env.ANTHROPIC_API_KEY,
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify({
        model: MODEL,
        max_tokens: 1800,
        system: [{ type: "text", text: SYSTEM, cache_control: { type: "ephemeral" } }],
        messages: [{ role: "user", content: user }],
        tools: [{ type: "web_search_20250305", name: "web_search", max_uses: MAX_USES }],
        output_config: { format: { type: "json_schema", schema: SCHEMA } },
      }),
    });
    const data = await resp.json();
    if (data.error) throw new Error(data.error.message || "anthropic api error");
    const searchErrors = (data.content || [])
      .filter((block) => block.type === "web_search_tool_result")
      .map((block) => block.content)
      .filter((content) => content && !Array.isArray(content) && (content.error_code || /error/i.test(content.type || "")))
      .map((content) => content.error_code || content.type)
      .filter((code) => code !== "max_uses_exceeded");
    const text = (data.content || []).filter((block) => block.type === "text").map((block) => block.text).join("\n").trim();
    if (searchErrors.length) throw new Error("web_search error: " + searchErrors.join(", "));
    if (!text) throw new Error("empty response");
    const result = JSON.parse(text);
    const hasGrounding = result.grounded && Array.isArray(result.evidence) &&
      result.evidence.filter((ev) => /^https?:\/\/.+/.test(ev.url || "")).length >= 2;
    if (result.outcome === "improving" && !hasGrounding) {
      result.outcome = "inconclusive";
      result.grounded = false;
      result.summary = "Fresh evidence was too thin to support a customer-impact claim.";
    }
    return res.status(200).json(result);
  } catch (error) {
    return res.status(502).json({ error: error.message || "couldn't complete the impact check" });
  }
}
