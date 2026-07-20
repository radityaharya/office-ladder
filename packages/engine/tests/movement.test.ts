import fc from "fast-check";
import { describe, expect, it } from "vitest";

import { moveAroundBoard } from "../src/rules/movement";

describe("moveAroundBoard", () => {
  it("wraps forward and distinguishes an exact Receptionist stop from passing", () => {
    expect(
      moveAroundBoard({ position: 43, spaces: 1, boardSize: 44 }),
    ).toEqual({
      path: [0],
      destination: 0,
      passedReceptionist: false,
      stoppedOnReceptionist: true,
      receptionistSalaryAwards: 1,
      receptionistLandingRewardEligible: true,
      laps: 1,
    });
  });

  it("reports passing Receptionist when movement continues beyond it", () => {
    expect(
      moveAroundBoard({ position: 42, spaces: 3, boardSize: 44 }),
    ).toEqual({
      path: [43, 0, 1],
      destination: 1,
      passedReceptionist: true,
      stoppedOnReceptionist: false,
      receptionistSalaryAwards: 1,
      receptionistLandingRewardEligible: false,
      laps: 1,
    });
  });

  it("counts every completed forward lap, including a final Receptionist stop", () => {
    const result = moveAroundBoard({ position: 43, spaces: 89, boardSize: 44 });

    expect(result.destination).toBe(0);
    expect(result.path).toHaveLength(89);
    expect(result.path.filter((position) => position === 0)).toHaveLength(3);
    expect(result).toMatchObject({
      passedReceptionist: true,
      stoppedOnReceptionist: true,
      receptionistSalaryAwards: 3,
      receptionistLandingRewardEligible: true,
      laps: 3,
    });
  });

  it("wraps backward without awarding laps or Receptionist passes", () => {
    expect(
      moveAroundBoard({
        position: 1,
        spaces: 2,
        boardSize: 44,
        direction: "backward",
      }),
    ).toEqual({
      path: [0, 43],
      destination: 43,
      passedReceptionist: false,
      stoppedOnReceptionist: false,
      receptionistSalaryAwards: 0,
      receptionistLandingRewardEligible: false,
      laps: 0,
    });
  });

  it("does not move or treat the starting space as entered for zero spaces", () => {
    expect(
      moveAroundBoard({ position: 0, spaces: 0, boardSize: 44 }),
    ).toEqual({
      path: [],
      destination: 0,
      passedReceptionist: false,
      stoppedOnReceptionist: false,
      receptionistSalaryAwards: 0,
      receptionistLandingRewardEligible: false,
      laps: 0,
    });
  });

  it("does not make backward Receptionist stops eligible for rewards", () => {
    expect(
      moveAroundBoard({
        position: 1,
        spaces: 1,
        boardSize: 44,
        direction: "backward",
      }),
    ).toMatchObject({
      destination: 0,
      stoppedOnReceptionist: true,
      receptionistSalaryAwards: 0,
      receptionistLandingRewardEligible: false,
      laps: 0,
    });
  });

  it("always computes the modular destination in either direction", () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 1, max: 100 }),
        fc.nat({ max: 10_000 }),
        fc.nat({ max: 500 }),
        fc.constantFrom("forward" as const, "backward" as const),
        (boardSize, rawPosition, spaces, direction) => {
          const position = rawPosition % boardSize;
          const delta = direction === "forward" ? spaces : -spaces;
          const expected = ((position + delta) % boardSize + boardSize) % boardSize;
          const result = moveAroundBoard({
            position,
            spaces,
            boardSize,
            direction,
          });

          expect(result.destination).toBe(expected);
          expect(result.path).toHaveLength(spaces);
          expect(result.path.every((index) => index >= 0 && index < boardSize)).toBe(
            true,
          );
        },
      ),
    );
  });
});
