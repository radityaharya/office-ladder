import { describe, expect, it } from "vitest";

import { MAX_TRAVEL_MS, travelDurationMs } from "../../../lib/motion";

import type { PlayerTokenView } from "./types";
import {
  advanceTravel,
  type BoardTravelEntry,
  reconcileTravel,
} from "./use-board-travel";

const SPACES = 44;

function player(id: string, position: number, seat = 1): PlayerTokenView {
  return { id, name: id.toUpperCase(), position, seat: seat as 1 };
}

function entries(
  ...rows: readonly (readonly [string, BoardTravelEntry])[]
): ReadonlyMap<string, BoardTravelEntry> {
  return new Map(rows);
}

/** Every hop the machine takes until the view agrees with the projection. */
function playOut(
  start: ReadonlyMap<string, BoardTravelEntry>,
  id: string,
): readonly number[] {
  const path: number[] = [];
  let state = start;
  // Bounded so a machine that failed to converge fails the test instead of
  // hanging it.
  for (let hop = 0; hop < SPACES * 2; hop += 1) {
    const next = advanceTravel(state, SPACES);
    if (!next) break;
    state = next;
    const entry = state.get(id);
    if (entry) path.push(entry.render);
  }

  return path;
}

describe("board travel machine", () => {
  it("seeds a token it has never drawn at rest on its real space", () => {
    // When — joining a match in progress must not animate a lap of catch-up.
    const seeded = reconcileTravel(new Map(), [player("a", 19)], SPACES, false);

    // Then
    expect(seeded?.get("a")).toEqual({ arrival: 0, render: 19, step: 0, truth: 19 });
    expect(reconcileTravel(seeded ?? new Map(), [player("a", 19)], SPACES, false)).toBe(
      null,
    );
  });

  it("hops one space at a time and only marks an arrival at the destination", () => {
    // Given a token at rest on space 0
    const rest = entries(["a", { arrival: 0, render: 0, step: 0, truth: 0 }]);

    // When the projection moves it six spaces
    const moved = reconcileTravel(rest, [player("a", 6)], SPACES, false);

    // Then the truth is immediate and the drawing lags, one space per hop
    expect(moved?.get("a")).toEqual({ arrival: 0, render: 0, step: 0, truth: 6 });
    expect(playOut(moved ?? rest, "a")).toEqual([1, 2, 3, 4, 5, 6]);
    expect(travelDurationMs(6)).toBe(840);
  });

  it("travels forward through the corner when a move wraps past the last space", () => {
    // Given a token drawn on space 41 of a 44-space ring
    const rest = entries(["a", { arrival: 3, render: 41, step: 0, truth: 41 }]);

    // When it moves to space 2
    const moved = reconcileTravel(rest, [player("a", 2)], SPACES, false);

    // Then it walks 42, 43, 0, 1, 2 — never backwards across the interior
    expect(playOut(moved ?? rest, "a")).toEqual([42, 43, 0, 1, 2]);
    expect(moved?.get("a")?.render).toBe(41);
  });

  it("snaps rather than exceeding the travel budget", () => {
    // Given
    const rest = entries(["a", { arrival: 1, render: 41, step: 0, truth: 41 }]);

    // When the move is longer than the budget allows (9 spaces is 1260ms)
    const moved = reconcileTravel(rest, [player("a", 6)], SPACES, false);

    // Then it is already at the truth, and acknowledged as an arrival so the
    // landing still registers.
    expect(9 * 140).toBeGreaterThan(MAX_TRAVEL_MS);
    expect(moved?.get("a")).toEqual({ arrival: 2, render: 6, step: 0, truth: 6 });
    expect(advanceTravel(moved ?? rest, SPACES)).toBe(null);
  });

  it("re-targets an interrupted move from where the token is drawn", () => {
    // Given a token mid-travel: drawn on 2, heading for 6
    const midTravel = entries(["a", { arrival: 0, render: 2, step: 0, truth: 6 }]);

    // When a newer projection moves the destination on
    const retargeted = reconcileTravel(midTravel, [player("a", 9)], SPACES, false);

    // Then it keeps travelling from 2 (not from 6, and not from where the old
    // move began) and still walks every space in between.
    expect(retargeted?.get("a")).toEqual({ arrival: 0, render: 2, step: 0, truth: 9 });
    expect(playOut(retargeted ?? midTravel, "a")).toEqual([3, 4, 5, 6, 7, 8, 9]);
  });

  it("snaps an interrupted move whose remaining distance blows the budget", () => {
    // Given
    const midTravel = entries(["a", { arrival: 0, render: 2, step: 0, truth: 6 }]);

    // When the projection jumps far ahead while the token is still walking
    const retargeted = reconcileTravel(midTravel, [player("a", 30)], SPACES, false);

    // Then it converges on the truth immediately rather than crawling — and is
    // never left stranded on the intermediate space it happened to be drawn on.
    expect(retargeted?.get("a")).toEqual({ arrival: 1, render: 30, step: 0, truth: 30 });
  });

  it("moves every travelling token on one shared beat", () => {
    // Given three tokens, two of them mid-travel
    const burst = entries(
      ["a", { arrival: 0, render: 4, step: 0, truth: 7 }],
      ["b", { arrival: 0, render: 40, step: 0, truth: 1 }],
      ["c", { arrival: 2, render: 12, step: 0, truth: 12 }],
    );

    // When
    const hopped = advanceTravel(burst, SPACES);

    // Then
    expect(hopped?.get("a")?.render).toBe(5);
    expect(hopped?.get("b")?.render).toBe(41);
    expect(hopped?.get("c")).toEqual({ arrival: 2, render: 12, step: 0, truth: 12 });
  });

  it("places the start of a travel without animating it, then animates each hop", () => {
    // Given a token at rest on space 0
    const rest = entries(["a", { arrival: 0, render: 0, step: 0, truth: 0 }]);

    // When the projection moves it forward
    const started = reconcileTravel(rest, [player("a", 4)], SPACES, false);

    // Then the commit that re-targets it is step 0. The token is still drawn at
    // its origin while its real space is already 4, so this single commit shifts
    // the offset by four whole cells — the renderer must PLACE that, not animate
    // it, or the token appears at its destination and slides backwards first.
    expect(started?.get("a")).toEqual({ arrival: 0, render: 0, step: 0, truth: 4 });

    // And every hop after it is a real one-tile step, which does animate.
    const first = advanceTravel(started ?? rest, SPACES);
    expect(first?.get("a")).toEqual({ arrival: 0, render: 1, step: 1, truth: 4 });

    const second = advanceTravel(first ?? rest, SPACES);
    expect(second?.get("a")).toEqual({ arrival: 0, render: 2, step: 2, truth: 4 });
  });

  it("collapses to an instant state change under reduced motion", () => {
    // Given a token at rest and a six-space move
    const rest = entries(["a", { arrival: 0, render: 0, step: 0, truth: 0 }]);

    // When
    const moved = reconcileTravel(rest, [player("a", 6)], SPACES, true);

    // Then it is drawn on the real space at once, with no arrival to
    // acknowledge — the evidence of the move is the token's new space, which is
    // in the markup either way.
    expect(moved?.get("a")).toEqual({ arrival: 0, render: 6, step: 0, truth: 6 });
    expect(advanceTravel(moved ?? rest, SPACES)).toBe(null);
  });

  it("recovers a token stranded mid-travel when reduced motion turns on", () => {
    // Given
    const midTravel = entries(["a", { arrival: 0, render: 2, step: 0, truth: 6 }]);

    // When the same projection is reconciled with reduced motion on
    const settled = reconcileTravel(midTravel, [player("a", 6)], SPACES, true);

    // Then
    expect(settled?.get("a")).toEqual({ arrival: 0, render: 6, step: 0, truth: 6 });
  });

  it("forgets tokens that leave the projection", () => {
    // Given
    const both = entries(
      ["a", { arrival: 0, render: 3, step: 0, truth: 3 }],
      ["b", { arrival: 0, render: 9, step: 0, truth: 9 }],
    );

    // When
    const only = reconcileTravel(both, [player("a", 3)], SPACES, false);

    // Then
    expect(only?.has("b")).toBe(false);
    expect(only?.size).toBe(1);
  });
});
