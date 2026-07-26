import { describe, expect, it } from "vitest";

import type { GameState, PlayerState, TakeTurnActionCommand } from "../src";
import {
  FREE_ACTION_KINDS,
  enabledFreeActions,
  freeActionsRemaining,
  resolveFreeActionPrices,
  takeTurnAction,
} from "../src/execution/free-action";
import {
  accepted,
  agencyContext,
  agencyIds,
  agencyState,
  commandBase,
  expectRoundTrips,
  rejected,
  resourceValue,
} from "./agency-fixtures";
import { deadlineDashContent } from "@office-ladder/content";

function actionCommand(
  state: GameState,
  action: string,
  overrides: Partial<TakeTurnActionCommand> = {},
): TakeTurnActionCommand {
  return {
    ...commandBase(state, `action-${action}`),
    type: "turn.action",
    payload: { action, targetPlayerIds: [], choice: null },
    ...overrides,
  };
}

function owner(state: GameState): PlayerState {
  const player = state.players[agencyIds.owner];
  if (player === undefined) throw new Error("fixture missing owner");

  return player;
}

/** The aggressive verb needs a mode that models both targeting and its price. */
const schemingRules = {
  conflict: { targetedAttacks: true, heatEnabled: true, heatPerAttack: 1 },
} as const;

describe("turn.action — the four verbs are four different shapes", () => {
  it("Given an Intern with energy, When they work, Then energy becomes money and the work counter advances", () => {
    const state = agencyState({ owner: { energy: 5, money: 1000, workCounter: 0 } });
    const prices = resolveFreeActionPrices(state, owner(state), deadlineDashContent);

    const { state: next, events } = accepted(
      takeTurnAction(state, actionCommand(state, "work"), agencyContext()),
    );

    // Intern salary is 200 in the content pack; work pays a quarter of the rank
    // it is done at, so the payout is not a constant but a function of rank.
    expect(prices.workPayout).toBe(50);
    expect(resourceValue(next, agencyIds.owner, "energy")).toBe(4);
    expect(resourceValue(next, agencyIds.owner, "money")).toBe(1050);
    expect(resourceValue(next, agencyIds.owner, "work-counter")).toBe(1);
    expect(next.turn).toEqual(state.turn);
    expect(events.at(-1)?.type).toBe("EffectProposed");
    expectRoundTrips(next);
  });

  it("Given a Supervisor and an Intern, When each works, Then the higher rank earns more from the same action", () => {
    const intern = agencyState({ owner: { rankKind: "rank.intern", rankIndex: 0 } });
    const supervisor = agencyState({
      owner: { rankKind: "rank.supervisor", rankIndex: 3 },
    });

    const internPay = resolveFreeActionPrices(
      intern,
      owner(intern),
      deadlineDashContent,
    ).workPayout;
    const supervisorPay = resolveFreeActionPrices(
      supervisor,
      owner(supervisor),
      deadlineDashContent,
    ).workPayout;

    expect(supervisorPay).toBeGreaterThan(internPay);
  });

  it("Given money to spend, When they network, Then money buys reputation at the ladder's own price", () => {
    const state = agencyState({ owner: { money: 1000, reputation: 2 } });
    const prices = resolveFreeActionPrices(state, owner(state), deadlineDashContent);

    const { state: next } = accepted(
      takeTurnAction(state, actionCommand(state, "network"), agencyContext()),
    );

    // Staff costs 250 money and 3 reputation in this mode, so a point of
    // reputation is worth ceil(250/3) = 84 — derived, never a constant.
    expect(prices.reputationPrice).toBe(84);
    expect(resourceValue(next, agencyIds.owner, "money")).toBe(916);
    expect(resourceValue(next, agencyIds.owner, "reputation")).toBe(3);
    expectRoundTrips(next);
  });

  it("Given a mode that models targeting, When they scheme, Then reputation moves off the target and heat lands on the actor", () => {
    const state = agencyState({
      rules: schemingRules,
      owner: { reputation: 2, energy: 5 },
      opponent: { reputation: 2 },
    });

    const { state: next } = accepted(
      takeTurnAction(
        state,
        actionCommand(state, "scheme", { payload: {
          action: "scheme",
          targetPlayerIds: [agencyIds.hiddenOpponent],
          choice: null,
        } }),
        agencyContext(),
      ),
    );

    expect(resourceValue(next, agencyIds.hiddenOpponent, "reputation")).toBe(1);
    expect(resourceValue(next, agencyIds.owner, "reputation")).toBe(3);
    expect(resourceValue(next, agencyIds.owner, "energy")).toBe(4);
    // Spec §10.4: aggression that costs the aggressor nothing collapses into
    // alpha-striking the leader every match.
    expect(next.players[agencyIds.owner]?.heat.value).toBe(1);
    expectRoundTrips(next);
  });

  it("Given a mode with heat switched off, When they scheme, Then the theft still lands but no suspicion accrues", () => {
    const state = agencyState({
      rules: { conflict: { targetedAttacks: true, heatEnabled: false } },
      opponent: { reputation: 2 },
    });

    const { state: next } = accepted(
      takeTurnAction(
        state,
        actionCommand(state, "scheme", { payload: {
          action: "scheme",
          targetPlayerIds: [agencyIds.hiddenOpponent],
          choice: null,
        } }),
        agencyContext(),
      ),
    );

    expect(resourceValue(next, agencyIds.hiddenOpponent, "reputation")).toBe(1);
    expect(next.players[agencyIds.owner]?.heat.value).toBe(0);
  });

  it("Given a tired player, When they rest, Then energy returns to full and the whole turn's actions are gone", () => {
    const state = agencyState({
      owner: { energy: 1, energyMaximum: 5 },
      rules: { agency: { freeActionsPerTurn: 2 } },
    });
    expect(freeActionsRemaining(state, owner(state))).toBe(2);

    const { state: next } = accepted(
      takeTurnAction(state, actionCommand(state, "rest"), agencyContext()),
    );

    expect(resourceValue(next, agencyIds.owner, "energy")).toBe(5);
    // Rest is the verb paid for in tempo: it takes the turn's other options.
    expect(freeActionsRemaining(next, owner(next))).toBe(0);
    expectRoundTrips(next);
  });
});

describe("turn.action — budget", () => {
  it("Given one action per turn, When a second is attempted on the same turn, Then it is refused", () => {
    const state = agencyState({ rules: { agency: { freeActionsPerTurn: 1 } } });
    const { state: afterFirst } = accepted(
      takeTurnAction(state, actionCommand(state, "work"), agencyContext()),
    );

    const result = takeTurnAction(
      afterFirst,
      actionCommand(afterFirst, "work", {
        commandId: "action-work-again" as TakeTurnActionCommand["commandId"],
      }),
      agencyContext(),
    );

    rejected(result, "ILLEGAL_ACTION");
  });

  it("Given a spent budget, When the turn number advances, Then the actions come back", () => {
    const state = agencyState();
    const spent = accepted(
      takeTurnAction(state, actionCommand(state, "work"), agencyContext()),
    ).state;
    const nextTurn: GameState = {
      ...spent,
      turn: { ...spent.turn, number: spent.turn.number + 1 },
    };

    expect(freeActionsRemaining(spent, owner(spent))).toBe(0);
    expect(freeActionsRemaining(nextTurn, owner(nextTurn))).toBe(1);
  });

  it("Given a mode that grants no turn actions, When any verb is used, Then the whole mechanic is off", () => {
    const state = agencyState({ rules: { agency: { freeActionsPerTurn: 0 } } });

    expect(enabledFreeActions(state.rules)).toEqual([]);
    for (const action of FREE_ACTION_KINDS) {
      rejected(
        takeTurnAction(state, actionCommand(state, action), agencyContext()),
        "ILLEGAL_ACTION",
      );
    }
  });
});

describe("turn.action — authorisation and refusals", () => {
  it("Given a player who is not the active one, When they take an action, Then it is refused as not their turn", () => {
    const state = agencyState();
    const command = actionCommand(state, "work", { actorId: agencyIds.hiddenOpponent });

    rejected(takeTurnAction(state, command, agencyContext()), "NOT_ACTOR_TURN");
  });

  it("Given a mode with targeting switched off, When a scheme is attempted, Then it is refused and the target keeps their reputation", () => {
    const state = agencyState({
      rules: { conflict: { targetedAttacks: false } },
      opponent: { reputation: 2 },
    });

    rejected(
      takeTurnAction(
        state,
        actionCommand(state, "scheme", { payload: {
          action: "scheme",
          targetPlayerIds: [agencyIds.hiddenOpponent],
          choice: null,
        } }),
        agencyContext(),
      ),
      "ILLEGAL_ACTION",
    );
    expect(resourceValue(state, agencyIds.hiddenOpponent, "reputation")).toBe(2);
  });

  it("Given a scheme aimed at its own actor, When it is applied, Then the command is refused", () => {
    const state = agencyState({ rules: schemingRules });

    rejected(
      takeTurnAction(
        state,
        actionCommand(state, "scheme", { payload: {
          action: "scheme",
          targetPlayerIds: [agencyIds.owner],
          choice: null,
        } }),
        agencyContext(),
      ),
      "INVALID_COMMAND",
    );
  });

  it("Given a scheme aimed at nobody, When it is applied, Then the command is refused", () => {
    const state = agencyState({ rules: schemingRules });

    rejected(
      takeTurnAction(state, actionCommand(state, "scheme"), agencyContext()),
      "INVALID_COMMAND",
    );
  });

  it("Given a target with nothing to take, When they are schemed against, Then the command is refused rather than burning the action", () => {
    const state = agencyState({ rules: schemingRules, opponent: { reputation: 0 } });

    rejected(
      takeTurnAction(
        state,
        actionCommand(state, "scheme", { payload: {
          action: "scheme",
          targetPlayerIds: [agencyIds.hiddenOpponent],
          choice: null,
        } }),
        agencyContext(),
      ),
      "ILLEGAL_ACTION",
    );
  });

  it("Given no energy, When they try to work, Then it is refused for insufficient energy", () => {
    const state = agencyState({ owner: { energy: 0 } });

    rejected(
      takeTurnAction(state, actionCommand(state, "work"), agencyContext()),
      "INSUFFICIENT_RESOURCE",
    );
  });

  it("Given not enough money, When they try to network, Then it is refused for insufficient money", () => {
    const state = agencyState({ owner: { money: 10 } });

    rejected(
      takeTurnAction(state, actionCommand(state, "network"), agencyContext()),
      "INSUFFICIENT_RESOURCE",
    );
  });

  it("Given a player already at full energy, When they rest, Then it is refused rather than wasting the turn", () => {
    const state = agencyState({ owner: { energy: 5, energyMaximum: 5 } });

    rejected(
      takeTurnAction(state, actionCommand(state, "rest"), agencyContext()),
      "ILLEGAL_ACTION",
    );
  });

  it("Given an action nobody authored, When it is submitted, Then the command is refused", () => {
    const state = agencyState();

    rejected(
      takeTurnAction(state, actionCommand(state, "embezzle"), agencyContext()),
      "INVALID_COMMAND",
    );
  });
});
