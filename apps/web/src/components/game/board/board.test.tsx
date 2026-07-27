import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { deadlineDashContent } from "@office-ladder/content";

import { boardCell, GameBoard } from "./game-board";
import type { BoardSpaceView, BoardZone, PlayerTokenView } from "./types";
import { forwardDistance } from "./use-board-travel";

const corners = [
  "bottom-right",
  "bottom-left",
  "top-left",
  "top-right",
] as const;

const zoneLabels = {
  landmark: "Landmark",
  workfloor: "Work floor",
  service: "Service desk",
  social: "Social",
  break: "Break room",
  hazard: "Hazard",
} as const satisfies Record<BoardZone, string>;

const incident = {
  status: "Round 2 · Turn 4",
  title: "Avery's turn",
  description: "Avery is standing on Coffee machine.",
  marker: { tone: "info", label: "Turn in progress" },
  readouts: [
    { label: "Space", value: "08/44" },
    { label: "Facility", value: "NET" },
  ],
} as const;

function space(
  index: number,
  zone: BoardZone,
  code: string,
  label: string,
  shortLabel?: string,
): BoardSpaceView {
  const base = {
    id: `tile-${index}`,
    index,
    zone,
    code,
    label,
    shortLabel,
    zoneLabel: zoneLabels[zone],
    kindId: code.toLowerCase(),
  };

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
    // Ascending with board index, matching the authored content pack since the
    // board was reordered to the workbook (tile.board.01.training is
    // coordinate 1, tile.board.43.burnout is coordinate 10). This fixture used
    // to descend, which is why it kept passing while the real board rendered
    // counter-clockwise — the fixture agreed with the renderer's bug instead of
    // with the content. `realContentSidesAscend` below now pins the convention
    // to the content pack so the two cannot drift apart again.
    coordinate: index % 11,
  };
}

function createSpaces(): readonly BoardSpaceView[] {
  return Array.from({ length: 44 }, (_, index): BoardSpaceView => {
    if (index % 11 === 0) return space(index, "landmark", "BRD", `Corner ${index}`);
    if (index === 7) return space(index, "social", "NET", "Coffee machine", "Coffee");
    if (index === 12) return space(index, "hazard", "BRN", "Burnout");
    if (index % 3 === 0) return space(index, "service", "FIN", `Finance ${index}`);

    return space(index, "workfloor", "WRK", "Work");
  });
}

describe("game board", () => {
  it("renders 44 travel-ordered spaces with complete accessible names", () => {
    // Given
    const spaces = createSpaces();

    // When
    const markup = renderToStaticMarkup(
      <GameBoard incident={incident} spaces={spaces} />,
    );

    // Then
    expect(markup.match(/class="board-tile"/g)).toHaveLength(44);
    expect(markup.indexOf("Space 01 of 44")).toBeLessThan(
      markup.indexOf("Space 44 of 44"),
    );
    expect(markup).toContain(
      "Space 08 of 44, Coffee machine, Social zone, code NET, unoccupied",
    );
  });

  it("keeps every space on the perimeter of the 12 by 12 grid", () => {
    // Given
    const spaces = createSpaces();

    // When
    const cells = spaces.map((candidate) => boardCell(candidate));

    // Then
    expect(cells).toHaveLength(44);
    for (const cell of cells) {
      expect(cell.col === 0 || cell.col === 11 || cell.row === 0 || cell.row === 11).toBe(
        true,
      );
    }
    expect(new Set(cells.map((cell) => `${cell.col}:${cell.row}`)).size).toBe(44);
    expect(cells[0]).toEqual({ col: 11, row: 11, axis: "horizontal" });
    expect(cells[23]).toEqual({ col: 1, row: 0, axis: "horizontal" });
    expect(cells[34]).toEqual({ col: 11, row: 1, axis: "vertical" });
  });

  it("agrees with the authored content pack about which way each side runs", () => {
    // Given — the real board, not a fixture. This is the assertion that was
    // missing: the reorder to the workbook changed `coordinate` to ascend with
    // board index, the renderer still assumed it descended, and every fixture
    // in this file encoded the renderer's assumption. So a stale convention
    // survived a full test suite and shipped a counter-clockwise board.
    const authored = deadlineDashContent.board.spaces;

    // The content declares its own direction; the renderer must honour it.
    expect(deadlineDashContent.board.direction).toBe("clockwise");

    // When
    const sideTiles = authored
      .map((tile, index) => ({ index, tile }))
      .filter((entry) => entry.tile.placement === "side");

    // Then — within a side, coordinate ascends in lockstep with board index.
    for (const { index, tile } of sideTiles) {
      if (tile.placement !== "side") continue;
      expect(tile.coordinate).toBe(index % 11);
    }

    // And the four corners sit exactly where the ring geometry expects them.
    expect(authored).toHaveLength(44);
    for (const corner of [0, 11, 22, 33]) {
      expect(authored[corner]?.placement).toBe("corner");
    }
  });

  it("closes the ring: consecutive spaces are always adjacent cells", () => {
    // Given
    const cells = createSpaces().map((candidate) => boardCell(candidate));

    // When
    const steps = cells.map((cell, index) => {
      const next = cells[(index + 1) % cells.length];
      if (!next) return Number.NaN;

      return Math.abs(next.col - cell.col) + Math.abs(next.row - cell.row);
    });

    // Then — one space of travel is one grid step, which is what lets a token
    // hop index-by-index and still trace the track (including 43 -> 0).
    expect(steps.every((step) => step === 1)).toBe(true);
  });

  it("labels tile kinds by code and zone rather than by colour alone", () => {
    // Given
    const spaces = createSpaces();

    // When
    const markup = renderToStaticMarkup(
      <GameBoard incident={incident} spaces={spaces} />,
    );

    // Then
    expect(markup).toContain('data-board-zone="workfloor"');
    expect(markup).toContain('data-board-zone="hazard"');
    expect(markup).toContain('data-board-code="BRN"');
    expect(markup).toContain('<span class="board-tile-code">WRK</span>');
    expect(markup).toContain('<span class="board-tile-name-full">Burnout</span>');
    expect(markup).toContain('data-slot="board-legend"');
    expect(markup).toContain('<span class="board-legend-name">Work floor</span>');
    expect(markup).toContain('<span class="board-legend-name">Hazard</span>');
    expect(markup).toContain('<dd class="board-legend-count">1</dd>');
  });

  it("ships both label forms so a narrow cell never breaks a word", () => {
    // When
    const markup = renderToStaticMarkup(
      <GameBoard incident={incident} spaces={createSpaces()} />,
    );

    // Then — the container query picks one; both are real whole words, and a
    // space without an authored short form repeats its full name rather than
    // rendering an empty label.
    expect(markup).toContain('<span class="board-tile-name-full">Coffee machine</span>');
    expect(markup).toContain('<span class="board-tile-name-short">Coffee</span>');
    expect(markup).toContain('<span class="board-tile-name-short">Burnout</span>');
    expect(markup).not.toContain("board-tile-name-short\"></span>");
  });

  it("marks the active space and the previous landing with separate devices", () => {
    // Given
    const spaces = createSpaces();

    // When
    const markup = renderToStaticMarkup(
      <GameBoard activeTile={7} incident={incident} landedTile={12} spaces={spaces} />,
    );

    // Then
    expect(markup.match(/data-board-active="true"/g)).toHaveLength(1);
    expect(markup.match(/data-board-landed="true"/g)).toHaveLength(1);
    expect(markup).toContain('data-board-tag="active"');
    expect(markup).toContain('data-board-tag="landed"');
    expect(markup).toContain("Coffee machine, Social zone, code NET, active space");
    expect(markup).toContain("Burnout, Hazard zone, code BRN, last landing");
  });

  it("docks several tokens on one space in one readable row", () => {
    // Given
    const players = [
      { id: "p-1", name: "Mina", seat: 1, position: 7 },
      { id: "p-2", name: "Omar", seat: 2, position: 7 },
      { id: "p-3", name: "Rae", seat: 3, position: 7 },
    ] as const satisfies readonly PlayerTokenView[];

    // When
    const markup = renderToStaticMarkup(
      <GameBoard
        activeTile={7}
        incident={incident}
        players={players}
        spaces={createSpaces()}
      />,
    );

    // Then — one dock row, seat order, 15px apart, and the count is on the tile
    // so the reserved band can never be mistaken for the label's space.
    expect(markup.match(/class="board-token"/g)).toHaveLength(3);
    expect(markup).toContain('<span class="board-token-seat">1</span>');
    expect(markup).toContain('<span class="board-token-seat">2</span>');
    expect(markup).toContain('<span class="board-token-seat">3</span>');
    expect(markup).toContain(
      '<span class="board-token-plate" data-board-seat="1" style="transform:none">',
    );
    expect(markup).toContain("translateX(15px)");
    expect(markup).toContain("translateX(30px)");
    expect(markup).toContain('data-board-occupants="3"');
    expect(markup).toContain(
      "occupied by Mina (seat 1), Omar (seat 2) and Rae (seat 3)",
    );
  });

  it("keeps the BOT tag while it fits and drops to seat glyphs when it cannot", () => {
    // Given
    const pair = [
      { id: "p-1", name: "Mina", seat: 1, position: 4 },
      { id: "p-2", name: "Ledger", seat: 2, position: 4, isBot: true },
    ] as const satisfies readonly PlayerTokenView[];
    const crowd = [
      ...pair,
      { id: "p-3", name: "Judge", seat: 3, position: 4, isBot: true },
    ] as const satisfies readonly PlayerTokenView[];

    // When
    const pairMarkup = renderToStaticMarkup(
      <GameBoard incident={incident} players={pair} spaces={createSpaces()} />,
    );
    const crowdMarkup = renderToStaticMarkup(
      <GameBoard incident={incident} players={crowd} spaces={createSpaces()} />,
    );

    // Then
    expect(pairMarkup).toContain('<span class="board-token-bot">BOT</span>');
    expect(pairMarkup).toContain('data-board-token-bot="true"');
    expect(pairMarkup).toContain('data-board-token-density="full"');
    expect(pairMarkup).toContain('aria-label="Ledger, seat 2, bot, space 05"');
    expect(pairMarkup).toContain("occupied by Mina (seat 1) and Ledger (seat 2, bot)");

    // Three plates carrying an uppercase tag would be 117px inside a ~98px cell,
    // so the group compacts. Bot-ness stays in the accessible name.
    expect(crowdMarkup).toContain('data-board-token-density="compact"');
    expect(crowdMarkup).not.toContain('<span class="board-token-bot">BOT</span>');
    expect(crowdMarkup).toContain('aria-label="Judge, seat 3, bot, space 05"');
    expect(crowdMarkup).toContain("translateX(15px)");
    expect(crowdMarkup).toContain("translateX(30px)");
  });

  it("renders tokens at their real cell and at rest on the first render", () => {
    // Given
    const players = [
      { id: "p-1", name: "Mina", seat: 1, position: 23, state: "current" },
      { id: "p-2", name: "Omar", seat: 2, position: 34, state: "disconnected" },
    ] as const satisfies readonly PlayerTokenView[];

    // When
    const markup = renderToStaticMarkup(
      <GameBoard
        activeTile={23}
        incident={incident}
        players={players}
        spaces={createSpaces()}
      />,
    );

    // Then — the canonical position is plain CSS on the token, the travel layer
    // is at `transform:none`, and nothing is marked as travelling. With animation
    // disabled entirely this markup is still a correct board.
    expect(markup).toContain("--board-token-col:1;--board-token-row:0");
    expect(markup).toContain("--board-token-col:11;--board-token-row:1");
    expect(markup).toContain('data-board-token-position="23"');
    expect(markup).toContain('data-board-token-position="34"');
    expect(markup.match(/class="board-token-travel" style="transform:none"/g))
      .toHaveLength(2);
    expect(markup).not.toContain("data-board-token-travelling");
    expect(markup).not.toContain("board-token-landing");
    expect(markup).toContain('data-board-token-state="current"');
    expect(markup).toContain('data-board-token-state="disconnected"');
    expect(markup).toContain("Omar, seat 2, space 35, disconnected");
  });

  it("renders the floor plate readouts and a focusable, pannable region", () => {
    // Given
    const label = "Deadline Dash office board";

    // When
    const markup = renderToStaticMarkup(
      <GameBoard incident={incident} label={label} spaces={createSpaces()} />,
    );

    // Then
    const describedBy = markup.match(/aria-describedby="([^"]+)"/)?.[1];
    expect(describedBy).toBeDefined();
    expect(markup).toContain('data-slot="board-pan-instructions"');
    expect(markup).toContain(`id="${describedBy}"`);
    expect(markup).toContain("sr-only");
    expect(markup).toContain('tabindex="0"');
    expect(markup).toContain('data-slot="board-incident"');
    expect(markup).toContain('data-board-tone="info"');
    expect(markup).toContain("Turn in progress");
    expect(markup).toContain('class="board-plate-main"');
    expect(markup).toContain('<p class="board-legend-head">Zone key</p>');
    expect(markup).toContain(
      '<dt class="board-plate-readout-label">Facility</dt><dd class="board-plate-readout-value">NET</dd>',
    );
    expect(markup).toContain("44 spaces · clockwise");
  });
});

describe("movement reach", () => {
  it("spells out what each die face lands on, wrapping past the last space", () => {
    // Given the active player is two spaces from the end of the ring
    const spaces = createSpaces();

    // When
    const markup = renderToStaticMarkup(
      <GameBoard activeTile={42} incident={incident} spaces={spaces} />,
    );

    // Then all six faces are present as markup — a reduced-motion player reads
    // the same board a player watching the tokens hop does — and the roll that
    // wraps names the space it actually reaches, not one past the end.
    expect(markup).toContain('data-slot="board-reach"');
    expect(markup).toContain(
      "Movement reach · one d6 clockwise from 43",
    );
    expect(markup.match(/class="board-reach-item"/g)).toHaveLength(6);
    expect(markup).toContain('<span class="board-reach-roll">1</span>');
    expect(markup).toContain('<span class="board-reach-roll">6</span>');
    // 42 + 2 = 44 wraps to space index 0, the bottom-right corner.
    expect(markup).toContain(
      '<span class="board-reach-roll">2</span><span class="board-reach-facility">' +
        '<span aria-hidden="true" class="board-legend-swatch" data-board-zone="landmark">' +
        '</span><span class="board-reach-code">BRD</span></span>' +
        '<span class="board-reach-name">Corner 0</span>' +
        '<span class="board-reach-zone">Landmark</span>',
    );
  });

  it("names the zone of every destination, not only its code", () => {
    // Given — the interior's 254.7 x 825.3px blank block went to this table, so
    // it now answers "is this a good square to land on" and not only "what is it
    // called". The swatch is the zone key's own swatch, reused, so a column can
    // be scanned by pattern before a word is read.
    const markup = renderToStaticMarkup(
      <GameBoard activeTile={11} incident={incident} spaces={createSpaces()} />,
    );

    // Then
    expect(markup).toContain('<span class="board-reach-zone">Hazard</span>');
    expect(markup).toContain('<span class="board-reach-name">Burnout</span>');
    expect(
      markup.match(
        /class="board-reach-facility"><span aria-hidden="true" class="board-legend-swatch"/g,
      ),
    ).toHaveLength(6);
  });

  it("leaves the claim line off entirely when the mode has no territory", () => {
    // Given a mode that never claims anything
    const markup = renderToStaticMarkup(
      <GameBoard activeTile={7} incident={incident} spaces={createSpaces()} />,
    );

    // Then the column does not pay height for a fact the ruleset cannot produce.
    expect(markup).not.toContain("board-reach-claim");
  });

  it("omits the reach strip when no seat is on the floor", () => {
    // When
    const markup = renderToStaticMarkup(
      <GameBoard incident={incident} spaces={createSpaces()} />,
    );

    // Then
    expect(markup).not.toContain('data-slot="board-reach"');
  });
});

describe("the quarter strip", () => {
  it("puts the announced event on the board instead of behind a tab (§5.7)", () => {
    // Given a mode running quarters, with next quarter's shock already announced
    const markup = renderToStaticMarkup(
      <GameBoard
        incident={{
          ...incident,
          schedule: {
            quarterLabel: "Q2",
            span: "R13–24",
            currentEventLabel: "Hiring freeze",
            nextQuarterLabel: "Q3",
            nextEventLabel: "Restructure",
          },
        }}
        spaces={createSpaces()}
      />,
    );

    // Then all three facts are on the board, and the announcement is flagged as
    // one — an announcement nobody sees is not an announcement.
    expect(markup).toContain('data-slot="board-schedule"');
    expect(markup).toContain("Q2 · R13–24");
    expect(markup).toContain("Hiring freeze");
    expect(markup).toContain("Announced · Q3");
    expect(markup).toContain("Restructure");
    expect(markup).toContain('data-board-announced="true"');
  });

  it("reserves every cell so arming an announcement cannot move the board", () => {
    // Given the same quarter before anything is scheduled
    const quiet = renderToStaticMarkup(
      <GameBoard
        incident={{
          ...incident,
          schedule: {
            quarterLabel: "Q1",
            span: "R01–12",
            currentEventLabel: null,
            nextQuarterLabel: "Q2",
            nextEventLabel: null,
          },
        }}
        spaces={createSpaces()}
      />,
    );

    // Then the strip has the same three cells and the same LED, carrying resting
    // values rather than being absent (§12.1).
    expect(quiet.match(/class="board-schedule-cell"/g)).toHaveLength(3);
    expect(quiet).toContain('data-slot="board-schedule-announcement"');
    expect(quiet).toContain("Nothing scheduled yet");
    expect(quiet).toContain('class="board-schedule-led"');
    expect(quiet).not.toContain('data-board-announced="true"');
    expect(quiet).toContain(
      '<dd class="board-schedule-value">—</dd>',
    );
  });

  it("draws no strip at all for a mode that runs no quarters", () => {
    // Given
    const markup = renderToStaticMarkup(
      <GameBoard incident={incident} spaces={createSpaces()} />,
    );

    // Then the plate's quarter row collapses rather than reserving an empty band
    // for a fact this ruleset can never have.
    expect(markup).not.toContain("board-schedule");
  });
});

describe("ring travel arithmetic", () => {
  it("always measures the clockwise distance, including past the last space", () => {
    // Then — a move off the end of the ring travels forward through the corner
    // rather than backwards across the interior.
    expect(forwardDistance(20, 26, 44)).toBe(6);
    expect(forwardDistance(41, 2, 44)).toBe(5);
    expect(forwardDistance(43, 0, 44)).toBe(1);
    expect(forwardDistance(0, 43, 44)).toBe(43);
    expect(forwardDistance(7, 7, 44)).toBe(0);
    expect(forwardDistance(3, 4, 0)).toBe(0);
  });
});
