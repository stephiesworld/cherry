# Decision log

A short record of the product decisions behind Cherry — the *why*, not just the
*what*. Newest first.

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
