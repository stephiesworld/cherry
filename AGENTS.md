# AGENTS.md

## Cursor Cloud specific instructions

Cherry is a **static frontend** (`index.html`, `scale.html`) plus a handful of
**Vercel serverless functions** in `api/` (`triage.js`, `draft.js`, `route.js`,
`judge.js`). There is **no database** and **no build step**; the project has
**zero npm dependencies** (`package.json` declares none, and there is no
lockfile). See `README.md` for the product overview and full env-var table.

### Tests / quality gate
- `npm run eval` runs the deterministic structural quality gate
  (`evals/check.mjs` over the golden fixtures). It needs **no network and no API
  key**, and is exactly what CI runs (`.github/workflows/eval.yml`). Use this as
  the primary automated test.
- `npm run judge` and `npm run eval:classify` are extra evals that **require a
  valid `ANTHROPIC_API_KEY`** (and, for classify, a running server); they cost
  real API money.

### Running the app
- The documented way is `vercel dev` (serves `index.html` + `/api/*` on
  `localhost:3000`). The Vercel CLI is installed globally (on `PATH` via
  `~/.npm-global/bin`, set in `~/.bashrc`).
- **Gotcha:** `vercel dev` requires an **interactive Vercel account login**
  (device OAuth) the first time — it cannot start unattended without credentials.
  For an unattended run, set a `VERCEL_TOKEN` / pre-link the project, or exercise
  the handlers directly (they are plain `export default (req, res)` functions and
  can be imported and called with a Vercel-style `req`/`res` shim).
- **Gotcha:** live functionality (`/api/triage`, `/api/draft`, `/api/judge`)
  requires a valid, billed `ANTHROPIC_API_KEY` (set in `.env.local` locally, or
  as an env var). Without it, `/api/triage` returns `500 server is missing its
  API key`; with an invalid key it returns `502 invalid x-api-key`. The frontend
  and backend wiring is otherwise fully functional. `web_search` additionally
  needs Anthropic account credit (see `HANDOFF.md`).
- `/api/route` (Slack routing) is optional and only active when
  `CHERRY_SLACK_WEBHOOK` is set.
