import type { EffectDescriptor } from "./effects";
import type { TileId } from "./ids";

export type BoardSide = "bottom" | "left" | "top" | "right";

export type CornerCoordinate =
  | "bottom-right"
  | "bottom-left"
  | "top-left"
  | "top-right";

export type RegularTileKind =
  | "training"
  | "work"
  | "networking"
  | "hr"
  | "meeting"
  | "energy-restore"
  | "finance"
  | "it"
  | "event"
  | "marketing"
  | "legal"
  | "operation"
  | "best-employee"
  | "sales"
  | "ceo-favorite"
  | "ceo-office"
  | "burnout";

export type CornerTileKind =
  | "receptionist"
  | "board-meeting"
  | "audit"
  | "annual-event";

type BoardTileBase = {
  readonly id: TileId;
  readonly index: number;
  readonly displayNameKey: `deadlineDash.board.tile.${string}.name`;
  readonly effects: readonly EffectDescriptor[];
};

export type RegularBoardTile = BoardTileBase & {
  readonly placement: "side";
  readonly side: BoardSide;
  /** One-based physical coordinate in the GDD table's printed direction. */
  readonly coordinate: number;
  readonly kind: RegularTileKind;
};

export type CornerBoardTile = BoardTileBase & {
  readonly placement: "corner";
  readonly coordinate: CornerCoordinate;
  readonly kind: CornerTileKind;
};

export type BoardTile = RegularBoardTile | CornerBoardTile;

export type BoardConfig = {
  readonly id: "board.deadline-dash";
  readonly direction: "clockwise";
  readonly startIndex: 0;
  readonly spaces: readonly BoardTile[];
  readonly expectedCounts: {
    readonly total: 44;
    readonly corners: 4;
    readonly regular: 40;
    readonly perSide: 10;
    readonly byKind: Readonly<Record<RegularTileKind | CornerTileKind, number>>;
  };
  readonly sourceNotes: readonly string[];
};
