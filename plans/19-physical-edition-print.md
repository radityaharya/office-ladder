# Physical Edition And Print

Status: Optional downstream plan
Owner: Game design, production design, and manufacturing owner
Updated: 2026-07-18

## Outcome

Generate the physical board game, print-and-play package, and manufacturing handoff from the same canonical content and assets as the digital game.

## Prerequisites

Resolve before production:

- Canonical 44-space ruleset.
- Exact Clock Deck quantities.
- Six-deck Shuffle eligibility.
- Character and hidden-allegiance component distribution.
- Movement/check dice rules.
- Physical tracking for cooldowns, laps, skips, Audit, Burnout, deck counts, and abilities.
- Money denominations and quantities.
- EN/ID separate or bilingual edition strategy.

The 247 count covers gameplay decks only. Character, identity, and reference cards are additional components.

## Shared Content

All digital and print outputs consume canonical IDs, effects, localized text, artwork assignments, and version metadata.

Generate:

- Board.
- Card fronts/backs.
- Rulebook and quick start.
- Player boards/reference sheets.
- Tokens/trackers.
- Component checklist.
- Print-and-play exports.
- Manufacturing manifest.

## Versioning

Track:

- Rules version.
- Content revision/hash.
- Language/SKU.
- Print template/render version.

Every PDF and box/component mark includes compatible version identifiers and immutable archived rules URL.

## A2 Board

Baseline:

- Trim: 420 x 594 mm.
- Provisional bleed: 3 mm, subject to manufacturer.
- General safe zone: 5 mm; critical text preferably 8 mm.
- Raster art: 300 PPI effective.
- Line art/text: vector.

A folding mounted board requires manufacturer dieline, wrap allowance, hinges, thickness, grain, and tolerances.

Use a near-square play area with utility region for career/deck/reference information only if table testing confirms readability.

Provide:

- Manufacturing one-up board.
- Full A2 print-and-play board.
- Tiled A4 and US Letter versions with calibration marks.

## Cards

Provisional poker format:

- Trim 63 x 88 mm.
- Bleed 3 mm.
- Safe area 5 mm.
- Minimum body target 8.5-9 pt.
- Manufacturer-defined corner radius.

Six gameplay deck backs plus separate character and identical hidden-allegiance backs.

Backs use icon, text, pattern, and color; no fine trim-adjacent border that marks cutting drift.

Print compact card ID and release mark inside safe zone.

## Imposition

Manufacturing:

- Deliver one card per PDF page unless printer requests imposed sheets.
- Let printer control press imposition and collation.
- Confirm combined versus per-deck files and packaging.

Print-and-play:

- A4 and US Letter.
- Duplex and fronts-only sleeve versions.
- Registration-tolerant backs.
- Low-ink option.
- Cut marks/page numbers and flip instructions.
- Card-count checklist.

## Color

- Maintain digital design intent in OKLCH/sRGB.
- Define approved print swatches.
- Use printer ICC profile.
- PDF/X-4 unless printer requires otherwise.
- 100K small black text; approved rich black for large fields.
- Check total ink coverage.
- Physical swatch proof for dark surfaces, Promotion Green, red, fine rules, and text.

Dark-heavy art requires scuff/glare/readability testing under real lighting.

## Fonts And Icons

- Confirm commercial print and embedding rights.
- Archive static font files/version/checksum/license.
- Embed fonts and avoid synthetic styles.
- Test all locale glyphs.
- Replace emoji with licensed print-safe SVG iconography.

## QR And Rules Archive

Put QR/short URL on rulebook/box and optionally board utility area, not every card.

URL identifies SKU, locale, and rules version and links to rules, accessibility files, errata, and replacement information.

## Component Inventory

Known baseline:

- Board: 1.
- Gameplay cards: 247.
- Character cards: 6.
- Hidden allegiance set sufficient for every supported player count.
- Pawns: 6.
- D6 dice: 2.
- MOVE 18, MOMENTUM 18, REP 12, MONEY 12.
- Rank markers/player trackers.

Still define:

- Currency bank.
- Reputation/Energy/Work Counter trackers.
- Lap/cooldown/Audit/Burnout/skip markers.
- Management ability counters.
- Deck/discard counters.
- Player boards/reference cards.
- Insert, bags/dividers/tuckboxes, box labeling.

Six player boards are recommended to consolidate resources, rank, cooldowns, and status tracking.

## Accessibility

- Color plus icon/text/shape/pattern.
- Distinct pawn silhouettes.
- Large-print and tagged rulebook PDF.
- Text-only accessible card list.
- High-contrast/low-ink print-and-play.
- Real printed readability and dexterity testing.
- Clear distinction between flavor and rules.

## Localization

Generate EN and ID outputs from shared mechanics/localization catalogs. Separate language editions are safer than bilingual cards unless testing proves text density acceptable.

Use pseudolocalization and gameplay-equivalence review.

## Print-And-Play Package

- Full and tiled board.
- Card fronts by deck.
- Deck-specific/universal prototype backs.
- Low-ink cards.
- Tokens/trackers/player boards.
- Rulebook, quick start, references.
- Component checklist and assembly guide.
- Accessible card list.
- 50 mm calibration bar and “print at 100%” guidance.

## Manufacturing Handoff

Package:

```text
README/specifications/BOM
board/cards/rulebooks/player-boards/tokens/box/insert
dielines/color-proofs/font-and-asset-licenses
preflight reports/checksums/source manifest
```

Include dimensions, tolerances, materials, finish, card stock/core, folds, color profile, quantities, collation, packaging, legal/safety labels, language matrix, and replacement IDs.

## Proofing Gates

1. Content proof.
2. Automated preflight.
3. Full contact sheets.
4. Home prototype.
5. Table readability.
6. White dummy.
7. Digital press proof.
8. Contract color proof.
9. Complete pre-production sample.
10. Signed golden master checksums.

Any correction increments revision and invalidates prior checksums.

## Acceptance Criteria

- Printed wording and effects match executable content.
- All card/board/component counts validate automatically.
- EN/ID outputs are generated from one release.
- Preflight confirms bleed, safe zones, fonts, images, PDF profile, and backs.
- Physical sample validates color, cutting, readability, handling, and collation.
- Golden manufacturing package is immutable and checksummed.
