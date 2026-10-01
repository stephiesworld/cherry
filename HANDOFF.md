# Handoff: Cherry (Studio Felix)

Notes for whoever picks up Cherry next, whether that's a person or a new coding
session.

## What it is

Cherry is a customer-feedback triage tool, built as part of an Anthropic job
application. You type a product name, it searches public reviews (G2, Reddit,
app stores, Trustpilot), and it returns the top five issues ranked by signal,
each with links to its sources, plus what customers like and suggested next
steps. You can also paste your own feedback instead of searching.

Reviewers can correct any issue and Cherry re-ranks with the correction.
Corrections are saved in the browser and sent with later searches, and the page
tracks how often you correct it. For each issue it can draft a ticket, a
customer reply or a "you said, we did" update.

## How it's built

- `index.html`: the app, a static page with no build step.
- `scale.html`: scaling notes, where v1 breaks at scale and what v2 would change.
- Four Vercel serverless functions in `api/`:
  - `triage.js`: calls Claude with the `web_search` tool (`web_search_20250305`).
    It holds `ANTHROPIC_API_KEY`, which never reaches the browser.
  - `draft.js`: tickets, replies and updates.
  - `route.js`: sends a drafted ticket to Slack.
  - `judge.js`: grades a result for the "Synthesis quality" card.
- Model: `claude-sonnet-4-6` by default, set with `CHERRY_MODEL`. It fits the
  free tier's 60-second limit; use `claude-opus-4-8` on Vercel Pro.
- Evals: `evals/check.mjs` runs in CI on pushes to `main` and on pull requests.
  `classify.mjs` and `judge.mjs` are run by hand. See the README.

The GitHub repo is the source of truth. Make changes on a branch, open a pull
request, and merge to `main`.

## Deploying

The repo is connected to Vercel. Merging to `main` redeploys the live site, and
each pull request gets a preview deployment. `ANTHROPIC_API_KEY` is set in the
Vercel project. All other settings are optional; the README lists them.
