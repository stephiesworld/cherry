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
const MAX_USES = Number(process.env.CHERRY_MAX_SEARCHES || 3); // 3 keeps the call under Vercel's 60s function limit; raise via env on Pro
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
   "severity": number,            // 1-5
   "prevalence": string,          // e.g. "many reports", "a few mentions"
   "signal": number,              // your ranking score; higher = more important
   "owner": string,               // the team that should own it
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
- Paraphrase sentiment in your own words. Keep any quoted phrase short (<= 12 words).
- "signal" should reflect severity AND how often the theme recurs — rank by impact,
  not by how loud a single review is.
- "actions" are concrete next steps (a product change, feature, pricing move, docs
  fix), each with the reasoning in "why".
- If a reviewer's prior corrections are provided, treat them as ground truth:
  adjust severity, owner, and ranking to honor them.
- If real feedback is genuinely thin, say so in "takeaway" and set found=false.`;

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

async function callAnthropic(name, corrections, memory, debug) {
  let userMsg = "Research and triage customer feedback for: " + name;
  if (corrections && corrections.length) {
    userMsg += "\n\nA reviewer corrected the previous pass. Honor these as ground truth and re-rank:\n" +
      corrections.map((c) => `- On "${c.title}": ${c.note}`).join("\n");
  }
  if (memory && memory.length) {
    userMsg += "\n\nLearned preferences from this reviewer's past corrections — apply these tendencies, but they are guidance, not gospel; still judge each product on its own evidence:\n" +
      memory.map((m) => `- On "${m.title}"${m.product ? ` (${m.product})` : ""}: ${m.note}`).join("\n");
  }
  // Debug calls use a single search so they complete inside the 60s limit and
  // we can read whether web_search returns results at all.
  const maxUses = debug ? 1 : MAX_USES;
  const startedAt = Date.now();
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
      system: SYSTEM,
      messages: [{ role: "user", content: userMsg }],
      tools: [{ type: "web_search_20260209", name: "web_search", max_uses: maxUses }],
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

  // If web search produced no usable results, fail loudly with the error_code.
  if (searchErrors.length) throw new Error("web_search error: " + searchErrors.join(", "));
  if (!text) throw new Error("empty response");
  const result = extractJSON(text);

  // Gated debug (only when caller sends {"debug": true}) — surfaces whether the
  // web_search tool actually ran and returned results.
  if (debug) {
    const blocks = data.content || [];
    result.__debug = {
      model: MODEL,
      max_uses: maxUses,
      elapsed_ms: Date.now() - startedAt,
      stop_reason: data.stop_reason,
      web_search_calls: blocks.filter((b) => b.type === "server_tool_use" && b.name === "web_search").length,
      web_search_queries: blocks.filter((b) => b.type === "server_tool_use" && b.name === "web_search").map((b) => b.input && b.input.query),
      web_search_results: blocks.filter((b) => b.type === "web_search_tool_result")
        .reduce((n, b) => n + (Array.isArray(b.content) ? b.content.length : 0), 0),
      content_block_types: blocks.map((b) => b.type),
      usage: data.usage,
    };
  }
  return result;
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
  const debug = !!(body && body.debug);
  // Free, instant config check (no Anthropic call) — POST {"ping":true}.
  if (body && body.ping) {
    return res.status(200).json({ ok: true, model: MODEL, max_uses: MAX_USES, max_duration: config.maxDuration, has_key: !!process.env.ANTHROPIC_API_KEY });
  }
  if (!name) return res.status(400).json({ error: "give me a product or company name" });

  const ip = (req.headers["x-forwarded-for"] || "").split(",")[0].trim() || "anon";
  if (rateLimited(ip)) return res.status(429).json({ error: "easy there — give it a few seconds and try again." });

  // Cache: only the no-corrections (fresh) lookups; corrections always re-run.
  // Debug calls always bypass the cache so they reflect a live tool run.
  const key = name.toLowerCase() + ":" + sig(memory);
  if (!corrections.length && !debug) {
    const hit = cache.get(key);
    if (hit && Date.now() - hit.at < CACHE_TTL_MS) return res.status(200).json(hit.data);
  }

  if (overDailyCap()) {
    return res.status(429).json({ error: "Cherry's demo limit for today is reached — try again tomorrow." });
  }

  try {
    const data = await callAnthropic(name, corrections, memory, debug);
    if (!corrections.length && !debug) cache.set(key, { at: Date.now(), data });
    return res.status(200).json(data);
  } catch (e) {
    return res.status(502).json({ error: e.message || "couldn't complete that one" });
  }
}
