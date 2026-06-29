// POST /api/route  — close the loop by routing a draft to where work happens.
//
// Body: { text, title?, owner? }
// Posts the drafted ticket to a Slack channel via an Incoming Webhook the site
// owner configures as CHERRY_SLACK_WEBHOOK. If no webhook is set, returns
// { configured: false } so the UI can explain how to wire one — the routing
// surface is real, the destination is one env var away.
//
// Safety: the destination URL comes from env (the owner's own webhook), never
// from the request, so there's no SSRF surface. Studio Felix · Anthropic API.

export const config = { maxDuration: 15 };

const PER_IP_PER_MIN = Number(process.env.CHERRY_PER_IP_PER_MIN || 12);
const ipHits = new Map();
function rateLimited(ip) {
  const now = Date.now();
  const hits = (ipHits.get(ip) || []).filter((t) => now - t < 60_000);
  hits.push(now); ipHits.set(ip, hits);
  return hits.length > PER_IP_PER_MIN;
}

export default async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", process.env.CHERRY_ALLOW_ORIGIN || "*");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "content-type");
  if (req.method === "OPTIONS") return res.status(204).end();
  if (req.method !== "POST") return res.status(405).json({ error: "POST only" });

  let body = req.body;
  if (typeof body === "string") { try { body = JSON.parse(body); } catch { body = {}; } }
  const text = (body && body.text ? String(body.text) : "").trim().slice(0, 6000);
  const title = (body && body.title ? String(body.title) : "").trim().slice(0, 200);
  const owner = (body && body.owner ? String(body.owner) : "").trim().slice(0, 80);
  if (!text) return res.status(400).json({ error: "nothing to route" });

  const ip = (req.headers["x-forwarded-for"] || "").split(",")[0].trim() || "anon";
  if (rateLimited(ip)) return res.status(429).json({ error: "easy there — give it a few seconds." });

  const hook = process.env.CHERRY_SLACK_WEBHOOK;
  // Not wired up yet — tell the UI so it can show the one-line setup instead of failing.
  if (!hook) return res.status(200).json({ configured: false });

  const header = `:cherries: *New ticket from Cherry*${owner ? ` — _${owner}_` : ""}${title ? `\n*${title}*` : ""}`;
  try {
    const r = await fetch(hook, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ text: `${header}\n\n${text}` }),
    });
    if (!r.ok) throw new Error("slack returned " + r.status);
    return res.status(200).json({ configured: true, routed: true });
  } catch (e) {
    return res.status(502).json({ error: e.message || "couldn't reach the destination" });
  }
}
