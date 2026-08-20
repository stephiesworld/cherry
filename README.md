# Cherry 🍒

**Name any product. Cherry reads what the internet is saying about it, picks the
few issues worth acting on, and tells you what to do — grounded in real sources.**

Studio Felix · built on the Anthropic API.

[![eval](https://github.com/stephiesworld/cherry/actions/workflows/eval.yml/badge.svg)](https://github.com/stephiesworld/cherry/actions/workflows/eval.yml)

A live, AI-native customer-feedback triage tool — a working v1 of an operating
system for voice-of-the-customer. It **intakes** signal three ways (search the open
web, paste raw internal feedback, or **weigh both in one pass**), **synthesizes**
the noise into ranked, source-grounded issues, **routes** each to the team that
owns it, and **closes the loop** with drafts and status — with a human in the
loop at every step and evals measuring quality.

- **Intake, three ways** — search the public web, paste internal feedback (no web
  search), or **Web + yours**: one triage that tags each issue as corroborated,
  first-party only, or public only. Corroboration is a visible tie-break, not a
  hidden score. Paste-only stays for data that must not hit search.
- **Legible signal** — each issue scores severity, reach, and recency as separate
  1-5 axes; a live `Signal = severity·reach·recency` control lets you re-weight what
  "high-signal" means and the ranking re-sorts in place. No opaque number.
- **Screens out fake signal** — public reviews get gamed (bought 5-stars, planted
  1-stars, review-farm text). Cherry scores each issue's *authenticity* 1-5, weights
  verified-provenance sources (App Store, G2) over anonymous ones, collapses templated
  bot clusters, and flags issues that may not come from real users — so astroturf
  doesn't inflate your priorities.
- **Human-in-the-loop & self-improving** — disagree with a call, tell Cherry what's
  off, and it re-ranks with your judgment as ground truth. Corrections persist and
  ride along into future queries; an on-page metric shows your *correction rate dropping*.
- **Routes the work** — a one-line digest (`3 Engineering · 1 Billing · 1 Legal`)
  reframes the list into who owns what; each issue's ticket is framed for that team,
  and tickets can be **sent straight to Slack**.
- **Closes the loop** — every issue has a lifecycle (`new → triaged → routed → shipped`)
  and **Draft ticket / reply / "you said, we did" update**, so Cherry does the
  first-pass writing and you can trace signal to outcome.

## How it's wired

```
  browser (index.html)  ──POST {name, corrections}──▶  /api/triage  (serverless)
                                                          │ holds the API key
                                                          │ Claude + web search
                                                          │ → ranked, cited JSON
  ◀────────────────── clean result JSON ──────────────────┘
```

The API key lives **only** in the backend as an environment variable — never in
the browser, never in the repo. Corrections persist client-side (localStorage)
and are sent up as learned context, so there's no database to provision. The
model's answer is **schema-enforced** (Anthropic structured outputs, `output_config.format`)
so the response is always valid JSON in the triage shape — no parsing free text.
Each issue must carry a real source URL or it's dropped, and an automated **eval
gates every change in CI** (`evals/check.mjs`).

## Run it locally

```bash
cp .env.example .env.local      # put your real ANTHROPIC_API_KEY in it
npm i -g vercel                 # one-time
vercel dev                      # serves index.html + /api/triage on localhost
```

Open the local URL, type "Notion", and you'll get a live, cited result.

## Deploy it (Vercel — ~5 clicks)

1. Push these files to a GitHub repo (e.g. `stephiesworld/cherry`) — `index.html`
   at the **root**, with the `api/` folder alongside.
2. Go to **vercel.com** → sign in with GitHub → **Add New… → Project** → import
   the repo.
3. Framework preset: **Other** (no build step — it's static + one function).
4. **Environment Variables** → add `ANTHROPIC_API_KEY` = your key. **Deploy.**
5. You get a public URL like `cherry-xxxx.vercel.app`. Type a product to test.
6. *(optional, recommended)* add `CHERRY_ALLOW_ORIGIN=https://<your-url>` and
   redeploy to lock the backend to your own site.

Every push to the repo auto-redeploys.

## Config (all optional — defaults are sensible)

| Env var | Default | What it does |
|---|---|---|
| `ANTHROPIC_API_KEY` | — | **Required.** Your key; backend-only. |
| `CHERRY_MODEL` | `claude-sonnet-4-6` | Fits the free-tier 60s limit. Set `claude-opus-4-8` on Vercel Pro. |
| `CHERRY_MAX_SEARCHES` | `3` | Web searches per query (the main cost/time lever). `3` keeps comfortable headroom under the free-tier 60s limit; raise on Vercel Pro. |
| `CHERRY_DAILY_CAP` | `200` | Hard ceiling on triage queries/day (abuse guard). |
| `CHERRY_DRAFT_DAILY_CAP` | `300` | Hard ceiling on draft requests/day. |
| `CHERRY_PER_IP_PER_MIN` | `6` | Per-visitor rate limit. |
| `CHERRY_ALLOW_ORIGIN` | `*` | Lock CORS to your site in production. |
| `CHERRY_SLACK_WEBHOOK` | — | Slack Incoming Webhook URL; enables "Send to Slack" routing. |

## Cost & safety

Roughly **$0.15–0.20 per query** (the web search is most of it; the model adds
~5¢). A handful of users clicking around ≈ a few dollars. The guards
that keep it there: identical product names are **cached 24h** (repeat plays are
free), a **per-IP rate limit**, and a **hard daily cap**. As a backstop, set a
spend limit on your key in the Anthropic Console. The in-memory cache/limiter is
per-instance — fine for a portfolio tool; back it with Vercel KV for real scale.

## Quality gate (evals)

Two layers — structure and quality:

```bash
npm run eval          # check.mjs  — structural contract (deterministic, runs in CI)
npm run judge         # judge.mjs  — LLM-as-judge synthesis quality (needs ANTHROPIC_API_KEY)
```

**`check.mjs`** treats the triage output as a product with a contract and fails
loudly when it's violated: every issue grounded in a real source, severities in
range, the list actually ranked, every action justified. It **runs automatically
in CI on every push** (`.github/workflows/eval.yml`), so a change that breaks the
contract fails the build before it ships — closed-loop quality, not vibes.

**`judge.mjs`** goes further: a second Claude call grades *synthesis quality* —
clustering, ranking defensibility, routing correctness, grounding, actionability
— each 1-5 against a rubric, and appends the score to `judge-history.jsonl` so
the trend is visible as the prompt evolves. That's the harder eval problem:
catching a triage that's structurally valid but *worse*. (`golden.json` is an
illustrative recorded result; pipe a live one in with `curl … | node evals/check.mjs -`.)

## Files

| Path | What |
|---|---|
| `index.html` | The front end (Studio Felix design; calls its own backend). |
| `api/triage.js` | Triage backend: web, paste, or fused (web + yours) intake, structured-output JSON, memory, guards. |
| `api/draft.js` | Drafts a ticket (framed for the owning team), customer reply, or "you said, we did" update. |
| `api/route.js` | Routes a drafted ticket to Slack (`CHERRY_SLACK_WEBHOOK`). |
| `evals/check.mjs` + `golden.json` / `golden-duolingo.json` / `golden-fused.json` | Structural quality gate (CI). |
| `evals/judge.mjs` | LLM-as-judge synthesis-quality eval. |
| `DESIGN.md` | The brand system. |

— Built with Claude. Studio Felix.
