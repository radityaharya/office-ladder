import type { ReactNode } from "react";

export type BoardSide = "bottom" | "left" | "top" | "right";

export type CornerCoordinate =
  | "bottom-right"
  | "bottom-left"
  | "top-left"
  | "top-right";

/**
 * Tonal zone groups for the floor plan. These are deliberately *not* hues:
 * DESIGN.md §8/§10 forbid identifying anything by colour alone, so a zone is
 * carried by a neutral tonal fill plus a rule pattern, and every tile also
 * shows its own uppercase facility code and room name.
 */
export type BoardZone =
  | "landmark"
  | "workfloor"
  | "service"
  | "social"
  | "break"
  | "hazard";

/** The track axis a token travels along when it leaves a space. */
export type BoardTravelAxis = "horizontal" | "vertical";

/** Zero-based cell in the 12x12 board grid, plus that space's track axis. */
export type BoardCell = {
  readonly col: number;
  readonly row: number;
  readonly axis: BoardTravelAxis;
};

/**
 * How wide a token plate renders. A crowded space cannot fit six plates that
 * each carry a 14px face and an uppercase `BOT` tag — one cell is ~98px at the
 * reference viewport — so a group of three or more drops to seat-glyph-only
 * plates rather than overlapping each other or the tile's own label.
 *
 * `full` is `[face][seat]` for a human and `[seat][BOT]` for a bot (a bot has no
 * photo, so it spends that width on saying so instead). `compact` is the seat
 * glyph alone. Bot-ness survives BOTH densities: the machine rule on the plate
 * is width-free, and the token's accessible name and the seat rail always say it
 * in words.
 */
export type BoardTokenDensity = "full" | "compact";

/** Where a token's plate sits inside its space's single-row occupancy dock. */
export type BoardDockSlot = {
  /** Pixel offset of the plate's left edge from the dock's left inset. */
  readonly x: number;
  readonly density: BoardTokenDensity;
};

type BoardSpaceBase = {
  readonly id: string;
  readonly index: number;
  readonly zone: BoardZone;
  /** Short uppercase facility code, e.g. `WRK`, `MTG`, `AUD`. */
  readonly code: string;
  /** Sentence-case room name, e.g. `Coffee machine`. */
  readonly label: string;
  /**
   * A shorter whole-word form of `label`, shown instead of it once a cell is
   * too narrow for the full name. Both are in the markup and the swap is a
   * container query, so no label ever breaks mid-word or ellipsises mid-word.
   * Omit it when `label` is already short enough to never need one.
   */
  readonly shortLabel?: string;
  /** Human-readable zone name, e.g. `Work floor`. */
  readonly zoneLabel: string;
  /** Raw content tile kind, exposed as a data attribute for tooling. */
  readonly kindId: string;
  readonly detail?: string;
  readonly inactive?: boolean;
};

export type BoardSpaceView =
  | (BoardSpaceBase & {
      readonly placement: "corner";
      readonly coordinate: CornerCoordinate;
    })
  | (BoardSpaceBase & {
      readonly placement: "side";
      readonly side: BoardSide;
      readonly coordinate: number;
    });

export type PlayerSeat = 1 | 2 | 3 | 4 | 5 | 6;

export type PlayerTokenView = {
  readonly id: string;
  readonly name: string;
  readonly seat: PlayerSeat;
  readonly position: number;
  readonly initials?: string;
  readonly isBot?: boolean;
  /**
   * `RoomMemberProjection.avatarUrl` — the player's own photo on their piece
   * ("pion ada foto player").
   *
   * Decoration on top of identity, never identity itself: the seat colour, the
   * seat pattern and the seat numeral are always drawn whether or not this is
   * set, so two seats stay distinguishable for a colour-blind player, a player
   * whose avatar host is down, and a player who has no avatar at all (§8, and
   * the contract's own note on this field). Three cases all resolve to the same
   * fallback rather than to a broken image:
   *
   *  - `null`/absent — the common case today, because nothing in the app can set
   *    one yet. The plate shows the seat initial.
   *  - a bot — always `null` per the contract; bot plates carry the machine rule
   *    and the `BOT` tag instead of a face, so a bot is never a faceless human.
   *  - a load failure — {@link PlayerToken} drops the `img` and reveals the
   *    initial underneath it. The initial is always in the markup, so nothing
   *    reflows and no broken-image glyph can appear.
   *
   * Only `https:` absolute URLs and root-relative same-origin paths are drawn;
   * anything else is treated as absent at the render boundary as well as at the
   * server's (see `renderableAvatarUrl` in `player-token.tsx`).
   */
  readonly avatarUrl?: string | null;
  readonly state?: "idle" | "current" | "disconnected" | "eliminated";
};

/**
 * A claimed tile, as the board draws it (spec §5.1, §12.4 — "a persistent mark
 * on the tile itself, readable on the board", never rail-only).
 *
 * Mirrors `TileOwnershipProjection` field for field except for the two
 * presentation facts the projection cannot know: which 1..6 seat slot the owner
 * holds (the board's colour/pattern/numeral system is seat-based, not
 * player-id-based) and whether the owner is the viewer.
 */
export type BoardTileOwnershipView = {
  /** `BoardSpaceView.id`, i.e. the content pack's tile id. */
  readonly tileId: string;
  readonly ownerSeat: PlayerSeat;
  readonly ownerName: string;
  /** 0 = claimed, >0 = upgraded, exactly as the projection reports it. */
  readonly level: number;
  /**
   * Own versus opponent, structurally rather than by reading a name (§12.1):
   * the viewer's own tiles get a solid owner edge, everyone else's get a hatched
   * one, and the tile's accessible name says "owned by you" or "owned by <name>".
   */
  readonly isSelf: boolean;
};

/**
 * A placed object on a tile (spec §5.1, §12.4 — "present on the board,
 * `owner-only` ones visible only to their owner, never leaked by layout").
 *
 * **This type carries no redaction of its own and must not be asked to.** The
 * per-viewer projection already omits every other player's `owner-only`
 * placement, so the board renders exactly what it is handed: a caller that
 * merges `gameplay.placements` with `gameplay.self.ownPlacements` is correct, and
 * a caller that reaches past the projection for someone else's hidden placement
 * has leaked before this type ever sees it.
 */
export type BoardPlacementView = {
  readonly id: string;
  /** `BoardSpaceView.id`. */
  readonly tileId: string;
  /**
   * The `placement.*` id, opaque to the board beyond the mark table in
   * `board-tile.tsx`. Kept as a plain string so this layer stays free of a
   * contracts dependency and an unrecognised kind degrades to a derived letter
   * instead of failing to render.
   */
  readonly kind: string;
  /** Display name; derived from {@link kind} when omitted. */
  readonly label?: string;
  readonly ownerSeat: PlayerSeat;
  readonly ownerName: string;
  /**
   * `"owner-only"` means *the viewer is the owner* — nobody else was ever given
   * this entry. It is drawn as visibly sealed (a dashed mark) so its owner can
   * tell which of their own placements the table cannot see.
   */
  readonly visibility: "public" | "owner-only";
  readonly charges: number;
  readonly isSelf: boolean;
};

/** One labelled readout in the plate's bottom strip. */
export type BoardPlateReadout = {
  readonly label: string;
  readonly value: string;
};

/**
 * Status light for the plate. `tone` picks a single `status-*` token; the
 * `label` is mandatory because a status is never communicated by colour alone.
 */
export type BoardPlateMarker = {
  readonly tone: "active" | "caution" | "info" | "neutral";
  readonly label: string;
};

export type BoardIncidentView = {
  readonly title: string;
  readonly status?: string;
  readonly description?: string;
  readonly detail?: ReactNode;
  readonly readouts?: readonly BoardPlateReadout[];
  readonly marker?: BoardPlateMarker;
};
