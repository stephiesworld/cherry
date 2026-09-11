// POST /api/draft  — turn a confirmed issue into the next artifact.
//
// Body: { product, issue, kind: "ticket" | "reply" | "update", impact? }
// Returns: { text }  — a paste-ready work ticket (framed for the owning team), or a customer reply.
//
// This is the "acts" step: Cherry doesn't just say what's wrong, it drafts the
// thing a PM or CS rep would write next. No web search (cheap, fast); the key
// stays server-side. Studio Felix · built on the Anthropic API.

export const config = { maxDuration: 30 };

const MODEL = process.env.CHERRY_MODEL || "claude-sonnet-4-6"; // match triage/judge default; set CHERRY_MODEL=claude-opus-4-8 for richer drafts
const DAILY_CAP = Number(process.env.CHERRY_DRAFT_DAILY_CAP || 300);
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

const SYSTEM_TICKET = `You write crisp work tickets a PM can paste straight into a tracker (Linear, Jira, Asana).
Frame the ticket for the team that OWNS the issue (given as "Suggested owner"): that may be engineering,
but it could equally be billing, support, product, marketing, or leadership — match the language, acceptance
criteria, and suggested approach to that team's world, not to engineering by default.
Given a product and one triaged customer-feedback issue, output a ready-to-file ticket as PLAIN TEXT
(no markdown symbols beyond simple "- " bullets) with exactly these labelled sections:

Title:
Problem:
Evidence:
Severity:
Proposed owner:
Acceptance criteria:
Suggested approach:

Rules: Problem is 1-3 sentences in neutral PM voice. Evidence bullets the sources/links you were given
(keep the links). Severity restates the given level and why. Acceptance criteria are 3-5 checkable bullets.
Suggested approach is 1-3 sentences. No preamble, no sign-off, no markdown headers.`;

const SYSTEM_REPLY = `You write warm, honest customer-support replies for a product/CS team.
Given a product and one triaged feedback issue, write a short reply (120-160 words) to a customer who
raised it. Acknowledge the specific problem, show you understand its impact, say what you're doing about
it WITHOUT overpromising or inventing dates, and invite them to follow up. Plain text, no markdown.
Sign off as "The <product> team". No preamble before the reply itself.`;

// Closing the loop: a "you said, we did" update is available only when a fresh,
// evidence-grounded impact check supports it — shipped status alone proves work
// completed, not that the customer problem improved.
const SYSTEM_UPDATE = `You write a short "you said, we did" customer update for a product/CS team —
the message sent only when fresh customer evidence supports an improvement. Given a product, a triaged
issue, and a cited impact check, write 90-140 words that: name what customers told us, the supported
change in their current signal, and what we are continuing to watch. Do NOT claim implementation details,
causality, metrics, dates, or customer benefit not in the supplied evidence. If the check does not say
why the signal changed, do not say "because we changed"; use careful wording such as "recent feedback
suggests." Plain text, no markdown.
Sign off as "The <product> team". No preamble before the update itself.`;

function userContent(product, issue, impact) {
  const lines = [`Product: ${product}`, `Issue: ${issue.title || ""}`];
  if (issue.gist) lines.push(`Detail: ${issue.gist}`);
  if (issue.severity != null) lines.push(`Severity: ${issue.severity}/5`);
  if (issue.owner) lines.push(`Suggested owner (owns the fix/decision): ${issue.owner}`);
  if (Array.isArray(issue.stakeholders) && issue.stakeholders.length)
    lines.push(`Stakeholders to loop in: ${issue.stakeholders.join(", ")}`);
  (issue.evidence || []).slice(0, 3).forEach((ev) =>
    lines.push(`Source: ${ev.source || ""} ${ev.url || ""}${ev.quote ? ` — "${ev.quote}"` : ""}`));
  if (impact) {
    lines.push(`Impact outcome: ${impact.outcome || ""}`);
    lines.push(`Impact summary: ${impact.summary || ""}`);
    (impact.evidence || []).slice(0, 3).forEach((ev) =>
      lines.push(`Fresh source: ${ev.source || ""} ${ev.url || ""}${ev.quote ? ` — "${ev.quote}"` : ""}`));
  }
  return lines.join("\n");
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
  const product = (body && body.product ? String(body.product) : "").trim().slice(0, 80);
  const SYS = { ticket: SYSTEM_TICKET, reply: SYSTEM_REPLY, update: SYSTEM_UPDATE };
  const kind = body && SYS[body.kind] ? body.kind : "ticket";
  const issue = (body && body.issue) || {};
  const impact = body && body.impact && typeof body.impact === "object" ? body.impact : null;
  if (!product || !issue.title) return res.status(400).json({ error: "missing product or issue" });
  const groundedImpact = impact && impact.outcome === "improving" && impact.grounded &&
    Array.isArray(impact.evidence) && impact.evidence.filter((ev) => /^https?:\/\/.+/.test(ev && ev.url || "")).length >= 2;
  if (kind === "update" && !groundedImpact)
    return res.status(400).json({ error: "a grounded improving impact check is required before drafting a customer update" });

  const ip = (req.headers["x-forwarded-for"] || "").split(",")[0].trim() || "anon";
  if (rateLimited(ip)) return res.status(429).json({ error: "easy there — give it a few seconds." });
  if (overDailyCap()) return res.status(429).json({ error: "Cherry's drafting limit for today is reached." });

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
        system: SYS[kind],
        messages: [{ role: "user", content: userContent(product, issue, kind === "update" ? impact : null) }],
      }),
    });
    const data = await resp.json();
    if (data.error) throw new Error(data.error.message || "anthropic api error");
    const text = (data.content || [])
      .filter((b) => b.type === "text").map((b) => b.text).join("\n").trim();
    if (!text) throw new Error("empty response");
    return res.status(200).json({ text });
  } catch (e) {
    return res.status(502).json({ error: e.message || "couldn't draft that one" });
  }
}
