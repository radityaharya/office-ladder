import { describe, expect, it } from "vitest";

import {
  deadlineDashBoard,
  deadlineDashContent,
} from "../../src/content/deadline-dash";
import {
  formatDeadlineDashValidationIssues,
  validateDeadlineDashContent,
} from "../../src/content/validation";
import type { DeadlineDashContentValidationInput } from "../../src/content/validation";

type MutableContent = {
  board: {
    spaces: Array<{
      id: string;
      effects: unknown[];
    }>;
  };
  modes: Record<
    string,
    {
      targetDurationMinutes: number[];
      startingTokens: Record<string, number>;
      handLimit: number;
      endgame: unknown;
    }
  >;
  ranks: Array<{
    salary: number;
    promotionFromPrevious: null | {
      moneyCost: Record<string, number>;
      reputationRequired: number;
    };
    benefits: unknown[];
  }>;
  characters: Record<
    string,
    {
      id: string;
      passive: { type: string };
      active: {
        cooldown: { unit: string; amount: number };
        effect: { type: string };
      };
    }
  >;
};

function cloneContent(): MutableContent {
  return structuredClone(deadlineDashContent) as unknown as MutableContent;
}

function validateMutation(mutate: (content: MutableContent) => void) {
  const content = cloneContent();
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

describe("Deadline Dash board content", () => {
  it("defines the four canonical corners at their exact indexes", () => {
    const corners = [0, 11, 22, 33].map((index) => {
      const tile = deadlineDashBoard.spaces[index];

      return {
        index: tile.index,
        coordinate: tile.coordinate,
        kind: tile.kind,
        displayNameKey: tile.displayNameKey,
      };
    });

    expect(corners).toEqual([
      {
        index: 0,
        coordinate: "bottom-right",
        kind: "receptionist",
        displayNameKey: "deadlineDash.board.tile.receptionist.name",
      },
      {
        index: 11,
        coordinate: "bottom-left",
        kind: "board-meeting",
        displayNameKey: "deadlineDash.board.tile.boardMeeting.name",
      },
      {
        index: 22,
        coordinate: "top-left",
        kind: "audit",
        displayNameKey: "deadlineDash.board.tile.audit.name",
      },
      {
        index: 33,
        coordinate: "top-right",
        kind: "annual-event",
        displayNameKey: "deadlineDash.board.tile.annualEvent.name",
      },
    ]);
  });

  it("contains exactly 44 sequential, uniquely identified spaces", () => {
    expect(deadlineDashBoard.spaces).toHaveLength(44);
    expect(deadlineDashBoard.spaces.map((tile) => tile.index)).toEqual(
      Array.from({ length: 44 }, (_, index) => index),
    );
    expect(new Set(deadlineDashBoard.spaces.map((tile) => tile.id)).size).toBe(44);
  });

  it("matches the canonical placement and kind counts", () => {
    const kindCounts = deadlineDashBoard.spaces.reduce<Record<string, number>>(
      (counts, tile) => {
        counts[tile.kind] = (counts[tile.kind] ?? 0) + 1;
        return counts;
      },
      {},
    );
    const cornerCount = deadlineDashBoard.spaces.filter(
      (tile) => tile.placement === "corner",
    ).length;
    const sideCounts = deadlineDashBoard.spaces.reduce<Record<string, number>>(
      (counts, tile) => {
        if (tile.placement === "side") {
          counts[tile.side] = (counts[tile.side] ?? 0) + 1;
        }
        return counts;
      },
      {},
    );

    expect(deadlineDashBoard.expectedCounts).toEqual({
      total: 44,
      corners: 4,
      regular: 40,
      perSide: 10,
      byKind: {
        receptionist: 1,
        "board-meeting": 1,
        audit: 1,
        "annual-event": 1,
        training: 1,
        work: 14,
        networking: 3,
        hr: 1,
        meeting: 4,
        "energy-restore": 4,
        finance: 1,
        it: 1,
        event: 3,
        marketing: 1,
        legal: 1,
        operation: 1,
        "best-employee": 1,
        sales: 1,
        "ceo-favorite": 1,
        "ceo-office": 1,
        burnout: 1,
      },
    });
    expect(cornerCount).toBe(4);
    expect(sideCounts).toEqual({ bottom: 10, left: 10, top: 10, right: 10 });
    expect(kindCounts).toEqual(deadlineDashBoard.expectedCounts.byKind);
  });

  it("gives every Work space the canonical energy, milestone, and draw effects", () => {
    const workTiles = deadlineDashBoard.spaces.filter(
      (tile) => tile.kind === "work",
    );

    expect(workTiles).toHaveLength(14);
    for (const tile of workTiles) {
      expect(tile.effects).toEqual([
        {
          type: "modifyResource",
          resource: "energy",
          amount: -1,
          clampAtZero: true,
        },
        {
          type: "incrementWorkCounter",
          amount: 1,
          rewardEvery: 5,
          reward: { resource: "reputation", amount: 1 },
          cumulative: true,
        },
        { type: "drawCards", deckId: "deck.work", count: 1 },
      ]);
    }
  });

  it("passes the full canonical content validator", () => {
    expect(validateDeadlineDashContent()).toEqual({ valid: true, issues: [] });
  });

  it("rejects character count, order, duplicate IDs, abilities, and cooldown mutations", () => {
    const missing = validateMutation((content) => {
      delete content.characters["character.lucky-employee"];
    });
    expectIssue(missing, "character.count", "characters.keys.length");

    const reordered = validateMutation((content) => {
      const workaholic = content.characters["character.workaholic"];
      delete content.characters["character.workaholic"];
      content.characters["character.workaholic"] = workaholic;
    });
    expectIssue(reordered, "character.order", "characters.keys[0]");

    const duplicate = validateMutation((content) => {
      content.characters["character.social-butterfly"].id = "character.workaholic";
    });
    expectIssue(
      duplicate,
      "character.duplicate-id",
      "characters.character.social-butterfly.id",
    );

    const abilities = validateMutation((content) => {
      const character = content.characters["character.workaholic"];
      character.passive.type = "salaryMultiplier";
      character.active.effect.type = "teleport";
      character.active.cooldown.amount = 0;
    });
    expectIssue(
      abilities,
      "character.passive",
      "characters.character.workaholic.passive.type",
    );
    expectIssue(
      abilities,
      "character.active",
      "characters.character.workaholic.active.effect.type",
    );
    expectIssue(
      abilities,
      "character.cooldown",
      "characters.character.workaholic.active.cooldown",
    );
  });

  it("rejects exact rank salary, promotion, and benefit mutations", () => {
    const result = validateMutation((content) => {
      content.ranks[0].salary = 201;
      content.ranks[1].promotionFromPrevious!.moneyCost["mode.quick"] = 251;
      content.ranks[1].promotionFromPrevious!.reputationRequired = 4;
      content.ranks[2].benefits = [];
    });

    expectIssue(result, "rank.salary", "ranks[0].salary");
    expectIssue(
      result,
      "rank.requirement",
      "ranks[1].promotionFromPrevious.moneyCost.mode.quick",
    );
    expectIssue(
      result,
      "rank.requirement",
      "ranks[1].promotionFromPrevious.reputationRequired",
    );
    expectIssue(result, "rank.benefits", "ranks[2].benefits");
  });

  it("rejects mode duration, tokens, hand limit, and endgame mutations", () => {
    const result = validateMutation((content) => {
      const quick = content.modes["mode.quick"];
      quick.targetDurationMinutes = [20, 31];
      quick.startingTokens.move = 2;
      quick.handLimit = 2;
      quick.endgame = { type: "additional-rounds" };
    });

    expectIssue(
      result,
      "mode.target-duration",
      "modes.mode.quick.targetDurationMinutes",
    );
    expectIssue(
      result,
      "mode.starting-token",
      "modes.mode.quick.startingTokens.move",
    );
    expectIssue(result, "mode.hand-limit", "modes.mode.quick.handLimit");
    expectIssue(result, "mode.endgame", "modes.mode.quick.endgame");
  });

  it("rejects malformed effect trees and unknown deck or status references", () => {
    const result = validateMutation((content) => {
      content.board.spaces[3].effects = [
        { type: "drawCards", deckId: "deck.unknown", count: 1 },
      ];
      content.board.spaces[28].effects = [
        {
          type: "applyStatus",
          statusId: "status.unknown",
          duration: { kind: "uses", count: 1 },
        },
      ];
      content.board.spaces[37].effects = [{ type: "unknownEffect" }];
    });

    expectIssue(
      result,
      "board.effect-deck-id",
      "board.spaces[3].effects[0].deckId",
    );
    expectIssue(
      result,
      "board.effect-status-id",
      "board.spaces[28].effects[0].statusId",
    );
    expectIssue(
      result,
      "board.effect-shape",
      "board.spaces[37].effects[0]",
    );
  });

  it("rejects invalid dice and overlapping or out-of-range total outcomes", () => {
    const result = validateMutation((content) => {
      content.board.spaces[6].effects = [
        {
          type: "rollCheck",
          dice: { count: 3, sides: 6 },
          rerollEligible: false,
          outcomes: [],
        },
      ];
      content.board.spaces[10].effects = [
        {
          type: "rollCheck",
          dice: { count: 2, sides: 6 },
          rerollEligible: false,
          outcomes: [
            { when: { total: [1, 1] }, effects: [] },
            { when: { total: [2, 7] }, effects: [] },
            { when: { total: [7, 12] }, effects: [] },
          ],
        },
      ];
    });

    expectIssue(
      result,
      "board.effect-dice",
      "board.spaces[6].effects[0].dice",
    );
    expectIssue(
      result,
      "board.effect-outcome",
      "board.spaces[10].effects[0].outcomes[0].when.total",
    );
    expectIssue(
      result,
      "board.effect-outcome",
      "board.spaces[10].effects[0].outcomes[2].when.total",
    );
  });

  it("formats mutation issues in stable traversal order", () => {
    const result = validateMutation((content) => {
      content.ranks[0].salary = 201;
      content.characters["character.workaholic"].active.cooldown.amount = 0;
    });

    expect(formatDeadlineDashValidationIssues(result.issues)).toBe(
      "1. [rank.salary] ranks[0].salary: expected 200; received 201\n" +
        '2. [character.cooldown] characters.character.workaholic.active.cooldown: expected {"unit":"laps","amount":2}; received {"unit":"laps","amount":0}',
    );
  });
});
