# Decision log

A short record of the product decisions behind Cherry — the *why*, not just the
*what*. Newest first.

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
