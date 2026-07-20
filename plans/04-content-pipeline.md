# Content Pipeline

Status: Proposed
Owner: Game design and content engineering
Updated: 2026-07-18

## Outcome

Transform the workbook and GDD into reviewed, typed, localized, immutable content packs consumed by the engine, UI, documentation, simulations, and physical edition.

## Source Authority

Bootstrap precedence:

1. Accepted rules decisions.
2. Canonical structured content after initial import.
3. XLSX workbook for concrete inventory and raw copy.
4. v3.2 GDD for mechanics and policies absent from the workbook.
5. How-to documents as derived player-facing output.
6. Legacy 28-space document as historical reference.

Conflicts must enter a decision ledger. Importers must not silently choose a winner.

## Pipeline

```text
immutable source snapshots
  -> deterministic extraction
  -> raw normalized candidates
  -> conflict report and decisions
  -> canonical authored content
  -> schema and semantic validation
  -> localization and asset validation
  -> simulations and previews
  -> immutable server/client/print bundles
```

## Proposed Structure

```text
content/
  source/
    workbook/
    gdd/
  raw/
  decisions/
    source-resolutions.yaml
    id-registry.yaml
  canonical/
    rules.yaml
    modes.yaml
    board.yaml
    ranks.yaml
    characters.yaml
    management.yaml
    decks.yaml
    cards/
    locales/
  generated/
    server-content.json
    public-content.json
    manifest.json
    source-report.json
    content-diff.md

scripts/content/
  extract-xlsx.ts
  extract-gdd.ts
  normalize.ts
  validate.ts
  compile.ts
  diff.ts
  preview.ts
  simulate.ts
  release.ts
```

## Raw Preservation

Preserve source coordinates and checksums for every imported value:

- Workbook file hash, sheet, row, cell, raw/formatted value, formula.
- Markdown file hash, heading path, and line range.
- Extractor version and import timestamp.
- Decision IDs that altered or clarified the source.

Source changes create a new snapshot. Never overwrite previous raw extraction.

## Stable IDs

Display names are not identity.

Examples:

```text
ruleset.deadline-dash
mode.quick
rank.assistant-manager
character.workaholic
deck.board-meeting
card.event.helping-hand-target
card.event.helping-hand-choice
tile.board.00.receptionist
status.burnout-energy
```

Rules:

- IDs are immutable after release.
- Retired IDs become tombstones.
- Display-name changes do not rename IDs.
- Same-name cards with different behavior have different IDs.
- Repeated identical physical copies use one definition plus `quantity` where appropriate.
- Board tile instance IDs are separate from tile type IDs.

## Canonical Bundle

```ts
type GameContent = {
  schemaVersion: number;
  contentVersion: string;
  releaseId: string;
  rulesetId: string;
  sourceDigest: string;
  rules: RulesConfig;
  modes: Record<ModeId, ModeConfig>;
  resources: Record<ResourceId, ResourceConfig>;
  tokens: Record<TokenId, TokenConfig>;
  ranks: RankConfig[];
  characters: Record<CharacterId, CharacterConfig>;
  management: ManagementConfig;
  board: BoardConfig;
  decks: Record<DeckId, DeckConfig>;
  cards: Record<CardId, CardConfig>;
  localization: LocalizationManifest;
};
```

## Card Content

Each card separates mechanics from text:

- Stable card definition ID.
- Physical quantity/instance IDs where needed.
- Deck and lifecycle.
- Timing and target policy.
- Structured effects.
- Categories and tags.
- Localization keys for name, rules, flavor, and accessible summary.
- Artwork ID.
- Enabled modes.
- Provenance and review status.

Runtime code never parses free-text effects.

## Semantic Mapping

Map source phrases to a finite effect AST through a reviewed mapping layer. Do not use an opaque natural-language parser.

Mapping priority:

1. Resource changes.
2. Global and target effects.
3. Stored cards.
4. Duration and next-trigger modifiers.
5. Choices and conditions.
6. Dice contests, rerolls, chained draws, and cancellation.
7. Reaction eligibility and complex custom handlers.

Unmapped records remain `needsReview` and cannot enter a production content release.

## Localization

Launch catalogs:

- `en`
- `id`

Use one localization key across locales. Keep mechanics locale-neutral.

Separate:

- Name.
- Short description.
- Rules text.
- Flavor wording.
- Accessible summary.

Use ICU-compatible placeholders and validate placeholder parity.

The EN and ID How-to guides should eventually be generated or validated from the canonical content and rules, not edited as independent authorities.

## Validation

### Structural

- Required fields and enums.
- Unique IDs.
- Exact expected deck/card counts.
- No unresolved placeholders.
- Valid localization keys and artwork references.

### Referential

- Every card references an existing deck.
- Every effect references valid resources, statuses, targets, and custom handlers.
- Every board tile references valid content.
- Promotion chain is contiguous.
- Every mode references valid decks and limits.

### Semantic

- Dice ranges are valid and non-overlapping.
- Costs use one sign convention.
- Transfers define insufficient-funds behavior.
- Stored cards define hand/play timing.
- Reactions define triggers.
- Durations define expiry and stacking.
- Movement defines traversal and salary behavior.
- Chained draws have safety limits.

### Game Invariants

- Exactly 44 board positions.
- Required corner indexes and tile distribution.
- Nine-rank ladder ending at Director.
- Six deck definitions.
- Clock composition defined per mode.
- Management count defined for supported player counts.
- Every timeout choice has a legal default.

## Preview Tools

- Content browser.
- Card gallery.
- Board visualizer.
- Effect inspector showing raw source beside normalized behavior.
- Turn sandbox.
- Deterministic match sandbox.
- Deck composition inspector.
- Localization overflow preview.
- Provenance viewer.
- Release diff and balance simulation dashboard.

## Versioning

Track separately:

- `schemaVersion`: data shape.
- `contentVersion`: human-facing semantic version.
- `releaseId`: immutable build identity.
- `balancePatchId`: immutable numeric overlay.
- `sourceDigest`: accepted source/decision hash.
- `bundleHash`: compiled output hash.

Rooms pin the complete resolved content release at match creation.

## Balance Patches

Safe patch targets:

- Resource amounts.
- Promotion costs.
- Starting resources.
- Token caps.
- Card quantities/weights.
- Character cooldowns.
- Mode timer/deck sizes.
- Enabled flags.

Changing effect shape, timing, or target policy requires a normal content/rules release.

## Release Process

1. Freeze source snapshots.
2. Resolve release-blocking decisions.
3. Extract and verify checksums.
4. Validate schemas and references.
5. Run semantic and localization linting.
6. Compile server and public bundles.
7. Run effect fixtures and deterministic scenarios.
8. Run simulations and thresholds.
9. Review board/card/localization previews.
10. Publish immutable staging release.
11. Smoke-test multiplayer with pinned release.
12. Promote environment pointer and retain rollback release.

## Acceptance Criteria

- Every source row is imported, explicitly ignored, or blocked with a reason.
- Every gameplay effect is structured and executable without parsing prose.
- Every entity has stable ID, provenance, localization, and validation status.
- Production bundles are immutable and reproducible.
- Active matches continue on their pinned release after new content ships.
- Player rules, digital UI, simulations, and print artifacts derive from the same release.
