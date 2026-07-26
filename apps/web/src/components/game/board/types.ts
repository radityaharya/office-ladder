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
 * each carry an uppercase `BOT` tag — one cell is ~98px at the reference
 * viewport and a tagged plate is 39px — so a group of three or more drops to
 * seat-glyph-only plates rather than overlapping each other or the tile's own
 * label. Bot-ness stays in the token's accessible name and in the seat rail.
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
  readonly state?: "idle" | "current" | "disconnected" | "eliminated";
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
