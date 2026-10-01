# Decision log

The product decisions behind Cherry and the reasons for them. Newest first.

---

## 2026-07-08 · Persona views, a review queue, and trends

**Context.** Cherry could already take in feedback, score it, route it and track
it to done. What it lacked was about who the results serve, where people should
spend their review time, and whether things are getting better or worse.

**What prompted it.** The role description talks about "one shared platform every
team plugs into", "humans focus on verification and judgment, not triage", and
health metrics like time-to-triage and signal quality. A single ranked list works
for a PM but not as well for GTM, Research or Support. It also treats every issue
as equally worth a person's time, and every run as a fresh snapshot with no memory
of last week.

**Decisions.**

1. **Persona views: one triage, four weightings.** The same issues, re-weighted
   for whoever is acting on them. Product ranks by user pain, GTM by breadth and
   freshness (what to get ahead of before renewals), Support by how badly it hurts
   right now, and Research by recurring, genuine patterns. Each persona is a preset
   of the existing signal sliders with a one-line caption, not a new hidden score,
   and you can still drag the sliders to make your own.

2. **A review queue for the least confident calls.** Cherry estimates its
   confidence in each issue from authenticity, how much evidence there is, and how
   thin the result is overall. The least confident issues get a "review first" note
   and a badge on the card, so people spend their review time on the shaky calls
   instead of re-checking the obvious ones.

3. **Trend since the last check.** When you run the same product again, Cherry
   compares the result with your previous one and reports which issues are new,
   which recur and which have gone, and tags the new ones.

**Tradeoffs.** All three run in the browser. The confidence score is a heuristic,
not a calibrated probability. Trends compare against your own previous result
stored locally, so they're real but limited to one person on one machine.
Cross-team trends, regression alerts and "spiking this week" views need the
shared store described in v2 (the same database the integration entry below needs).
I built the limited version rather than fake a dashboard with invented history.

---

## 2026-07-08 · Connect to existing systems instead of rebuilding them

**Context.** Cherry v1 is self-contained on purpose. It searches the web or takes
pasted text, and "Send to Slack" is its one live integration. That's the right
scope for a demo, but it leaves open where Cherry would plug in for real.

**What prompted it.** Two questions any real deployment raises. First, once an
issue is routed to a team, how does its status get back to *shipped* without
someone updating Cherry by hand? Second, the best customer feedback usually isn't
on the open web. It's in the company's own Slack, Gong calls, CRM, support tickets
and data warehouse, and a tool that can't reach those only sees the surface.

**Approach.** Cherry should be the layer that synthesizes and judges feedback, not
another system teams have to keep up to date by hand. Any step that says "update
Cherry manually" will be skipped and the data will go stale. So: pull feedback from
the tools where customers already talk, push work to the tools where teams already
work, and let status sync back automatically. Cherry adds the one thing those
systems don't: which few issues matter and why.

**Decision.** Three kinds of connection, each a small adapter around the same
triage core:

1. **Intake connectors.** Beyond web search and paste:
   - **Slack:** watch a `#feedback` or `#support` channel and stream new messages
     into intake.
   - **Gong:** pull call transcripts so what customers tell sales and CS gets
     triaged.
   - **CRM (Salesforce, HubSpot):** read loss reasons and account notes.
   - **Support (Zendesk, Intercom):** first-party tickets, the most trustworthy
     feedback available.

   Each adapter converts its source into the format paste mode already accepts, so
   the triage core doesn't change.

2. **Status sync.** When an issue is routed, Cherry files a ticket in the team's
   engineering tracker (Linear or Jira) and stores the ticket ID with the issue.
   Status (`triaged → routed → shipped`) then comes from that ticket, so nobody
   re-types it. Cherry reads status only from the tracker; it doesn't guess from
   email or anything else.

3. **Warehouse sync.** For larger volumes, Cherry connects to the data warehouse
   (Snowflake, BigQuery, Databricks). SQL and simple rules narrow millions of rows
   (reviews, tickets, NPS comments) to the slice that needs judgment, and only that
   slice goes to the model. Triaged issues and their status are written back to the
   warehouse so they can be queried and tracked alongside the rest of the
   company's data.

**Tradeoffs.** None of this is built in v1; it's the design. Each connector is
real work: auth, rate limits, schema mapping, and a persistent store to replace
localStorage. But because the triage core already accepts normalized feedback
through paste mode, each connector is an adapter rather than a rewrite. The live
Slack routing, including how it handles not being configured yet, shows the
pattern working.

---

## 2026-07-01 · Is this feedback from real people?

**Context.** Cherry's web triage uses public review sites as its source of
customer feedback. Those sites get gamed: vendors buy 5-star reviews, competitors
plant 1-star ones, and review farms produce text in bulk. If fake reviews drive an
issue, Cherry ends up prioritizing a problem that doesn't exist.

**What prompted it.** Someone asked how we know the feedback wasn't written by
bots. The source-bias fix (next entry down) deals with which real people show up
to complain. It does nothing about reviews that never came from a customer.

**Options considered.**
- A separate classifier or API call per review. Accurate, but slow, expensive,
  and another dependency for a portfolio tool with no database.
- Blocking certain sources outright. Too blunt; even gamed sites carry real
  complaints.
- Handling it during synthesis. The model already reads every review, and models
  are good at spotting templated or duplicate text, praise or outrage with no
  details, and bursts of reviews at the same time.

**Decision.** Extend the synthesis prompt, the same way as for source bias. The
model gives each issue an **authenticity** score from 1 to 5, trusts sources with
verified purchases or accounts (App Store, Google Play, G2, Capterra) over
anonymous ones, merges near-duplicate bot text into a single low-confidence
mention, and doesn't let suspect reviews raise reach, prevalence or severity.
Doubtful issues get a `⚠ maybe not genuine` tag, the page warns when the triage
relies on suspect reviews, and the eval gate now requires the field.

**Tradeoffs.** This reduces bot contamination and makes it visible, but can't
rule it out; the model's authenticity score is a judgment, not proof. The most
reliable fix is still first-party data (your own tickets, or verified-purchase
surveys via "Paste feedback"), and the warning points people there.

---

## 2026-06-30 · Source bias: the open web skews negative

**Context.** Cherry's web triage searches public sources for customer feedback.

**What prompted it.** In a triage of ChatGPT, most of the evidence came from
Trustpilot and similar complaint sites, which made the picture look worse than it
is. People rarely post to Trustpilot after a good experience; they go there to
vent. So those sites over-represent angry users (ratings cluster at the
extremes), and a product with hundreds of millions of mostly happy users looks
much worse there than it really is.

**Why it matters.** Cherry is built to triage complaints, so some negativity is
expected. The problem is that a complaint-heavy mix of sources distorts the thing
Cherry most needs to get right: how widespread an issue really is. An issue that's
loud on Trustpilot and rare everywhere else gets inflated `reach` and
`prevalence`. App Store reviews help, since the pool is bigger and there's a star
rating for context, but they have their own biases (some apps only prompt happy
users to review). So the answer is a mix of sources and being open about it, not
swapping one biased source for another. The most accurate picture comes from
first-party data, your own support and survey channels, which is what "Paste
feedback" is for.

**Decision.** Three changes, covering the input, a warning, and the display:

1. **Balance the prompt.** Ask for a spread of sources (App Store, Reddit, G2,
   press, not just complaint sites), and estimate `reach` and `prevalence` from
   likely base rates rather than from how loud a complaint is on a venting site.
2. **Warn about skew.** When most of the evidence comes from complaint sites,
   Cherry says so: *"Reads more negative than reality. X% of this evidence comes
   from complaint sites. Treat the severity as real, but read the prevalence as an
   upper limit."*
3. **Show the sources.** An "evidence base" row lists the platforms used, with
   complaint sites marked, so the bias is visible and you can discount it
   yourself. In paste mode it says instead that the data is first-party.

---

## 2026-06-30 · Routing: one owner plus stakeholders

**Context.** Cherry routes each issue to the team that should own it, and shows a
"Routes to" summary so a PM can see who owns what. Each issue had exactly one
`owner`.

**What prompted it.** Testing Adobe, Cherry routed *"predatory cancellation
fees"* to **Leadership** and tagged it an *intentional tradeoff*. I tried
correcting it to **Legal**, since there's an active FTC lawsuit, and the
synthesis-quality score dropped from 4.4 to 4.2. That made me ask who actually
owns this.

**Why.** Both do, but they own different things:

- **Legal** owns the risk: the lawsuit, compliance, exposure.
- **Leadership** owns the decision: whether to change a practice that's
  profitable and widely hated. Legal can't make that call; it's a business-model
  choice.

A single owner field forced Cherry to pick one of two correct answers to two
different questions.

**Decision.** Route each issue to **one primary owner (who owns the fix or the
decision) plus 0–3 stakeholders (other teams who need to be kept informed).**

- Cancellation fees: owner **Leadership**, stakeholder **Legal**.
- A checkout bug: owner **Engineering**, stakeholder **Billing**.

**Why not allow several owners?** When everyone owns something, nobody is
accountable. One owner acts; stakeholders are consulted. The summary still shows
who owns the most, and each ticket still has one assignee.

**Result.** Routing now matches how decisions get made inside a company. Drafted
tickets list the stakeholders to loop in, and the quality gate
(`evals/check.mjs`) checks that each issue has a valid owner and that no
stakeholder repeats the owner. It was the quality score dropping after a bad
correction that pointed to the problem in the first place.

---

## 2026-06-30 · Measuring whether corrections help

**Context.** Cherry's premise is that Claude proposes, you correct, and the
results improve. Nothing measured whether that was true.

**First attempt.** Add a second, independent Claude call that grades each triage
from 1 to 5 against a rubric (grounding, clustering, ranking, routing,
actionability). Show the scores, and after a reviewer corrects and re-ranks,
grade again and show the change.

**What we found.** In a live before-and-after, the score went down after a
correction, from 4.4 to 4.2. The correction wasn't bad. A correction re-ran the
whole triage from scratch, so the grader was comparing two different drafts
rather than measuring the correction. Regeneration noise drowned out the effect.

**Fix.** Corrections now revise the existing triage in place, changing only what
the reviewer asked for, with no new search or rewrite. The grade then reflects
just the correction. Re-tested: fixing a clearly mis-routed bug raised the score
from 2.0 to 2.8, and it's faster too.

**Why it matters.** The role asks for "closed-loop data that makes synthesis
quality measurably improve", and this now measures it. Because the grader is
independent, the score only goes up when a correction actually helps. I kept the
result where the score went down rather than re-running for a better screenshot.

---

## 2026-06-30 · Disposition: not every complaint is a bug

**Context.** Cherry ranks issues and routes them to a team. Every issue read as
something to fix.

**What prompted it.** Adobe's top complaint, predatory cancellation fees, was
being framed as a ticket to fix. It isn't a bug. It's a business decision Adobe's
leadership knows about and made on purpose, so "fix the cancellation fees" gets
the work wrong.

**Why.** A feedback tool needs to tell two kinds of issue apart:

- a **fixable gap:** a bug or missing feature the team would want to close, and
- an **intentional tradeoff:** a deliberate choice customers dislike but the
  company made on purpose, such as aggressive pricing or dark patterns.

They need different actions and different owners. A gap becomes a fix for the
owning team. A tradeoff becomes a strategy or risk decision for Leadership or
Legal, not a ticket for whoever built the feature.

**Decision.** Add disposition as its own field, `fixable gap` or `intentional
tradeoff`, shown as a badge that sets both how the action is worded and where the
issue is routed.

**Result.** Checked live: cancellation fees come out as an *intentional
tradeoff* routed to Leadership, with an FTC-related action ("review the ETF
policy"), while crashes come out as a *fixable gap* routed to Engineering.

---

## 2026-06-30 · Three web searches instead of five

**Context.** Each triage lets Claude run web searches to find feedback. More
searches give deeper coverage, but each adds about 10–15 seconds, and the free
hosting tier stops any request that runs past 60 seconds.

**Measurements.** Five searches went past 60 seconds and timed out. Three finish in
about 38–40 seconds, leaving around 20 seconds of headroom, and still pull feedback
from six or more platforms into a full result with sources. Four (about 46–54
seconds) sometimes hit the limit and failed, which is the worst outcome for a demo.

**Decision.** Default to **3**. A triage that always returns in about 40 seconds
is better than a slightly deeper one that sometimes fails in front of a hiring
manager. The count is an environment variable, so switching to 5 on a paid tier
(300-second limit) needs no code change.

**Tradeoffs.** Five searches don't produce more issues, since the output is capped
at five either way. They give slightly richer sourcing and a slightly better chance
of catching a quieter issue. The major issues show up in the first one to three
searches regardless. So three covers what matters, and five only pays off for
products with little feedback or for a deep audit, which is when you'd move to a
paid tier anyway.
