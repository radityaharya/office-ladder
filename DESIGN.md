---
name: Office Ladder
description: In-game corporate management terminal — flat, precise, Gray Sand Dune & Matte Black UI.
colors:
  bg: "oklch(0.155 0.006 80)"
  bg-recessed: "oklch(0.115 0.004 80)"
  surface: "oklch(0.205 0.007 78)"
  surface-raised: "oklch(0.245 0.008 76)"
  surface-sunken: "oklch(0.175 0.006 79)"
  sand: "oklch(0.62 0.021 75)"
  taupe: "oklch(0.50 0.016 72)"
  text-high: "oklch(0.955 0.004 80)"
  text-medium: "oklch(0.685 0.013 76)"
  text-low: "oklch(0.46 0.012 74)"
  text-on-accent: "oklch(0.145 0.006 80)"
  border: "oklch(1 0 0 / 9%)"
  border-strong: "oklch(1 0 0 / 16%)"
  border-inverse: "oklch(0 0 0 / 22%)"
  accent: "oklch(0.735 0.085 78)"
  accent-dim: "oklch(0.44 0.05 78)"
  status-active: "oklch(0.615 0.075 145)"
  status-caution: "oklch(0.735 0.11 75)"
  status-critical: "oklch(0.575 0.135 32)"
  status-info: "oklch(0.615 0.045 235)"
  status-neutral: "oklch(0.50 0.016 72)"
  player-1: "oklch(0.63 0.06 235)"
  player-2: "oklch(0.68 0.11 75)"
  player-3: "oklch(0.60 0.09 320)"
  player-4: "oklch(0.60 0.075 145)"
  player-5: "oklch(0.62 0.12 40)"
  player-6: "oklch(0.58 0.08 290)"
typography:
  display:
    fontFamily: "Neue Haas Grotesk, Inter, Arial, sans-serif"
    fontSize: "1.5rem"
    fontWeight: 600
    lineHeight: 1.2
    letterSpacing: "-0.01em"
  headline:
    fontFamily: "Neue Haas Grotesk, Inter, Arial, sans-serif"
    fontSize: "1rem"
    fontWeight: 600
    lineHeight: 1.25
    letterSpacing: "0.02em"
  body:
    fontFamily: "Neue Haas Grotesk, Inter, Arial, sans-serif"
    fontSize: "0.875rem"
    fontWeight: 400
    lineHeight: 1.5
    letterSpacing: "0em"
  label:
    fontFamily: "Neue Haas Grotesk, Inter, Arial, sans-serif"
    fontSize: "0.6875rem"
    fontWeight: 600
    lineHeight: 1
    letterSpacing: "0.08em"
  data:
    fontFamily: "IBM Plex Mono, JetBrains Mono, ui-monospace, monospace"
    fontSize: "0.875rem"
    fontWeight: 500
    lineHeight: 1.3
    letterSpacing: "-0.01em"
  data-lg:
    fontFamily: "IBM Plex Mono, JetBrains Mono, ui-monospace, monospace"
    fontSize: "1.25rem"
    fontWeight: 500
    lineHeight: 1.15
    letterSpacing: "-0.01em"
  caption:
    fontFamily: "IBM Plex Mono, JetBrains Mono, ui-monospace, monospace"
    fontSize: "0.6875rem"
    fontWeight: 400
    lineHeight: 1.4
    letterSpacing: "0.02em"
grid:
  unit: "4px"
  step: "8px"
spacing:
  1: "4px"
  2: "8px"
  3: "12px"
  4: "16px"
  6: "24px"
  8: "32px"
  12: "48px"
  16: "64px"
radius:
  none: "0px"
  hairline: "2px"
  control: "4px"
geometry:
  border-width: "1px"
  control-height-sm: "28px"
  control-height-md: "36px"
  control-height-lg: "44px"
  header-height: "48px"
  rail-width: "320px"
  hud-strip-height: "40px"
  board-tile-min: "48px"
motion:
  duration-instant: "80ms"
  duration-fast: "120ms"
  duration-base: "160ms"
  easing-standard: "cubic-bezier(0.2, 0, 0, 1)"
  easing-linear: "linear"
---

# Design System: Office Ladder — Terminal

## 0. Mandate

This document replaces every prior visual direction for Office Ladder. Nothing from an earlier `DESIGN.md` — dark-game aesthetics, rounded panels, accent-green primaries, card-based layout — carries forward. Read this document as the sole source of truth.

**Core Aesthetic: In-Game Corporate.** The interface is not "a game UI about an office." It is the office's own internal system: a management terminal a player is issued at the start of a shift. Every screen should look like it could plausibly run a real logistics floor, a trading desk, or a building's facilities console — repurposed, in-fiction, to run a competitive board game. The player is not looking at a game skin; they are looking at the tool the game's fiction hands them.

This mandate has three enforceable consequences:

1. **Seriousness over charm.** No mascot energy, no rounded-toy affordances, no playful color bursts. If a component would look at home in a mobile game's shop screen, it is wrong for this system.
2. **Density with clarity.** Real management software is dense. This system is allowed to be dense, provided the grid and type hierarchy keep it legible — density is not an excuse for clutter.
3. **Cold confidence.** The tone is procedural and unbothered — status lights, not celebrations; entries, not toasts; log lines, not banners.

## 1. Palette — "Gray Sand Dune & Matte Black"

The palette has exactly two structural families and one warm neutral bridging them: **matte black/charcoal** for depth and recession, **sand dune / greige / taupe** for structure and mid-ground surfaces, and a single **desaturated ochre accent** for commitment and system state. There is no saturated brand color anywhere in this system — commitment is expressed through the accent's restraint, not its intensity.

### 1.1 Structural neutrals

| Token | Value | Role |
| --- | --- | --- |
| `bg-recessed` | `oklch(0.115 0.004 80)` | Outermost canvas — browser chrome edge, modal scrim field. Almost never seen directly; it is the void behind the terminal. |
| `bg` | `oklch(0.155 0.006 80)` | Primary application background. Matte black with a barely-perceptible warm cast — never pure `#000`, which reads as OLED/gamer-dark rather than material matte. |
| `surface` | `oklch(0.205 0.007 78)` | Standard panel plane: rails, headers, table zones, the resting plane for grouped content. |
| `surface-raised` | `oklch(0.245 0.008 76)` | One step up — active/selected rows, the currently focused panel, toolbars. Used sparingly; "raised" here means *tonal* step, never a shadow. |
| `surface-sunken` | `oklch(0.175 0.006 79)` | One step down — input wells, inset meters, recessed data fields. Reads as pressed into the desk, not floating above it. |

### 1.2 Sand dune structural grays

| Token | Value | Role |
| --- | --- | --- |
| `sand` | `oklch(0.62 0.021 75)` | The system's namesake mid-gray. Used for structural iconography, dividers that need to read as more than a hairline, and inactive-but-present UI (unselected tab labels, idle meters). |
| `taupe` | `oklch(0.50 0.016 72)` | A step darker than sand, warmer-leaning greige. Used for tertiary text, disabled control fills, and quiet groupings. |

### 1.3 Text

| Token | Value | Contrast on `bg` | Use |
| --- | --- | --- | --- |
| `text-high` | `oklch(0.955 0.004 80)` | ≥ 15:1 | Primary copy, values, active labels, headings. |
| `text-medium` | `oklch(0.685 0.013 76)` | ≥ 6.8:1 | Secondary copy, helper text, inactive labels, table sub-rows. |
| `text-low` | `oklch(0.46 0.012 74)` | ≥ 3.2:1 — decorative/large text only | Metadata that is present but not meant to compete: timestamps, unit suffixes, placeholder text at rest. Never body copy. |
| `text-on-accent` | `oklch(0.145 0.006 80)` | ≥ 8:1 on `accent` | Text/icon color sitting on top of the accent fill. |

### 1.4 Borders

| Token | Value | Use |
| --- | --- | --- |
| `border` | `oklch(1 0 0 / 9%)` | The default hairline. Nearly every seam in this system uses this token — this is the workhorse of the whole aesthetic. |
| `border-strong` | `oklch(1 0 0 / 16%)` | Emphasis boundary: focused panel edge, active tab underline, selected row edge. |
| `border-inverse` | `oklch(0 0 0 / 22%)` | Used on `sand`/`accent` fills where a light-on-light hairline would vanish — the sunken seam inside a filled control. |

### 1.5 Accent

| Token | Value | Use |
| --- | --- | --- |
| `accent` | `oklch(0.735 0.085 78)` | Desaturated ochre/brass. The single committed color in the system: primary actions, the current-turn indicator, selected states, and confirmed-progress fills. It reads as "brass fixture," not "brand color." |
| `accent-dim` | `oklch(0.44 0.05 78)` | Accent at rest / accent on dark fills / disabled-primary. Never used for text on `bg` — insufficient contrast by design, reserved for fills and borders. |

**Accent discipline.** `accent` is spent on exactly one thing per view: the single next action, or the single active state. A screen with two simultaneous accent fills has lost hierarchy — resolve the collision by demoting one to `sand` or `surface-raised`.

### 1.6 Muted system-state accents

These exist for notifications and state, not decoration. Each is desaturated relative to what a typical UI kit would ship — corporate telemetry, not a traffic light.

| Token | Value | Meaning |
| --- | --- | --- |
| `status-active` | `oklch(0.615 0.075 145)` | Moss green. Confirmed / online / completed / positive delta. |
| `status-caution` | `oklch(0.735 0.11 75)` | Muted amber. Pending decision, attention required, at-risk. Visually close to `accent` on purpose — both mean "this needs you" — but caution is a signal color and never used for a button fill. |
| `status-critical` | `oklch(0.575 0.135 32)` | Muted brick red. Errors, destructive confirmation, negative delta, disconnection. |
| `status-info` | `oklch(0.615 0.045 235)` | Muted slate blue. Neutral system notices, informational log lines, remote-player activity. The most desaturated of the four — informational, not urgent. |
| `status-neutral` | `oklch(0.50 0.016 72)` | Alias of `taupe`. Idle/off/disabled state light. |

### 1.7 Player identity

Six seat colors, each pulled toward the system's desaturation floor so no seat reads as "the fun one." Identity is always color + a seat number glyph, never color alone — see §8.

| Token | Value |
| --- | --- |
| `player-1` | `oklch(0.63 0.06 235)` — slate blue |
| `player-2` | `oklch(0.68 0.11 75)` — brass (visually close to `accent`; reserve seat 2 assignment logic to avoid same-screen confusion, or apply seat-2's pattern cue more assertively) |
| `player-3` | `oklch(0.60 0.09 320)` — plum |
| `player-4` | `oklch(0.60 0.075 145)` — moss |
| `player-5` | `oklch(0.62 0.12 40)` — rust |
| `player-6` | `oklch(0.58 0.08 290)` — violet-gray |

### 1.8 Contrast floor

All body and label text against `bg`, `surface`, and `surface-raised` must clear **4.5:1**. All hairline borders against their adjacent fill must clear **3:1** structurally (WCAG non-text contrast) even though they are 1px — this system relies on borders for structure, so a border that vanishes at 90% zoom is a system failure, not a rounding error. Verify every new token pairing against both `bg` and `surface` before shipping it.

## 2. Typography

**Primary family:** a geometric/grotesk sans (spec target: Neue Haas Grotesk or an equivalent — Inter as the practical web fallback). One family carries headings, labels, buttons, and body. This is deliberate: a management terminal does not need a display/body pairing, and introducing a second display face would immediately read as "game" rather than "tool."

**Data family:** a monospace (spec target: IBM Plex Mono or JetBrains Mono) reserved *exclusively* for numbers — money, dice results, coordinates, timestamps, percentages, counters. Monospace is a functional choice, not a flavor choice: tabular figures must not reflow as values change, and columns of numbers must align without manual kerning.

### 2.1 Scale

Fixed rem scale. No `clamp()`, no fluid type — this is a fixed-DPI terminal, not a marketing page, and a heading that resizes based on viewport width looks like an accident here, not a feature.

| Token | Size | Weight | Line | Tracking | Use |
| --- | --- | --- | --- | --- | --- |
| `display` | 24px / 1.5rem | 600 | 1.2 | -0.01em | Screen titles, primary scene-setting copy. Used once per view, at most twice. |
| `headline` | 16px / 1rem | 600 | 1.25 | 0.02em | Panel headers, section titles. |
| `body` | 14px / 0.875rem | 400 | 1.5 | 0em | Default interface copy, descriptions, log prose. Cap prose blocks at 65–75ch. |
| `label` | 11px / 0.6875rem | 600 | 1.0 | 0.08em, uppercase | Buttons, tabs, table headers, status chips, form labels. The system's command voice — terse, uppercase, always. |
| `data` | 14px / 0.875rem | 500 | 1.3 | -0.01em | Inline numeric values: resource counts, prices, dice totals. `font-variant-numeric: tabular-nums` mandatory. |
| `data-lg` | 20px / 1.25rem | 500 | 1.15 | -0.01em | Hero numeric values: the HUD's primary money/rank readout, dice-roll result callouts. |
| `caption` | 11px / 0.6875rem | 400 | 1.4 | 0.02em | Timestamps, seat tags, unit suffixes, footnote metadata. Set in the data family even when not strictly numeric, to keep the system-log register consistent. |

### 2.2 Rules

- **Sentence case for prose, uppercase for commands.** Body copy, log entries, and descriptions are sentence case. Buttons, tabs, badges, and table headers are uppercase `label` type. Do not uppercase a sentence — it reads as shouting, not as system chrome.
- **Tabular numerals everywhere numbers compare.** Any place two numeric values sit in visual proximity (a table column, a before/after delta, a leaderboard) must use the `data` family with tabular figures, full stop.
- **No italics.** The system has no italic voice. Emphasis is carried by weight (never above 600) or by the `accent`/`status-*` color tokens, not by slant.
- **Line-length discipline.** `body` text wraps at 65–75ch max. Data-dense zones (tables, logs) are exempt and may run wider.
- **One heading per region.** A panel gets exactly one `headline`. If a panel needs a second heading-weight element, it is two panels.

## 3. Spacing — the 4px grid

Every spacing value, every control height, every inset is a multiple of **4px**, with **8px as the default step** for anything above micro-adjustments (icon-to-label gaps, hairline insets). This is not a soft guideline — a value like `10px` or `18px` appearing anywhere in this system is a defect.

| Token | Value | Typical use |
| --- | --- | --- |
| `spacing.1` | 4px | Icon-to-label gap, tightest internal padding (chips, badges). |
| `spacing.2` | 8px | Default internal control padding, gap between tightly related items. |
| `spacing.3` | 12px | Compact row padding, gap between a label and its value. |
| `spacing.4` | 16px | Standard panel padding, gap between unrelated controls in a toolbar. |
| `spacing.6` | 24px | Gap between distinct panel regions. |
| `spacing.8` | 32px | Section-level separation, page-edge gutter on compact viewports. |
| `spacing.12` | 48px | Major region separation on wide viewports. |
| `spacing.16` | 64px | Outermost shell gutter on wide desktop. |

**Enforcement rule:** before shipping any spacing value, round it to the nearest 4px and ask whether 8px would read cleaner. When in doubt, pick the value that makes two unrelated elements' edges land on the same 8px line across the layout — that alignment is what makes the system read as precision software rather than assembled components.

## 4. Layout Architecture — Seamless & Flat

**The floating-card web-app look is explicitly forbidden.** No panel gets a drop shadow as its primary separation device. No panel floats on visible negative space with rounded corners implying it's a discrete "card" sitting above the page. This system is one continuous desk surface, subdivided by line and tone — not a pile of documents.

### 4.1 The seam system, not the card system

Separation between regions is achieved by exactly three devices, in order of preference:

1. **1px hairline border** (`border` token, `border-width: 1px`, never anti-aliased soft edges). This is the primary and default separator. A vertical or horizontal `border` line between two `surface` regions is the system's basic grammar — think partition wall or desk-seam, not card edge.
2. **Tonal step.** Adjacent regions that need separation without a hard line shift by exactly one step on the `bg → surface → surface-raised` or `surface → surface-sunken` scale. Two adjacent regions at the *same* tone with no border between them is a bug — the eye has nothing to read.
3. **Whitespace at an 8px-grid multiple.** Used only when 1 and 2 would over-partition a view (e.g., separating unrelated toolbar clusters). Never the sole separator between data regions that a user must visually parse as distinct.

Drop shadows are **not part of this system.** There is no elevation scale, no shadow token set, no `box-shadow` on any panel, button, or overlay in its resting state. The single narrow exception is §4.4.

### 4.2 Radius discipline

| Token | Value | Use |
| --- | --- | --- |
| `radius.none` | 0px | Default for all structural panels, rails, headers, table zones, board tiles. This is the system default — reach for `0` first. |
| `radius.hairline` | 2px | Interactive controls only: buttons, inputs, chips, small indicator dots. Enough to soften a click target, not enough to read as "rounded." |
| `radius.control` | 4px | The system ceiling. Reserved for the largest interactive surfaces (primary CTA buttons, modal containers). Nothing in this system exceeds 4px of corner radius. |

If a component's corner radius is being debated, the answer is the smaller of the two options under consideration.

### 4.3 Edge-to-edge panels

Structural regions (headers, rails, the HUD strip, table containers) run edge-to-edge against their parent region — flush to the viewport or flush to their containing panel's own edge, with no outer margin creating a floating-island effect. Internal breathing room is achieved entirely through *padding* (§3), never through a gap that makes the panel look like it's resting on top of the page rather than being part of it.

### 4.4 The one sanctioned elevation

Exactly one class of element is permitted to break flatness: **transient overlays that must interrupt** — a modal dialog, a dropdown menu, a toast/notification stack. These use a single, short-throw, near-black shadow (`0 2px 8px oklch(0 0 0 / 40%)`) purely as a physical-plausibility cue that they are temporarily above the desk surface, not as a decorative device. They still use `radius.control` at most and a `border` hairline — the shadow supplements the border, it does not replace it.

### 4.5 Grid discipline

Major regions align to a shared shell grid — column edges and row baselines line up across sibling panels. Do not center panels independently within free space; independent centering is what produces the "assembled cards" look this system explicitly rejects. If a rail is 320px wide, every panel edge inside that rail aligns to the rail's own edge, not to its own content's optical center.

## 5. Elevation & Interaction States

Every interactive element defines **five** states at minimum. Missing a state is treated as an incomplete component, not an acceptable default.

| State | Treatment |
| --- | --- |
| **Default (resting)** | `surface` fill (or transparent for ghost/text controls), `border` hairline, `text-medium` or `text-high` label depending on emphasis tier. |
| **Hover** | Fill steps to `surface-raised`; border steps to `border-strong`. No color hue shift, no shadow appears. Transition at `duration-fast` (120ms), `easing-standard`. |
| **Focus-visible** | A 2px outline in `accent`, offset 2px from the control edge (`outline-offset: 2px`), rendered *outside* the hairline border so it never competes with it. This is the only place a glow-adjacent effect is permitted, and it is a hard-edged outline, not a soft glow. |
| **Active/pressed** | Fill steps to `surface-sunken` (control visually recedes into the desk on press — the opposite direction from hover, reinforcing "physical button"). Duration `duration-instant` (80ms), no easing delay. |
| **Disabled** | Fill unchanged, `text-low` label, border drops to `border` at reduced apparent contrast via opacity `0.5` on the whole control. Disabled controls are never fully hidden — they stay present and legible-as-inert, matching real console hardware where an unavailable switch is still visible. |
| **Selected (where applicable)** | `accent-dim` fill with `text-high` label and a `border-inverse` hairline, or a 1px `accent` left/bottom rule under a tab — never a full `accent` fill unless the control is also the page's single primary action. |

Every state transition uses `duration-fast` (120ms) by default; the tray/panel-level transitions in §9 use `duration-base` (160ms). Nothing in this system uses an easing curve other than `easing-standard` (`cubic-bezier(0.2, 0, 0, 1)`) except literal linear progress meters, which use `easing-linear`.

## 6. Component Guidelines

### 6.1 Buttons

- **Shape:** `radius.hairline` (2px) for secondary/ghost, `radius.control` (4px) ceiling for primary. Never a pill. Never fully square with 0 radius on a clickable button — that reads as a keyboard key, not a button, and is reserved for board tiles.
- **Primary:** `accent` fill, `text-on-accent` label, `label` typography (uppercase), height `control-height-md` (36px) by default, `control-height-lg` (44px) for the single primary turn/room action. Exactly one primary button visible per view region.
- **Secondary (outline):** Transparent fill, `border-strong` outline, `text-high` label. This is the default choice for "a real, non-primary action" — reach for outline before ghost.
- **Ghost/text:** Transparent fill, no border, `text-medium` label that steps to `text-high` on hover. Used for the lowest-emphasis actions (dismiss, cancel, "skip").
- **Destructive:** Same shapes as primary/secondary, but the fill or outline swaps to `status-critical`. Requires explicit confirmation copy ("End room for everyone" not "Confirm") per the interaction contract, not a color alone.
- **Icon buttons:** Square, `control-height-sm` (28px) minimum footprint even though the glyph itself is smaller (pointer-target floor, see §8), `radius.hairline`.

### 6.2 Menus & Dropdowns

- Menus render on `surface-raised`, `border-strong` outline, `radius.hairline`, with the §4.4 short-throw shadow since they are transient overlays.
- Menu items are full-bleed rows (no inset "chip" per item) at `control-height-sm`, `label` typography for the item text is *not* used here — menu item text is `body`, since menu items are prose-length actions, not commands. Reserve `label` for the menu's own header row if it has one.
- Item hover/focus uses the standard `surface-raised → surface` inversion relative to the menu's own base tone (i.e., item hover fill is one step lighter than the menu's resting `surface-raised`, since the menu itself already occupies that tone).
- Destructive menu items use `status-critical` text color only — never a full-row critical fill, which would read as an error state for the whole menu.
- Dropdowns triggered from a control anchor directly below/above the trigger with no gap-shadow illusion; they render via `position: fixed` or a portal so they are never clipped by an `overflow: hidden` ancestor.

### 6.3 Data Tables

Tables are a first-class citizen in this system — this is a management terminal, and tabular data is the primary content type, not an edge case.

- **Header row:** `label` typography, uppercase, `text-medium`, sits on `surface-raised`, bottom border `border-strong`. Sticky on scroll.
- **Body rows:** `body` typography for text columns, `data` typography (tabular nums) for numeric columns, right-aligned. Row height snaps to `control-height-md` (36px) as the default density, with a documented "compact" density at `control-height-sm` (28px) for high-row-count views (e.g., a full game log).
- **Row separators:** 1px `border` between every row — no zebra-striping. Zebra striping is a card-era crutch this system doesn't need because the hairline grid already does the job.
- **Row hover:** Full-row fill step to `surface-raised`. Row select (if applicable): `accent-dim` fill with `border-inverse` top/bottom rule.
- **Column alignment:** Text columns left-align; numeric/data columns right-align; status/icon columns center. This is fixed, not per-table discretion.
- **Empty/loading:** Skeleton rows at `surface-sunken` with a subtle `duration-base` pulse — never a centered spinner floating mid-table.

### 6.4 HUD Elements (Gameplay)

The HUD is the terminal's live-telemetry strip — the place the "in-game corporate" mandate is most visible, since it must read as instrumentation, not as a game score bar.

- **HUD strip:** Fixed `hud-strip-height` (40px), `surface` fill, bottom `border`, spans full width directly under the room header. Contains labeled `data` readouts (money, position, rank) separated by 1px vertical `border` rules — not pills, not icon badges. Each readout is `[LABEL — 11px uppercase, text-medium] [VALUE — data, text-high]` stacked or inline depending on available width, never a decorative icon standing in for the label.
- **Status lights:** A single 6px square (not circle — circles read as "notification dot," squares read as "indicator LED," which fits the terminal metaphor) in the relevant `status-*` token, always paired with a text label. Never color-only.
- **Meters (energy, progress-to-promotion, etc.):** Rendered as a `surface-sunken` track with an `accent` or `status-active` fill bar, `radius.none`, 1px `border` around the track. No gradient fill, no glow. The numeric value is always echoed in `data` type beside the meter — the bar illustrates, the number confirms.
- **Turn/active-player indicator:** A `border-strong`-to-`accent` 2px top rule on the active player's dossier row, plus a `label`-styled "ACTIVE" tag — never a glow, pulse-loop, or scale-up animation on the whole row. One brief `duration-base` fade-in of the tag on turn change is the only motion permitted here.
- **Log entries:** Monospace `caption` timestamp, `body` sentence-case event text, `data` for any resource delta with explicit sign (`+120`, `-40`) — never color alone for gain/loss.

## 7. Motion

Motion exists to confirm state changes a user already expects, not to entertain. This is instrumentation, not a game trailer.

- `duration-instant` (80ms): press/active feedback.
- `duration-fast` (120ms): hover, focus, small control transitions.
- `duration-base` (160ms): panel/tray state changes, row insertion in tables/logs, tag fade-in.
- No duration in this system exceeds ~200ms except a deliberate token-travel animation on the board itself, which is a gameplay affordance, not chrome, and is scoped separately if/when the board is specified.
- Easing is `easing-standard` for all transform/opacity changes; `easing-linear` only for literal progress/loading meters.
- No bounce, no overshoot, no elastic easing anywhere in this system.
- `prefers-reduced-motion: reduce`: every transition above collapses to an instant state change or, where a fade genuinely aids comprehension (e.g., a new log line), a maximum 80ms crossfade.

## 8. Accessibility Constraints

- Every interactive control meets a **28px minimum pointer target** (`control-height-sm`), even where the visible glyph is smaller — pad the hit area, don't grow the icon.
- Text contrast floor is WCAG AA: body/label/data text ≥ 4.5:1 against its background; large `display` text and structural hairlines ≥ 3:1.
- Status and identity are never color-only. Every `status-*` use pairs with text or an icon+label; every player identity pairs color with a seat-number glyph and, where relevant, a pattern (retain the six-pattern seat system from the prior identity spec if patterns are still required — color alone does not satisfy this system's own contrast/CVD rules).
- Focus order follows visual/DOM order; the `focus-visible` outline (§5) must never be suppressed globally.
- All core flows (join, ready, act, respond to a prompt) are fully keyboard-operable without relying on hover-only affordances.
- At 200% browser zoom, no structural panel clips its content or traps focus; the HUD strip and action tray degrade to wrapped/stacked layout rather than overflowing silently.

## 9. Responsive Behavior

- **Wide desktop (≥ 1280px):** Full three-region shell — header, HUD strip, board-plus-rail — all edge-to-edge per §4.3.
- **Desktop/tablet landscape (1024–1279px):** Rail width may compress toward a documented minimum before the layout switches to stacking; panels keep their hairline/tonal separation exactly as at full width.
- **Tablet portrait (768–1023px):** Rail stacks below the primary content region rather than beside it. HUD strip may wrap to two rows at `spacing.2` internal gap, still hairline-separated per readout.
- **Mobile (< 768px):** Header compresses to essential identity + status only; HUD readouts scroll horizontally as a single strip rather than collapsing into icon-only chips (values must stay legible as text, per the "no icon standing in for data" rule in §6.4). Tables switch to a stacked key/value row pattern per record rather than horizontal scroll, to avoid reintroducing card-like floating blocks — the stacked rows still use hairline separators, not gaps.
- Capability parity holds at every breakpoint: nothing available on desktop becomes desktop-only.

## 10. Do's and Don'ts

### Do
- **Do** default every new component to `radius.none` and only add radius if a specific interactive affordance needs it (§4.2).
- **Do** separate every region with a 1px `border` or a tonal step — never leave two adjacent same-tone regions with no seam.
- **Do** spend `accent` on exactly one thing per screen.
- **Do** set every numeric value in the `data`/`data-lg` monospace family with tabular figures.
- **Do** round every spacing value to the 4px grid, defaulting to 8px.

### Don't
- **Don't** give any resting-state panel, card, or button a drop shadow. The only sanctioned shadow is the short-throw overlay shadow in §4.4.
- **Don't** round any corner past 4px anywhere in the system.
- **Don't** use a second saturated color alongside `accent` in the same view — all secondary emphasis routes through `sand`/`taupe`/tonal steps or a single restrained `status-*` token.
- **Don't** center panels independently within free space; align every panel edge to the shared shell grid (§4.5).
- **Don't** communicate gain/loss, status, or identity through color alone.
- **Don't** introduce a second heading typeface, italics, or a decorative display face anywhere — one sans family, one mono family, full stop.
