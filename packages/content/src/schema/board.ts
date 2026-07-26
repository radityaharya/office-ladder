import type { DiceSpec, EffectDescriptor, RollOutcome } from "./effects";
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

/**
 * A choice offered to the player who lands on this tile, resolved through a
 * real decision prompt instead of being applied automatically.
 *
 * Deliberately *not* an `EffectDescriptor`. An offer is not something that
 * happens to a player, and the effect vocabulary is shared with deck cards,
 * which must never be able to open a tile decision. The engine reads this
 * config back when the response command arrives, so the numbers authored here
 * are the single source of truth for both branches — nothing about the
 * mechanics is restated in the engine or the client.
 */
export type TileDecisionConfig = {
  /** Copied verbatim into the engine's `PromptState.kind`. */
  readonly kind: "training-course";
  /** Resolved when the player takes the deal and pays `cost`. */
  readonly accept: {
    readonly optionId: "enroll";
    readonly cost: {
      readonly resource: "money";
      readonly amount: number;
    };
    readonly roll: DiceSpec;
    readonly rerollEligible: false;
    readonly outcomes: readonly RollOutcome[];
  };
  /** Resolved when the player walks away. Must never cost the player anything. */
  readonly decline: {
    readonly optionId: "decline";
    readonly effects: readonly EffectDescriptor[];
  };
  /**
   * A prompt must never offer a deal the player cannot honour, so when the
   * acting player cannot pay `accept.cost` in full the decline branch resolves
   * immediately and no prompt is opened at all.
   */
  readonly whenUnaffordable: "resolve-decline";
};

type BoardTileBase = {
  readonly id: TileId;
  readonly index: number;
  readonly displayNameKey: `deadlineDash.board.tile.${string}.name`;
  readonly effects: readonly EffectDescriptor[];
  /** Present only on tiles that ask the player a question. */
  readonly decision?: TileDecisionConfig;
};

export type RegularBoardTile = BoardTileBase & {
  readonly placement: "side";
  readonly side: BoardSide;
  /**
   * The design workbook's one-based `side,index` ordinal, which **ascends** in
   * the direction of travel: `index === 11 * (side - 1) + coordinate`.
   */
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
