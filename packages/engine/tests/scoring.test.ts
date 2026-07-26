import { describe, expect, it } from "vitest";

import { isJsonCompatible, stableStringify } from "../src";
import type {
  GameState,
  ModeRules,
  ObjectiveId,
  ObjectiveState,
  ProjectState,
  TileId,
} from "../src";
import {
  evaluateMatchEnd,
  FALLBACK_SCORING_WEIGHTS,
  leadingScores,
  resolveScoringConfig,
  scoreMatch,
  scorePlayer,
  winPathFor,
} from "../src/execution/scoring";
import { fixtureIds } from "./fixtures";
import {
  campaignRules,
  content,
  jsonRoundTrip,
  marathonRules,
  quickRules,
  standardRules,
  tableState,
} from "./quarter-objective-fixtures";
import { logicalTimestamp, withRules } from "./turn-loop-fixtures";

const branded = <Id extends string>(value: string) => value as Id;

const standardConfig = resolveScoringConfig(standardRules);

function objective(overrides: Partial<ObjectiveState> = {}): ObjectiveState {
  return {
    id: branded("objective-1"),
    definitionId: "objective.reserve-fund",
    ownerId: fixtureIds.owner,
    progress: 3000,
    target: 3000,
    completedAtRound: 3,
    visibility: "secret",
    rewardPoints: 500,
    rewardMoney: 0,
    ...overrides,
  };
}

function project(overrides: Partial<ProjectState> = {}): ProjectState {
  return {
    id: branded("project-1"),
    definitionId: "project.rebrand",
    leadPlayerId: fixtureIds.owner,
    tileId: null,
    status: "completed",
    requiredMoney: 400,
    requiredWork: 2,
    contributions: [
      { playerId: fixtureIds.owner, money: 300, work: 2, atRound: 1 },
      { playerId: fixtureIds.hiddenOpponent, money: 100, work: 1, atRound: 2 },
    ],
    sabotage: [],
    deadlineRound: 8,
    payout: { money: 800, reputation: 2, objectiveProgress: 1 },
    openToJoin: true,
    leadBonusBasisPoints: 2500,
    ...overrides,
  };
}

/** A finished-looking table sitting one round past its last quarter. */
function endOfMatch(state: GameState): GameState {
  return { ...state, currentQuarterIndex: state.quarters.length - 1 };
}

describe("scoring — configuration", () => {
  it("Given a score-resolved mode, When its config is resolved, Then the snapshotted endgame block is used verbatim, and it agrees with what the pack authored", () => {
    const marathon = resolveScoringConfig(marathonRules);

    expect(marathon.rankTierPoints).toBe(1000);
    expect(marathon.moneyMultiplier).toBe(0.1);
    expect(marathon.reputationPoints).toBe(50);

    // The mirror `ModeRules.endgame` makes of `ModeConfig.endgame.scoring`. The
    // engine reads only the former; this is what keeps the two the same numbers.
    const authored = content.modes["mode.marathon"].endgame;
    expect(authored.type).toBe("additional-rounds");
    if (authored.type === "additional-rounds") {
      expect(marathon.rankTierPoints).toBe(authored.scoring.rankTierPoints);
      expect(marathon.moneyMultiplier).toBe(authored.scoring.moneyMultiplier);
      expect(marathon.reputationPoints).toBe(authored.scoring.reputationPoints);
    }
  });

  it("Given a race mode with no authored scoring block, When its config is resolved, Then its ruleset still carries the shared scale so a race still scores", () => {
    const quick = resolveScoringConfig(quickRules);

    expect(content.modes["mode.quick"].endgame.type).toBe("immediate");
    expect(quick.rankTierPoints).toBe(FALLBACK_SCORING_WEIGHTS.rankTierPoints);
    expect(quick.moneyMultiplier).toBe(FALLBACK_SCORING_WEIGHTS.moneyMultiplier);
    expect(quick.reputationPoints).toBe(FALLBACK_SCORING_WEIGHTS.reputationPoints);
  });

  it("Given the derived weights, When the config is resolved, Then each one is a function of an authored one", () => {
    expect(standardConfig.ownershipPointsPerLevel).toBe(standardConfig.reputationPoints);
    expect(standardConfig.projectCompletionPoints).toBe(standardConfig.rankTierPoints / 2);
    expect(standardConfig.missedUpkeepPenaltyPoints).toBe(standardConfig.reputationPoints * 2);
    expect(standardConfig.debtMultiplier).toBe(standardConfig.moneyMultiplier);
  });

  it("Given an override, When the config is resolved, Then the caller wins", () => {
    const config = resolveScoringConfig(standardRules, {
      projectCompletionPoints: 42,
    });

    expect(config.projectCompletionPoints).toBe(42);
    expect(config.rankTierPoints).toBe(1000);
  });

  it("Given a legacy ruleset with no endgame block, When the config is resolved, Then the fallback keeps scoring possible", () => {
    // A pre-v2 snapshot (spec §5.10): every weight is missing, and a match that
    // has already been played still has to produce a score sheet.
    const legacy = { ...standardRules, endgame: undefined } as unknown as ModeRules;

    expect(resolveScoringConfig(legacy)).toMatchObject({
      rankTierPoints: FALLBACK_SCORING_WEIGHTS.rankTierPoints,
      moneyMultiplier: FALLBACK_SCORING_WEIGHTS.moneyMultiplier,
      reputationPoints: FALLBACK_SCORING_WEIGHTS.reputationPoints,
    });
  });

  it("Given a mode id that names no mode at all, When the config is resolved, Then it makes no difference, because the weights come from the snapshot", () => {
    const state = tableState(marathonRules);
    const unknownMode: GameState = { ...state, modeId: branded("mode.does-not-exist") };

    expect(resolveScoringConfig(unknownMode.rules)).toEqual(
      resolveScoringConfig(marathonRules),
    );
  });
});

describe("scoring — one player's sheet", () => {
  it("Given rank, money and reputation, When a player is scored, Then each column uses its authored weight and the total is their sum", () => {
    const state = tableState(standardRules, {
      [fixtureIds.owner]: { rankIndex: 2, wallet: { money: 3000, reputation: 4 } },
    });

    const score = scorePlayer(state, fixtureIds.owner, standardConfig);

    expect(score).toMatchObject({
      rankPoints: 2000,
      moneyPoints: 300,
      reputationPoints: 200,
      objectivePoints: 0,
      ownershipPoints: 0,
      projectPoints: 0,
      penaltyPoints: 0,
      total: 2500,
    });
  });

  it("Given a ruleset where only promotion scores, When a rich player is scored, Then their money and reputation are worth nothing", () => {
    const state = tableState(quickRules, {
      [fixtureIds.owner]: { rankIndex: 2, wallet: { money: 9000, reputation: 12 } },
    });

    const score = scorePlayer(state, fixtureIds.owner, resolveScoringConfig(quickRules));

    expect(quickRules.winPaths).toMatchObject({ wealth: false, influence: false });
    expect(score.moneyPoints).toBe(0);
    expect(score.reputationPoints).toBe(0);
    expect(score.total).toBe(2000);
  });

  it("Given owned tiles, When ownership is switched off in the ruleset, Then the ownership column is zero", () => {
    const owned = {
      "tile-5": {
        tileId: branded<TileId>("tile-5"),
        ownerId: fixtureIds.owner,
        level: 1,
        claimedAtRound: 1,
        tollPaidCount: 0,
      },
    };
    const on: GameState = { ...tableState(standardRules), tileOwnership: owned };
    const off: GameState = {
      ...withRules(on, { board: { ...standardRules.board, ownershipEnabled: false } }),
      tileOwnership: owned,
    };

    // level 1 = a claim plus one upgrade, so twice the per-level weight.
    expect(scorePlayer(on, fixtureIds.owner, standardConfig).ownershipPoints).toBe(100);
    expect(scorePlayer(off, fixtureIds.owner, standardConfig).ownershipPoints).toBe(0);
  });

  it("Given a completed project, When its contributors are scored, Then the lead takes its bonus and the rest splits by money", () => {
    const state: GameState = { ...tableState(standardRules), projects: [project()] };

    const lead = scorePlayer(state, fixtureIds.owner, standardConfig);
    const helper = scorePlayer(state, fixtureIds.hiddenOpponent, standardConfig);
    const bystander = scorePlayer(state, fixtureIds.revealedOpponent, standardConfig);

    // 500 pool, 25% lead bonus = 125, remainder 375 split 300:100.
    expect(lead.projectPoints).toBe(125 + 281);
    expect(helper.projectPoints).toBe(94);
    expect(bystander.projectPoints).toBe(0);
  });

  it("Given an open project, When contributors are scored, Then it pays nothing until it completes", () => {
    const state: GameState = {
      ...tableState(standardRules),
      projects: [project({ status: "open" })],
    };

    expect(scorePlayer(state, fixtureIds.owner, standardConfig).projectPoints).toBe(0);
  });

  it("Given projects switched off, When a completed project sits in state, Then it scores nothing", () => {
    const state: GameState = {
      ...withRules(tableState(standardRules), {
        projects: { ...standardRules.projects, enabled: false },
      }),
      projects: [project()],
    };

    expect(scorePlayer(state, fixtureIds.owner, standardConfig).projectPoints).toBe(0);
  });

  it("Given missed upkeep and an outstanding loan, When a player is scored, Then both are charged as penalties", () => {
    const base = tableState(standardRules, {
      [fixtureIds.owner]: { wallet: { money: 1000 }, missedPayments: 2 },
    });
    const state: GameState = {
      ...base,
      players: {
        ...base.players,
        [fixtureIds.owner]: {
          ...base.players[fixtureIds.owner],
          loans: [
            {
              id: branded("loan-1"),
              principal: 2000,
              outstanding: 1500,
              interestBasisPoints: 1000,
              takenAtRound: 2,
            },
          ],
        },
      },
    };

    const score = scorePlayer(state, fixtureIds.owner, standardConfig);

    // 2 missed charges x 100, plus 1500 of debt at the money rate.
    expect(score.penaltyPoints).toBe(350);
    expect(score.total).toBe(score.moneyPoints - 350);
  });

  it("Given completed objectives, When their owner is scored, Then only their own count", () => {
    const state: GameState = {
      ...tableState(standardRules),
      objectives: [
        objective(),
        objective({ id: branded<ObjectiveId>("objective-2"), ownerId: fixtureIds.hiddenOpponent, rewardPoints: 900 }),
        objective({ id: branded<ObjectiveId>("objective-3"), completedAtRound: null }),
        objective({ id: branded<ObjectiveId>("objective-4"), ownerId: null, rewardPoints: 700 }),
      ],
    };

    expect(scorePlayer(state, fixtureIds.owner, standardConfig).objectivePoints).toBe(500);
    expect(scorePlayer(state, fixtureIds.hiddenOpponent, standardConfig).objectivePoints).toBe(900);
    expect(scorePlayer(state, fixtureIds.revealedOpponent, standardConfig).objectivePoints).toBe(0);
  });

  it("Given a whole table, When it is scored, Then the sheets come back in seat order and every total is an integer", () => {
    const state = tableState(standardRules, {
      [fixtureIds.owner]: { wallet: { money: 1234, reputation: 3 } },
    });

    const scores = scoreMatch(state, standardConfig);

    expect(scores.map((score) => score.playerId)).toEqual([...state.playerOrder]);
    expect(scores.every((score) => Number.isInteger(score.total))).toBe(true);
    expect(isJsonCompatible(scores)).toBe(true);
  });

  it("Given a score sheet, When the state has been through the persistence boundary, Then the sheet is identical", () => {
    const state = tableState(standardRules, {
      [fixtureIds.owner]: { rankIndex: 3, wallet: { money: 4321, reputation: 7 } },
    });

    expect(stableStringify(scoreMatch(jsonRoundTrip(state), standardConfig))).toBe(
      stableStringify(scoreMatch(state, standardConfig)),
    );
  });
});

describe("scoring — win path", () => {
  it("Given a winner whose rank dominates, When the win path is chosen, Then it is promotion", () => {
    const state = tableState(standardRules, {
      [fixtureIds.owner]: { rankIndex: 4, wallet: { money: 500, reputation: 1 } },
    });

    expect(winPathFor(scorePlayer(state, fixtureIds.owner, standardConfig), standardRules)).toBe(
      "promotion",
    );
  });

  it("Given a winner whose money dominates, When the win path is chosen, Then it is wealth", () => {
    const state = tableState(standardRules, {
      [fixtureIds.owner]: { rankIndex: 0, wallet: { money: 40_000, reputation: 1 } },
    });

    expect(winPathFor(scorePlayer(state, fixtureIds.owner, standardConfig), standardRules)).toBe(
      "wealth",
    );
  });

  it("Given a winner whose reputation dominates, When the win path is chosen, Then it is influence", () => {
    const state = tableState(standardRules, {
      [fixtureIds.owner]: { rankIndex: 0, wallet: { money: 100, reputation: 30 } },
    });

    expect(winPathFor(scorePlayer(state, fixtureIds.owner, standardConfig), standardRules)).toBe(
      "influence",
    );
  });

  it("Given a path that does not score in this ruleset, When it would otherwise dominate, Then it is never chosen", () => {
    const rules = { ...standardRules, winPaths: { ...standardRules.winPaths, wealth: false } };
    const state = tableState(rules, {
      [fixtureIds.owner]: { rankIndex: 1, wallet: { money: 40_000, reputation: 1 } },
    });

    expect(winPathFor(scorePlayer(state, fixtureIds.owner, standardConfig), rules)).toBe(
      "promotion",
    );
  });

  it("Given a player who scored nothing anywhere, When the win path is chosen, Then there is none", () => {
    const state = tableState(standardRules, {
      [fixtureIds.owner]: { rankIndex: 0, wallet: { money: 0, reputation: 0 } },
    });

    expect(winPathFor(scorePlayer(state, fixtureIds.owner, standardConfig), standardRules)).toBeNull();
    expect(winPathFor(undefined, standardRules)).toBeNull();
  });
});

describe("scoring — end of match", () => {
  it("Given a match in progress, When the end is evaluated, Then it keeps going", () => {
    const state = tableState(standardRules);

    expect(
      evaluateMatchEnd(state, { round: 3, endedAt: logicalTimestamp }),
    ).toBeNull();
  });

  it("Given the last quarter has run out, When the end is evaluated, Then the match ends on quarters and the top score wins", () => {
    const state = endOfMatch(
      tableState(standardRules, {
        [fixtureIds.owner]: { rankIndex: 1, wallet: { money: 1000 } },
        [fixtureIds.hiddenOpponent]: { rankIndex: 3, wallet: { money: 200 } },
      }),
    );

    const outcome = evaluateMatchEnd(state, { round: 17, endedAt: logicalTimestamp });

    expect(outcome).not.toBeNull();
    expect(outcome?.reason).toBe("quarters-elapsed");
    expect(outcome?.winnerPlayerIds).toEqual([fixtureIds.hiddenOpponent]);
    expect(outcome?.winPath).toBe("promotion");
    expect(outcome?.scores).toHaveLength(3);
    expect(outcome?.winningRole).toBeNull();
  });

  it("Given two players tied at the top, When the match ends on quarters, Then both are winners", () => {
    const state = endOfMatch(
      tableState(standardRules, {
        [fixtureIds.owner]: { rankIndex: 2, wallet: { money: 1000 } },
        [fixtureIds.hiddenOpponent]: { rankIndex: 2, wallet: { money: 1000 } },
        [fixtureIds.revealedOpponent]: { rankIndex: 0, wallet: { money: 0 } },
      }),
    );

    const outcome = evaluateMatchEnd(state, { round: 17, endedAt: logicalTimestamp });

    expect(outcome?.winnerPlayerIds).toEqual([fixtureIds.owner, fixtureIds.hiddenOpponent]);
  });

  it("Given quarters switched off, When the round runs far past any schedule, Then this check never ends the match", () => {
    const state = tableState(quickRules);

    expect(
      evaluateMatchEnd(state, { round: 400, endedAt: logicalTimestamp }),
    ).toBeNull();
  });

  it("Given an objectives ruleset and a player who has finished, When the end is evaluated, Then the match ends on objectives with that objective's path", () => {
    const state: GameState = {
      ...tableState(campaignRules),
      objectives: [
        objective({ definitionId: "objective.corner-office", rewardPoints: 1000 }),
        objective({
          id: branded<ObjectiveId>("objective-other"),
          ownerId: fixtureIds.hiddenOpponent,
          completedAtRound: null,
        }),
      ],
    };

    const outcome = evaluateMatchEnd(state, { round: 5, endedAt: logicalTimestamp });

    expect(outcome?.reason).toBe("objectives-complete");
    expect(outcome?.winnerPlayerIds).toEqual([fixtureIds.owner]);
    expect(outcome?.winPath).toBe("promotion");
    expect(outcome?.data).toMatchObject({ objectiveIds: ["objective-1"] });
  });

  it("Given the same completed objectives under a fixed-length ruleset, When the end is evaluated, Then finishing them does not end the match", () => {
    const state: GameState = {
      ...tableState(standardRules),
      objectives: [objective()],
    };

    expect(standardRules.winShape).toBe("fixed-length");
    expect(
      evaluateMatchEnd(state, { round: 5, endedAt: logicalTimestamp }),
    ).toBeNull();
  });

  it("Given elimination and one survivor, When the end is evaluated, Then the match ends last-standing on the survival path", () => {
    const state: GameState = {
      ...tableState(marathonRules),
      eliminatedPlayerIds: [fixtureIds.hiddenOpponent, fixtureIds.revealedOpponent],
    };

    const outcome = evaluateMatchEnd(state, { round: 6, endedAt: logicalTimestamp });

    expect(marathonRules.conflict.elimination).toBe(true);
    expect(outcome?.reason).toBe("last-standing");
    expect(outcome?.winnerPlayerIds).toEqual([fixtureIds.owner]);
    expect(outcome?.winPath).toBe("survival");
  });

  it("Given elimination on but survival not scoring, When one player is left, Then the match still ends and no path is claimed", () => {
    const rules = {
      ...marathonRules,
      winPaths: { ...marathonRules.winPaths, survival: false },
    };
    const state: GameState = {
      ...tableState(rules),
      eliminatedPlayerIds: [fixtureIds.hiddenOpponent, fixtureIds.revealedOpponent],
    };

    const outcome = evaluateMatchEnd(state, { round: 6, endedAt: logicalTimestamp });

    expect(outcome?.reason).toBe("last-standing");
    expect(outcome?.winPath).toBeNull();
  });

  it("Given a ruleset with elimination switched off, When only one player is left standing anyway, Then that is not an ending", () => {
    const state: GameState = {
      ...tableState(standardRules),
      eliminatedPlayerIds: [fixtureIds.hiddenOpponent, fixtureIds.revealedOpponent],
    };

    expect(standardRules.conflict.elimination).toBe(false);
    expect(
      evaluateMatchEnd(state, { round: 3, endedAt: logicalTimestamp }),
    ).toBeNull();
  });

  it("Given a match that already has an outcome, When the end is evaluated again, Then it is not re-ended", () => {
    const base = endOfMatch(tableState(standardRules));
    const first = evaluateMatchEnd(base, { round: 17, endedAt: logicalTimestamp });
    if (first === null) throw new Error("expected the match to end");
    const ended: GameState = { ...base, status: "ended", outcome: first };

    expect(
      evaluateMatchEnd(ended, { round: 18, endedAt: logicalTimestamp }),
    ).toBeNull();
  });

  it("Given an outcome, When it crosses the persistence boundary, Then it survives unchanged and its totals still add up", () => {
    const state = endOfMatch(
      tableState(standardRules, {
        [fixtureIds.owner]: { rankIndex: 2, wallet: { money: 1234, reputation: 5 } },
      }),
    );

    const outcome = evaluateMatchEnd(state, { round: 17, endedAt: logicalTimestamp });
    if (outcome === null) throw new Error("expected the match to end");

    expect(isJsonCompatible(outcome)).toBe(true);
    expect(JSON.parse(JSON.stringify(outcome))).toEqual(outcome);
    for (const score of outcome.scores) {
      expect(score.total).toBe(
        score.rankPoints +
          score.moneyPoints +
          score.reputationPoints +
          score.objectivePoints +
          score.ownershipPoints +
          score.projectPoints -
          score.penaltyPoints,
      );
    }
  });

  it("Given the state has been through the persistence boundary, When the end is evaluated, Then the outcome is identical", () => {
    const state = endOfMatch(
      tableState(standardRules, {
        [fixtureIds.owner]: { rankIndex: 2, wallet: { money: 1234, reputation: 5 } },
      }),
    );

    expect(
      stableStringify(
        evaluateMatchEnd(jsonRoundTrip(state), {
          round: 17,
          endedAt: logicalTimestamp,
        }),
      ),
    ).toBe(
      stableStringify(evaluateMatchEnd(state, { round: 17, endedAt: logicalTimestamp })),
    );
  });

  it("Given a set of scores, When the leaders are taken, Then every tie for the maximum comes back in seat order", () => {
    const state = tableState(standardRules, {
      [fixtureIds.owner]: { wallet: { money: 1000 } },
      [fixtureIds.hiddenOpponent]: { wallet: { money: 1000 } },
      [fixtureIds.revealedOpponent]: { wallet: { money: 10 } },
    });

    expect(leadingScores(scoreMatch(state, standardConfig))).toEqual([
      fixtureIds.owner,
      fixtureIds.hiddenOpponent,
    ]);
  });
});
