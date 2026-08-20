# Decision log

A short record of the product decisions behind Cherry — the *why*, not just the
*what*. Newest first.

---

## 2026-08-11 · What changed since last run — identity, worse, and a tested matcher

**Context.** Trend vs last check already stored a per-product title snap and labeled
new / recurring / resolved. Titles get reworded between model runs, so exact-string
identity is the wrong key — and without scores on the snap, "gotten worse" was
impossible. Putting the matcher inline in `index.html` also left deterministic logic
untested in CI.

**Decisions.**

1. **Identity = significant-token overlap + greedy 1:1 + host tie-break.** Normalize
   titles (words >3 chars, sorted, top 5). Pair when exact norm match or ≥2 shared
   tokens; assign greedily so two near-duplicate current titles can't both claim one
   prior. On score ties, prefer overlapping evidence hostnames. No embeddings, no second
   Claude call — dependency-free and honest for a top-5 list.

2. **"Worse" is conjunction, not disjunction.** Flag only when severity rises by ≥1
   **and** `(severity + reach + recency)` rises by ≥2. A lone severity +1 on a 1–5 scale
   is within run-to-run model noise; requiring the composite bump filters phantom
   regressions. The tradeoff: a real single-axis regression (severity up, reach/recency
   flat) will not badge as worse. Title-only legacy snaps never flag worse.

3. **`savedAt` + prose summary; badges only for change.** Snapshots carry run-level
   `savedAt` (legacy `at` still read). Copy reads `2 new issues, 1 worsened, 1 resolved
   since Aug 4`, or `since last run` when no timestamp. Only `▲ new` and `▲ worse`
   badges — absence means same. Resolved titles appear in the Gone clause, not as cards.

4. **Harder snap keys + dev `?nocache=1`.** Product snap keys trim and collapse
   whitespace before lowercasing. The 24h server result cache would otherwise echo the
   same JSON on a same-name re-run; a non-production `?nocache=1` query (forwarded from
   the page URL) skips cache read and write so local diffs are real. Ignored in production.

5. **Matcher extracted to `trend.js` and gated in CI.** Pure functions live in
   `trend.js`; `evals/trend-check.mjs` covers competitor titles, reword matches,
   title-only snaps, and the worse boundary — wired into `npm run eval` alongside
   `check.mjs`. Single-file purity wasn't worth an untested algorithm.

**The honest tradeoff.** Still a single-browser prior, not team velocity. Stricter
"worse" prefers fewer false alarms over catching every soft regression.

---

## 2026-07-08 · Three cuts deeper — persona views, a review queue, and trend

**Context.** Cherry already intakes, scores, routes, and closes the loop. The gaps left
weren't about *more* triage — they were about *reach* (who the triage serves), *where human
attention should go*, and *time* (is this getting better or worse?).

**Trigger.** Re-reading the role: "one shared platform every team plugs into," "humans focus
on verification and judgment, not triage," and health metrics like time-to-triage and signal
quality. A single ranked list serves a PM well but under-serves GTM, Research, and Support —
it treats every issue as equally worth a human's time, and every run as a fresh snapshot with
no memory of last week.

**Decisions.**

1. **Persona views — one triage, four cuts.** The same issues, re-weighted for who's acting:
   Product ranks by user pain, GTM by breadth and freshness (what to get ahead of in renewals),
   Support by how sharply it stings right now, Research by systemic, authentic signal. Crucially
   this *reuses the transparent signal weights* instead of inventing a new hidden score — each
   persona is a weighting preset with a plain-English caption, and you can still drag the sliders
   to a custom cut. "High-signal" gets defined per audience, in the open.

2. **Active-learning review queue.** Cherry scores each issue's confidence (authenticity +
   evidence density + overall thinness) and surfaces the *least* confident first — a "review
   first" callout plus a per-card badge. It's triage of the triage: send scarce human judgment
   to the shaky calls, not to re-checking the obvious ones. The human-in-the-loop model, pointed
   at the issues where a human actually moves the needle.

3. **Trend vs last check.** On a repeat run for a product, Cherry diffs against the last snapshot
   and reports new / recurring / resolved, tags new issues, and names what's gone. Proportion over
   time, not just a point-in-time list — the start of velocity.

**The honest tradeoff.** All three are client-side and honest about their limits. The
review-queue confidence is a heuristic, not a calibrated probability. Trend compares *your own*
prior result (stored locally), so it's real but single-user, single-machine — true cross-team
velocity, regression alerts, and "spiking this week" at scale need the persistent store v2 would
add (the same database the integration entry points to). I built the honest version rather than
fake a dashboard of invented history.

**What it demonstrates.** Treating the feedback loop as a product with *users* — four of them,
each with a different job — deciding where automation earns a human's attention and where it
doesn't, and measuring change over time. The operating instincts the role names, shipped as
working software rather than described.

---

## 2026-07-08 · Closing the loop for real — connect to systems of record, don't rebuild them

**Context.** Cherry's v1 is deliberately self-contained: it web-searches or takes pasted
text, and "Send to Slack" is the one live integration. That's the right scope for a demo,
but it raises the obvious production question — *where does this actually plug in?*

**Trigger.** Two questions that a real deployment forces: (1) once an issue is routed to a
team, how does its status get back to *shipped* without someone manually updating Cherry?
(2) the richest customer signal isn't on the open web at all — it's in the company's own
Slack, Gong calls, CRM, support tickets, and data warehouse. A tool that can't reach those
is triaging the shallow end of the pool.

**The insight.** Cherry should be the **synthesis and judgment layer**, not another system
of record teams have to maintain by hand. Every "update Cherry manually" step is a
documentation tax that guarantees the data goes stale. The design principle: **pull signal
*from* the systems where customers already speak, push work *to* the systems where teams
already work, and let status flow *back* automatically.** Cherry sits in the middle and
adds the one thing those systems don't — *which few things matter and why*.

**Decision (the integration architecture).** Three connection surfaces, all thin adapters
around the same triage core:

1. **Intake connectors — pull signal from where it lives.** Beyond web search and paste:
   - **Slack** — watch a `#feedback`/`#support` channel; new messages stream into intake.
   - **Gong** — pull call transcripts so sales/CS voice-of-customer is triaged, not lost.
   - **CRM (Salesforce/HubSpot)** — read opportunity-loss reasons and account notes.
   - **Support (Zendesk/Intercom)** — the highest-authenticity first-party signal there is.
   Each is a small adapter that normalizes its source into the same feedback shape the
   triage already accepts — the core doesn't change, only the front door.

2. **Status sync — no manual documentation tax.** When an issue is routed, Cherry files
   the work item in the **system of record for engineering work (Linear/Jira)** and stores
   the returned work-item ID against the issue. Status (`triaged → routed → shipped`) then
   **flows automatically from that link** — Cherry reads the ticket's state; a human never
   re-types it. Cherry does *not* read anyone's email or guess; it connects to the one
   place work status is authoritative.

3. **Warehouse sync — first-party signal at scale.** For volume beyond what a live call can
   read, Cherry connects to the company's **data warehouse (Snowflake / BigQuery /
   Databricks)**. The pattern is the scaling pattern: cheap SQL and coded rules shrink
   millions of rows (reviews, tickets, NPS verbatims) to the slice that needs judgment, and
   *that* slice goes to the model — never the raw millions. Triaged issues and their
   lifecycle write **back** to the warehouse so they're queryable and trendable alongside
   the rest of the business's data.

**The honest tradeoff.** None of this is wired in v1 — it's the architecture, not the
build. Each connector is real engineering (auth, rate limits, schema mapping, a persistent
store to replace localStorage). But the *shape* is deliberate and load-bearing: keeping
the triage core source-agnostic (it already accepts normalized feedback via paste mode)
means every one of these is an adapter, not a rewrite. The Slack routing that *is* live —
and its graceful "not configured yet" handling — is the working proof of the pattern.

**What it demonstrates.** Understanding that a feedback-loops tool's value is being the
*connective synthesis layer* across a company's existing stack — meeting teams in Slack,
Gong, the CRM, the warehouse, and Linear/Jira rather than asking them to adopt and hand-
maintain yet another tool. That "integrate with the system of record, don't recreate it"
instinct is the difference between a product ops function that scales and one that becomes
a manual-update bottleneck.

---

## 2026-07-01 · Authenticity: is this feedback even from real people?

**Context.** Cherry's web triage pulls "real customer feedback" from public review sites.
But public reviews are gamed at scale — vendors buy 5-stars, competitors plant 1-stars,
and review farms mass-produce text. If astroturf drives an issue, Cherry prioritizes a
problem that doesn't exist.

**Trigger.** The question "how do we ensure the feedback we've taken in isn't written by
bots?" Selection bias (the prior entry) fixes *who shows up to complain*; it does nothing
about *feedback that was never a real customer at all*.

**Options weighed.** (a) A separate classifier/API call per review — accurate but slow,
costly, and another dependency for a no-DB portfolio tool. (b) Hard-block sources — too
blunt; even gamed venues carry real complaints. (c) Fold it into synthesis: the model
already reads every review, and LLMs are good at spotting templated/duplicate text,
detail-free superlatives, and timing bursts.

**Decision.** Extend the synthesis prompt, mirroring the source-bias pattern. The model
scores each issue's **authenticity** 1-5, weights verified-provenance sources (App Store,
Google Play, G2/Capterra, verified-purchase) over anonymous open-submission venues,
**collapses** near-duplicate bot clusters to a single low-confidence mention, and refuses
to let suspect signal inflate reach/prevalence/severity. The UI flags shaky issues
(`⚠ maybe not genuine`) and warns when the triage leans on suspect signal; the eval gate
now requires the field.

**The honest tradeoff.** This *reduces and surfaces* bot contamination — it doesn't
guarantee zero. Model-judged authenticity is a heuristic, not proof. The strongest lever
stays provenance and first-party data (your own tickets, verified-purchase surveys via
"Paste feedback"), which the warning points users toward rather than pretending the open
web is clean.

**What it demonstrates.** Taking a trust question seriously enough to build a defensible,
transparent answer — down-weight and disclose — instead of laundering scraped reviews as
ground truth.

---

## 2026-06-30 · Source bias: the open web skews negative

**Context.** Cherry's web triage searches public sources for real customer feedback.

**Trigger.** Reading a ChatGPT triage, most of the evidence came from Trustpilot and
other complaint sites — which paints an overly negative picture. People don't post to
Trustpilot after a good session; they go there to *vent*. So those venues are
self-selected toward furious users (a J-shaped rating curve), and a product with
hundreds of millions of mostly-happy users looks far worse there than it is.

**The insight.** Cherry is a *complaint-triage* tool, so some negativity is by design —
but a complaint-skewed **source mix** corrupts the thing it tries hardest to get right:
*how widespread is this, really?* An issue that's loud on Trustpilot but rare everywhere
else gets an inflated `reach`/`prevalence`. The skew doesn't just make it negative; it
makes its sense of *proportion* unreliable. (App Store reviews help — bigger pool, a star
rating for context — but they carry their own biases, e.g. review-gating, so the answer
is *diversity + transparency*, not swapping one biased source for another.) The truest
read is first-party data — your own support/survey channels — which is exactly the
"Paste feedback" mode and the thesis of the role this was built for.

**Decision.** Three fixes, attacking the bias at the input, the warning, and the display:

1. **De-bias the prompt** — explicitly balance sources (App Store, Reddit, G2, press —
   not just complaint aggregators) and calibrate `reach`/`prevalence` by likely base
   rate, never by how loud a complaint is on a venting site.
2. **A skew warning** — when the evidence is mostly complaint sites, Cherry says so:
   *"Reads more negative than reality — X% from complaint sites; treat severity as real,
   prevalence as a ceiling."*
3. **Show the source mix** — an "evidence base" strip listing the platforms (complaint
   sites flagged), so the bias is visible and you can discount it yourself. In paste
   mode it instead affirms the data is first-party — the representative kind.

**What it demonstrates.** Recognizing that *every public source is a self-selected slice*,
and designing for representativeness instead of taking volume at face value, is the core
of defining what "high-signal" means. The fix doesn't hide the bias — it surfaces it and
calibrates around it.

---

## 2026-06-30 · Routing: a primary owner *plus* stakeholders, not one team

**Context.** Cherry routes every triaged issue to the team that should own it, and
shows a "Routes to" digest so a PM can see who owns what at a glance. Each issue
carried exactly one `owner`.

**Trigger.** Testing Adobe, Cherry routed *"predatory cancellation fees"* to
**Leadership** and tagged it an *intentional tradeoff*. I tried "correcting" it to
**Legal** — there's an active FTC lawsuit — and the synthesis-quality score
*dropped* (4.4 → 4.2). That nudge sent me back to the real question: who actually
owns this?

**The insight.** It's both — but they own different things:

- **Legal** owns the *risk*: the lawsuit, compliance, exposure.
- **Leadership** owns the *decision*: whether to change a profitable-but-hated
  practice. Legal can't make that call — it's a business-model choice.

Forcing a single owner made Cherry pick a side on a question that has two correct
answers for two different jobs. That's a routing model that loses real org nuance.

**Decision.** Split routing into **a primary owner (who owns the fix or the
decision) + 0–3 stakeholders (other teams who must be looped in).**

- Cancellation fees → owner **Leadership**, stakeholder **Legal**.
- A checkout bug → owner **Engineering**, stakeholder **Billing**.

**Why not just allow multiple owners?** Accountability blurs when everyone owns it.
One owner *acts*; stakeholders are *consulted*. Keeping that line sharp is the
whole point — the digest still answers "who owns the most," and the ticket still
has one clear assignee.

**Result.** Routing now mirrors how decisions actually get made in an org. The
drafted ticket lists stakeholders to loop in, and the quality gate (`evals/check.mjs`)
enforces a valid owner-plus-stakeholders shape (stakeholders never repeat the owner).

**What it demonstrates.** The tool surfaced a genuinely hard judgment call; a human
caught that it was forcing a false binary (Legal *or* Leadership); and the system
was changed to model reality — owner *and* stakeholders. Voice-of-customer routing
with real org nuance, not "dump it on a team." It also shows the measured learning
loop earning its keep: the quality score *dropping* on a bad correction is what
pointed at the design flaw in the first place.

---

## 2026-06-30 · The measured learning loop — proving "it gets better"

**Context.** Cherry's pitch is "Claude proposes, you correct, the system improves."
That was a claim with nothing behind it.

**Decision (first pass).** Add a second, independent Claude call — an *LLM-as-judge* —
that grades each triage's synthesis quality (grounding, clustering, ranking, routing,
actionability) 1–5 against a rubric. Show a scorecard; when the reviewer corrects and
re-ranks, re-grade and show the delta.

**The honest finding.** On a live before/after, the score went *down* (4.4 → 4.2)
after a correction — not because the correction was bad, but because a correction
re-ran the *entire* triage from scratch. The grader was comparing two different random
drafts, not measuring the correction. The signal was swamped by regeneration noise.

**The fix.** *Revise-in-place*: a correction now applies the reviewer's judgment to the
**existing** triage and changes only what's required (no re-search, no rewrite). The
grade then reflects *only* the correction. Re-tested: fixing a genuinely mis-routed bug
moved the score 2.0 → 2.8 (+0.8), cleanly — and it's faster, too.

**Why it matters.** This is the role's core — "closed-loop data that makes synthesis
quality measurably improve." It's now a measured fact, not a claim. The honesty is
load-bearing: the judge is independent, so the number only rises when a correction
genuinely helps. I kept the down-result rather than re-rolling for a flattering
screenshot — a measurement you can trust beats a demo that always flatters.

**What it demonstrates.** Built an eval (LLM-as-judge), found it was noisy, diagnosed
*why*, and fixed the measurement so it's both honest and reliable.

---

## 2026-06-30 · Disposition — not every loud complaint is a bug to fix

**Context.** Cherry ranks issues and routes them to a team. Implicitly, every issue
read as "a thing to fix."

**Trigger.** Adobe's #1 complaint — predatory cancellation fees — was being framed as
a fix-it ticket. But that's not a bug; it's an *intentional business decision*. Adobe's
leadership knows about it and chose it. "Fix the cancellation fees" misframes the work.

**The insight.** A feedback system has to tell apart two very different things:

- a **fixable gap** — a bug or missing feature the team would want to close, and
- an **intentional tradeoff** — a deliberate choice customers hate but the company made
  on purpose (aggressive pricing, dark patterns).

They need different actions and different owners. A gap → a fix, routed to the team. A
tradeoff → a strategy/risk call, routed to Leadership/Legal, not a "fix it" ticket for
whoever built it.

**Decision.** Make disposition a first-class field — `fixable gap` | `intentional
tradeoff` — shown as a badge that drives both the action framing and the routing.

**Result.** Verified live: cancellation fees → *intentional tradeoff* → Leadership with
an FTC-framed action ("review the ETF policy"), while crashes → *fixable gap* →
Engineering.

**What it demonstrates.** Defining what "actionable" even *means* — the difference
between a fix and a strategic tension — is exactly the judgment voice-of-customer work
requires. It came from questioning the tool's framing, not accepting it.

---

## 2026-06-30 · 3 vs 5 web searches — depth vs reliability under a real constraint

**Context.** Each triage lets Claude run web searches to find real feedback. More
searches = deeper coverage, but each adds ~10–15s, and the free hosting tier kills any
request past 60s.

**The data.** 5 searches blew past 60s and timed out. 3 lands ~38–40s with ~20s of
headroom and still pulls feedback from 6+ platforms into a full, cited result. 4
(~46–54s) occasionally brushed the limit and failed — the worst outcome for a demo.

**Decision.** Default to **3**. A triage that *always* returns in ~40s beats one that's
marginally deeper but sometimes fails in front of a hiring manager. The count is an env
var, so it's one flip to 5 on a paid tier (300s limit) — no code change.

**The honest tradeoff.** I measured what 5 would add: not *more* issues (the output caps
at 5 either way), but slightly richer grounding and a marginally better shot at a quieter
issue. The major issues surface in the first 1–3 searches regardless. So 3 captures what
matters; the depth of 5 only pays off for thin-feedback products or a deep audit —
exactly when you'd upgrade the tier anyway.

**What it demonstrates.** Choosing the right operating point under a hard constraint,
backed by real timing and quality data — and knowing precisely what the cheaper choice
gives up, instead of guessing.
