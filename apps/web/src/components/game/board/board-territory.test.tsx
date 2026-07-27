import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { GameBoard } from "./game-board";
import type {
  BoardPlacementView,
  BoardSpaceView,
  BoardTileOwnershipView,
  PlayerTokenView,
} from "./types";

const incident = {
  status: "Round 3 · Turn 9",
  title: "Mina's turn",
  marker: { tone: "info", label: "Turn in progress" },
} as const;

const corners = ["bottom-right", "bottom-left", "top-left", "top-right"] as const;

function createSpaces(): readonly BoardSpaceView[] {
  return Array.from({ length: 44 }, (_, index): BoardSpaceView => {
    const base = {
      id: `tile-${index}`,
      index,
      zone: "workfloor",
      code: "WRK",
      label: `Desk ${index}`,
      zoneLabel: "Work floor",
      kindId: "work",
    } as const;

    if (index % 11 === 0) {
      return {
        ...base,
        placement: "corner",
        coordinate: corners[index / 11] ?? "bottom-right",
      };
    }

    const sides = ["bottom", "left", "top", "right"] as const;

    return {
      ...base,
      placement: "side",
      side: sides[Math.floor(index / 11)] ?? "bottom",
      coordinate: index % 11,
    };
  });
}

function owned(overrides: Partial<BoardTileOwnershipView> = {}): BoardTileOwnershipView {
  return {
    tileId: "tile-7",
    ownerSeat: 3,
    ownerName: "Rae",
    level: 0,
    isSelf: false,
    ...overrides,
  };
}

function placed(overrides: Partial<BoardPlacementView> = {}): BoardPlacementView {
  return {
    id: "pl-1",
    tileId: "tile-7",
    kind: "placement.sabotage",
    ownerSeat: 2,
    ownerName: "Omar",
    visibility: "public",
    charges: 1,
    isSelf: false,
    ...overrides,
  };
}

function board(
  props: {
    readonly ownership?: readonly BoardTileOwnershipView[];
    readonly placements?: readonly BoardPlacementView[];
    readonly players?: readonly PlayerTokenView[];
    readonly territory?: boolean;
  } = {},
): string {
  return renderToStaticMarkup(
    <GameBoard
      activeTile={props.players?.[0]?.position ?? null}
      incident={incident}
      ownership={props.ownership}
      placements={props.placements}
      players={props.players}
      spaces={createSpaces()}
      territory={props.territory}
    />,
  );
}

const table = [
  { id: "p-1", name: "Mina", seat: 1, position: 5 },
  { id: "p-2", name: "Omar", seat: 2, position: 12 },
  { id: "p-3", name: "Rae", seat: 3, position: 30 },
] as const satisfies readonly PlayerTokenView[];

describe("ownership on the board", () => {
  it("marks an owned space on the tile itself, not only in a rail panel", () => {
    // Given one claimed space
    const markup = board({ ownership: [owned()] });

    // Then the tile carries the owner's seat as a mark AND an edge rule, so
    // ownership is readable across the ring rather than by opening a sidebar
    // (spec §12.4).
    expect(markup).toContain('data-board-owner-seat="3"');
    expect(markup).toContain('class="board-tile-owner-edge"');
    expect(markup).toContain('<span class="board-tile-owner" data-board-seat="3">3</span>');
    expect(markup.match(/class="board-tile-owner-edge"/g)).toHaveLength(1);
  });

  it("states the owner in words as well, and says who it is", () => {
    // Given
    const markup = board({ ownership: [owned()] });

    // Then — the mark is colour and shape; the accessible name is the only place
    // the owner's actual name lives.
    expect(markup).toContain("Desk 7, Work floor zone, code WRK, owned by Rae, unoccupied");
  });

  it("distinguishes your own space from an opponent's structurally", () => {
    // Given the same tile owned by the viewer
    const mine = board({ ownership: [owned({ isSelf: true, ownerName: "Mina" })] });
    const theirs = board({ ownership: [owned()] });

    // Then own-versus-opponent is an attribute the stylesheet keys the edge and
    // the mark off, plus a different sentence — never just a name to read (§12.1).
    expect(mine).toContain('data-board-owner-self="true"');
    expect(mine).toContain("owned by you");
    expect(theirs).not.toContain("data-board-owner-self");
    expect(theirs).toContain("owned by Rae");
  });

  it("reports an upgrade level rather than showing a claim and an upgrade alike", () => {
    // Given
    const markup = board({ ownership: [owned({ level: 2 })] });

    // Then — on the tile, on the gutter mark (which gains an underscore rule
    // rather than a second hue), and in words.
    expect(markup.match(/data-board-owner-level="2"/g)).toHaveLength(2);
    expect(markup).toContain("owned by Rae, upgraded to level 2");
  });

  it("leaves every unclaimed space unmarked", () => {
    // Given
    const markup = board({ ownership: [owned()] });

    // Then
    expect(markup.match(/data-board-owner-seat=/g)).toHaveLength(1);
    expect(markup).toContain("Desk 8, Work floor zone, code WRK, unoccupied");
  });
});

describe("placements on the board", () => {
  it("shows a public placement on its own tile, with a mark and a sentence", () => {
    // Given
    const markup = board({ placements: [placed()] });

    // Then
    expect(markup).toContain('data-board-placement-count="1"');
    expect(markup).toContain('data-board-mark="S"');
    expect(markup).toContain("sabotage placed by Omar");
  });

  it("gives every authored kind its own mark", () => {
    // Given all five kinds, one per tile
    const kinds = [
      "placement.meeting-invite",
      "placement.sabotage",
      "placement.surveillance",
      "placement.rumour",
      "placement.favour",
    ] as const;
    const markup = board({
      placements: kinds.map((kind, index) =>
        placed({ id: `pl-${index}`, kind, tileId: `tile-${index + 1}` }),
      ),
    });

    // Then — distinct letters, each spelled out in the plate's territory key.
    for (const mark of ["M", "S", "V", "R", "F"]) {
      expect(markup).toContain(`data-board-mark="${mark}"`);
    }
    expect(markup).toContain("Meeting invite");
    expect(markup).toContain("Surveillance");
    expect(markup).toContain("Favour");
  });

  it("marks the viewer's own owner-only placement as visibly sealed", () => {
    // Given the one case an `owner-only` entry legitimately reaches a client: it
    // is the viewer's own, merged in from `gameplay.self.ownPlacements`.
    const markup = board({
      placements: [placed({ visibility: "owner-only", isSelf: true, ownerName: "Mina" })],
    });

    // Then the owner can tell which of their marks the table cannot see.
    expect(markup).toContain('data-board-mark-sealed="true"');
    expect(markup).toContain('data-board-mark-self="true"');
    expect(markup).toContain("sabotage yours, visible only to you");
  });

  it("renders exactly the placements it is handed and invents none", () => {
    // Given a viewer whose projection omitted every other player's owner-only
    // placement — which is what the server does, and what this must not undo.
    const markup = board({ placements: [] });

    // Then
    expect(markup).not.toContain("board-tile-mark");
    expect(markup).not.toContain("data-board-placement-count");
  });

  it("compresses a crowded tile into a count instead of dropping a placement", () => {
    // Given four placements plus an owner on one space — more than the 25px
    // gutter can draw at 12px a mark
    const markup = board({
      ownership: [owned()],
      placements: [
        placed({ id: "pl-1", kind: "placement.sabotage" }),
        placed({ id: "pl-2", kind: "placement.rumour", ownerName: "Rae", ownerSeat: 3 }),
        placed({ id: "pl-3", kind: "placement.favour", ownerName: "Ada", ownerSeat: 4 }),
        placed({ id: "pl-4", kind: "placement.surveillance", ownerName: "Kit", ownerSeat: 5 }),
      ],
    });

    // Then the gutter shows the owner plus a count of the rest...
    expect(markup).toContain('data-board-mark-more="true"');
    expect(markup).toContain('data-board-mark-more="true">4</span>');
    // ...and nothing is lost: every entry is still named in the tile's own
    // accessible name.
    expect(markup).toContain("sabotage placed by Omar");
    expect(markup).toContain("rumour placed by Rae");
    expect(markup).toContain("favour placed by Ada");
    expect(markup).toContain("surveillance placed by Kit");
  });

  it("marks an unauthored kind rather than leaving its tile blank", () => {
    // Given a placement kind this build does not know about
    const markup = board({ placements: [placed({ kind: "placement.whiteboard-hog" })] });

    // Then
    expect(markup).toContain('data-board-mark="W"');
    expect(markup).toContain("whiteboard hog placed by Omar");
  });
});

describe("the board's size never depends on shared state", () => {
  it("reserves the per-tile gutter for the whole match, not from the first claim", () => {
    // Given a territory match in which nothing has been claimed or placed yet
    const empty = board({ ownership: [], placements: [] });
    const later = board({ ownership: [owned()], placements: [placed()] });

    // Then the reservation is identical in both, so the first claim of the game
    // cannot reflow the room name on all 44 tiles.
    expect(empty).toContain('data-board-territory="true"');
    expect(later).toContain('data-board-territory="true"');
    expect(empty.match(/data-slot="board-tile-territory"/g)).toHaveLength(44);
    expect(later.match(/data-slot="board-tile-territory"/g)).toHaveLength(44);
  });

  it("charges a mode without claiming nothing at all", () => {
    // Given a ruleset with no tile ownership — the board is told nothing
    const markup = board();

    // Then no gutter is reserved and no tile pays width for it.
    expect(markup).not.toContain("data-board-territory");
    expect(markup).not.toContain("board-tile-territory");
    expect(markup).not.toContain("board-territory-key");
  });

  it("honours an explicit territory flag before anything exists to show", () => {
    // Given a mode that allows claiming, read from `gameplay.rules`
    const markup = board({ territory: true });

    // Then
    expect(markup).toContain('data-board-territory="true"');
    expect(markup).toContain('data-slot="board-territory-key"');
  });
});

describe("territory key", () => {
  it("teaches the marks and reports how much of the ring is claimed", () => {
    // Given
    const markup = board({
      ownership: [owned(), owned({ tileId: "tile-9", isSelf: true, ownerSeat: 1 })],
      placements: [placed(), placed({ id: "pl-2", kind: "placement.rumour", tileId: "tile-9" })],
    });

    // Then the gutter compresses and the key expands, so a one-letter mark on a
    // 97px tile is never a private code.
    expect(markup).toContain('data-slot="board-territory-key"');
    expect(markup).toContain('<p class="board-legend-head">Territory key</p>');
    expect(markup).toContain('<span class="board-legend-name">Claimed</span>');
    expect(markup).toContain('<span class="board-legend-name">Yours</span>');
    expect(markup).toContain("Sabotage");
    expect(markup).toContain("Rumour");
  });

  it("says what claiming is before anything has been claimed (§12.5)", () => {
    // Given the first ten minutes of a territory match
    const markup = board({ ownership: [], placements: [] });

    // Then the empty state teaches the vocabulary instead of saying "none".
    expect(markup).toContain("board-territory-empty");
    expect(markup).toContain("Claimed spaces carry their owner");
    expect(markup).toContain("Nothing is claimed yet.");
  });

  it("keeps the zone key beside it in the plate's own key column", () => {
    // Given
    const markup = board({ territory: true });

    // Then both keys share one column, so the plate's wide two-column layout does
    // not depend on how many keys a match happens to have.
    expect(markup).toContain('data-slot="board-plate-keys"');
    expect(markup).toContain('<p class="board-legend-head">Zone key</p>');
    expect(markup).toContain('<p class="board-legend-head">Territory key</p>');
  });
});

/*
 * The ring's interior, measured in a live campaign match at 1698x913: the
 * rectangle bounded by the inner edges of the four ring sides is 1086.8x552.7px
 * — 600,633px², 69.4% of the whole board — of which 44.1% was two contiguous
 * blank blocks. The claim ledger is what one of them went to, and it is the one
 * fact about shared state the ring genuinely cannot express: a claim is drawn on
 * its own tile, but 44 gutters never add up to a standing.
 */
describe("claims by seat", () => {
  it("aggregates what 44 tile gutters cannot: who is ahead", () => {
    // Given a ring where two seats have claimed and one has not
    const markup = board({
      players: table,
      ownership: [
        owned({ tileId: "tile-7", ownerSeat: 3, ownerName: "Rae" }),
        owned({ tileId: "tile-9", ownerSeat: 3, ownerName: "Rae" }),
        owned({ tileId: "tile-4", ownerSeat: 1, ownerName: "Mina", isSelf: true }),
      ],
    });

    // Then every seat has a row, counts included, in the same seat grammar the
    // pieces and the tile marks use.
    expect(markup).toContain('data-slot="board-claim-ledger"');
    expect(markup).toContain('<p class="board-legend-head">Claims by seat</p>');
    expect(markup).toContain(
      '<span aria-hidden="true" class="board-ledger-seat" data-board-seat="3">3</span>',
    );
    expect(markup).toContain('<span class="board-ledger-name">Rae</span>');
    expect(markup).toContain('<span class="board-ledger-name">Omar</span>');
  });

  it("marks the viewer's own row structurally, not just by their name", () => {
    // Given the viewer holds seat 1 — derivable because one of their claims is
    // flagged `isSelf`, the only place the board is told which seat is theirs.
    const markup = board({
      players: table,
      ownership: [owned({ tileId: "tile-4", ownerSeat: 1, ownerName: "Mina", isSelf: true })],
    });

    // Then own-versus-opponent is an attribute the stylesheet keys a tonal step
    // off, plus a word — never a name to read (§12.1).
    expect(markup.match(/data-board-claim-self="true"/g)?.length).toBeGreaterThan(0);
    expect(markup).toContain('<span class="board-ledger-name">Mina (you)</span>');
  });

  it("keeps one row per seat from turn 0, so a first claim cannot move the board", () => {
    // Given the same table before and after the very first claim of the match
    const before = board({ players: table, ownership: [], territory: true });
    const after = board({
      players: table,
      ownership: [owned({ tileId: "tile-4", ownerSeat: 1, ownerName: "Mina" })],
    });

    // Then the ledger's row count is identical — the claim changed a digit, not
    // a height — and a seat on zero is still listed rather than appearing later.
    const ledger = (markup: string) =>
      markup.slice(
        markup.indexOf('data-slot="board-claim-ledger"'),
        markup.indexOf('data-slot="board-territory-key"'),
      );
    expect(before.match(/class="board-ledger-seat"/g)).toHaveLength(3);
    expect(after.match(/class="board-ledger-seat"/g)).toHaveLength(3);
    expect(ledger(before).match(/class="board-legend-item"/g)).toHaveLength(3);
    expect(ledger(after).match(/class="board-legend-item"/g)).toHaveLength(3);
    expect(before).toContain('<dd class="board-legend-count">0</dd>');
  });

  it("puts the one block that resizes last, so nothing above it is pushed down", () => {
    // Given a territory match at its first claim. The territory key legitimately
    // changes height (§12.5 swaps a teaching empty state for rows), so the
    // column is ordered rigid-first: whatever resizes has to be the last block
    // in it or it moves everything beneath it (§12.1).
    const markup = board({ players: table, ownership: [owned()] });

    // Then
    expect(markup.indexOf('data-slot="board-legend"')).toBeLessThan(
      markup.indexOf('data-slot="board-claim-ledger"'),
    );
    expect(markup.indexOf('data-slot="board-claim-ledger"')).toBeLessThan(
      markup.indexOf('data-slot="board-territory-key"'),
    );
  });

  it("draws no ledger for a mode that never claims anything", () => {
    // Given a ruleset with no tile ownership
    const markup = renderToStaticMarkup(
      <GameBoard incident={incident} players={table} spaces={createSpaces()} />,
    );

    // Then
    expect(markup).not.toContain("board-claim-ledger");
  });

  it("draws no ledger before anyone is seated", () => {
    // Given a territory mode with an empty table
    const markup = board({ territory: true });

    // Then the block is absent rather than an empty heading over nothing.
    expect(markup).not.toContain("board-claim-ledger");
  });
});

describe("the reach table names who owns each destination", () => {
  it("says whose the square is and what is sitting on it", () => {
    // Given the active player one space short of a claimed, sabotaged tile
    const markup = board({
      players: [{ id: "p-1", name: "Mina", seat: 1, position: 6 }],
      ownership: [owned()],
      placements: [placed()],
    });

    // Then the destination's owner and its placement are stated in words on the
    // reach column — a player deciding whether to roll into a trap should not
    // have to infer it from a 12px mark on a 97px tile.
    expect(markup).toContain('data-slot="board-reach-claim"');
    expect(markup).toContain("Seat 3 · Sabotage");
  });

  it("shows an unclaimed destination as unclaimed rather than as blank", () => {
    // Given a territory match where nothing on the reach is owned
    const markup = board({ players: [{ id: "p-1", name: "Mina", seat: 1, position: 20 }], ownership: [], placements: [] });

    // Then every column carries the line, so a claim landing changes a word and
    // never a height (§12.1).
    expect(markup.match(/data-slot="board-reach-claim"/g)).toHaveLength(6);
    expect(markup).toContain("Unclaimed");
  });

  it("marks your own destination structurally", () => {
    // Given
    const markup = board({
      players: [{ id: "p-1", name: "Mina", seat: 1, position: 6 }],
      ownership: [owned({ ownerSeat: 1, ownerName: "Mina", isSelf: true })],
    });

    // Then
    expect(markup).toContain('data-board-claim-self="true"');
    expect(markup).toContain("Yours");
  });
});

/*
 * Measured in headless Chrome at the shell's real 1184px, where a tile is
 * 97.5x50.7 and the territory gutter takes 14px off the head row. Three findings
 * from that pass are pinned here, because none of them is visible to
 * `renderToStaticMarkup`.
 */
describe("territory gutter geometry", () => {
  const stylesheet = readFileSync(
    fileURLToPath(new URL("../../../styles/board.css", import.meta.url)),
    "utf8",
  );

  it("reserves the gutter with padding, so the tile is never resized", () => {
    // Then — the track is `padding-right` on the tile plus an absolutely
    // positioned gutter inside it. Measured: the board frame is 1168.8px and a
    // tile 97.5x50.7 with territory on and with it off, identically.
    expect(stylesheet).toMatch(
      /\.board-grid\[data-board-territory="true"\] \.board-tile \{\s*padding-right: 20px/,
    );
    expect(stylesheet).toMatch(/\.board-tile-territory \{[^}]*position: absolute/);
  });

  it("keeps the gutter clear of the occupancy dock at both ends", () => {
    // Then — measured: a 3px owner edge running to the tile's foot overlapped the
    // leftmost token plate by 1px. Both the edge and the gutter now stop at the
    // dock band's 19px.
    expect(stylesheet).toMatch(/\.board-tile-territory \{[^}]*bottom: 19px/);
    expect(stylesheet).toMatch(/\.board-tile-owner-edge \{[^}]*bottom: 19px/);
  });

  it("never lets the state tag clip mid-word to make room", () => {
    // Then — measured: "Last" rendered as "LAS" once the gutter narrowed the head
    // row. The tag is rigid, and the space NUMBER gives way on the at most two
    // tiles that are marked at once.
    expect(stylesheet).toMatch(/\.board-tile-tag \{[^}]*flex: 0 0 auto/);
    expect(stylesheet).toContain(
      '.board-grid[data-board-territory="true"] .board-tile[data-board-active="true"] .board-tile-index',
    );
    expect(stylesheet).toContain(
      '.board-grid[data-board-territory="true"] .board-tile[data-board-landed="true"] .board-tile-index',
    );
  });
});
