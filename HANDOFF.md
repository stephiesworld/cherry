# Handoff — Cherry (Studio Felix)

Cherry is a live customer-feedback triage tool for an Anthropic job application:
type a product → it web-searches public reviews (G2, Reddit, app stores,
Trustpilot) → returns the top 5 issues ranked by signal, each grounded in a
cited source URL, plus "what they love" and recommended next steps.
Human-in-the-loop corrections re-rank it; it's self-improving (corrections
persist in localStorage and feed back into future searches, with a
correction-rate metric) and it drafts a ticket/customer reply per issue.

## Architecture
- Static `index.html` (Studio Felix design)
- Two Vercel serverless functions:
  - `api/triage.js` — Claude + `web_search`, holds `ANTHROPIC_API_KEY` server-side
  - `api/draft.js`
- Model `claude-opus-4-8`, `web_search_20260209`
- `evals/check.mjs` is a quality gate

**The latest `cherry.zip` is the source of truth — reconcile this repo to it.**

## Deploy
This repo is connected to Vercel; pushing to `main` auto-redeploys.
`ANTHROPIC_API_KEY` is set in Vercel.

## Current blocker
On the live site the `web_search` tool returns no results ("usage quota
exhausted before any results") — suspected new-account web-search
rate/billing limit. `api/triage.js` already has a diagnostic that surfaces
the exact web-search `error_code`.

## Task for the new session
1. Reconcile this repo to the attached zip and **push directly to `main`** so
   Vercel redeploys — don't hand back zips.
2. Help get web search working (likely an account billing/tier thing — guide
   through it).

## ⚠️ Important heads-up
The new session fixes the "stop making me upload zips" problem — but it
**won't** fix the web-search error by itself, because that's an
**account/billing** issue, not a code issue. Still do the **billing check**
(payment method + credit at console.anthropic.com) — that's the actual thing
standing between you and a working live demo right now.
