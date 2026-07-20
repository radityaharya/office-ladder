# Asset Management

Status: Proposed
Owner: Art direction and frontend engineering
Updated: 2026-07-18

## Outcome

Create a reproducible, licensed, accessible asset pipeline for brand, board, tiles, icons, pawns, characters, backgrounds, and motion assets.

Card-specific imagery is covered in `06-card-image-management.md`.

## Principles

- Game state remains understandable without art.
- Stable semantic asset IDs are separate from filenames and URLs.
- Board geometry and interaction remain code-driven, not one bitmap.
- Editable masters and runtime outputs are separate.
- Generated outputs are content-hashed and immutable.
- Every asset has provenance, rights, accessibility guidance, and fallback.
- Motion is optional and has reduced-motion behavior.
- Color is never the only distinction.

## Taxonomy

- Brand: mark, wordmark, favicons, social preview.
- Board: frame, center treatment, textures, decorative overlays.
- Tiles: semantic glyphs and special landmark emblems.
- Resources/tokens: Money, Reputation, Energy, Work Counter, MOVE, MOMENTUM, REP, MONEY.
- Pawns: six shape-and-color-distinct pieces.
- Characters: portraits and emblems.
- Ranks: Intern through Director icons.
- Backgrounds: lobby, game, role reveal, results.
- Motion: dice, promotion, reveal, victory.
- Print: board and component masters.

## Repository Layout

```text
assets-source/
  brand/
  board/
  tiles/
  icons/
  pawns/
  characters/
  backgrounds/
  motion/
  provenance/

asset-registry/
  assets.yaml
  licenses.yaml
  contributors.yaml

src/assets/generated/
src/generated/asset-manifest.ts
public/assets/direct/
```

Use Git LFS for large editable binary masters. Small optimized runtime assets remain normal Git files.

## Asset IDs

Examples:

```text
brand.logo.wordmark
board.frame.default
tile.audit.emblem
resource.reputation.icon
token.momentum.icon
pawn.paperclip
character.workaholic.portrait
rank.director.icon
motion.promotion.success
background.game.after-hours
```

IDs do not contain dimensions, extensions, artist names, or hashes.

## Board Strategy

Render the board from structured game data using HTML/CSS/SVG:

- Tile placement, labels, interaction, tokens, and states are code-driven.
- Texture and center artwork are decorative layers.
- Tile icons are independent assets.
- Active/disabled/target states are UI overlays.
- Localization never requires regenerating the board background.

Use three art tiers:

1. Core glyph for every tile type.
2. Feature emblem for corners and major special tiles.
3. Scene artwork only for detail panels and high-impact moments.

## Pawns

Six pawns must differ by:

- Shape.
- Color.
- Outline/pattern.
- Seat number or initials in accessible UI.

Requirements:

- Readable at 24-48 CSS pixels.
- High-contrast halo against all tile colors.
- Stable top-down silhouette.
- Collision/stack layout for shared spaces.
- Reduced-motion and instant-position modes.

## Formats

| Asset | Runtime format |
|---|---|
| Logos/icons/tile glyphs | SVG |
| Pawns | SVG or WebP |
| Portraits | WebP, optional AVIF after measurement |
| Backgrounds/textures | WebP, optional AVIF |
| UI motion | CSS/WAAPI/SVG |
| Complex short motion | WebM/MP4 or validated Lottie only when justified |
| Print masters | PDF/vector/high-resolution raster |

Avoid GIF and system emoji as final game assets.

## Responsive Roles

- `full`
- `compact`
- `thumb`
- `minimap`
- `poster`
- `social`
- `print`

Generate DPR variants automatically. Author separate compositions only when the crop or level of detail changes.

## Runtime Manifest

Manifest entries include:

- Stable ID and revision.
- Category.
- Variant paths and dimensions.
- File size and format.
- Focal point.
- Alt/decorative guidance.
- Fallback ID.
- Content hash.

Keep licensing and private contributor data in an internal manifest, not the browser bundle.

## Build Validation

Fail when:

- IDs duplicate.
- Source or generated files are missing.
- Dimensions/aspect ratios violate declarations.
- Semantic images lack alt guidance.
- Provenance/license fields are incomplete.
- Runtime files exceed budgets.
- SVG contains scripts, external references, or unexpected embedded raster.
- Application code references an unknown ID.

## Initial Budgets

- Tile/UI SVG: target under 8 KB.
- Pawn: under 15 KB.
- Avatar thumbnail: under 20 KB.
- Character portrait: under 100 KB.
- Mobile background: under 180 KB.
- Desktop background: under 350 KB.
- Lottie: under 120 KB.
- Short celebration video: under 750 KB.
- Initial gameplay asset payload: under 1 MB.

## Delivery And Caching

MVP:

- Static imports for normal first-party images.
- Bundled SVG for semantic icons.
- Direct public URLs only for media that requires URL loading.
- Hashed immutable outputs.
- No separate asset CDN initially.

Use Supabase Storage later for user uploads, not for application-owned build assets unless independent content deployment becomes necessary.

## Fallbacks

- Logo -> text product name.
- Tile icon -> short text label.
- Pawn -> numbered high-contrast marker.
- Portrait -> neutral classified-file silhouette.
- Background/texture -> flat design-system surface.
- Motion -> static poster or brief CSS emphasis.

## Provenance And Rights

Record:

- Creator/vendor.
- Source/contract.
- License and allowed use.
- Attribution and redistribution requirements.
- Digital, marketing, and print rights.
- AI assistance, model, prompt record, and human editing.
- Approval status.

Avoid Monopoly trade dress, real-company branding, unlicensed likenesses, and unreviewed AI outputs.

## Workflow

1. Reserve semantic ID.
2. Approve brief and usage roles.
3. Add editable source and provenance.
4. Generate optimized outputs.
5. Review desktop/mobile/fallback/reduced-motion contexts.
6. Run validation and size report.
7. Merge source, registry, and generated output together.

## Phases

1. Brand identity and starter-asset cleanup.
2. Board-critical assets: icons, board treatment, resources, tokens, pawns, dice, ranks.
3. Character portraits and atmospheric backgrounds.
4. Promotion/reveal/victory motion.
5. User avatar upload pipeline only if needed.

## Acceptance Criteria

- Every runtime asset is addressed by stable ID.
- A clean checkout can reproduce generated outputs.
- Missing assets degrade intentionally.
- Pawns remain distinguishable in grayscale.
- Board remains usable with images disabled.
- Motion respects reduced-motion settings.
- Every asset has approved provenance and rights.
- Asset releases are content-hashed and safe across rolling deployments.
