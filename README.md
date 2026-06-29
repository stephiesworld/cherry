# Cherry 🍒

**Name any product. Cherry reads what the internet is saying about it, picks the
few issues worth acting on, and tells you what to do — grounded in real sources.**

Studio Felix · built on the Anthropic API.

A live, AI-native customer-feedback triage tool: enter a product → Cherry
searches the open web (reviews, Reddit, forums, app stores, social), clusters
the noise into ranked issues, recommends next steps with reasoning, and cites a
source for every issue. Human-in-the-loop: disagree with a call, tell Cherry
what's off, and it re-ranks with your judgment as ground truth.

It also **learns** and **acts**:
- **Self-improving** — corrections persist in your browser, accumulate across
  searches, and ride along into future queries as learned preferences. A small
  on-page metric shows your *correction rate dropping* as Cherry adapts.
- **Drafts the next step** — every issue has **Draft ticket** / **Draft reply**:
  Cherry turns a triaged issue into a paste-ready engineering ticket or a customer
  response, so it does the first-pass writing, not just the analysis.

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
and are sent up as learned context, so there's no database to provision. Each issue must carry a real
source URL or it's dropped (`evals/check.mjs` enforces that contract).

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
| `CHERRY_MODEL` | `claude-opus-4-8` | Flip to `claude-sonnet-4-6` to cut cost. |
| `CHERRY_MAX_SEARCHES` | `5` | Web searches per query (the main cost lever). |
| `CHERRY_DAILY_CAP` | `200` | Hard ceiling on triage queries/day (abuse guard). |
| `CHERRY_DRAFT_DAILY_CAP` | `300` | Hard ceiling on draft requests/day. |
| `CHERRY_PER_IP_PER_MIN` | `6` | Per-visitor rate limit. |
| `CHERRY_ALLOW_ORIGIN` | `*` | Lock CORS to your site in production. |

## Cost & safety

Roughly **$0.15–0.20 per query** (the web search is most of it; the model adds
~5¢). A handful of hiring managers clicking around ≈ a few dollars. The guards
that keep it there: identical product names are **cached 24h** (repeat plays are
free), a **per-IP rate limit**, and a **hard daily cap**. As a backstop, set a
spend limit on your key in the Anthropic Console. The in-memory cache/limiter is
per-instance — fine for a portfolio tool; back it with Vercel KV for real scale.

## Quality gate (evals)

```bash
npm run eval          # node evals/check.mjs evals/golden.json
```

Treats the triage output as a product with a contract and fails loudly when it's
violated: every issue grounded in a real source URL, severities in range, the
list actually ranked by signal, every action justified. Run it over recorded
outputs in CI before trusting a prompt/model change. (`golden.json` is an
illustrative recorded result.)

## Files

| Path | What |
|---|---|
| `index.html` | The front end (Studio Felix design; calls its own backend). |
| `api/triage.js` | Triage backend: key + prompt + Claude/web-search + memory + guards. |
| `api/draft.js` | Drafts an engineering ticket or customer reply from an issue. |
| `evals/check.mjs` + `golden.json` | The quality gate. |
| `DESIGN.md` | The brand system. |

— Built with Claude. Studio Felix.
