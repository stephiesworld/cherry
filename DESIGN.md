# Cherry — design system

The design lives in `index.html` (CSS in the `<style>` block, tokens in `:root`);
`scale.html` reuses the same tokens and components. This file is the intent
behind it: the rules to follow when editing or extending the UI so it stays
on-brand. **When you change the front end, derive new styling from these tokens —
don't introduce new colors, fonts, or radii.**

## Concept
Cherry is an *instrument* with a bite: warm paper, hard ink outlines, one loud
red. The identity comes from the name — picking the few signals worth acting on
out of a large pile — and from the **sour/sweet** metaphor: severity is
tartness. It should feel like a well-made tool, not a landing page. The product
is the hero; there is no slogan-and-paragraph column.

Keep it visually distinct from sibling product Stanley (dim, all-serif butler):
Cherry is bright, outlined, and runs on sans + mono.

## Color tokens (exact, from `:root`)
| Token            | Value                  | Use |
|------------------|------------------------|-----|
| `--ink`          | `#19120F`              | Primary text. Warm near-black, never pure black. |
| `--line`         | `#19120F`              | Outlines and hard offset shadows (same value as ink). |
| `--muted`        | `#8A7A66`              | Secondary text, captions, inactive tabs, mono labels. |
| `--ground`       | `#F8EFDF`              | Page background. Warm cream paper. |
| `--panel`        | `#F2E7D0`              | Section-header tabs, inactive console tabs, callouts, takeaway box. |
| `--panel-deep`   | `#EAD9BB`              | The sort-demo box; deeper panel tint. |
| `--cherry`       | `#C71F38`              | THE accent. Scores, primary buttons, top-issue shadow, section-header dot. |
| `--cherry-bright`| `#D8324B`              | Hover/active of the cherry accent only. |
| `--cherry-deep`  | `#8E1428`              | Stamps, links in example rows, "corrected" state shadow. |
| `--stem`         | `#5A6E10`              | Olive green. Owners, "what they love", confirmed state, live integrations. |
| `--sour`         | `#AEC42B`              | Acid-green highlight: link underlines, the underline swash. Small doses only. |
| `--rule`         | `rgba(25,18,15,0.13)`  | Hairline dividers inside content. |
| `--rule-strong`  | `rgba(25,18,15,0.34)`  | Stronger borders, dimmed chips, input outlines. |

White (`#fff`) is the surface for cards, inputs and the active console tab.

**Caution amber** (not a token yet, used consistently): `#C99A3A` border,
`#8A6712` text, `#FBF3E4` fill. Reserved for "needs a human look" states —
review queue, low-confidence notes, revenue/money tags, competitor and silent
sources. Don't use it decoratively.

Rules: cherry is the only loud color — spend it on the top pick, the primary
action, and scores. Stem is the quiet positive counterpoint. Sour and amber are
signals, not decoration. No new hues.

## Typography (three roles)
- **Bricolage Grotesque** (sans) — body copy, UI, inputs, and section-header
  titles (700, tight tracking). The workhorse and the main display voice.
- **JetBrains Mono** — buttons, tabs, labels, tags, status lines, chips.
  Uppercase with letter-spacing ~0.05–0.18em for the "instrument readout" feel.
- **Fraunces** (serif) — numbers and quotes only: signal scores, big stat
  numbers, the takeaway statement, step `h3`s. Not for page or section
  headlines.

Loaded via Google Fonts in the `<head>`. Don't swap families.

## Surfaces: outline + hard shadow
The signature look is a **1.5px ink outline with a solid offset shadow** (no
blur): `box-shadow: 6px 6px 0 var(--line)` on big panels, `4px` on cards,
`3px` on buttons. Coloured offsets carry state:
- `var(--cherry)` — top issue
- `var(--stem)` — confirmed
- `var(--cherry-deep)` — corrected

Primary buttons "press in" on hover (translate 2px, shadow shrinks to 1px).
Never use soft/blurred drop shadows.

## Radii
3–5px for tags, stamps and small chips; 6–8px for inputs, buttons and tabs;
9–12px for cards and panels; `50%` for dots; `999px` only for feedback pills.

## Structure & components
- **Header**: cherry-pair SVG mark + "Cherry" wordmark + a small cherry
  "sour or sweet" badge; mono nav on the right (hidden under 640px).
- **Hero = the tool.** No headline column. A visually hidden `h1` carries the
  page heading for screen readers.
  - **Console**: full-width white panel (6px hard shadow) with *Search the web*
    / *Paste feedback* as folder tabs on its top-left edge. The active tab is
    white and joins the panel; the inactive one is `--panel` with muted text.
    Inside: a large runbar (input + cherry "Pick the signal" button) and the
    "Try" example links; or the paste textarea + data-terms select.
  - **Sort demo** (signature moment, keep it): `--panel-deep` box beneath the
    console. Left: the pile of raw notes as slightly tilted white chips.
    Middle: a cherry arrow. Right: three ranked `.issue` cards. On load the
    notes that feed an issue turn cherry (`.hit`), the rest dim (`.dim`), then
    the picks fade in. Stacks vertically under 880px (arrow rotates down).
- **Section headers** (`.sec-head`): a folder tab (`--panel`, 1.5px ink
  outline, rounded top) holding a cherry dot + Bricolage title, sitting on a
  full-width 1.5px ink rule. No right-aligned tagline, no section numbers.
- **Results**:
  - **Header**: the product name, big (Bricolage 700), with a mono readout
    beside it ("5 issues ranked · 6 sources", counts in cherry) and "Try
    another" on the right, over a 1.5px ink rule. No sentence headline.
  - **The point**: the takeaway as a large Fraunces statement on the page,
    marked by a small rotated "the point" stamp. No callout box, no left border.
  - **Readout panel**: the context strips (routing, evidence base, trends,
    capability signal, coverage, authenticity, data terms, memory) share one
    white outlined panel, one row each, divided by hairlines. It hides itself
    when every strip is empty.
  - **Grid**: ranked issues left, under a small section-header tab ("Top
    issues, ranked by signal"). Side cards right: white, outlined, hard shadow,
    Bricolage title with a dot. "What they love" is the **sweet** card (stem
    shadow and dots); "Do next" lists actions with outlined checkboxes.
- **Issue card** (`.rissue`): Fraunces score in cherry on the left; title, gist
  and mono tags (severity-as-tartness / prevalence / owner in stem) on the right.
- **Severity as tartness**: `sweet → mild → tart → sour → extra sour` (1–5).
  "Extra sour" gets a slightly rotated stamp.
- **Human-in-the-loop**: "Looks right / Not quite" pills per issue; "Not quite"
  opens an inline correction; corrections collect in `.corrbar` with a
  "Re-pick with my corrections" primary button. Drafting sits beside them as
  one group ("Draft: Ticket · Reply · Update"). Under 540px the score moves
  into a row above the title. Persona tabs and signal-weight
  sliders re-rank the same triage.
- **Scaling notes** (`scale.html`): page name + mono readout ("10 breaks ·
  v1 → v2") instead of a slogan headline, a short plain intro, then a two-column
  index of the breaks linking to each one. Each break is a before/after card:
  title bar, the v1 **break** on `--panel` left, the v2 **fix** on white right
  (stacks under 640px); the targeted card gets a cherry shadow. "The rule" is a
  stamped Fraunces statement like "the point"; the autonomy ladder is drawn as
  a staircase, each rung indented further, the last with a stem shadow.
  The footer sits on a 1.5px ink rule: a "Back to Cherry" link styled like the
  index cards, a mono "Back to top" link, and the studio credit. No tagline.
 Fraunces italic tag line on the left, mono studio credit right.

## Motion
Restrained and purposeful: the one orchestrated hero moment (the sort
resolving), gentle scroll-reveals (`.rise`), button press-in, a bobbing
two-cherry loader during a query. **Respect `prefers-reduced-motion`** — the
CSS disables transitions and the demo jumps straight to its resolved state;
preserve that.

## Spacing & layout
Max content width 1140px with 32px side padding. Sections ~70px vertical
padding. Breakpoints: 880px (grids → one column, sort demo stacks), 680px,
640px (nav hides), 540/520px (runbar stacks, tighter padding and chips).

## Voice (copy is design material)
Plain and specific. Say what the thing does in the words a PM would use out
loud. Keep the fruit to names and labels (the wordmark, severity as tartness:
sweet → extra sour); don't write fruit puns into sentences. Buttons say exactly
what happens ("Pick the signal", "Triage this feedback", "Re-pick with my
corrections"; never "Submit").

Avoid the patterns that make copy read as generated:
- slogan headlines or taglines ending in a full stop
- closing aphorisms ("X is a privilege Y has to earn", "halfway to a platform")
- "isn't X — it's Y" and "not X, but Y" turns
- chains of em-dashes; use a full stop, colon or comma instead
- vague intensifiers ("genuinely", "truly", "sharper every pass")

## Quality floor (keep when editing)
Responsive to mobile with no horizontal scroll at 390px, visible keyboard focus
(`:focus-visible` outline in cherry), reduced motion respected, every input
labeled, a real `h1` (visually hidden is fine). Don't regress these.

— Studio Felix
