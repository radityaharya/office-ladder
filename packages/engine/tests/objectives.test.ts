import { describe, expect, it } from "vitest";

import { projectPlayerView, projectPublicView, stableStringify } from "../src";
import type { GameState, ObjectiveState, PlayerId } from "../src";
import {
  advanceObjectives,
  assignObjectives,
  eligibleObjectiveDefinitions,
  measureObjective,
  objectivePointsFor,
  objectivesEnabled,
  OBJECTIVE_DEFINITIONS,
  playersWithAllObjectivesComplete,
  type ObjectiveDefinition,
} from "../src/execution/objectives";
import { fixtureIds } from "./fixtures";
import {
  campaignRules,
  jsonRoundTrip,
  quickRules,
  standardRules,
  tableState,
} from "./quarter-objective-fixtures";
import { withRules } from "./turn-loop-fixtures";

const MONEY_OBJECTIVE: ObjectiveDefinition = {
  id: "objective.reserve-fund",
  winPath: "wealth",
  metric: "money",
  target: 3000,
  rewardPoints: 500,
  rewardMoney: 250,
};

const REPUTATION_OBJECTIVE: ObjectiveDefinition = {
  id: "objective.name-on-the-door",
  winPath: "influence",
  metric: "reputation",
  target: 10,
  rewardPoints: 500,
  rewardMoney: 250,
};

function objective(
  overrides: Partial<ObjectiveState> & Pick<ObjectiveState, "id" | "definitionId">,
): ObjectiveState {
  return {
    ownerId: fixtureIds.owner,
    progress: 0,
    target: 3000,
    completedAtRound: null,
    visibility: "secret",
    rewardPoints: 500,
    rewardMoney: 250,
    ...overrides,
  };
}

function withObjectives(
  state: GameState,
  objectives: readonly ObjectiveState[],
): GameState {
  return { ...state, objectives };
}

const brandedObjectiveId = <Id extends string>(value: string) => value as Id;

describe("objectives — dealing", () => {
  it("Given a ruleset with secret objectives on, When objectives are assigned, Then every seat gets one and it is secret", () => {
    const state = tableState(standardRules);

    const objectives = assignObjectives(state);

    expect(objectives).toHaveLength(state.playerOrder.length);
    expect(objectives.map((entry) => entry.ownerId)).toEqual([...state.playerOrder]);
    expect(objectives.every((entry) => entry.visibility === "secret")).toBe(true);
    expect(objectives.every((entry) => entry.completedAtRound === null)).toBe(true);
  });

  it("Given the quick preset, When objectives are assigned, Then none are dealt because the mechanic is switched off", () => {
    const state = tableState(quickRules);

    expect(objectivesEnabled(quickRules)).toBe(false);
    expect(assignObjectives(state)).toEqual([]);
  });

  it("Given secret objectives off but an objectives win shape, When objectives are assigned, Then they are dealt publicly", () => {
    const state = withRules(tableState(campaignRules), {
      hidden: { ...campaignRules.hidden, secretObjectives: false },
    });

    const objectives = assignObjectives(state);

    expect(objectives.length).toBeGreaterThan(0);
    expect(objectives.every((entry) => entry.visibility === "public")).toBe(true);
  });

  it("Given a ruleset where wealth does not score, When eligibility is resolved, Then no wealth objective can be dealt", () => {
    const rules = {
      ...standardRules,
      winPaths: { ...standardRules.winPaths, wealth: false },
    };

    const eligible = eligibleObjectiveDefinitions(rules);

    expect(eligible.length).toBeGreaterThan(0);
    expect(eligible.some((definition) => definition.winPath === "wealth")).toBe(false);
  });

  it("Given ownership and projects switched off, When eligibility is resolved, Then objectives that read them are excluded", () => {
    const rules = {
      ...standardRules,
      board: { ...standardRules.board, ownershipEnabled: false },
      projects: { ...standardRules.projects, enabled: false },
    };

    const eligible = eligibleObjectiveDefinitions(rules);

    expect(eligible.some((definition) => definition.metric === "tiles-owned")).toBe(false);
    expect(eligible.some((definition) => definition.metric === "projects-completed")).toBe(
      false,
    );
  });

  it("Given the same table, When objectives are assigned twice and after a JSON round trip, Then the deal is identical", () => {
    const state = tableState(standardRules);

    const first = assignObjectives(state);
    const second = assignObjectives(state);
    const restored = assignObjectives(jsonRoundTrip(state));

    expect(stableStringify(second)).toBe(stableStringify(first));
    expect(stableStringify(restored)).toBe(stableStringify(first));
  });

  it("Given a dealt objective, When its id is inspected, Then it is derived from server-owned state and never from the definition it hides", () => {
    const state = tableState(standardRules);

    const [first] = assignObjectives(state);

    expect(first?.id).toBe(`${state.gameId}:objective:${fixtureIds.owner}:0`);
    // The id is the one field a secret objective does *not* redact, so it must
    // not spell out what the objective asks for.
    expect(first?.id).not.toContain(String(first?.definitionId));
  });

  it("Given more objectives per player than the catalogue has entries, When they are dealt, Then the catalogue wraps rather than running out", () => {
    const state = tableState(campaignRules);
    const eligible = eligibleObjectiveDefinitions(campaignRules);

    const objectives = assignObjectives(state, { perPlayer: eligible.length + 2 });

    expect(objectives).toHaveLength(state.playerOrder.length * (eligible.length + 2));
  });
});

describe("objectives — progress and completion", () => {
  it("Given a player short of the target, When objectives advance, Then progress tracks and nothing completes", () => {
    const state = withObjectives(
      tableState(standardRules, { [fixtureIds.owner]: { wallet: { money: 1200 } } }),
      [objective({ id: brandedObjectiveId("objective-money"), definitionId: MONEY_OBJECTIVE.id })],
    );

    const result = advanceObjectives(state, 4);

    expect(result.completed).toEqual([]);
    expect(result.objectives[0]?.progress).toBe(1200);
    expect(result.objectives[0]?.completedAtRound).toBeNull();
    expect(result.changes).toEqual([]);
  });

  it("Given a player who has reached the target, When objectives advance, Then it completes and the reward is paid", () => {
    const state = withObjectives(
      tableState(standardRules, { [fixtureIds.owner]: { wallet: { money: 3200 } } }),
      [objective({ id: brandedObjectiveId("objective-money"), definitionId: MONEY_OBJECTIVE.id })],
    );

    const result = advanceObjectives(state, 7);

    expect(result.completed).toHaveLength(1);
    expect(result.completed[0]).toMatchObject({
      playerId: fixtureIds.owner,
      winPath: "wealth",
      rewardPoints: 500,
      rewardMoneyPaid: 250,
      completedAtRound: 7,
    });
    expect(result.objectives[0]?.completedAtRound).toBe(7);
    expect(result.objectives[0]?.progress).toBe(3000);
    expect(result.players[fixtureIds.owner]?.resources.money?.value).toBe(3450);
    expect(result.changes[0]).toMatchObject({ previousValue: 3200, newValue: 3450 });
  });

  it("Given a completed objective, When the player spends the money back down, Then completion is permanent and is not paid twice", () => {
    const state = withObjectives(
      tableState(standardRules, { [fixtureIds.owner]: { wallet: { money: 3200 } } }),
      [objective({ id: brandedObjectiveId("objective-money"), definitionId: MONEY_OBJECTIVE.id })],
    );

    const completed = advanceObjectives(state, 7);
    const broke: GameState = {
      ...state,
      objectives: completed.objectives,
      players: {
        ...completed.players,
        [fixtureIds.owner]: {
          ...completed.players[fixtureIds.owner],
          resources: {
            ...completed.players[fixtureIds.owner].resources,
            money: { ...completed.players[fixtureIds.owner].resources.money, value: 10 },
          },
        },
      },
    };

    const again = advanceObjectives(broke, 9);

    expect(again.objectives[0]?.completedAtRound).toBe(7);
    expect(again.completed).toEqual([]);
    expect(again.changes).toEqual([]);
    expect(again.players[fixtureIds.owner]?.resources.money?.value).toBe(10);
  });

  it("Given one player who is rich, When another player owns the money objective, Then the rich player's balance does not complete it", () => {
    const state = withObjectives(
      tableState(standardRules, {
        [fixtureIds.owner]: { wallet: { money: 9000 } },
        [fixtureIds.hiddenOpponent]: { wallet: { money: 10 } },
      }),
      [
        objective({
          id: brandedObjectiveId("objective-money-opponent"),
          definitionId: MONEY_OBJECTIVE.id,
          ownerId: fixtureIds.hiddenOpponent,
        }),
      ],
    );

    const result = advanceObjectives(state, 5);

    expect(result.completed).toEqual([]);
    expect(result.objectives[0]?.progress).toBe(10);
  });

  it("Given a table-wide objective, When any seat reaches the target, Then it completes and scores nobody", () => {
    const state = withObjectives(
      tableState(standardRules, {
        [fixtureIds.revealedOpponent]: { wallet: { money: 5000 } },
      }),
      [
        objective({
          id: brandedObjectiveId("objective-table"),
          definitionId: MONEY_OBJECTIVE.id,
          ownerId: null,
          visibility: "public",
        }),
      ],
    );

    const result = advanceObjectives(state, 3);
    const scored: GameState = { ...state, objectives: result.objectives };

    expect(result.objectives[0]?.completedAtRound).toBe(3);
    expect(result.completed[0]?.playerId).toBeNull();
    for (const playerId of state.playerOrder) {
      expect(objectivePointsFor(scored, playerId)).toBe(0);
    }
  });

  it("Given the quick preset, When objectives somehow exist in state, Then advancing them changes nothing", () => {
    const state = withObjectives(
      tableState(quickRules, { [fixtureIds.owner]: { wallet: { money: 9000 } } }),
      [objective({ id: brandedObjectiveId("objective-money"), definitionId: MONEY_OBJECTIVE.id })],
    );

    const result = advanceObjectives(state, 6);

    expect(result.objectives).toBe(state.objectives);
    expect(result.completed).toEqual([]);
  });

  it("Given an objective whose definition the engine does not know, When objectives advance, Then it is left strictly alone", () => {
    const state = withObjectives(
      tableState(standardRules, { [fixtureIds.owner]: { wallet: { money: 9000 } } }),
      [
        objective({
          id: brandedObjectiveId("objective-authored-elsewhere"),
          definitionId: "objective.authored-by-content-later",
          progress: 1,
          target: 2,
        }),
      ],
    );

    const result = advanceObjectives(state, 6);

    expect(result.objectives[0]?.progress).toBe(1);
    expect(result.objectives[0]?.completedAtRound).toBeNull();
    expect(result.completed).toEqual([]);
  });

  it("Given an owner with no wallet, When a money-rewarding objective completes, Then it still completes and pays nothing", () => {
    const base = tableState(standardRules, {
      [fixtureIds.owner]: { wallet: { reputation: 12 } },
    });
    const state = withObjectives(
      {
        ...base,
        players: {
          ...base.players,
          [fixtureIds.owner]: {
            ...base.players[fixtureIds.owner],
            resources: {
              reputation: base.players[fixtureIds.owner].resources.reputation,
            },
          },
        },
      },
      [
        objective({
          id: brandedObjectiveId("objective-reputation"),
          definitionId: REPUTATION_OBJECTIVE.id,
          target: 10,
        }),
      ],
    );

    const result = advanceObjectives(state, 2);

    expect(result.completed[0]?.rewardMoneyPaid).toBe(0);
    expect(result.objectives[0]?.completedAtRound).toBe(2);
    expect(result.changes).toEqual([]);
  });

  it("Given the caller's own updated player map, When objectives advance, Then the turn that crossed the line is the turn it completes on", () => {
    const state = withObjectives(
      tableState(standardRules, { [fixtureIds.owner]: { wallet: { money: 100 } } }),
      [objective({ id: brandedObjectiveId("objective-money"), definitionId: MONEY_OBJECTIVE.id })],
    );
    const afterTheTurn = {
      ...state.players,
      [fixtureIds.owner]: {
        ...state.players[fixtureIds.owner],
        resources: {
          ...state.players[fixtureIds.owner].resources,
          money: { ...state.players[fixtureIds.owner].resources.money, value: 4000 },
        },
      },
    };

    const result = advanceObjectives(state, 8, afterTheTurn);

    expect(result.objectives[0]?.completedAtRound).toBe(8);
    expect(result.players[fixtureIds.owner]?.resources.money?.value).toBe(4250);
  });

  it("Given a state carrying objectives, When it goes through the persistence boundary, Then advancing produces an identical result", () => {
    const state = withObjectives(
      tableState(standardRules, { [fixtureIds.owner]: { wallet: { money: 3200 } } }),
      assignObjectives(tableState(standardRules)),
    );

    const live = advanceObjectives(state, 4);
    const restored = advanceObjectives(jsonRoundTrip(state), 4);

    expect(stableStringify(restored)).toBe(stableStringify(live));
    expect(JSON.parse(JSON.stringify(live.objectives))).toEqual(live.objectives);
  });
});

describe("objectives — win condition", () => {
  it("Given a player with every objective complete, When finishers are listed, Then only they appear, with their richest objective's win path", () => {
    const state = withObjectives(tableState(campaignRules), [
      objective({
        id: brandedObjectiveId("objective-a"),
        definitionId: MONEY_OBJECTIVE.id,
        completedAtRound: 3,
        rewardPoints: 500,
      }),
      objective({
        id: brandedObjectiveId("objective-b"),
        definitionId: "objective.corner-office",
        completedAtRound: 4,
        rewardPoints: 1000,
      }),
      objective({
        id: brandedObjectiveId("objective-c"),
        definitionId: MONEY_OBJECTIVE.id,
        ownerId: fixtureIds.hiddenOpponent,
      }),
    ]);

    const finished = playersWithAllObjectivesComplete(state);

    expect(finished).toHaveLength(1);
    expect(finished[0]).toMatchObject({
      playerId: fixtureIds.owner,
      objectiveId: "objective-b",
      winPath: "promotion",
    });
  });

  it("Given an eliminated player who finished, When finishers are listed, Then they are not one", () => {
    const state: GameState = {
      ...withObjectives(tableState(campaignRules), [
        objective({
          id: brandedObjectiveId("objective-a"),
          definitionId: MONEY_OBJECTIVE.id,
          completedAtRound: 3,
        }),
      ]),
      eliminatedPlayerIds: [fixtureIds.owner],
    };

    expect(playersWithAllObjectivesComplete(state)).toEqual([]);
  });

  it("Given a player with no objectives at all, When finishers are listed, Then they never count as finished", () => {
    expect(playersWithAllObjectivesComplete(tableState(campaignRules))).toEqual([]);
  });
});

describe("objectives — measurement", () => {
  it("Given each metric, When it is measured, Then it reads canonical state directly", () => {
    const base = tableState(standardRules, {
      [fixtureIds.owner]: {
        wallet: { money: 700, reputation: 4, workCounter: 9 },
        rankIndex: 3,
        lapsCompleted: 2,
      },
    });
    const state: GameState = {
      ...base,
      tileOwnership: {
        "tile-1": {
          tileId: brandedObjectiveId("tile-1"),
          ownerId: fixtureIds.owner,
          level: 0,
          claimedAtRound: 1,
          tollPaidCount: 0,
        },
      },
      projects: [
        {
          id: brandedObjectiveId("project-1"),
          definitionId: "project.rebrand",
          leadPlayerId: fixtureIds.owner,
          tileId: null,
          status: "completed",
          requiredMoney: 100,
          requiredWork: 1,
          contributions: [{ playerId: fixtureIds.owner, money: 100, work: 1, atRound: 1 }],
          sabotage: [],
          deadlineRound: 5,
          payout: { money: 200, reputation: 1, objectiveProgress: 1 },
          openToJoin: false,
          leadBonusBasisPoints: 2500,
        },
      ],
    };
    const owner: PlayerId = fixtureIds.owner;

    expect(measureObjective(state, "money", owner)).toBe(700);
    expect(measureObjective(state, "reputation", owner)).toBe(4);
    expect(measureObjective(state, "work-counter", owner)).toBe(9);
    expect(measureObjective(state, "rank-index", owner)).toBe(3);
    expect(measureObjective(state, "laps-completed", owner)).toBe(2);
    expect(measureObjective(state, "tiles-owned", owner)).toBe(1);
    expect(measureObjective(state, "projects-completed", owner)).toBe(1);
    // Table-wide takes the best seat, walked in playerOrder.
    expect(measureObjective(state, "money", null)).toBe(1000);
  });

  it("Given the shipped catalogue, When it is inspected, Then every definition names a win path the rulesets can enable", () => {
    const paths = new Set(OBJECTIVE_DEFINITIONS.map((definition) => definition.winPath));

    expect([...paths].sort()).toEqual(["influence", "promotion", "survival", "wealth"]);
    expect(OBJECTIVE_DEFINITIONS.every((definition) => definition.target > 0)).toBe(true);
  });
});

describe("objectives — hidden information", () => {
  it("Given secret objectives dealt to every seat, When another player's view is projected, Then nothing but their existence leaks", () => {
    const base = tableState(standardRules);
    const state = withObjectives(base, assignObjectives(base));
    const secretDefinitionIds = state.objectives.map((entry) => entry.definitionId);

    const view = projectPlayerView(state, fixtureIds.owner);
    const payload = stableStringify(view);
    const othersDefinitionIds = state.objectives
      .filter((entry) => entry.ownerId !== fixtureIds.owner)
      .map((entry) => entry.definitionId);

    expect(state.objectives.every((entry) => entry.visibility === "secret")).toBe(true);
    expect(view.objectives).toHaveLength(state.objectives.length);
    // Existence-only for everybody else's; the viewer's own is disclosed in
    // full, which is what `PlayerGameProjection` promises (spec §7.2).
    for (const projected of view.objectives) {
      const disclosed = projected.ownerId === fixtureIds.owner;
      expect(projected.definitionId === null).toBe(!disclosed);
      expect(projected.progress === null).toBe(!disclosed);
      expect(projected.target === null).toBe(!disclosed);
      expect(projected.rewardPoints === null).toBe(!disclosed);
      expect(projected.rewardMoney === null).toBe(!disclosed);
    }
    expect(othersDefinitionIds.length).toBeGreaterThan(0);
    for (const definitionId of othersDefinitionIds) {
      expect(payload).not.toContain(definitionId);
    }
    expect(secretDefinitionIds.length).toBeGreaterThan(othersDefinitionIds.length);
  });

  it("Given secret objectives, When the public view is projected, Then the same redaction holds", () => {
    const base = tableState(standardRules);
    const state = withObjectives(base, assignObjectives(base));

    const payload = stableStringify(projectPublicView(state));

    for (const entry of state.objectives) {
      expect(payload).not.toContain(entry.definitionId);
      expect(payload).toContain(entry.id);
    }
  });

  it("Given public objectives, When they are projected, Then their detail is present", () => {
    const base = withRules(tableState(campaignRules), {
      hidden: { ...campaignRules.hidden, secretObjectives: false },
    });
    const state = withObjectives(base, assignObjectives(base));

    const view = projectPublicView(state);

    expect(view.objectives[0]?.definitionId).toBe(state.objectives[0]?.definitionId);
    expect(view.objectives[0]?.target).toBe(state.objectives[0]?.target);
  });
});
