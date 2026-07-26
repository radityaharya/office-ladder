import { describe, expect, it } from "vitest";

import { deadlineDashBoard } from "../src/deadline-dash";
import type { BoardTile, EffectDescriptor, RollOutcome } from "../src/schema";

/**
 * Every tile rule the design workbook states as a fixed number, pinned against
 * the workbook itself.
 *
 * These values are otherwise unguarded: `validation/deadline-dash.ts` checks the
 * *shape* of every effect (kinds, dice, deck and status references, non-
 * overlapping outcome bands) but deliberately no per-tile amounts, and the
 * counts test next door only counts tiles by kind. So a Finance tile authored to
 * take $30 instead of $300, or a Marketing tile authored with the wrong resource,
 * is currently a valid content pack that quietly plays a different game.
 *
 * Sources, in the order they were reconciled:
 * - `docs/Office_Board_Game_Design_Workbook.xlsx`, sheets `01_Board_Corners` and
 *   `02_General_Tiles` — the authority for these numbers.
 * - `docs/DEADLINE_DASH_FULL_GDD.md` and the two `How_to_Play` rulebooks, used
 *   where the workbook's shorthand is ambiguous (see the 2d6 note below).
 */
const spaces: readonly BoardTile[] = deadlineDashBoard.spaces;

function tilesOfKind(kind: BoardTile["kind"]): readonly BoardTile[] {
  const tiles = spaces.filter((tile) => tile.kind === kind);
  if (tiles.length === 0) throw new Error(`no authored tile of kind ${kind}`);
  return tiles;
}

function onlyTileOfKind(kind: BoardTile["kind"]): BoardTile {
  const tiles = tilesOfKind(kind);
  expect(tiles).toHaveLength(1);
  const tile = tiles[0];
  if (tile === undefined) throw new Error(`no authored tile of kind ${kind}`);
  return tile;
}

describe("workbook flat-value tiles", () => {
  it.each([
    [
      // "Budget Control | -300 | Pay $300 (Unexpected company deduction / tax /
      // reimbursement issue)". Paying up to what the player has is the authored
      // reading of a debt they cannot dodge.
      "finance",
      [
        {
          type: "payResource",
          resource: "money",
          amount: 300,
          insufficientFunds: "pay-up-to-available",
        },
      ],
    ],
    [
      // "Best Employee | Resources | Money Reward 500 | Reputation Reward 3".
      "best-employee",
      [
        { type: "modifyResource", resource: "money", amount: 500 },
        { type: "modifyResource", resource: "reputation", amount: 3 },
      ],
    ],
    [
      // "CEO's Favorite | Golden boy / girl | Instantly +2 rep when land on this tile".
      "ceo-favorite",
      [{ type: "modifyResource", resource: "reputation", amount: 2 }],
    ],
    [
      // "Marketing | Exposure | Gain +1 rep instantly".
      "marketing",
      [{ type: "modifyResource", resource: "reputation", amount: 1 }],
    ],
    [
      // "IT | Productivity | Ignore energy cost on the next 'work' tile".
      "it",
      [
        {
          type: "applyStatus",
          statusId: "status.ignore-next-work-energy",
          duration: { kind: "uses", count: 1 },
        },
      ],
    ],
    [
      // "Legal | Bureaucracy | Skip special effect of the next tile you land on".
      "legal",
      [
        {
          type: "applyStatus",
          statusId: "status.skip-next-tile-effect",
          duration: { kind: "uses", count: 1 },
        },
      ],
    ],
    [
      // "Operation | Efficiency | Move extra +2 tiles on the next roll".
      // `traversal: true` records that the two extra spaces are walked, so they
      // can trigger a Receptionist pass rather than teleporting past it.
      "operation",
      [
        {
          type: "applyStatus",
          statusId: "status.next-roll-extra-movement",
          duration: { kind: "uses", count: 1 },
          parameters: { spaces: 2, traversal: true },
        },
      ],
    ],
  ] as const)("authors the %s tile exactly as the workbook states it", (kind, effects) => {
    expect(onlyTileOfKind(kind).effects).toEqual(effects);
  });

  it("authors all four Restore Energy tiles as a full refill and nothing else", () => {
    // "Pantry / Lunch Break / Employee Lounge / Smoking Area | Restore Energy |
    // Refill energy to full", one per side.
    const tiles = tilesOfKind("energy-restore");
    expect(tiles).toHaveLength(4);
    for (const tile of tiles) {
      expect(tile.effects).toEqual([
        { type: "restoreResourceToMaximum", resource: "energy" },
      ]);
    }
  });

  it("authors the Burnout tile's two skipped turns, and nothing that shortens them", () => {
    // "Burnout | Skip 2 turns". The accompanying two-turn movement-penalty status
    // is an authored elaboration the workbook does not mention; it is asserted
    // here so it stays deliberate and visible rather than being mistaken for the
    // workbook's own rule.
    const burnout = onlyTileOfKind("burnout");
    expect(burnout.effects[0]).toEqual({ type: "skipTurns", count: 2, source: "tile" });
    expect(burnout.effects).toEqual([
      { type: "skipTurns", count: 2, source: "tile" },
      {
        type: "applyStatus",
        statusId: "status.burnout-tile",
        duration: { kind: "turns", count: 2 },
        parameters: { movementPenalty: 1 },
      },
    ]);
  });

  it("authors the Receptionist corner's payday and its landing-only free roll", () => {
    // "Receptionist | Starting Point & Payday | Receive Salary when passing |
    // + Salary | Another roll (Free energy) if stop in this tile".
    expect(onlyTileOfKind("receptionist").effects).toEqual([
      { type: "gainSalary", trigger: "pass" },
      { type: "gainSalary", trigger: "land" },
      { type: "grantExtraRoll", count: 1 },
    ]);
  });

  it("authors the HR tile as doubles-or-nothing on a 2d6 check", () => {
    // "HR | Performance Feedback | Reputation Reward -1 | Dice Check Yes |
    // 1. Double Dices : no effect (safe performance) | 2. Other Number : -1 Rep".
    expect(onlyTileOfKind("hr").effects).toEqual([
      {
        type: "rollCheck",
        dice: { count: 2, sides: 6 },
        rerollEligible: false,
        outcomes: [
          { when: { doubles: true }, effects: [] },
          {
            when: { doubles: false },
            effects: [
              {
                type: "modifyResource",
                resource: "reputation",
                amount: -1,
                clampAtZero: true,
              },
            ],
          },
        ],
      },
    ]);
  });

  it("authors the Sales tile's two payday multipliers on the workbook's own bands", () => {
    // "Sales | Revenue | Dice Check Yes | Roll the dice again to decide bonus:
    // 1 - 9 : 1.5x salary on the next payday | 10 - 12 : 2x salary on the next
    // payday". The workbook's "1" is impossible on 2d6 and GDD:163 states 2-9,
    // which is what is authored; the band arithmetic is checked below.
    expect(onlyTileOfKind("sales").effects).toEqual([
      {
        type: "rollCheck",
        dice: { count: 2, sides: 6 },
        rerollEligible: false,
        outcomes: [
          {
            when: { total: [2, 9] },
            effects: [
              {
                type: "applyStatus",
                statusId: "status.next-salary-multiplier",
                duration: { kind: "uses", count: 1 },
                parameters: { multiplier: 1.5 },
              },
            ],
          },
          {
            when: { total: [10, 12] },
            effects: [
              {
                type: "applyStatus",
                statusId: "status.next-salary-multiplier",
                duration: { kind: "uses", count: 1 },
                parameters: { multiplier: 2 },
              },
            ],
          },
        ],
      },
    ]);
  });

  it.each([
    ["work", "deck.work"],
    ["meeting", "deck.meeting"],
    ["event", "deck.event"],
    ["networking", "deck.networking"],
    ["board-meeting", "deck.board-meeting"],
    ["annual-event", "deck.annual-event"],
  ] as const)("draws one %s card from %s on every tile of that kind", (kind, deckId) => {
    for (const tile of tilesOfKind(kind)) {
      expect(tile.effects).toEqual(
        expect.arrayContaining([{ type: "drawCards", deckId, count: 1 }]),
      );
    }
  });
});

/**
 * Dice arithmetic for every authored roll on the board.
 *
 * The workbook writes Training as "1 - 6 = +1 Rep | 7 - 12 = +2 Rep" and Sales as
 * "1 - 9 / 10 - 12", which only make sense on 2d6 — the minimum total of 2d6 is
 * 2, and a 1d6 roll cannot reach 7 or 10 at all. Authoring either of those bands
 * against `{ count: 1 }` would leave its outcome permanently unreachable and the
 * tile silently doing less than the workbook says. The validator already rejects
 * a band outside the declared dice's range, so this covers the other half it does
 * not check: that the bands leave no *gap* either, because a total no band
 * matches makes `matchRollOutcome` return null and the whole roll a no-op.
 */
type Roll = {
  readonly path: string;
  readonly dice: { readonly count: number; readonly sides: number };
  readonly outcomes: readonly RollOutcome[];
};

function collectRolls(
  effects: readonly EffectDescriptor[],
  path: string,
  found: Roll[],
): void {
  effects.forEach((effect, index) => {
    if (effect.type !== "rollCheck") return;
    const rollPath = `${path}[${index}]`;
    found.push({ path: rollPath, dice: effect.dice, outcomes: effect.outcomes });
    effect.outcomes.forEach((outcome, outcomeIndex) => {
      collectRolls(outcome.effects, `${rollPath}.outcomes[${outcomeIndex}].effects`, found);
    });
  });
}

function boardRolls(): readonly Roll[] {
  const found: Roll[] = [];
  for (const tile of spaces) {
    collectRolls(tile.effects, `${tile.id}.effects`, found);
    const decision = tile.decision;
    if (decision === undefined) continue;

    found.push({
      path: `${tile.id}.decision.accept`,
      dice: decision.accept.roll,
      outcomes: decision.accept.outcomes,
    });
    collectRolls(decision.decline.effects, `${tile.id}.decision.decline.effects`, found);
    decision.accept.outcomes.forEach((outcome, outcomeIndex) => {
      collectRolls(
        outcome.effects,
        `${tile.id}.decision.accept.outcomes[${outcomeIndex}].effects`,
        found,
      );
    });
  }

  return found;
}

describe("authored dice bands are reachable and complete", () => {
  it("finds every authored roll on the board, including the tile decision's", () => {
    const paths = boardRolls().map((roll) => roll.path);

    // A guard on the guard: if this ever finds nothing, every assertion below
    // would pass vacuously.
    expect(paths).toEqual([
      "tile.board.01.training.decision.accept",
      "tile.board.05.hr.effects[0]",
      "tile.board.37.sales.effects[0]",
    ]);
  });

  it.each(boardRolls().map((roll) => [roll.path, roll] as const))(
    "%s covers every total its dice can produce, exactly once",
    (_path, roll) => {
      const minimum = roll.dice.count;
      const maximum = roll.dice.count * roll.dice.sides;
      const bands = roll.outcomes.flatMap((outcome) =>
        "total" in outcome.when ? [outcome.when.total] : [],
      );

      if (bands.length === 0) {
        // A doubles-only roll instead: both branches must be authored, or one of
        // them silently does nothing.
        const doubles = roll.outcomes.flatMap((outcome) =>
          "doubles" in outcome.when ? [outcome.when.doubles] : [],
        );
        expect([...doubles].sort()).toEqual([false, true]);
        return;
      }

      for (const [start, end] of bands) {
        expect(Number.isInteger(start)).toBe(true);
        expect(Number.isInteger(end)).toBe(true);
        expect(start).toBeLessThanOrEqual(end);
        // Unreachable at either end means an outcome nobody can ever roll.
        expect(start).toBeGreaterThanOrEqual(minimum);
        expect(end).toBeLessThanOrEqual(maximum);
      }

      for (let total = minimum; total <= maximum; total += 1) {
        const matching = bands.filter(([start, end]) => total >= start && total <= end);
        expect(matching).toHaveLength(1);
      }
    },
  );

  it("authors the Training tile's reputation bands on two dice, as its 7-12 outcome requires", () => {
    // The one case the workbook's shorthand gets wrong on its face: "1 - 6 /
    // 7 - 12" is a 2d6 spread written with a 1d6 minimum. Both rulebooks and
    // GDD:118 say 2-6 / 7-12, which is what is authored.
    const decision = onlyTileOfKind("training").decision;
    if (decision === undefined) throw new Error("training tile authors no decision");

    expect(decision.accept.roll).toEqual({ count: 2, sides: 6 });
    expect(decision.accept.outcomes.map((outcome) => outcome.when)).toEqual([
      { total: [2, 6] },
      { total: [7, 12] },
    ]);
    // The higher band must be the better one, whatever the amounts are.
    const gain = (outcome: RollOutcome): number => {
      const effect = outcome.effects[0];
      if (effect === undefined || effect.type !== "modifyResource") {
        throw new Error("expected a reputation reward");
      }
      expect(effect.resource).toBe("reputation");
      return effect.amount;
    };
    const [low, high] = decision.accept.outcomes;
    if (low === undefined || high === undefined) throw new Error("expected two outcomes");
    expect(gain(high)).toBeGreaterThan(gain(low));
  });
});
