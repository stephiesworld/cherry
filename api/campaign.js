// POST /api/campaign — create neutral outreach for a segment Cherry has not heard from.
//
// Body: { product, segment, decision }
// Returns: { outreach, questions } — the campaign assets a team can send through
// its approved survey, CRM, or interview workflow. Response collection stays in the
// browser alongside Cherry's existing first-party paste intake.

export const config = { maxDuration: 30 };

const MODEL = process.env.CHERRY_MODEL || "claude-sonnet-4-6";
const DAILY_CAP = Number(process.env.CHERRY_CAMPAIGN_DAILY_CAP || 100);
const PER_IP_PER_MIN = Number(process.env.CHERRY_PER_IP_PER_MIN || 8);

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

const SYSTEM = `You create a focused customer-feedback outreach campaign for Cherry.
The team has no evidence from one customer segment; that silence is not evidence
that the segment is happy. Given a product, segment, and product decision to
inform, return ONLY JSON matching this exact shape:
{
  "outreach": string,
  "questions": [string]
}

Rules:
- Write a short, neutral outreach message (80-130 words) in a direct product-research
  voice. Invite honest feedback; do not assume there is a problem, promise a change,
  use leading language, or invent incentives/timelines.
- Return 3-5 open, non-leading interview or survey questions. They should help a team
  make the stated decision, while leaving room for "nothing is wrong".
- Ask about the recipient's actual workflow before asking about a proposed solution.
- Output plain strings only: no markdown, labels, URLs, or preamble.`;

const SCHEMA = {
  type: "object",
  properties: {
    outreach: { type: "string" },
    questions: { type: "array", items: { type: "string" }, minItems: 3, maxItems: 5 },
  },
  required: ["outreach", "questions"],
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
  const product = String((body && body.product) || "").trim().slice(0, 80);
  const segment = String((body && body.segment) || "").trim().slice(0, 100);
  const decision = String((body && body.decision) || "").trim().slice(0, 300);
  if (!product || !segment || !decision)
    return res.status(400).json({ error: "product, segment, and decision are required" });

  const ip = (req.headers["x-forwarded-for"] || "").split(",")[0].trim() || "anon";
  if (rateLimited(ip)) return res.status(429).json({ error: "easy there — give it a few seconds." });
  if (overDailyCap()) return res.status(429).json({ error: "Cherry's campaign drafting limit for today is reached." });

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
        system: SYSTEM,
        messages: [{ role: "user", content: `Product: ${product}\nSilent segment: ${segment}\nDecision to inform: ${decision}` }],
        output_config: { format: { type: "json_schema", schema: SCHEMA } },
      }),
    });
    const data = await resp.json();
    if (data.error) throw new Error(data.error.message || "anthropic api error");
    const text = (data.content || []).filter((b) => b.type === "text").map((b) => b.text).join("\n").trim();
    if (!text) throw new Error("empty response");
    const campaign = JSON.parse(text);
    if (!campaign.outreach || !Array.isArray(campaign.questions) || campaign.questions.length < 3)
      throw new Error("invalid campaign response");
    return res.status(200).json(campaign);
  } catch (e) {
    return res.status(502).json({ error: e.message || "couldn't create that campaign" });
  }
}
