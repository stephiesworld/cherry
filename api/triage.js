// POST /api/triage  — Cherry's secure backend.
//
// The browser never sees the API key. It posts { name, corrections } here; this
// function runs the one Anthropic call server-side (web search + synthesis),
// parses the model's JSON, and returns it clean. Studio Felix · built on the
// Anthropic API.
//
// Cost & abuse guards (a public URL runs on YOUR key):
//   • web search is capped per call (MAX_USES)
//   • identical product names are cached for CACHE_TTL (repeat plays are free)
//   • per-IP rate limit + a hard global daily cap bound the worst case
// Note: caches/limiters are in-memory (per serverless instance) — fine for a
// portfolio tool. For real scale, back them with Vercel KV / Upstash.

export const config = { maxDuration: 60 }; // web search can take 20–40s

const MODEL = process.env.CHERRY_MODEL || "claude-sonnet-4-6"; // Sonnet fits web-search calls under Vercel's 60s free-tier limit; set CHERRY_MODEL=claude-opus-4-8 on Pro (maxDuration 300)
const MAX_USES = Number(process.env.CHERRY_MAX_SEARCHES || 3); // 3 keeps comfortable headroom under Vercel's 60s free-tier limit (incl. cold-start schema compile); raise via env on Pro (maxDuration 300)
const DAILY_CAP = Number(process.env.CHERRY_DAILY_CAP || 200);
const PER_IP_PER_MIN = Number(process.env.CHERRY_PER_IP_PER_MIN || 6);
const CACHE_TTL_MS = 24 * 60 * 60 * 1000;

const SYSTEM = `You are Cherry, a customer-feedback intelligence engine.
Given a product or company, use web search to find REAL, recent, public customer
feedback: reviews (App Store, Google Play, G2, Trustpilot, Capterra), Reddit,
forums, social posts, news. Favor the last ~12 months.

Synthesize what you find into the few issues that matter most, and GROUND every
issue in real sources.

Return ONLY a JSON object — no preamble, no markdown, no code fences. Shape:
{
 "product": string,
 "found": boolean,
 "takeaway": string,
 "issues": [ {
   "title": string,
   "gist": string,
   "severity": number,            // 1-5: how painful for an affected user
   "reach": number,               // 1-5: how widespread (how many users hit it)
   "recency": number,             // 1-5: how current (5 = actively complained about now)
   "prevalence": string,          // e.g. "many reports", "a few mentions"
   "disposition": string,         // "fixable gap" | "intentional tradeoff" (see rule)
   "signal": number,              // your holistic ranking score; higher = more important
   "owner": string,               // ONE primary team that owns the fix/decision (see owner rule)
   "stakeholders": [string],      // 0-3 OTHER teams with a material stake (see stakeholder rule)
   "evidence": [ { "source": string, "url": string, "quote": string } ]
 } ],
 "love": [string, string, string],
 "actions": [ {"action": string, "why": string, "owner": string} ]
}

Rules:
- Up to 5 issues (most important first), gist <= 22 words, up to 3 love, up to 4 actions.
- EVERY issue MUST carry 1–3 evidence items, each with a real source platform and a
  real URL you found via search. An issue you cannot ground in a source does not
  belong in the list — drop it.
- PREFER primary sources where customers speak directly — Trustpilot, G2, Capterra,
  Reddit, the App Store / Google Play, BBB, news outlets. Avoid SEO/AI "review
  roundup" aggregator sites (e.g. generic *.ai analyses) unless nothing primary exists.
- BALANCE your sources and correct for selection bias. Complaint venues (Trustpilot,
  ConsumerAffairs, PissedConsumer, BBB, Sitejabber) are SELF-SELECTED toward furious
  users — their volume is NOT representative of the overall user base. Deliberately also
  pull from the App Store / Google Play (where a star rating gives context), Reddit
  (which carries praise and gripes), G2/Capterra, and expert/press reviews. When scoring
  "reach" and "prevalence", calibrate by likely BASE RATE, not by how loud a complaint is
  on a venting site: an issue that is loud on Trustpilot but absent everywhere else is
  probably niche, so score its reach LOW. Do not let a complaint-heavy source mix inflate
  severity or prevalence.
- Paraphrase sentiment in your own words. Keep any quoted phrase short (<= 12 words).
- Score severity, reach, and recency independently, each 1-5 — they are separate
  axes (a niche-but-brutal bug can be high-severity, low-reach). "signal" is your
  own holistic rank; higher = more important. Rank by impact, not by how loud a
  single review is.
- "actions" are concrete next steps (a product change, feature, pricing move, docs
  fix), each with the reasoning in "why".
- Set "disposition" per issue: a FIXABLE GAP (a bug, missing feature, or unintended
  friction the team would want to close) or an INTENTIONAL TRADEOFF (a deliberate
  business decision — aggressive pricing, cancellation friction, a dark pattern — that
  customers hate but the company chose on purpose). For an intentional tradeoff, do NOT
  frame the action as a simple "fix it"; frame it as a leadership/strategy decision
  weighing the customer/brand/legal cost against the business upside, and prefer
  Leadership (or Legal when there's regulatory exposure) as the owner rather than the
  team that merely built it.
- "owner" (on issues AND actions) MUST be a SINGLE primary team — no "/" or "&"
  compounds, no listing two teams. The owner is the one team that owns the FIX or the
  DECISION. Prefer one of these canonical labels so related issues cluster: Engineering,
  Product, Design, Billing, Customer Support, Trust & Safety, Security, Legal, Marketing,
  Content, Leadership. Only invent a different single label if none of these fits.
- "stakeholders": 0-3 OTHER canonical teams (never repeating the owner) that have a real
  stake and must be looped in — e.g. an intentional-tradeoff pricing issue is OWNED by
  Leadership (they decide whether to change it) with Legal a STAKEHOLDER when there's
  regulatory exposure; a checkout bug owned by Engineering may have Billing as a
  stakeholder. Use [] when no other team genuinely needs a seat. Owner = who acts;
  stakeholders = who must be consulted.
- If a reviewer's prior corrections are provided, treat them as ground truth:
  adjust severity, owner, stakeholders, and ranking to honor them.
- If real feedback is genuinely thin, say so in "takeaway" and set found=false.`;

// Internal-intake mode: instead of searching the web, triage RAW feedback the
// user pasted (a Slack thread, support tickets, sales-call notes). Same output
// shape — this is the "system of record" path: meet teams where the signal lives.
const SYSTEM_INTERNAL = `You are Cherry, a customer-feedback intelligence engine.
You are given RAW internal customer feedback (e.g. a Slack thread, support tickets,
or sales-call notes) pasted by the user. Do NOT use web search. Cluster THIS text
into the few issues that matter most, grounding every issue in the text itself.

Return ONLY a JSON object — no preamble, no markdown, no code fences. Shape:
{
 "product": string,                // what the feedback is about (infer if unstated)
 "found": boolean,
 "takeaway": string,
 "issues": [ {
   "title": string, "gist": string,
   "severity": number,            // 1-5: how painful for an affected user
   "reach": number,               // 1-5: how many distinct people/accounts raise it in the text
   "recency": number,             // 1-5: leave 3 unless the text carries dates/timestamps
   "prevalence": string,
   "disposition": string,         // "fixable gap" | "intentional tradeoff"
   "signal": number,
   "owner": string,               // ONE primary team that owns the fix/decision
   "stakeholders": [string],      // 0-3 other teams to loop in (e.g. Legal for regulatory risk); [] if none
   "evidence": [ { "source": string, "quote": string } ]  // quote VERBATIM from the text; source = who/where in the text (no url)
 } ],
 "love": [string], "actions": [ {"action": string, "why": string, "owner": string} ]
}

Rules:
- Up to 5 issues (most important first), gist <= 22 words, up to 3 love, up to 4 actions.
- EVERY issue MUST carry 1–3 evidence items, each a SHORT verbatim quote (<= 14 words)
  copied from the pasted text, with "source" naming who or where in the text it came
  from. Do NOT invent feedback that is not in the text. Omit "url".
- Score severity, reach, and recency 1-5 each as separate axes.
- Set "disposition": "fixable gap" (a bug/missing-feature/friction to close) or
  "intentional tradeoff" (a deliberate business choice customers dislike). Route an
  intentional tradeoff to Leadership/Legal as a strategy call, not a fix.
- "owner" (issues AND actions) is a SINGLE primary team that owns the fix/decision —
  prefer: Engineering, Product, Design, Billing, Customer Support, Trust & Safety,
  Security, Legal, Marketing, Content, Leadership. Only invent a single label if none fits.
- "stakeholders": 0-3 other canonical teams (never the owner) that must be looped in
  (e.g. Legal for regulatory risk). Use [] when none. Owner = who acts; stakeholders = who's consulted.
- If prior corrections/preferences are provided, honor them and re-rank.
- If the pasted text has no real product feedback, say so in "takeaway" and set found=false.`;

// Revise-in-place: apply a reviewer's corrections to an EXISTING triage, changing
// only what the corrections require. No web search, no regeneration — this keeps
// the quality measurement clean (the only delta is the reviewer's judgment) and is
// the right behavior anyway: the reviewer wants their call applied, not a fresh rewrite.
const SYSTEM_REVISE = `You are Cherry. You are given a CURRENT triage (JSON) and a reviewer's corrections.
Apply the corrections as GROUND TRUTH and return the UPDATED triage in the SAME JSON shape.

Critical: change ONLY what the corrections require — and any re-ranking that logically follows from
them. Every other issue, title, gist, severity, reach, recency, disposition, owner, quote, source, url,
"love", and "action" MUST stay BYTE-FOR-BYTE IDENTICAL to the input. Do not reword, re-score, re-search,
or invent anything. Do not add or drop issues. If a correction changes an issue's signal/severity, re-sort
issues by signal so the list stays ranked. Return the full object, not a diff.`;

// Structured-output contract. We hand this schema to the API (output_config.format)
// so the model's final answer is GUARANTEED to be valid JSON in this exact shape —
// no more parsing JSON out of free text (which intermittently failed when a review
// quote contained a stray quote/newline). Every object needs additionalProperties:false.
const ev = {
  type: "object",
  // url is optional: web-search evidence carries a real URL; pasted internal
  // feedback (Slack/support/calls) grounds in a verbatim quote with no URL.
  properties: { source: { type: "string" }, url: { type: "string" }, quote: { type: "string" } },
  required: ["source", "quote"], additionalProperties: false,
};
const TRIAGE_SCHEMA = {
  type: "object",
  properties: {
    product: { type: "string" },
    found: { type: "boolean" },
    takeaway: { type: "string" },
    issues: {
      type: "array",
      items: {
        type: "object",
        properties: {
          title: { type: "string" }, gist: { type: "string" },
          // Legible, separable signal components (each 1-5) so the score can be
          // re-weighted client-side instead of being one opaque number.
          severity: { type: "integer" }, reach: { type: "integer" }, recency: { type: "integer" },
          prevalence: { type: "string" },
          // Disposition: is this a gap the team would close, or a deliberate business
          // choice customers hate? Drives whether the action is a fix or a strategy call.
          disposition: { type: "string", enum: ["fixable gap", "intentional tradeoff"] },
          signal: { type: "number" }, owner: { type: "string" },
          // Stakeholders: other teams with a material stake (e.g. Legal owns the
          // lawsuit even when Leadership owns the decision). Empty when there are none.
          stakeholders: { type: "array", items: { type: "string" } },
          evidence: { type: "array", items: ev },
        },
        required: ["title", "gist", "severity", "reach", "recency", "prevalence", "disposition", "signal", "owner", "stakeholders", "evidence"],
        additionalProperties: false,
      },
    },
    love: { type: "array", items: { type: "string" } },
    actions: {
      type: "array",
      items: {
        type: "object",
        properties: { action: { type: "string" }, why: { type: "string" }, owner: { type: "string" } },
        required: ["action", "why", "owner"], additionalProperties: false,
      },
    },
  },
  required: ["product", "found", "takeaway", "issues", "love", "actions"],
  additionalProperties: false,
};

// ── in-memory guards ─────────────────────────────────────────────────────────
function sig(memory){let h=5381;const t=(memory||[]).map(m=>(m.title||'')+'~'+(m.note||'')).join('|');for(let i=0;i<t.length;i++)h=((h<<5)+h+t.charCodeAt(i))>>>0;return h.toString(36);}
const cache = new Map();        // key -> { at, data }
const ipHits = new Map();       // ip -> [timestamps]
let day = "", dayCount = 0;

function rateLimited(ip) {
  const now = Date.now();
  const hits = (ipHits.get(ip) || []).filter((t) => now - t < 60_000);
  hits.push(now);
  ipHits.set(ip, hits);
  return hits.length > PER_IP_PER_MIN;
}
function overDailyCap() {
  const today = new Date().toISOString().slice(0, 10);
  if (today !== day) { day = today; dayCount = 0; }
  dayCount += 1;
  return dayCount > DAILY_CAP;
}

function extractJSON(txt) {
  let t = String(txt).replace(/```json/gi, "").replace(/```/g, "").trim();
  const a = t.indexOf("{"), b = t.lastIndexOf("}");
  if (a >= 0 && b > a) t = t.slice(a, b + 1);
  return JSON.parse(t);
}

async function callAnthropic(name, corrections, memory, feedback, current) {
  // Revise-in-place when we have a prior result + corrections: surgically apply the
  // reviewer's judgment to the existing triage (no web search, no rewrite).
  const revise = !!(current && Array.isArray(current.issues) && current.issues.length && corrections && corrections.length);
  const internal = !revise && !!(feedback && feedback.trim());
  let userMsg;
  if (revise) {
    userMsg = "CURRENT triage:\n" + JSON.stringify(current) +
      "\n\nReviewer corrections — apply as ground truth, change only what they require, keep everything else identical:\n" +
      corrections.map((c) => `- On "${c.title}": ${c.note}`).join("\n");
  } else {
    userMsg = internal
      ? `Triage this pasted internal customer feedback${name ? ` about ${name}` : ""}:\n\n"""\n${feedback}\n"""`
      : "Research and triage customer feedback for: " + name;
    if (corrections && corrections.length) {
      userMsg += "\n\nA reviewer corrected the previous pass. Honor these as ground truth and re-rank:\n" +
        corrections.map((c) => `- On "${c.title}": ${c.note}`).join("\n");
    }
    if (memory && memory.length) {
      userMsg += "\n\nLearned preferences from this reviewer's past corrections — apply these tendencies, but they are guidance, not gospel; still judge each product on its own evidence:\n" +
        memory.map((m) => `- On "${m.title}"${m.product ? ` (${m.product})` : ""}: ${m.note}`).join("\n");
    }
  }
  const resp = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-api-key": process.env.ANTHROPIC_API_KEY,
      "anthropic-version": "2023-06-01",
    },
    body: JSON.stringify({
      model: MODEL,
      max_tokens: 4096,
      system: revise ? SYSTEM_REVISE : internal ? SYSTEM_INTERNAL : SYSTEM,
      messages: [{ role: "user", content: userMsg }],
      // Web search only for a fresh web triage — not for revise or pasted-feedback modes.
      ...(revise || internal ? {} : { tools: [{ type: "web_search_20250305", name: "web_search", max_uses: MAX_USES }] }),
      output_config: { format: { type: "json_schema", schema: TRIAGE_SCHEMA } },
    }),
  });
  const data = await resp.json();
  if (data.error) throw new Error(data.error.message || "anthropic api error");

  // Web-search diagnostic: the web_search tool fails with HTTP 200 + an error
  // block (not a thrown error), and the model often still emits text (found=false),
  // which hides the real cause. Surface the exact web-search error_code so it
  // reaches the UI instead of silently looking like "no feedback found".
  const searchErrors = (data.content || [])
    .filter((b) => b.type === "web_search_tool_result")
    .map((b) => b.content)
    .filter((c) => c && !Array.isArray(c) && (c.error_code || /error/i.test(c.type || "")))
    .map((c) => c.error_code || c.type);

  const text = (data.content || [])
    .filter((b) => b.type === "text").map((b) => b.text).join("\n").trim();

  // max_uses_exceeded is benign: the model wanted more searches than the per-call
  // cap allows, but the searches that DID run still returned results. Only other
  // search errors (unavailable, too_many_requests, ...) are fatal, and only when
  // the model produced no usable answer at all.
  const fatal = searchErrors.filter((c) => c !== "max_uses_exceeded");
  if (!text && fatal.length) throw new Error("web_search error: " + fatal.join(", "));
  if (!text) throw new Error("empty response");
  return extractJSON(text);
}

export default async function handler(req, res) {
  // CORS — lock to your site's origin in production via CHERRY_ALLOW_ORIGIN.
  res.setHeader("Access-Control-Allow-Origin", process.env.CHERRY_ALLOW_ORIGIN || "*");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "content-type");
  if (req.method === "OPTIONS") return res.status(204).end();
  if (req.method !== "POST") return res.status(405).json({ error: "POST only" });
  if (!process.env.ANTHROPIC_API_KEY) return res.status(500).json({ error: "server is missing its API key" });

  let body = req.body;
  if (typeof body === "string") { try { body = JSON.parse(body); } catch { body = {}; } }
  const name = (body && body.name ? String(body.name) : "").trim().slice(0, 80);
  const corrections = Array.isArray(body && body.corrections) ? body.corrections.slice(0, 8) : [];
  const memory = Array.isArray(body && body.memory) ? body.memory.slice(0, 12) : [];
  const feedback = (body && body.feedback ? String(body.feedback) : "").trim().slice(0, 8000);
  const current = body && body.current && Array.isArray(body.current.issues) ? body.current : null;
  const internal = !!feedback && !current;
  if (!internal && !name) return res.status(400).json({ error: "give me a product or company name" });
  if (internal && feedback.length < 40) return res.status(400).json({ error: "paste a bit more feedback to triage (a few lines at least)" });

  const ip = (req.headers["x-forwarded-for"] || "").split(",")[0].trim() || "anon";
  if (rateLimited(ip)) return res.status(429).json({ error: "easy there — give it a few seconds and try again." });

  // Cache: only fresh web lookups (no corrections, no pasted feedback). Pasted
  // feedback is one-off and corrections always re-run.
  const cacheable = !corrections.length && !internal;
  const key = name.toLowerCase() + ":" + sig(memory);
  if (cacheable) {
    const hit = cache.get(key);
    if (hit && Date.now() - hit.at < CACHE_TTL_MS) return res.status(200).json(hit.data);
  }

  if (overDailyCap()) {
    return res.status(429).json({ error: "Cherry's demo limit for today is reached — try again tomorrow." });
  }

  try {
    const data = await callAnthropic(name, corrections, memory, feedback, current);
    if (cacheable) cache.set(key, { at: Date.now(), data });
    return res.status(200).json(data);
  } catch (e) {
    return res.status(502).json({ error: e.message || "couldn't complete that one" });
  }
}
