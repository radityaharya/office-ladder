import { describe, expect, it } from "vitest";

import { deadlineDashBoard } from "../src/deadline-dash";
import type { BoardSide, BoardTile, CornerCoordinate } from "../src/schema";

/**
 * The whole board order, written out once.
 *
 * This exists because the board was shipped **reversed**: every ten-tile side
 * ran backwards and the second and fourth blocks were swapped, and not one test
 * noticed, because every other board test is order-invariant (counts, kinds,
 * uniqueness) or pins only the four corners. The table below is transcribed from
 * `docs/Office_Board_Game_Design_Workbook.xlsx` (`01_Board_Corners` and
 * `02_General_Tiles`), which the user declared authoritative for board order.
 *
 * The rule the table encodes:
 *
 *     board index = 11 * (side - 1) + coordinate      (side tiles)
 *     board index = 11 * (corner - 1)                 (corners)
 *
 * with workbook sides 1..4 laid out clockwise from the Receptionist corner as
 * bottom, left, top, right. `coordinate` is the workbook's own side ordinal and
 * ascends in the direction of travel.
 *
 * If a change to `board.ts` makes this fail, the question to answer is not "how
 * do I update the expectation" but "does the workbook say so". Reordering the
 * board is a rules change; it needs the workbook, or a new decision recorded in
 * `board.ts`'s `sourceNotes`.
 */
const EXPECTED_ORDER = [
  { index: 0, id: "tile.board.00.receptionist", kind: "receptionist", corner: "bottom-right" },
  { index: 1, id: "tile.board.01.training", kind: "training", side: "bottom", coordinate: 1 },
  { index: 2, id: "tile.board.02.work-bottom-1", kind: "work", side: "bottom", coordinate: 2 },
  { index: 3, id: "tile.board.03.work-bottom-2", kind: "work", side: "bottom", coordinate: 3 },
  { index: 4, id: "tile.board.04.coffee-machine", kind: "networking", side: "bottom", coordinate: 4 },
  { index: 5, id: "tile.board.05.hr", kind: "hr", side: "bottom", coordinate: 5 },
  { index: 6, id: "tile.board.06.work-bottom-3", kind: "work", side: "bottom", coordinate: 6 },
  { index: 7, id: "tile.board.07.work-bottom-4", kind: "work", side: "bottom", coordinate: 7 },
  { index: 8, id: "tile.board.08.meeting-bottom", kind: "meeting", side: "bottom", coordinate: 8 },
  { index: 9, id: "tile.board.09.pantry", kind: "energy-restore", side: "bottom", coordinate: 9 },
  { index: 10, id: "tile.board.10.finance", kind: "finance", side: "bottom", coordinate: 10 },
  { index: 11, id: "tile.board.11.board-meeting", kind: "board-meeting", corner: "bottom-left" },
  { index: 12, id: "tile.board.12.work-left-1", kind: "work", side: "left", coordinate: 1 },
  { index: 13, id: "tile.board.13.work-left-2", kind: "work", side: "left", coordinate: 2 },
  { index: 14, id: "tile.board.14.meeting-left", kind: "meeting", side: "left", coordinate: 3 },
  { index: 15, id: "tile.board.15.it", kind: "it", side: "left", coordinate: 4 },
  { index: 16, id: "tile.board.16.event-left", kind: "event", side: "left", coordinate: 5 },
  { index: 17, id: "tile.board.17.work-left-3", kind: "work", side: "left", coordinate: 6 },
  { index: 18, id: "tile.board.18.marketing", kind: "marketing", side: "left", coordinate: 7 },
  { index: 19, id: "tile.board.19.lunch-break", kind: "energy-restore", side: "left", coordinate: 8 },
  { index: 20, id: "tile.board.20.office-gossip", kind: "networking", side: "left", coordinate: 9 },
  { index: 21, id: "tile.board.21.work-left-4", kind: "work", side: "left", coordinate: 10 },
  { index: 22, id: "tile.board.22.audit", kind: "audit", corner: "top-left" },
  { index: 23, id: "tile.board.23.work-top-1", kind: "work", side: "top", coordinate: 1 },
  { index: 24, id: "tile.board.24.work-top-2", kind: "work", side: "top", coordinate: 2 },
  { index: 25, id: "tile.board.25.meeting-top", kind: "meeting", side: "top", coordinate: 3 },
  { index: 26, id: "tile.board.26.event-top", kind: "event", side: "top", coordinate: 4 },
  { index: 27, id: "tile.board.27.legal", kind: "legal", side: "top", coordinate: 5 },
  { index: 28, id: "tile.board.28.work-top-3", kind: "work", side: "top", coordinate: 6 },
  { index: 29, id: "tile.board.29.seminar", kind: "networking", side: "top", coordinate: 7 },
  { index: 30, id: "tile.board.30.employee-lounge", kind: "energy-restore", side: "top", coordinate: 8 },
  { index: 31, id: "tile.board.31.work-top-4", kind: "work", side: "top", coordinate: 9 },
  { index: 32, id: "tile.board.32.operation", kind: "operation", side: "top", coordinate: 10 },
  { index: 33, id: "tile.board.33.annual-event", kind: "annual-event", corner: "top-right" },
  { index: 34, id: "tile.board.34.best-employee", kind: "best-employee", side: "right", coordinate: 1 },
  { index: 35, id: "tile.board.35.work-right-1", kind: "work", side: "right", coordinate: 2 },
  { index: 36, id: "tile.board.36.meeting-right", kind: "meeting", side: "right", coordinate: 3 },
  { index: 37, id: "tile.board.37.sales", kind: "sales", side: "right", coordinate: 4 },
  { index: 38, id: "tile.board.38.ceo-favorite", kind: "ceo-favorite", side: "right", coordinate: 5 },
  { index: 39, id: "tile.board.39.event-right", kind: "event", side: "right", coordinate: 6 },
  { index: 40, id: "tile.board.40.smoking-area", kind: "energy-restore", side: "right", coordinate: 7 },
  { index: 41, id: "tile.board.41.ceo-office", kind: "ceo-office", side: "right", coordinate: 8 },
  { index: 42, id: "tile.board.42.work-right-2", kind: "work", side: "right", coordinate: 9 },
  { index: 43, id: "tile.board.43.burnout", kind: "burnout", side: "right", coordinate: 10 },
] as const;

/** Workbook side numbers, laid out clockwise from the Receptionist corner. */
const SIDE_NUMBER: Readonly<Record<BoardSide, number>> = {
  bottom: 1,
  left: 2,
  top: 3,
  right: 4,
};

/** Workbook corner numbers, in the same clockwise walk. */
const CORNER_NUMBER: Readonly<Record<CornerCoordinate, number>> = {
  "bottom-right": 1,
  "bottom-left": 2,
  "top-left": 3,
  "top-right": 4,
};

const spaces: readonly BoardTile[] = deadlineDashBoard.spaces;

type Projection =
  | { index: number; id: string; kind: string; corner: string }
  | { index: number; id: string; kind: string; side: string; coordinate: number };

function project(tile: BoardTile): Projection {
  return tile.placement === "corner"
    ? { index: tile.index, id: tile.id, kind: tile.kind, corner: tile.coordinate }
    : {
        index: tile.index,
        id: tile.id,
        kind: tile.kind,
        side: tile.side,
        coordinate: tile.coordinate,
      };
}

describe("Deadline Dash board order", () => {
  it("Given the authored board, When its 44 spaces are read in array order, Then they are exactly the workbook's ordering", () => {
    expect(spaces.map(project)).toEqual(EXPECTED_ORDER.map((tile) => ({ ...tile })));
  });

  /**
   * A compact second view of the same fact. `toEqual` on 44 objects reports the
   * first differing entry; a kind sequence shows the *shape* of a regression —
   * a reversed side or a swapped block is obvious here and buried above.
   */
  it("Given the authored board, When only tile kinds are read, Then the clockwise sequence of kinds is unchanged", () => {
    expect(spaces.map((tile) => tile.kind)).toEqual([
      "receptionist",
      "training", "work", "work", "networking", "hr", "work", "work", "meeting", "energy-restore", "finance",
      "board-meeting",
      "work", "work", "meeting", "it", "event", "work", "marketing", "energy-restore", "networking", "work",
      "audit",
      "work", "work", "meeting", "event", "legal", "work", "networking", "energy-restore", "work", "operation",
      "annual-event",
      "best-employee", "work", "meeting", "sales", "ceo-favorite", "event", "energy-restore", "ceo-office", "work", "burnout",
    ]);
  });

  it("Given every space, When its own index field is compared to its array position, Then they agree", () => {
    spaces.forEach((tile, position) => {
      expect(tile.index).toBe(position);
    });
  });

  /**
   * The ordering rule itself, checked independently of the table above: the
   * table could be transcribed wrong, but it cannot be transcribed wrong *and*
   * satisfy the workbook's own arithmetic.
   */
  it("Given every space, When the workbook's index formula is applied, Then it reproduces the space's index", () => {
    for (const tile of spaces) {
      if (tile.placement === "corner") {
        expect(tile.index).toBe(11 * (CORNER_NUMBER[tile.coordinate] - 1));
        continue;
      }

      expect(tile.index).toBe(11 * (SIDE_NUMBER[tile.side] - 1) + tile.coordinate);
    }
  });

  it("Given each ten-tile side, When its coordinates are read in board order, Then they ascend 1 to 10 in the direction of travel", () => {
    for (const side of Object.keys(SIDE_NUMBER) as readonly BoardSide[]) {
      const coordinates = spaces
        .filter((tile) => tile.placement === "side" && tile.side === side)
        .map((tile) => (tile.placement === "side" ? tile.coordinate : Number.NaN));

      expect(coordinates).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);
    }
  });

  it("Given every tile id, When its numeric segment is read, Then it matches the tile's index and no id repeats", () => {
    for (const tile of spaces) {
      expect(tile.id).toMatch(
        new RegExp(`^tile\\.board\\.${String(tile.index).padStart(2, "0")}\\.`),
      );
    }

    expect(new Set(spaces.map((tile) => tile.id)).size).toBe(spaces.length);
  });
});
