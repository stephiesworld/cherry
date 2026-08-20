# Cherry — design system

The full design lives in `cherry.html` (CSS in the `<style>` block, tokens in
`:root`). This file is the intent behind it: the rules to follow when editing or
extending the UI so it stays on-brand. **When you change the front end, derive
new styling from these tokens — don't introduce new colors, fonts, or radii.**

## Concept
Cherry is an *instrument*, not a toy: cool and bright, confident, a little
editorial. The whole identity comes from the name — the job is picking the few
signals worth acting on out of a large pile ("from the pile, the point"). It is
deliberately the opposite of its sibling product Stanley (warm, dim, all-serif
butler) — keep them visually distinct.

## Color tokens (exact, from `:root`)
| Token            | Value                 | Use |
|------------------|-----------------------|-----|
| `--ink`          | `#1A1416`             | Primary text; dark CTA band. A plum-tinted near-black, not pure black. |
| `--muted`        | `#8A7E7C`             | Secondary text, captions, labels. |
| `--ground`       | `#FBF6F4`             | Page background. Faint blush off-white (NOT cream — cream is Stanley). |
| `--panel`        | `#F3EBE8`             | Cards, panels, takeaway box. |
| `--panel-deep`   | `#ECE0DC`             | Deeper panel tint when needed. |
| `--cherry`       | `#B0233C`             | THE accent. Scores, primary buttons, top-issue emphasis, links. |
| `--cherry-bright`| `#D13651`             | Hover/active state of the cherry accent only. |
| `--stem`         | `#46734E`             | Secondary/positive: owners, "what they love," confirmed state. |
| `--rule`         | `rgba(26,20,22,0.12)` | Hairline borders, dividers. |
| `--rule-strong`  | `rgba(26,20,22,0.22)` | Stronger borders, input outlines. |

Rules: cherry is the *only* loud color — spend it sparingly (top pick, primary
action, scores). Stem is the quiet counterpoint (positive/owner). Never add a
third hue.

## Typography (three roles, no more)
- **Fraunces** (serif, optical) — display only: wordmark, H1/H2, the takeaway box,
  big numbers in value cards. Lush and characterful; use at large sizes.
- **Inter** (sans) — all body copy, UI, controls. The neutral workhorse.
- **JetBrains Mono** — labels, eyebrows, scores, tags, status lines. Always
  uppercase with letter-spacing ~0.1–0.18em for the "instrument readout" feel.

Loaded via Google Fonts in the `<head>`. Don't swap families.

## Structure & components
- **Hero**: two columns — copy + live input on the left, the "sort" demo on the
  right (raw note chips that resolve into 3 ranked issue cards on load). The sort
  animation is the signature; keep it.
- **Results**: a takeaway box (Fraunces, cherry left-border), then a focused
  decision queue: change summary, uncertain issue to review, and the top three
  issue cards. Ranking controls and methodology use progressive disclosure. The
  1.5fr/1fr grid keeps issues left and recommended next steps right.
- **Issue card** (`.rissue`): signal score (mono, cherry) on the left; title,
  gist, and tags (severity / prevalence / owner) on the right. Top issue gets the
  `.top` emphasis. States: `.confirmed` (stem border) and `.corrected` (cherry
  border, faint blush fill).
- **Human-in-the-loop**: each issue has "Looks right / Not quite" pills; "Not
  quite" reveals an inline correction input; corrections collect in `.corrbar`
  with a "Re-pick with my corrections" primary button.

## Motion
Restrained and purposeful. One orchestrated hero moment (the sort resolving),
gentle scroll-reveals (`.rise`), small hover lifts on buttons/cards. A bobbing
two-dot cherry loader during a query. **Respect `prefers-reduced-motion`** — the
existing CSS disables transitions and shows resolved states; preserve that.

## Radii, spacing, shadows
- Radius: 4px (inputs/buttons), 8–10px (cards/panels). No sharp 0px, no pills
  except tags/feedback chips (999px).
- Shadows are soft and low-opacity, tinted with the ink color, never pure black.
- Generous section padding (~70px); max content width 1140px.

## Voice (copy is design material)
Sharp, plain, confident product voice — not the butler register of Stanley.
Active verbs, specific over clever. Examples in use: "From the pile, the point."
· "Pick the signal." · "Cherry proposes — you decide." Buttons say exactly what
happens ("Re-pick with my corrections", not "Submit").

## Quality floor (keep when editing)
Responsive to mobile (breakpoints at 880px and ~540px already defined), visible
keyboard focus (`:focus-visible` outline in cherry), reduced-motion respected,
inputs labeled. Don't regress these.

— Studio Felix
