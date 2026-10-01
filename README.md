# Cherry 🍒

Cherry is a customer-feedback triage tool. Give it a product name and it reads
what people are saying about that product online, groups the complaints into
issues, ranks them, and suggests who should act on each one. Every issue links
back to the sources it came from.

Studio Felix · built on the Anthropic API.

[![eval](https://github.com/stephiesworld/cherry/actions/workflows/eval.yml/badge.svg)](https://github.com/stephiesworld/cherry/actions/workflows/eval.yml)

## What it does

- **Two ways in.** Search the public web for a product, or paste your own
  feedback (a Slack thread, support tickets, sales-call notes) and Cherry
  triages that directly without searching.
- **A score you can read.** Each issue gets separate 1–5 ratings for severity,
  reach and recency. Sliders let you change how much each one counts, and the
  list re-sorts as you move them. Team views (Product, GTM, Research, Support)
  are preset weightings.
- **Filters out fake reviews.** Public reviews get gamed: bought 5-star reviews,
  planted 1-star ones, text from review farms. Cherry gives each issue an
  authenticity score from 1 to 5, trusts verified sources (App Store, G2) more
  than anonymous ones, merges templated bot text, and flags issues that may not
  come from real users.
- **Learns from corrections.** If you disagree with a call, tell Cherry what's
  wrong and it re-ranks with your correction treated as correct. Corrections are
  saved and sent along with future searches, and the page shows your correction
  rate over time.
- **Routes the work.** A one-line summary (`3 Engineering · 1 Billing · 1 Legal`)
  shows who owns what. Each issue can produce a ticket written for its owning
  team, and tickets can be sent to Slack.
- **Tracks what happens next.** Each issue moves through
  `new → triaged → routed → shipped`, and Cherry can draft a ticket, a reply to
  the customer, or a "you said, we did" update.

## How it's wired

```
  browser (index.html)  ──POST {name, corrections}──▶  /api/triage  (serverless)
                                                          │ holds the API key
                                                          │ Claude + web search
                                                          │ → ranked, cited JSON
  ◀────────────────── result JSON ────────────────────────┘
```

The API key lives only in the backend as an environment variable. It is never
sent to the browser or committed to the repo.

Corrections are stored in the browser (localStorage) and sent with each request
as context, so there's no database to set up.

The model's response is constrained to a JSON schema (Anthropic structured
outputs, `output_config.format`), so it always comes back in the triage shape
and nothing has to be parsed out of free text. Any issue without a real source
URL is dropped. An eval (`evals/check.mjs`) runs in CI and fails the build if
the output breaks that contract.

Three smaller endpoints sit alongside `/api/triage`: `/api/draft` writes
tickets and replies, `/api/route` posts a ticket to Slack, and `/api/judge`
grades a result for the "Synthesis quality" card.

## Run it locally

```bash
cp .env.example .env.local      # put your real ANTHROPIC_API_KEY in it
npm i -g vercel                 # one-time
vercel dev                      # serves index.html + the api/ functions on localhost
```

Open the local URL and type "Notion" to get a live result with sources.

## Deploy to Vercel

1. Push the repo to GitHub, with `index.html` at the root and the `api/` folder
   next to it.
2. On vercel.com, sign in with GitHub, choose **Add New… → Project**, and import
   the repo.
3. Set the framework preset to **Other**. There's no build step: it's static
   files plus serverless functions.
4. Under **Environment Variables**, add `ANTHROPIC_API_KEY` with your key, then
   deploy.
5. Vercel gives you a public URL like `cherry-xxxx.vercel.app`. Type a product
   name to test it.
6. Optional but recommended: add `CHERRY_ALLOW_ORIGIN=https://<your-url>` and
   redeploy, so the backend only accepts requests from your own site.

Vercel redeploys automatically on every push.

## Configuration

Only the API key is required. Everything else has a default.

| Env var | Default | What it does |
|---|---|---|
| `ANTHROPIC_API_KEY` | none | **Required.** Your API key. Backend only. |
| `CHERRY_MODEL` | `claude-sonnet-4-6` | Model for triage, drafts and the in-app judge. The default fits Vercel's free-tier 60-second limit; set `claude-opus-4-8` on Vercel Pro. |
| `CHERRY_MAX_SEARCHES` | `3` | Web searches per query. This is the main cost and time lever; 3 stays well under the free-tier limit. |
| `CHERRY_DAILY_CAP` | `200` | Maximum triage queries per day. |
| `CHERRY_DRAFT_DAILY_CAP` | `300` | Maximum draft requests per day. |
| `CHERRY_JUDGE_DAILY_CAP` | `400` | Maximum quality-grading requests per day. |
| `CHERRY_PER_IP_PER_MIN` | `6` triage, `12` others | Requests per minute per visitor. |
| `CHERRY_ALLOW_ORIGIN` | `*` | Which site may call the backend (CORS). Set it to your URL in production. |
| `CHERRY_SLACK_WEBHOOK` | none | A Slack Incoming Webhook URL. Turns on "Send to Slack". |

The eval scripts read two more: `CHERRY_JUDGE_MODEL` (model for
`evals/judge.mjs`, default `claude-sonnet-4-6`) and `CHERRY_URL` (the deployment
`evals/classify.mjs` calls, default `http://localhost:3000`).

## Cost and limits

A query costs roughly $0.15–0.20. Most of that is the web search; the model adds
about 5¢. A few people trying it out costs a few dollars.

Three things keep it there: results for the same product name are cached for
24 hours, so repeat searches are free; each visitor is rate-limited; and there's
a hard daily cap. Also set a spend limit on your key in the Anthropic Console as
a backstop.

The cache and rate limiter live in memory on each serverless instance. That's
fine for a portfolio project; at real scale, move them to a shared store such as
Vercel KV. [Scaling notes](scale.html) covers this and the other places v1 would
need to change.

## Evals

```bash
npm run eval            # check.mjs: output contract, deterministic, runs in CI
npm run eval:classify   # classify.mjs: classification accuracy against labeled cases
npm run judge           # judge.mjs: LLM-graded synthesis quality (needs ANTHROPIC_API_KEY)
```

**`check.mjs`** checks that the triage output keeps its contract: every issue
has a real source, severities are in range, the list is actually ranked, and
every action has a reason. CI runs it on pushes to `main` and on pull requests
(`.github/workflows/eval.yml`), so a prompt or model change that breaks the
contract fails before it ships. It runs against two recorded results,
`golden.json` (Notion) and `golden-duolingo.json`. To check a live result, pipe
it in: `curl … | node evals/check.mjs -`.

**`classify.mjs`** checks whether Cherry put issues in the right category. It
sends the short labeled cases in `labeled.json` to a running deployment and
compares disposition, signal type and owner with the human labels. The most
useful output is the list of categories it confuses with each other, because
that shows which definition in the prompt needs tightening.

**`judge.mjs`** uses a second Claude call to grade the quality of a triage on
clustering, ranking, routing, grounding and actionability, each from 1 to 5. It
appends each score to `judge-history.jsonl`, so you can see whether prompt
changes make results better or worse. This catches results that are valid but
worse, which `check.mjs` can't.

## Files

| Path | What |
|---|---|
| `index.html` | The app front end. Calls its own backend. |
| `scale.html` | Scaling notes: where v1 breaks at scale and what v2 would change. |
| `api/triage.js` | Triage backend: web search or pasted feedback, structured JSON output, memory, rate limits. |
| `api/draft.js` | Drafts a ticket for the owning team, a customer reply, or a "you said, we did" update. |
| `api/route.js` | Sends a drafted ticket to Slack (`CHERRY_SLACK_WEBHOOK`). |
| `api/judge.js` | Grades a triage result for the in-app "Synthesis quality" card. |
| `evals/check.mjs` | Output contract check (CI), run against `golden.json` and `golden-duolingo.json`. |
| `evals/classify.mjs` | Classification accuracy eval, using `labeled.json`. |
| `evals/judge.mjs` | LLM-graded synthesis quality eval. |
| `DESIGN.md` | Design system: tokens, type, components, voice. |
| `DECISIONS.md` | Log of product decisions and the reasons for them. |
| `HANDOFF.md` | Project handoff notes. |
