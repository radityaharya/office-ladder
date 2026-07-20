# Accessibility And Localization

Status: Proposed
Owner: Frontend accessibility and content localization
Updated: 2026-07-18

## Targets

- WCAG 2.2 AA.
- Full keyboard operation.
- Screen-reader parity for game information and actions.
- 200% zoom and reflow without loss of gameplay.
- Alternate list representation for the visual board.
- Reduced motion and sound controls.
- English (`en`) and Indonesian (`id`) launch architecture.
- RTL-prepared layout without claiming RTL support before testing.

## Personal Settings

- Interface language.
- Screen-reader verbosity.
- Motion: system, reduced, full.
- Sound: full, essential, muted/custom.
- Music/effects volume.
- High-contrast tokens.
- Larger UI/card text.
- Visual board or list view.
- Confirm irreversible actions.
- Auto-focus behavior.

Room-level accommodations that change rules must be disclosed before start:

- Extended/no turn timer.
- Extended reaction window.
- Disconnect pause policy.

Do not identify which player requested an accommodation.

## Semantic Structure

Provide landmarks and skip links for:

- Current turn/actions.
- Own player state.
- Board.
- Player list.
- Deck status.
- Activity log.
- Hand/private cards.
- Rules/help.

Use controlled live regions:

- Polite for routine outcomes.
- Assertive only for expiring local decisions and blocking errors.

Do not announce every timer tick or pawn step.

## Board Accessibility

The canonical board is an ordered movement list. CSS controls visual placement without changing DOM movement order.

Each space exposes:

- Space number.
- Localized name and type.
- Short effect.
- Occupants.
- Relevant status.
- Origin/destination state.

Avoid 44 normal Tab stops. Use one Explore Board entry point with arrow-key navigation, Home/End, shortcuts to current positions, and Escape to leave.

Provide a searchable/list view grouped by side or tile type.

## Keyboard

- Native controls first.
- `Tab` between major controls.
- Arrows within composite board/hand widgets.
- `Enter`/`Space` activate.
- `Escape` closes/cancels.
- Optional shortcuts are discoverable, disable while typing, and avoid assistive-technology conflicts.
- Focus returns to the invoking control after dialogs.

Turn actions appear in phase order and disabled actions explain why they are unavailable.

## Focus Management

Move focus only for meaningful context changes:

- Role reveal.
- Blocking prompt.
- Required target/choice.
- Reauthentication.
- Game result.

Do not focus dice animation, moving tokens, toasts, or changing resource counters.

## Timers

Provide numeric and textual remaining time, optional progress, visual urgency, and optional sound.

Screen-reader thresholds:

- Turn start.
- 10 seconds.
- 5 seconds.
- Expiration/resolution.

Explain timeout behavior before play and log automatic choices.

## Hidden Information

- Private data is not rendered before reveal.
- Reveal is user-initiated.
- Warn that screen-reader speech may reveal private information aloud.
- Provide Hide Role and restore focus.
- Public announcements never contain unrevealed roles or hands.
- Unauthorized clients never receive hidden data, even visually hidden.

## Cards

Structured accessible card order:

1. Deck and category.
2. Title.
3. Optional flavor.
4. Mechanical effect.
5. Timing/duration.
6. Target rule.
7. Current status.

Allow users to suppress repeated flavor text in announcements.

Artwork is decorative when adjacent card text fully communicates the card.

## Color And Contrast

- Normal text 4.5:1.
- Large text and meaningful graphics 3:1.
- Focus rings and boundaries remain visible.
- Color never solely communicates player, deck, token, polarity, selection, eligibility, timer, or role.
- Test forced colors, grayscale, and common color-vision deficiencies.

## Motion And Sound

Reduced motion replaces:

- Dice tumble -> immediate result.
- Tile-by-tile movement -> origin/destination emphasis.
- Card flip -> crossfade.
- Confetti/particles -> static result.
- Timer pulse -> static weight/color change.

Audio never communicates a unique result without visible text. Music, effects, warnings, and haptics are independently controllable where practical.

## Cognitive Load

Show one primary question at a time while preserving relevant context:

- Current phase and player.
- Source tile/card.
- Relevant resources.
- Deadline.
- Known consequences.

Provide searchable rules, glossary, contextual explanations, and “Why did this happen?” details for resource/status changes.

## Localization Architecture

Use locale-prefixed routes:

```text
/[lang]
/[lang]/sign-in
/[lang]/rooms/[roomCode]
/[lang]/rules
```

Set root `lang` and `dir` from route locale. Keep room/game IDs locale-neutral and preserve match state across language switching.

Use ICU MessageFormat-capable catalogs with namespaces for auth, lobby, game status/actions, board, cards, characters, promotions, rules, errors, and accessibility.

Realtime events contain semantic data, not pre-localized sentences.

## Terminology

Create and approve an EN/ID glossary before translating all cards, including:

- Worker/Pekerja.
- Management/Manajemen.
- Reputation/Reputasi.
- Energy/Energi.
- Work Counter.
- Clock Deck.
- Stored card.
- Reaction.
- Promotion and ranks.
- Audit and Burnout.
- Token names and deck names.

Visual uppercase should be styling, not forced catalog casing.

## Numbers And Currency

Use locale-aware formatting through `Intl`/i18n:

- English grouping `1,000`.
- Indonesian grouping `1.000`.
- Duration and plural rules localized.

Clarify whether `$` is fictional game money or USD. Do not change economic values by locale.

## Artwork Localization

- Keep text out of illustrations.
- Render localized text in UI/print templates.
- Design for 30-50% expansion.
- Locale-specific artwork only when unavoidable and explicitly registered.
- Perform cultural review for workplace, food, smoking, holidays, gestures, hierarchy, and representation.

## RTL Preparedness

- Use logical CSS properties.
- Feed locale direction into the direction provider.
- Keep board movement canonically clockwise regardless of document direction.
- Isolate room codes and IDs as LTR.
- Add pseudo-RTL testing before supporting a real RTL locale.

## Testing

- Catalog key and placeholder parity.
- No hard-coded gameplay strings.
- Pseudo-localized expansion and pseudo-RTL.
- Axe/component tests.
- Keyboard-only E2E.
- Reduced motion, forced colors, zoom, mobile.
- Manual NVDA, VoiceOver, Narrator, and TalkBack coverage.
- Multiplayer tests for live announcements and hidden information.

## Acceptance Criteria

- A keyboard-only player can complete a match.
- A screen-reader player can understand and complete all core decisions.
- Visual board information has an equivalent textual representation.
- Hidden information remains private in DOM and announcements.
- Timers have documented accommodations and non-audio/non-color cues.
- EN and ID catalogs cover every tile, card, character, status, action, and error.
- Language switching does not interrupt game state.
