// POST /api/judge  — score a triage's SYNTHESIS QUALITY with an LLM judge.
//
// Body: { result }  (a triage result object)
// Returns: { scores:{grounding,clustering,ranking,routing,actionability}, overall, weakest, improve }
//
// This is the "measured learning loop": the UI scores a triage, the reviewer
// corrects and re-ranks, and we score again — so a human correction's effect on
// synthesis quality is visible, not asserted. A separate Claude call (independent
// of the triage) grades against a rubric. Studio Felix · built on the Anthropic API.

export const config = { maxDuration: 30 };

const MODEL = process.env.CHERRY_JUDGE_MODEL || process.env.CHERRY_MODEL || "claude-sonnet-4-6";
const DAILY_CAP = Number(process.env.CHERRY_JUDGE_DAILY_CAP || 400);
const PER_IP_PER_MIN = Number(process.env.CHERRY_PER_IP_PER_MIN || 12);

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

const RUBRIC = `You are a senior product-operations leader grading a customer-feedback triage.
You are given the triage JSON. Score each dimension 1-5 (5 = excellent), strictly:

- grounding: is every issue tied to specific, believable evidence (a quote/source), with no invented feedback?
- clustering: are the issues distinct, well-scoped themes — not overlapping, not one theme split in two, not a grab-bag?
- ranking: are severity/reach/recency and the resulting order defensible? Would a PM agree the top issue is the top issue?
- routing: is each "owner" the single team genuinely accountable for that issue, and is an intentional tradeoff sent to Leadership/Legal rather than the team that merely built it?
- actionability: are the actions concrete, specific to THIS product, and justified — something a team could actually pick up?

Be a tough grader: 3 = acceptable, 4 = good, 5 = exemplary. Reserve 5s. Identify the single weakest
dimension and say, in one short sentence, what would most improve the triage.`;

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

export default async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", process.env.CHERRY_ALLOW_ORIGIN || "*");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "content-type");
  if (req.method === "OPTIONS") return res.status(204).end();
  if (req.method !== "POST") return res.status(405).json({ error: "POST only" });
  if (!process.env.ANTHROPIC_API_KEY) return res.status(500).json({ error: "server is missing its API key" });

  let body = req.body;
  if (typeof body === "string") { try { body = JSON.parse(body); } catch { body = {}; } }
  const result = body && body.result;
  if (!result || !Array.isArray(result.issues) || !result.issues.length) {
    return res.status(400).json({ error: "nothing to grade" });
  }

  const ip = (req.headers["x-forwarded-for"] || "").split(",")[0].trim() || "anon";
  if (rateLimited(ip)) return res.status(429).json({ error: "easy there — give it a few seconds." });
  if (overDailyCap()) return res.status(429).json({ error: "Cherry's grading limit for today is reached." });

  // Only the fields the judge needs — keep the payload tight.
  const slim = {
    product: result.product, takeaway: result.takeaway,
    issues: (result.issues || []).slice(0, 5).map((i) => ({
      title: i.title, gist: i.gist, severity: i.severity, reach: i.reach, recency: i.recency,
      disposition: i.disposition, owner: i.owner,
      evidence: (i.evidence || []).slice(0, 3).map((e) => ({ source: e.source, url: e.url, quote: e.quote })),
    })),
    actions: (result.actions || []).slice(0, 4),
  };

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
        max_tokens: 1024,
        system: RUBRIC,
        messages: [{ role: "user", content: "Grade this triage:\n\n" + JSON.stringify(slim) }],
        output_config: { format: { type: "json_schema", schema: SCHEMA } },
      }),
    });
    const data = await resp.json();
    if (data.error) throw new Error(data.error.message || "anthropic api error");
    const text = (data.content || []).filter((b) => b.type === "text").map((b) => b.text).join("").trim();
    if (!text) throw new Error("empty response");
    const v = JSON.parse(text);
    const s = v.scores;
    const overall = Math.round(((s.grounding + s.clustering + s.ranking + s.routing + s.actionability) / 5) * 10) / 10;
    return res.status(200).json({ scores: s, overall, weakest: v.weakest, improve: v.improve });
  } catch (e) {
    return res.status(502).json({ error: e.message || "couldn't grade that one" });
  }
}
