import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { GameBoard } from "./game-board";
import type { BoardSpaceView, PlayerTokenView } from "./types";

const corners = [
  "bottom-right",
  "bottom-left",
  "top-left",
  "top-right",
] as const;

function createSpaces(): readonly BoardSpaceView[] {
  return Array.from({ length: 44 }, (_, index): BoardSpaceView => {
    if (index % 11 === 0) {
      return {
        id: `tile-${index}`,
        index,
        placement: "corner",
        coordinate: corners[index / 11] ?? "bottom-right",
        kind: index === 0 ? "start" : "corner",
        label: `Corner ${index}`,
        categoryLabel: index === 0 ? "Start" : "Corner",
      };
    }

    const sideIndex = Math.floor(index / 11);
    const side = ["bottom", "left", "top", "right"] as const;

    return {
      id: `tile-${index}`,
      index,
      placement: "side",
      side: side[sideIndex] ?? "bottom",
      coordinate: 11 - (index % 11),
      kind: index % 3 === 0 ? "action" : "department",
      label: `Space ${index}`,
      categoryLabel: index % 3 === 0 ? "Action" : "Department",
      detail: `$${index * 100}`,
    };
  });
}

describe("GameBoard", () => {
  it("renders 44 travel-ordered spaces with complete accessible names", () => {
    // Given
    const spaces = createSpaces();

    // When
    const markup = renderToStaticMarkup(
      <GameBoard incident={{ title: "Quarterly incident" }} spaces={spaces} />,
    );

    // Then
    expect(markup.match(/role="listitem"/g)).toHaveLength(44);
    expect(markup.indexOf("Position 1 of 44")).toBeLessThan(
      markup.indexOf("Position 44 of 44"),
    );
    expect(markup).toContain("Space 1, Department, unowned, no players");
    expect(markup).toContain(
      'data-board-index="23" data-kind="department" data-placement="side" role="listitem" style="grid-column:2;grid-row:1"',
    );
    expect(markup).toContain(
      'data-board-index="34" data-kind="department" data-placement="side" role="listitem" style="grid-column:12;grid-row:2"',
    );
  });

  it("marks the active space and exposes every occupant by text", () => {
    // Given
    const players = [
      { id: "player-1", name: "Mina", seat: 1, position: 7, initials: "MN" },
      { id: "player-2", name: "Omar", seat: 2, position: 7, initials: "OM" },
    ] as const satisfies readonly PlayerTokenView[];

    // When
    const markup = renderToStaticMarkup(
      <GameBoard
        activeTile={7}
        incident={{ title: "Printer outage", status: "Resolving" }}
        players={players}
        spaces={createSpaces()}
      />,
    );

    // Then
    expect(markup).toContain('data-active="true"');
    expect(markup).toContain("Mina and Omar");
    expect(markup).toContain('aria-label="Mina, seat 1"');
    expect(markup).toContain('aria-label="Omar, seat 2"');
  });

  it("exposes a mobile panning instruction without changing board geometry", () => {
    // Given
    const label = "Deadline Dash board";

    // When
    const markup = renderToStaticMarkup(
      <GameBoard incident={{ title: "Quarterly incident" }} label={label} spaces={createSpaces()} />,
    );

    // Then
    const describedBy = markup.match(/aria-describedby="([^"]+)"/)?.[1];
    expect(describedBy).toBeDefined();
    expect(markup).toContain('data-slot="board-pan-instructions"');
    expect(markup).toContain(`id="${describedBy}"`);
    expect(markup).toContain("sr-only");
    expect(markup).toContain('tabindex="0"');
    expect(markup).toContain("overflow-auto");
    expect(markup).toContain("grid-cols-12");
  });
});
