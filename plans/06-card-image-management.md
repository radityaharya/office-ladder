# Card Image Management

Status: Proposed
Owner: Art direction, content design, and frontend engineering
Updated: 2026-07-18

## Outcome

Manage imagery for 247 cards across six decks without producing 247 manually maintained flattened card images.

## Core Decision

Use template-composed cards:

- Deck-specific frame and back.
- Real localized HTML/SVG text.
- Reusable illustration motif.
- Structured category/timing/resource icons.
- Shared overlays and texture system.

Flattened cards are derived outputs for print, QA, contact sheets, marketing, and offline references. They are never the source of truth.

Benefits:

- EN and ID text can change without repainting art.
- Balance updates do not invalidate illustrations.
- Web text stays accessible and responsive.
- Digital and print render from one component and content source.
- Reusable motifs reduce cost and style drift.
- Secret card identity is not encoded in predictable unique image URLs.

## Inventory

| Deck | Cards | Proposed motif masters |
|---|---:|---:|
| Work | 50 | 8 |
| Meeting | 50 | 8 |
| Event | 50 | 10 |
| Networking | 47 | 8 |
| Board Meeting | 25 | 7 |
| Annual Event | 25 | 7 |
| Total | 247 | 48 |

Also produce:

- Six front frame systems.
- Six backs.
- Six deck icons.
- Shared resource/category/timing icons.
- Shared overlays such as stamps, redactions, toner streaks, sticky notes, coffee rings, warning tape, and confetti.

## Visual Direction

Extend the after-hours office style:

- Editorial collage and photocopier texture.
- Anonymous office silhouettes and objects.
- Fluorescent nighttime atmosphere.
- Dry visual jokes.
- Strong negative space for text.

Avoid:

- Polished corporate stock vectors.
- Real company logos or products.
- Generated typography inside illustrations.
- Illustration details required to understand mechanics.
- Overuse of Promotion Green.

## Card IDs

Each physical card instance receives an immutable production ID:

```text
OL-WRK-001..050
OL-MTG-001..050
OL-EVT-001..050
OL-NET-001..047
OL-BRD-001..025
OL-ANN-001..025
```

Canonical definition IDs remain semantic, for example `card.event.helping-hand-target`. Physical copies can reference a shared definition.

Track separately:

- `contentVersion`
- `artVersion`
- `templateVersion`
- `renderVersion`

## Data Contracts

### Card Rules

- Physical card ID.
- Canonical definition ID.
- Deck/category/lifecycle/timing.
- Structured effect.
- Artwork ID.
- Release and approval status.

### Localized Copy

- Title.
- Flavor wording.
- Rules/effect text.
- Accessible summary.
- Locale.

### Artwork Manifest

- Artwork ID and concept.
- Source master and checksum.
- Web derivative and dimensions.
- Generation method and provenance.
- Art version, license status, and review status.

## Storage

```text
content/cards/
  cards.json
  locales/en.json
  locales/id.json
  artwork-manifest.json

assets-source/cards/
  templates/
  motifs/
  icons/
  overlays/
  backs/
  provenance/
  proofs/

src/assets/cards/generated/
src/generated/card-asset-registry.ts
scripts/cards/
dist/cards/                  generated and ignored
```

Do not expose unique hidden card fronts through predictable `public/cards/fronts/...` paths.

## Front Composition

Card face regions:

1. Deck rail with icon and label.
2. Illustration window, approximately 35-42% of the card.
3. Title.
4. Flavor wording region where applicable.
5. Structured effect region.
6. Category/timing labels.
7. Resource and target icons paired with text.
8. Short production ID/revision footer.

Networking, Board Meeting, and Annual Event templates reserve more room for read-aloud flavor text.

## Backs

Create one back per deck with:

- Shared Office Ladder/Deadline Dash motif.
- Deck name and icon.
- Unique structural pattern and restrained accent.
- Similar ink density and identical dimensions.
- Bleed-safe borderless pattern.
- No per-card marks.

Meeting and Event backs share a small Clock Deck symbol but remain distinguishable.

## Localization

- Artwork remains locale-neutral.
- EN and ID share IDs, effects, and artwork assignments.
- Text is rendered from catalogs.
- Effects should be generated from structured mechanics where practical.
- Flavor is editorially localized.
- Allow at least 30% text expansion.
- Overflow is a build failure, not truncation.
- Current root `lang="en"` must become locale-aware before launch.

## Accessibility

Web cards use real semantic text.

- Decorative motif image uses empty alt text when adjacent card text is complete.
- Store localized art descriptions for galleries/editorial tools.
- Flattened card images require a concise accessible label containing deck, title, effect, and timing.
- Do not duplicate full card copy in image alt text when semantic text is adjacent.

## AI-Assisted Artwork Policy

Allowed for ideation and base illustration with human editing.

Required:

- No imitation of named living artists or franchises.
- No real logos, people, confidential references, or generated UI text.
- Human cleanup for artifacts and palette consistency.
- Commercial-use terms recorded at generation time.
- Original output and edited master retained separately.
- Exact model/version, seed, prompt, references, settings, hashes, editor, and approvals recorded.
- Uncertain rights block release.

Prompt records are append-only. A prompt update creates a new version.

## Review Workflow

1. Complete canonical 247-card inventory and IDs.
2. Approve a 12-card visual pilot covering all decks and stress cases.
3. Approve all six backs.
4. Produce and review motif masters.
5. Assign motifs to all physical IDs.
6. Review deck contact sheets for repetition, tone, polarity, representation, and misleading art.
7. Review EN/ID copy and overflow.
8. Complete accessibility, legal, security, and print sign-off.

Status flow:

```text
draft -> art-ready -> generated -> edited -> legal-reviewed
-> localization-reviewed -> print-proofed -> approved
```

## Automated Rendering

Planned commands:

```text
cards:validate
cards:render:web
cards:render:print
cards:contact-sheets
cards:visual-test
cards:preflight
```

Use one React/SVG card component for browser, visual tests, and print rendering. Pin fonts, browser renderer, dependencies, dimensions, color profile, and template version.

Validation fails on:

- Wrong deck counts.
- Duplicate/missing IDs.
- Missing locale records.
- Missing/unapproved artwork.
- Missing provenance.
- Checksum mismatch.
- Text overflow.
- Missing accessible summary.

## Web Delivery

The client downloads motifs, not 247 flattened card faces.

- Static imports for approved public motifs.
- `next/image` for raster motif windows.
- Accurate `sizes` with `fill`.
- Blur/dominant-color placeholders.
- Preload only current public/revealed cards.
- Do not preload hidden decks or other players' hands.
- Hashed immutable caching.

Reusable motifs may be public because they do not identify a card. Mapping card ID to rules, title, and artwork remains server-authorized until reveal.

## Hidden Information

Never:

- Send full shuffled deck order to clients.
- Import all private card definitions into a Client Component.
- Render hidden faces with CSS hiding.
- Put private card IDs/titles/artwork mapping in RSC payloads, logs, analytics, or preloads.
- Use a blur of the hidden face as placeholder.

Use card backs for hidden cards. Other players receive only permitted deck/count information.

## Visual Regression

PR suite:

- Approximately 24 representative cards.
- All decks, locales, long copy, categories, fronts/backs, desktop/mobile.

Release suite:

- All 247 cards in EN and ID: 494 fronts.
- Six backs.
- Contact sheets and print proofs.
- DOM overflow and font-fallback assertions.

Baselines update only through explicit reviewed commands.

## Print Baseline

Provisional poker size:

- Trim: 63 x 88 mm.
- Bleed: 3 mm each side.
- Canvas: 69 x 94 mm.
- Raster illustration: 300 effective DPI.
- Safe area: at least 4-5 mm inside trim.
- Keep vector text live through PDF export.

Use printer-supplied ICC profile and PDF/X requirements. Approve a physical pilot before full production.

## Acceptance Criteria

- Exactly 247 immutable physical IDs exist.
- Every card has approved EN/ID content and artwork assignment.
- Six cut-safe distinct backs exist.
- Web text remains semantic and accessible.
- Hidden cards cannot be discovered through payloads, DOM, preloads, or private URLs.
- All localized fronts pass overflow and visual review.
- AI-assisted art has complete provenance and rights approval.
- Print outputs pass bleed, safe-area, resolution, font, color, and duplex checks.
