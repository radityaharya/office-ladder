import { describe, expect, it } from "vitest";

import { deadlineDashBoard, deadlineDashContent } from "../src/deadline-dash";
import type { BoardTile, EffectDescriptor, TileDecisionConfig } from "../src/schema";
import { validateDeadlineDashContent } from "../src/validation";
import type { DeadlineDashContentValidationInput } from "../src/validation";

/**
 * The authored pack is `as const`, so indexing it yields a 44-member union of
 * tile literals on which the optional `decision` property does not exist. Every
 * consumer that reads a tile generically has to widen the same way the engine
 * does (`const tile: BoardTile | undefined = ...find(...)`).
 */
const spaces: readonly BoardTile[] = deadlineDashBoard.spaces;

type MutableDecision = {
  kind: string;
  accept: {
    optionId: string;
    cost: { resource: string; amount: number };
    roll: { count: number; sides: number };
    rerollEligible: boolean;
    outcomes: Array<{ when: { total: [number, number] }; effects: unknown[] }>;
  };
  decline: { optionId: string; effects: unknown[] };
  whenUnaffordable: string;
};

type MutableSpace = { id: string; effects: unknown[]; decision?: MutableDecision };

type MutableContent = {
  board: { spaces: MutableSpace[] };
};

function requireMutableDecision(space: MutableSpace): MutableDecision {
  if (space.decision === undefined) throw new Error("expected the training decision");
  return space.decision;
}

/**
 * Derived, not written down: board order is the workbook's ordering column and
 * `board-order.test.ts` pins it, so a reorder must not silently re-point these
 * mutation tests at whatever tile happens to sit at a literal index.
 */
const TRAINING_INDEX = spaces.findIndex((tile) => tile.kind === "training");
const BURNOUT_INDEX = spaces.findIndex((tile) => tile.kind === "burnout");

function validateMutation(mutate: (content: MutableContent) => void) {
  const content = structuredClone(deadlineDashContent) as unknown as MutableContent;
  mutate(content);

  return validateDeadlineDashContent(
    content as unknown as DeadlineDashContentValidationInput,
  );
}

function expectIssue(
  result: ReturnType<typeof validateDeadlineDashContent>,
  code: string,
  path: string,
): void {
  expect(result.valid).toBe(false);
  expect(result.issues).toEqual(
    expect.arrayContaining([expect.objectContaining({ code, path })]),
  );
}

function requireDecision(index: number): TileDecisionConfig {
  const decision = spaces[index]?.decision;
  if (decision === undefined) throw new Error(`tile ${index} offers no decision`);
  return decision;
}

function requireTotalBand(when: { readonly total: readonly [number, number] } | object) {
  if (!("total" in when)) throw new Error("expected a total-range condition");
  return when.total;
}

function requireReputationGain(effects: readonly EffectDescriptor[]): number {
  const [effect] = effects;
  if (effect === undefined || effect.type !== "modifyResource") {
    throw new Error("expected a single modifyResource effect");
  }
  return effect.amount;
}

describe("Deadline Dash tile decisions", () => {
  it("offers exactly one tile decision, on the Training space", () => {
    const withDecisions = spaces.filter((tile) => tile.decision !== undefined);

    expect(withDecisions.map((tile) => tile.id)).toEqual(["tile.board.01.training"]);
    expect(requireDecision(TRAINING_INDEX)).toMatchObject({
      kind: "training-course",
      accept: {
        optionId: "enroll",
        cost: { resource: "money", amount: 300 },
        roll: { count: 2, sides: 6 },
        rerollEligible: false,
      },
      decline: { optionId: "decline" },
      whenUnaffordable: "resolve-decline",
    });
  });

  it("covers every 2d6 total in the accept branch and never charges for declining", () => {
    const decision = requireDecision(TRAINING_INDEX);
    const covered = new Set<number>();
    for (const outcome of decision.accept.outcomes) {
      const [minimum, maximum] = requireTotalBand(outcome.when);
      for (let total = minimum; total <= maximum; total += 1) {
        covered.add(total);
      }
    }

    expect([...covered].sort((left, right) => left - right)).toEqual([
      2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12,
    ]);
    expect(decision.decline.effects).toEqual([
      { type: "modifyResource", resource: "reputation", amount: 1 },
    ]);
    // Paying tuition must never be worse than walking away, on any total.
    for (const outcome of decision.accept.outcomes) {
      expect(requireReputationGain(outcome.effects)).toBeGreaterThan(
        requireReputationGain(decision.decline.effects),
      );
    }
  });

  it("gives the Burnout tile the pack's only turns-duration status", () => {
    const turnsDurationStatuses = spaces.flatMap((tile) =>
      tile.effects
        .filter(
          (effect) => effect.type === "applyStatus" && effect.duration.kind === "turns",
        )
        .map((effect) => ({ tileId: tile.id, effect })),
    );

    expect(turnsDurationStatuses).toEqual([
      {
        tileId: "tile.board.43.burnout",
        effect: {
          type: "applyStatus",
          statusId: "status.burnout-tile",
          duration: { kind: "turns", count: 2 },
          parameters: { movementPenalty: 1 },
        },
      },
    ]);
    expect(spaces[BURNOUT_INDEX]?.effects[0]).toEqual({
      type: "skipTurns",
      count: 2,
      source: "tile",
    });
  });

  it("rejects a decision whose unaffordable rule, cost, or option ids are malformed", () => {
    const unaffordableRule = validateMutation((content) => {
      const decision = content.board.spaces[TRAINING_INDEX].decision;
      if (decision === undefined) throw new Error("expected the training decision");
      decision.whenUnaffordable = "charge-what-they-have";
    });
    expectIssue(
      unaffordableRule,
      "board.decision-shape",
      `board.spaces[${TRAINING_INDEX}].decision.whenUnaffordable`,
    );

    const freeCost = validateMutation((content) => {
      const decision = content.board.spaces[TRAINING_INDEX].decision;
      if (decision === undefined) throw new Error("expected the training decision");
      decision.accept.cost.amount = 0;
    });
    expectIssue(
      freeCost,
      "board.decision-shape",
      `board.spaces[${TRAINING_INDEX}].decision.accept.cost`,
    );

    const collidingOptions = validateMutation((content) => {
      const decision = content.board.spaces[TRAINING_INDEX].decision;
      if (decision === undefined) throw new Error("expected the training decision");
      decision.accept.optionId = decision.decline.optionId;
    });
    expectIssue(
      collidingOptions,
      "board.decision-shape",
      `board.spaces[${TRAINING_INDEX}].decision.accept.optionId`,
    );
  });

  it("rejects a decline branch that costs the player something", () => {
    const result = validateMutation((content) => {
      const decision = content.board.spaces[TRAINING_INDEX].decision;
      if (decision === undefined) throw new Error("expected the training decision");
      decision.decline.effects = [
        {
          type: "payResource",
          resource: "money",
          amount: 100,
          insufficientFunds: "pay-up-to-available",
        },
      ];
    });

    expectIssue(
      result,
      "board.decision-shape",
      `board.spaces[${TRAINING_INDEX}].decision.decline.effects[0]`,
    );
  });

  it("rejects accept outcomes the declared dice cannot roll", () => {
    const result = validateMutation((content) => {
      const decision = content.board.spaces[TRAINING_INDEX].decision;
      if (decision === undefined) throw new Error("expected the training decision");
      decision.accept.outcomes[0].when.total = [1, 6];
    });

    expectIssue(
      result,
      "board.effect-outcome",
      `board.spaces[${TRAINING_INDEX}].decision.accept.outcomes[0].when.total`,
    );
  });

  /**
   * The validator is the only guard the server has against a decision that
   * would strand a player in an unanswerable prompt, so every rejection branch
   * needs a case — an unreached branch is an unenforced rule.
   */
  it.each([
    [
      "a decision that is not an object at all",
      "",
      (space: MutableSpace) => {
        space.decision = "not-an-object" as unknown as MutableDecision;
      },
    ],
    [
      "a decision missing one of its two branches",
      "",
      (space: MutableSpace) => {
        delete (requireMutableDecision(space) as { decline?: unknown }).decline;
      },
    ],
    [
      "an empty prompt kind",
      ".kind",
      (space: MutableSpace) => {
        requireMutableDecision(space).kind = "";
      },
    ],
    [
      "a reroll-eligible accept branch",
      ".accept.rerollEligible",
      (space: MutableSpace) => {
        requireMutableDecision(space).accept.rerollEligible = true;
      },
    ],
    [
      "an accept branch with no outcomes",
      ".accept.outcomes",
      (space: MutableSpace) => {
        requireMutableDecision(space).accept.outcomes = [];
      },
    ],
    [
      "a decline branch whose effects are not an array",
      ".decline.effects",
      (space: MutableSpace) => {
        (requireMutableDecision(space).decline as { effects: unknown }).effects = "nothing";
      },
    ],
  ] as const)("rejects %s", (_label, pathSuffix, mutate) => {
    const result = validateMutation((content) => {
      mutate(content.board.spaces[TRAINING_INDEX]);
    });

    expectIssue(
      result,
      "board.decision-shape",
      `board.spaces[${TRAINING_INDEX}].decision${pathSuffix}`,
    );
  });

  it("rejects overlapping accept outcomes", () => {
    const result = validateMutation((content) => {
      const decision = content.board.spaces[TRAINING_INDEX].decision;
      if (decision === undefined) throw new Error("expected the training decision");
      decision.accept.outcomes[1].when.total = [6, 12];
    });

    expectIssue(
      result,
      "board.effect-outcome",
      `board.spaces[${TRAINING_INDEX}].decision.accept.outcomes[1].when.total`,
    );
  });
});
