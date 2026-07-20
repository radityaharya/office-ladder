---
name: Office Ladder
description: Browser-based multiplayer office board game with sharp, dark, flat game UI.
colors:
  background: "oklch(0.141 0.005 285.823)"
  foreground: "oklch(0.985 0 0)"
  primary: "oklch(0.527 0.154 150.069)"
  primary-foreground: "oklch(0.982 0.018 155.826)"
  surface: "oklch(0.21 0.006 285.885)"
  surface-muted: "oklch(0.274 0.006 286.033)"
  muted-foreground: "oklch(0.705 0.015 286.067)"
  border: "oklch(1 0 0 / 10%)"
  destructive: "oklch(0.704 0.191 22.216)"
  warning: "oklch(0.769 0.165 70.08)"
  info: "oklch(0.746 0.124 232.661)"
  player-1: "oklch(0.746 0.124 232.661)"
  player-2: "oklch(0.769 0.165 70.08)"
  player-3: "oklch(0.716 0.166 327.19)"
  player-4: "oklch(0.704 0.151 258.338)"
  player-5: "oklch(0.749 0.159 52.153)"
  player-6: "oklch(0.713 0.143 303.353)"
typography:
  display:
    fontFamily: "Instrument Sans, Geist, Arial, sans-serif"
    fontSize: "1.875rem"
    fontWeight: 600
    lineHeight: 1.15
    letterSpacing: "-0.02em"
  headline:
    fontFamily: "Instrument Sans, Geist, Arial, sans-serif"
    fontSize: "1.125rem"
    fontWeight: 600
    lineHeight: 1.2
    letterSpacing: "0.08em"
  body:
    fontFamily: "Geist Mono, Geist, monospace"
    fontSize: "0.875rem"
    fontWeight: 400
    lineHeight: 1.6
    letterSpacing: "0em"
  label:
    fontFamily: "Geist, Arial, sans-serif"
    fontSize: "0.75rem"
    fontWeight: 600
    lineHeight: 1
    letterSpacing: "0.12em"
  metric:
    fontFamily: "Geist Mono, Geist, monospace"
    fontSize: "1rem"
    fontWeight: 600
    lineHeight: 1.1
    letterSpacing: "-0.01em"
  caption:
    fontFamily: "Geist Mono, Geist, monospace"
    fontSize: "0.6875rem"
    fontWeight: 500
    lineHeight: 1.35
    letterSpacing: "0.04em"
rounded:
  xs: "0.25rem"
  sm: "0.375rem"
  md: "0.5rem"
  lg: "0.625rem"
spacing:
  2xs: "0.25rem"
  xs: "0.375rem"
  sm: "0.5rem"
  compact: "0.75rem"
  md: "1rem"
  lg: "1.5rem"
  xl: "2rem"
  2xl: "3rem"
  shell-gutter: "clamp(1rem, 2.5vw, 2rem)"
  panel-gap: "clamp(0.75rem, 1.5vw, 1.5rem)"
  tile-inset: "clamp(0.25rem, 0.55vw, 0.5rem)"
geometry:
  control-height-sm: "2rem"
  control-height-md: "2.5rem"
  control-height-lg: "3rem"
  room-header-height: "4rem"
  gameplay-rail-width: "clamp(16rem, 22vw, 20rem)"
  board-grid-size: 12
  board-space-count: 44
  board-min-size: "36rem"
  board-max-size: "56rem"
  board-tile-min: "3rem"
  token-size: "clamp(1.25rem, 2.2vw, 2rem)"
motion:
  duration-fast: "120ms"
  duration-base: "180ms"
  duration-emphasis: "320ms"
  easing-standard: "cubic-bezier(0.22, 1, 0.36, 1)"
  easing-linear: "linear"
patterns:
  player-1: "diagonal-forward"
  player-2: "dot-grid"
  player-3: "diagonal-back"
  player-4: "horizontal-rule"
  player-5: "checker"
  player-6: "crosshatch"
components:
  button-primary:
    backgroundColor: "{colors.primary}"
    textColor: "{colors.primary-foreground}"
    typography: "{typography.label}"
    rounded: "{rounded.md}"
    padding: "0 1.5rem"
    height: "2.5rem"
  button-outline:
    backgroundColor: "transparent"
    textColor: "{colors.foreground}"
    typography: "{typography.label}"
    rounded: "{rounded.md}"
    padding: "0 1.5rem"
    height: "2.5rem"
  input-default:
    backgroundColor: "transparent"
    textColor: "{colors.foreground}"
    typography: "{typography.body}"
    rounded: "{rounded.sm}"
    padding: "0 0 0.25rem 0"
    height: "2.5rem"
  card-default:
    backgroundColor: "{colors.surface}"
    textColor: "{colors.foreground}"
    rounded: "{rounded.lg}"
    padding: "1.5rem"
  badge-default:
    backgroundColor: "transparent"
    textColor: "{colors.foreground}"
    typography: "{typography.label}"
    rounded: "{rounded.sm}"
    padding: "0"
  board-tile:
    backgroundColor: "{colors.surface}"
    textColor: "{colors.foreground}"
    rounded: "{rounded.xs}"
    padding: "{spacing.tile-inset}"
    minSize: "{geometry.board-tile-min}"
  player-token:
    size: "{geometry.token-size}"
    rounded: "{rounded.xs}"
    borderColor: "{colors.foreground}"
  resource-strip:
    backgroundColor: "{colors.surface}"
    textColor: "{colors.foreground}"
    rounded: "{rounded.md}"
    gap: "{spacing.md}"
    minHeight: "{geometry.control-height-lg}"
  action-tray:
    backgroundColor: "{colors.surface}"
    textColor: "{colors.foreground}"
    rounded: "{rounded.lg}"
    padding: "{spacing.md}"
    gap: "{spacing.sm}"
---

# Design System: Office Ladder

## Overview

**Creative North Star: "After-hours office"**

Office Ladder uses a dark, flat, sharp-edged interface that feels like workplace software after the building lights have dimmed and the rules have loosened. The system keeps the legibility and task clarity of product UI, but turns that structure toward a social browser game: clean panels, strong contrast, uppercase status language, and a single electric green accent that reads as progress, momentum, and tactical advantage.

The atmosphere is competitive rather than cozy. Surfaces are square or only lightly rounded, labels are terse, and the visual rhythm favors game-state clarity over decorative personality. Humor should come from the board game's office-drama premise, event copy, and player interaction. The UI itself stays dry, confident, and slightly mischievous.

This system explicitly rejects the strategic anti-reference from `PRODUCT.md`: **polished corporate SaaS**. Even though the game borrows the office as its setting, it must never look like a dashboard, HR portal, or B2B workflow tool. It also rejects glossy toy styling, soft game-casual roundedness, and decorative visual noise that weakens the competitive read.

**Key Characteristics:**
- Dark-first surfaces with strong foreground contrast.
- Flat-by-default panels and controls with minimal shadow reliance.
- Sharp component vocabulary: square tabs, uppercase labels, decisive active states.
- A single saturated green accent used as a game-state signal, not decoration.
- Monospace-forward body copy for a dry, systems-native feel, with Instrument Sans reserved for headings.

## Colors

The palette is a restrained dark system: near-black graphite structure, bright off-white text, and one cool green accent that carries momentum and action.

### Primary
- **Promotion Green** (`oklch(0.527 0.154 150.069)`): The only fully committed accent. Use it for primary actions, selected states, positive game progression, and emphasis that should feel earned rather than ambient.

### Secondary
- **Night Surface** (`oklch(0.21 0.006 285.885)`): The main panel color for cards, modal bodies, and contained gameplay regions. It separates structure from the darker page background without reading glossy.

### Tertiary
- **Panel Underside** (`oklch(0.274 0.006 286.033)`): The denser neutral layer for tabs, toggles, nested UI rails, and any place where a quieter, subordinate surface is needed.

### Neutral
- **Server Room Black** (`oklch(0.141 0.005 285.823)`): The page-field background. Use it for the outer canvas and large framing regions.
- **Cold White** (`oklch(0.985 0 0)`): Primary text and high-priority iconography. This is the system's trust anchor; do not soften it unnecessarily.
- **Shift Report Gray** (`oklch(0.705 0.015 286.067)`): Supporting copy, helper text, and secondary labels. Use only where the information is genuinely secondary.
- **Wireframe Border** (`oklch(1 0 0 / 10%)`): Hairline structure for boundaries and separators. It should read as tension, not decoration.
- **Penalty Red** (`oklch(0.704 0.191 22.216)`): Error, destructive, and setback states.

**The Accent Scarcity Rule.** Promotion Green appears where the game wants action or certainty. If the screen feels green-heavy, the UI is spending emphasis too cheaply.

### Semantic Game Color
- **Warning Amber** (`{colors.warning}`): Pending decisions, deadlines, risk, and event outcomes that require attention but are not errors.
- **Information Blue** (`{colors.info}`): Neutral system notices, remote-player activity, and informational board spaces.
- **Player Identity Colors** (`{colors.player-1}` through `{colors.player-6}`): Six stable identity channels assigned by seat order. They may appear on tokens, dossier rules, avatar frames, and owned-tile markers. They never replace Promotion Green for primary actions.
- Player identity is always expressed by **color plus pattern plus seat number**. Color alone is insufficient for ownership, turn, or location.

## Typography

**Display Font:** Instrument Sans, Geist, Arial, sans-serif
**Body Font:** Geist Mono, Geist, monospace
**Label/Mono Font:** Geist, Arial, sans-serif

**Character:** The pairing creates a split between game presence and system logic. Instrument Sans gives headings a firm, modern voice without turning theatrical. Geist Mono keeps body copy, stats, and interface language dry and mechanical, which supports the office-game fiction and helps the product avoid friendly-SaaS softness.

### Hierarchy
- **Display** (600, `1.875rem`, 1.15, `-0.02em`): Reserved for page titles, auth screens, game-state moments, and primary scene-setting copy.
- **Headline** (600, `1.125rem`, 1.2, `0.08em`): Used for card titles, panel headings, and named gameplay sections. Uppercase treatment is acceptable here when it sharpens the competitive tone.
- **Title** (600, `1rem`, 1.25): Used for row-level emphasis, small section labels, and compact component headings.
- **Body** (400, `0.875rem`, 1.6): Default interface copy, helper text, room details, and explanatory language. Long-form body should still cap at roughly 65-75ch.
- **Label** (600, `0.75rem`, 1, `0.12em`): Buttons, badges, tabs, and state labels. This is the system's terse command voice.
- **Metric** (600, `1rem`, 1.1, `-0.01em`): Money, rank, resource totals, dice results, and compact values that need immediate comparison. Use tabular numerals.
- **Caption** (500, `0.6875rem`, 1.35, `0.04em`): Tile metadata, timestamps, seat numbers, and secondary log context. Captions may be uppercase only when they are short state codes.

**The Two-Voice Rule.** Headings speak in Instrument Sans. Interface logic speaks in Geist or Geist Mono. Do not blur them together until everything sounds like generic product UI.

**Gameplay Type Refinements.** Board labels favor Caption or Label and must remain legible without zooming. Resource values use Metric with `font-variant-numeric: tabular-nums`. Player names stay in Instrument Sans at Title scale so social identity does not collapse into console metadata. Uppercase is reserved for commands, statuses, and short room codes; conversational event and log copy remains sentence case.

## Spatial Direction

**Office floor after closing.** The lobby and game shell should feel like a dark office floor seen after the overhead lights have switched off: the outer canvas is the unlit floorplate, panels are isolated pools of task light, separators behave like partitions and carpet seams, and the board reads as the only fully occupied conference table. The direction is architectural, not illustrative. Do not add desk clip art, fake windows, neon signs, glossy glass, or enterprise-dashboard chrome.

The composition should retain visible negative space around primary regions. Avoid a wall of equally weighted cards. One region owns the scene, one rail carries context, and one anchored tray carries the current decision.

### Semantic Spacing and Geometry
- The base spacing increment is `0.25rem`. Use the named frontmatter scale for all gaps and padding; do not introduce isolated values.
- `shell-gutter` controls page-edge breathing room. `panel-gap` controls major region separation. `tile-inset` is the only board-tile padding value.
- Controls use `control-height-sm`, `control-height-md`, or `control-height-lg`. Core room and turn actions use the medium or large height; compact filters and icon controls use the small height.
- Primary shells use `rounded.lg`; nested controls use `rounded.md` or below. Board spaces and ownership marks use `rounded.xs` so the board remains sharper than the surrounding shell.
- Borders remain one CSS pixel at rendered scale. Use a double boundary only for the active-turn focus treatment, never as ambient decoration.
- Major regions align to a shared shell grid. Do not center every panel independently; alignment should suggest corridors, partitions, and a conference-room table.

## Lobby Shell

The lobby is a waiting room with social presence, not a setup dashboard. It supports **3-6 players** and must never imply that two players can start a match.

### Desktop Layout
- `RoomHeader` spans the shell and anchors room identity, share controls, connection state, and leave action.
- The main region is asymmetrical: the player roster occupies roughly two thirds of the width; a narrower briefing rail holds match summary, readiness guidance, and host controls.
- The roster renders six stable seat positions. Occupied seats use `PlayerDossier`; unoccupied positions use `EmptySeat`. Seats do not reflow when players join, so identity and reading order remain stable.
- Host start controls sit at the bottom of the briefing rail and remain visually subordinate until 3 players are present and all required players are ready.
- Do not use six identical floating cards. The roster should read as one shared table divided into seat bays by hairlines and spacing.

### Lobby States
- **Waiting:** Room code and invite action are prominent; empty seats remain quiet but discoverable.
- **Minimum met:** At 3 players, the start area becomes eligible but remains disabled until readiness rules pass.
- **Ready:** Ready players receive a compact status mark and strengthened identity boundary, not a full green card fill.
- **Host:** Host authority is expressed by a label and action availability, never a crown or novelty icon.
- **Disconnected:** Preserve the seat and identity; mute the dossier, show a connection status, and do not convert it to an empty seat.
- **Starting:** Lock roster actions, show a single transition status in `RoomHeader`, and move into the game shell without celebratory confetti.

## Gameplay Shell

The game shell prioritizes the board, current decision, and social state in that order.

### Desktop Layout
- `RoomHeader` remains as a compact persistent top bar containing room code, round/turn context, connection status, and exit/menu actions.
- `ResourceStrip` sits directly below the header and exposes the local player's money, position, owned departments, and active effects in one horizontal scan.
- The content region uses a board-first split: `BoardViewport` owns the flexible main column; a fixed `gameplay-rail-width` context rail contains the active `PlayerDossier`, remaining-player summaries, and `GameLog`.
- `ActionTray` is anchored to the bottom edge of the board column, not the entire browser window. It contains the current prompt, legal actions, dice or transaction controls, and resolution feedback.
- The right rail may scroll independently only when the viewport can preserve the board and tray. Avoid nested scrolling inside `GameLog` on ordinary desktop heights.

### 12 x 12 Board Geometry
- The board is a CSS Grid with `board-grid-size: 12` columns and 12 rows.
- The perimeter contains exactly **44 board spaces**: 12 across the top, 10 down the right excluding corners, 12 across the bottom in reverse travel order, and 10 up the left excluding corners.
- Every board space occupies one square grid cell. The interior 10 x 10 area is reserved for board title, current-event presentation, turn summary, and ambient table surface; it is not a second application dashboard.
- Travel order begins at the bottom-left corner, proceeds left-to-right across the bottom, bottom-to-top on the right, right-to-left across the top, and top-to-bottom on the left.
- `BoardViewport` keeps the board square between `board-min-size` and `board-max-size`. It centers the board when space permits and provides two-axis pan/scroll when the available width is smaller than `board-min-size`.
- Board coordinates and travel index are data attributes or semantic props, not inferred from DOM order or visual position.

### Tile Categories
- **Start / Review Cycle:** Corner tile and lap origin. Uses Promotion Green only when a player crosses or lands; otherwise it stays neutral.
- **Department:** Purchasable office territory. Shows department name, price/rent cue, ownership mark, and category band. Ownership is player color plus player pattern.
- **Action:** Draws an office-drama action or event. Uses Information Blue as a restrained category cue.
- **Policy:** Applies a rule, fee, or mandatory choice. Uses Warning Amber for unresolved consequence and Penalty Red only after a confirmed loss or invalid action.
- **Transit:** Moves the player or changes routing. Uses a directional glyph and high-contrast neutral treatment rather than a unique decorative palette.
- **Break / Safe:** A pause or protected state. Uses the quiet neutral surface and plain-language status.
- **Corner:** Start, review, break, or other structural spaces. Corners share geometry but retain their semantic category treatment.

Category treatment is a compact edge band, icon, and label. Never flood every tile with saturated color. Tile copy must stay readable at the default board scale; detailed rules belong in a focused overlay or `ActionTray`, not inside the square.

## Player Identities

Office Ladder supports six persistent seat identities. Assignment is deterministic by seat order and remains stable through reconnects.

| Seat | Color token | Pattern token | Shape cue |
| --- | --- | --- | --- |
| 1 | `player-1` | `diagonal-forward` | clipped top-right corner |
| 2 | `player-2` | `dot-grid` | centered inset dot |
| 3 | `player-3` | `diagonal-back` | clipped top-left corner |
| 4 | `player-4` | `horizontal-rule` | double horizontal notch |
| 5 | `player-5` | `checker` | split lower edge |
| 6 | `player-6` | `crosshatch` | centered cross notch |

- Patterns are high-contrast CSS masks or repeating gradients using the identity color and current surface token. They must survive grayscale and color-vision-deficiency simulation.
- A `PlayerToken` always exposes seat number or short initials as text. At crowded tiles, tokens overlap by a system spacing step while preserving every identity cue.
- Promotion Green never becomes a player identity. This protects the global meaning of action, progress, and confirmation.

## Reusable Gameplay Primitives

### RoomHeader
- **Anatomy:** Room identity, room code/share cluster, round or lobby status, connection indicator, utility actions.
- **States:** `lobby`, `starting`, `in-game`, `reconnecting`, `ended`, and `offline`.
- **Behavior:** The primary status is announced politely when it changes. Utility actions remain reachable by keyboard and never compete visually with the current turn action.

### PlayerDossier
- **Anatomy:** Identity marker, player name, seat/host metadata, ready or turn status, resources, connection state, and compact owned-category summary.
- **States:** `waiting`, `ready`, `active-turn`, `thinking`, `resolved`, `disconnected`, `bankrupt`, and `winner`.
- **Behavior:** `active-turn` uses a double boundary, identity marker, and text status. `disconnected` preserves layout. `bankrupt` reduces resource emphasis but retains readable identity and game history.

### EmptySeat
- **Anatomy:** Seat number, invitation affordance, and minimum-player context where relevant.
- **States:** `open`, `invite-copied`, `reserved`, and `locked`.
- **Behavior:** It must read as available capacity without looking like an error or a disabled form field. `locked` is used once the match transition begins.

### BoardTile
- **Anatomy:** Travel index, category cue, short label, price or outcome metadata, ownership mark, and token layer.
- **States:** `default`, `hovered`, `keyboard-focused`, `current-target`, `owned`, `mortgaged-or-inactive`, `resolving`, and `disabled`.
- **Behavior:** Hover never reveals information that keyboard focus cannot reveal. `current-target` is a legal-destination cue; `resolving` is temporary and must not obscure player tokens.

### PlayerToken
- **Anatomy:** Identity color, pattern, shape cue, initials or seat number, and accessible player label.
- **States:** `idle`, `current-player`, `moving`, `landed`, `stacked`, `disconnected`, and `eliminated`.
- **Behavior:** Movement follows the board path between discrete spaces. A stacked token remains individually focusable or discoverable through the tile's player list.

### BoardViewport
- **Anatomy:** Square board stage, pan/scroll container, optional zoom controls, and edge affordances that indicate off-screen board content.
- **States:** `fit`, `overflow-x`, `overflow-both`, `panning`, and `focus-follow`.
- **Behavior:** Keyboard focus may bring a tile into view but must not steal focus. Zoom controls, if implemented, use named discrete steps and expose the current scale in text.

### ResourceStrip
- **Anatomy:** Cash, board position, owned-department count, active effects, and local turn status.
- **States:** `stable`, `gain`, `loss`, `warning`, `updating`, and `spectating`.
- **Behavior:** Values use Metric typography and tabular numerals. Gain/loss feedback includes signed text and does not depend on green/red alone.

### ActionTray
- **Anatomy:** Current prompt, context sentence, primary action, secondary/legal alternatives, pending indicator, and result feedback.
- **States:** `waiting`, `your-turn`, `choice-required`, `rolling`, `transaction`, `confirming`, `resolving`, `resolved`, `blocked`, and `error`.
- **Behavior:** Only one primary action appears at a time. Destructive or irreversible actions require explicit wording. The tray retains its footprint during async transitions to avoid moving the board.

### GameLog
- **Anatomy:** Timestamp or turn index, actor identity, concise event copy, resource delta, and optional expand control for rule detail.
- **States:** `live`, `paused`, `unread`, `expanded`, `reconnecting`, and `empty`.
- **Behavior:** New entries append without taking keyboard focus or forcing a user away from older entries. Actor identity uses color, pattern, and text. The log is sentence case and reads like dry office incident reporting, not developer telemetry.

## Motion

- Use `duration-fast` for hover, focus, and pressed feedback; `duration-base` for tray and rail state transitions; `duration-emphasis` for token travel between spaces and match-state transitions.
- Use `easing-standard` for stateful transforms and fades. Use `easing-linear` only for deterministic progress indicators.
- Token movement is path-based and purposeful: translate between tile centers, pause briefly at the destination, then resolve the tile. Do not add bounce, spin, or random flourish.
- Resource changes use a short opacity/translate emphasis on the changed value while keeping the final value visible throughout.
- Lobby-to-game transition may tighten the room shell into the board shell through opacity and transform only. No confetti, parallax office scenery, or decorative ambient loops.
- Under `prefers-reduced-motion: reduce`, token travel becomes an immediate position change with a destination highlight; all other transitions become instant or a short crossfade.

## Responsive Behavior

- **Wide desktop (`>= 80rem`):** Board and context rail sit side by side. The board may grow to `board-max-size`; the rail remains within `gameplay-rail-width`.
- **Desktop and tablet landscape (`64rem-79.999rem`):** Preserve the side rail, reduce shell gaps through named spacing tokens, and keep the board at or above `board-min-size` with viewport panning if required.
- **Tablet portrait (`48rem-63.999rem`):** Stack `ResourceStrip`, `BoardViewport`, `ActionTray`, active `PlayerDossier`, and `GameLog`. Keep the action tray immediately after the board in reading and focus order.
- **Mobile (`< 48rem`):** `RoomHeader` wraps into two rows. Lobby seats become one shared vertical roster. Gameplay uses a horizontally and vertically scrollable `BoardViewport`; do not shrink the 12 x 12 board below `board-min-size` or reduce tile text below Caption scale.
- On small screens, `ResourceStrip` may scroll horizontally as a single labeled strip. It must not collapse values into icon-only controls.
- `ActionTray` may become sticky to the viewport bottom only when it does not cover focused board content and respects safe-area insets.
- The same game actions and state information are available at every breakpoint. Responsive adaptation changes arrangement, not capability.

## Accessibility Constraints

- Core lobby and gameplay flows are fully keyboard operable: join, ready, start, inspect tile, roll, choose, transact, and end turn.
- Visible focus uses a high-contrast shared ring plus local boundary change. Focus is never indicated by player color alone.
- Board navigation follows travel order with arrow-key support where implemented; Tab order remains reserved for interactive controls rather than traversing all 44 tiles by default.
- Every `BoardTile` has an accessible name containing travel position, tile name, category, ownership, and current occupants. Decorative pattern layers are hidden from assistive technology.
- Live announcements are limited to turn changes, required decisions, connection changes, and committed game outcomes. Token-by-token animation steps are not announced.
- Status, ownership, and player identity always combine text with color and pattern. Green/red-only gain-loss communication is prohibited.
- Minimum pointer target is `2.75rem` square for interactive board and shell controls, even when the visible glyph is smaller.
- Text contrast follows WCAG AA: body and caption text target 4.5:1; large display text and essential graphical boundaries target 3:1 against adjacent surfaces.
- Board panning must not trap keyboard focus or browser zoom. At 200% browser zoom, the active action and focused tile remain reachable without loss of content.
- Timed decisions, if introduced, require a visible text countdown and a non-color warning state; do not introduce them without a documented extension to this contract.

## Accepted Debt

- The initial implementation may use CSS-generated player patterns rather than bespoke illustrated token assets. This is accepted only while all six patterns remain distinct at the minimum token size.
- The first gameplay shell may provide fit-to-board plus one magnified board scale rather than continuous zoom. Continuous zoom and gesture inertia are deferred until real-device testing proves a need.
- `GameLog` may begin as a chronological feed without filtering or event grouping. It must still preserve actor identity, turn index, and resource deltas.
- Complex tile-rule detail may open in `ActionTray` rather than a dedicated board inspector during the first implementation. The focused tile must remain identified while the detail is open.
- Spectator-specific layout is not part of the first lobby/game shell contract. Existing disconnected or eliminated players continue to use the defined dossier states; a dedicated spectator mode requires a future contract extension.

## Elevation

Office Ladder is flat by default. Depth is conveyed through tonal separation, border tension, and active-state contrast, not through plush shadows. When shadow appears, it should feel structural and short-range, never soft-focus or atmospheric.

### Shadow Vocabulary
- **Table Edge** (`0 1px 2px rgba(0, 0, 0, 0.24)`): Low structural lift for contained surfaces that need separation from the page field.
- **Spotlight Hover** (`0 4px 8px rgba(0, 0, 0, 0.22)`): Reserved for rare hover or transient emphasis moments. Never combine with a decorative border treatment on the same element.

**The Flat-By-Default Rule.** If a surface can be understood through contrast and spacing alone, it gets no extra shadow.

## Components

### Buttons
- **Shape:** Gently squared corners (`0.5rem`) with no pill treatment.
- **Primary:** Promotion Green background with pale green text, uppercase label styling, and a firm `2.5rem` height. Primary buttons should feel like committed actions, not playful chips.
- **Hover / Focus:** Hover darkens the fill slightly; focus uses the shared ring token rather than a glow or bloom.
- **Secondary / Ghost / Tertiary:** Outline and ghost variants stay restrained, leaning on contrast and border shifts rather than color fill.

### Chips
- **Style:** Text-led, uppercase, and often borderless. Chips and badges should read like signals or metadata, not rounded stickers.
- **State:** Selected states are driven by text contrast and active underlines or fills, not candy-color fills.

### Cards / Containers
- **Corner Style:** Tight rounding (`0.625rem` max in system primitives; custom gameplay containers should not exceed `1rem`).
- **Background:** Use Night Surface or other dark neutrals, never milky translucency as a default pattern.
- **Shadow Strategy:** Minimal. Prefer ring and tonal layer separation before any shadow.
- **Border:** Fine structural lines only.
- **Internal Padding:** Usually `1.5rem` at standard density, with compact modes stepping down to `0.5rem` rhythm units.

### Inputs / Fields
- **Style:** Transparent or surface-matched fields with a strong bottom-edge or perimeter boundary. Inputs should feel tool-like and immediate.
- **Focus:** Boundary color changes are the primary focus cue; pair with the shared ring only where extra emphasis is needed.
- **Error / Disabled:** Penalty Red for invalid state, opacity reduction for disabled. Do not blur or haze fields into the background.

### Navigation
- **Style:** Tabs and sectional navigation are sharp, compact, and label-driven. The default tab treatment uses dark layers; the line variant uses a visible active rule instead of a soft segmented-pill pattern.
- **Typography:** Uppercase or tightly controlled label text is encouraged for game-state sections.
- **Mobile Treatment:** On narrow widths, preserve hierarchy through stacking and wrapping, not by shrinking labels into illegibility.

### Badges
- **Style:** Minimal, uppercase, and often text-only. They should feel like status tags from a system console, not collectible flair.
- **Use:** Good for player states, role hints, turn indicators, and compact metadata.

## Do's and Don'ts

### Do:
- **Do** keep the page field dark (`oklch(0.141 0.005 285.823)`) and let the brighter surfaces emerge through layered neutrals rather than decorative effects.
- **Do** use Promotion Green (`oklch(0.527 0.154 150.069)`) for primary actions, active selections, and meaningful progress only.
- **Do** keep corners square-to-tight (`0rem` to `0.625rem` in core primitives, never giant rounding on gameplay containers).
- **Do** favor uppercase labels, concise state language, and strong contrast for controls that need to read quickly in multiplayer play.
- **Do** preserve keyboard-friendly focus states and mobile-capable layout adaptation as first-class product requirements.

### Don't:
- **Don't** let this feel like **polished corporate SaaS**. No enterprise-dashboard tone, no B2B-app polish language, no faux productivity-software framing.
- **Don't** use gradient text, glassmorphism, or soft translucent blur cards as default styling patterns.
- **Don't** pair decorative wide shadows with crisp borders on the same control. Pick one structural cue.
- **Don't** turn badges, tabs, or buttons into rounded toy-like pills unless a specific gameplay moment earns it.
- **Don't** spend the accent on decoration. If inactive UI is bright green, the system has lost its hierarchy.
