import { describe, expect, it } from "vitest";

import { deadlineDashContent } from "@office-ladder/content";

import type {
  AttemptPromotionCommand,
  BlockPromotionCommand,
  CommandId,
  DeclinePromotionCommand,
  DecisionPointId,
  ExpireWindowCommand,
  GameState,
} from "../src";
import {
  attemptPromotion,
  blockPromotion,
  canAttemptPromotion,
  declinePromotion,
  promotionIsAutomatic,
  resolvePendingPromotion,
  upkeepAfterPromotion,
} from "../src/execution/promotion-choice";
import {
  accepted,
  agencyContext,
  agencyIds,
  agencyState,
  branded,
  commandBase,
  expectRoundTrips,
  rejected,
  resourceValue,
} from "./agency-fixtures";

/** Intern → Staff costs 250 money and 3 reputation under the fixture's mode. */
const AFFORDABLE_INTERN = { money: 1000, reputation: 3 } as const;

function attempt(
  state: GameState,
  overrides: Partial<AttemptPromotionCommand> = {},
): AttemptPromotionCommand {
  return {
    ...commandBase(state, "promotion-attempt"),
    type: "promotion.attempt",
    payload: {},
    ...overrides,
  };
}

function decline(
  state: GameState,
  overrides: Partial<DeclinePromotionCommand> = {},
): DeclinePromotionCommand {
  return {
    ...commandBase(state, "promotion-decline"),
    type: "promotion.decline",
    payload: {},
    ...overrides,
  };
}

function block(
  state: GameState,
  decisionPointId: DecisionPointId,
  overrides: Partial<BlockPromotionCommand> = {},
): BlockPromotionCommand {
  return {
    ...commandBase(state, "promotion-block", agencyIds.hiddenOpponent),
    type: "management.block-promotion",
    decisionPointId,
    payload: {},
    ...overrides,
  };
}

function expire(
  state: GameState,
  decisionPointId: DecisionPointId,
): ExpireWindowCommand {
  return {
    ...commandBase(state, "window-expire", agencyIds.owner),
    type: "window.expire",
    payload: { decisionPointId },
  };
}

const roleModeRules = {
  hidden: { rolesEnabled: true },
  interaction: { reactionWindows: true },
} as const;

describe("promotion.attempt", () => {
  it("Given an Intern who can afford Staff, When they attempt promotion, Then they pay for it and climb without the turn moving on", () => {
    const state = agencyState({ owner: AFFORDABLE_INTERN });

    const { state: next, events } = accepted(
      attemptPromotion(state, attempt(state), agencyContext()),
    );

    expect(next.players[agencyIds.owner]?.rank).toMatchObject({
      kind: "rank.staff",
      index: 1,
    });
    expect(resourceValue(next, agencyIds.owner, "money")).toBe(750);
    expect(events.map((event) => event.type)).toEqual([
      "PromotionAttempted",
      "PlayerPromoted",
      "ResourceChanged",
    ]);
    expect(next.turn).toEqual(state.turn);
    expectRoundTrips(next);
  });

  it("Given a mode that promotes automatically, When promotion is attempted, Then it is refused so the roll transition is not double-charged", () => {
    const state = agencyState({
      owner: AFFORDABLE_INTERN,
      rules: { agency: { promotionIsChoice: false } },
    });

    expect(promotionIsAutomatic(state.rules)).toBe(true);
    rejected(attemptPromotion(state, attempt(state), agencyContext()), "ILLEGAL_ACTION");
  });

  it("Given not enough reputation, When promotion is attempted, Then it is refused for insufficient resources", () => {
    const state = agencyState({ owner: { money: 1000, reputation: 1 } });

    expect(canAttemptPromotion(state, agencyIds.owner, deadlineDashContent)).toBeNull();
    rejected(
      attemptPromotion(state, attempt(state), agencyContext()),
      "INSUFFICIENT_RESOURCE",
    );
  });

  it("Given not enough money, When promotion is attempted, Then it is refused for insufficient resources", () => {
    const state = agencyState({ owner: { money: 10, reputation: 5 } });

    rejected(
      attemptPromotion(state, attempt(state), agencyContext()),
      "INSUFFICIENT_RESOURCE",
    );
  });

  it("Given a Director, When promotion is attempted, Then there is no rung above to buy", () => {
    const state = agencyState({
      owner: { rankKind: "rank.director", rankIndex: 8, money: 99999, reputation: 99 },
    });

    rejected(attemptPromotion(state, attempt(state), agencyContext()), "ILLEGAL_ACTION");
  });

  it("Given a player who is not the active one, When they attempt promotion, Then it is refused as not their turn", () => {
    const state = agencyState({ owner: AFFORDABLE_INTERN });

    rejected(
      attemptPromotion(
        state,
        attempt(state, { actorId: agencyIds.hiddenOpponent }),
        agencyContext(),
      ),
      "NOT_ACTOR_TURN",
    );
  });

  it("Given a General Manager who can afford Director, When they take it, Then the match ends on the promotion win path", () => {
    const state = agencyState({
      owner: {
        rankKind: "rank.general-manager",
        rankIndex: 7,
        money: 5000,
        // Director's `reputationRequired` is 58, not 17: the ladder was raised
        // from linear (3/5/7/9/11/13/15/17) to geometric (3/5/8/12/18/27/40/58)
        // so reputation stays a real gate at the top instead of going slack
        // above Supervisor.
        reputation: 58,
      },
    });

    const { state: next, events } = accepted(
      attemptPromotion(state, attempt(state), agencyContext()),
    );

    expect(next.status).toBe("ended");
    expect(next.outcome).toMatchObject({
      reason: "director-reached",
      winnerPlayerIds: [agencyIds.owner],
      winPath: "promotion",
    });
    expect(events.some((event) => event.type === "MatchEnded")).toBe(true);
    expectRoundTrips(next);
  });
});

describe("promotion upkeep — the bet that makes the choice real", () => {
  it("Given a mode where promotion raises upkeep, When a player climbs, Then their recurring charge moves to the new rank's row", () => {
    const state = agencyState({
      owner: AFFORDABLE_INTERN,
      rules: {
        agency: { promotionIsChoice: true, promotionRaisesUpkeep: true },
        economy: {
          upkeepEnabled: true,
          upkeepByRankIndex: [0, 50, 75, 100, 150, 200, 250, 300, 400],
        },
      },
    });
    const offer = canAttemptPromotion(state, agencyIds.owner, deadlineDashContent);

    const { state: next } = accepted(attemptPromotion(state, attempt(state), agencyContext()));

    expect(offer).toMatchObject({ upkeepBefore: 0, upkeepAfter: 50 });
    expect(next.players[agencyIds.owner]?.upkeep.perRound).toBe(50);
    expectRoundTrips(next);
  });

  it("Given a mode where promotion does not raise upkeep, When a player climbs, Then their charge is untouched", () => {
    const state = agencyState({
      owner: AFFORDABLE_INTERN,
      rules: {
        agency: { promotionRaisesUpkeep: false },
        economy: {
          upkeepEnabled: true,
          upkeepByRankIndex: [0, 50, 75, 100, 150, 200, 250, 300, 400],
        },
      },
    });

    const { state: next } = accepted(attemptPromotion(state, attempt(state), agencyContext()));

    expect(next.players[agencyIds.owner]?.upkeep.perRound).toBe(0);
  });

  it("Given upkeep switched off entirely, When the seam is asked for a new rank's charge, Then it is the identity function", () => {
    const state = agencyState({
      rules: {
        agency: { promotionRaisesUpkeep: true },
        economy: { upkeepEnabled: false },
      },
    });
    const upkeep = { perRound: 0, lastChargedRound: 3, missedPayments: 1 };

    expect(upkeepAfterPromotion(upkeep, state.rules, 4)).toBe(upkeep);
  });

  it("Given a rank index past the end of the ladder, When the seam resolves it, Then it clamps rather than reading undefined", () => {
    const state = agencyState({
      rules: {
        agency: { promotionRaisesUpkeep: true },
        economy: {
          upkeepEnabled: true,
          upkeepByRankIndex: [0, 50, 75, 100, 150, 200, 250, 300, 400],
        },
      },
    });

    expect(
      upkeepAfterPromotion(
        { perRound: 0, lastChargedRound: 0, missedPayments: 0 },
        state.rules,
        99,
      ).perRound,
    ).toBe(400);
  });
});

describe("promotion.decline", () => {
  it("Given an available promotion, When it is declined, Then the offer stops being pushed but stays legal to take", () => {
    const state = agencyState({ owner: AFFORDABLE_INTERN });

    const { state: next } = accepted(declinePromotion(state, decline(state), agencyContext()));

    expect(canAttemptPromotion(next, agencyIds.owner, deadlineDashContent)).toMatchObject({
      declined: true,
    });
    expect(resourceValue(next, agencyIds.owner, "money")).toBe(1000);
    expectRoundTrips(next);

    const { state: promoted } = accepted(
      attemptPromotion(
        next,
        attempt(next, { commandId: branded<CommandId>("promotion-attempt-after-decline") }),
        agencyContext(),
      ),
    );
    expect(promoted.players[agencyIds.owner]?.rank.kind).toBe("rank.staff");
    // The wave-off applied to the rung just taken, not to the next one.
    expect(
      promoted.players[agencyIds.owner]?.statuses.some(
        (status) => status.id === "status.promotion-declined",
      ),
    ).toBe(false);
  });

  it("Given a mode that promotes automatically, When promotion is declined, Then there is nothing to decline", () => {
    const state = agencyState({
      owner: AFFORDABLE_INTERN,
      rules: { agency: { promotionIsChoice: false } },
    });

    rejected(declinePromotion(state, decline(state), agencyContext()), "ILLEGAL_ACTION");
  });

  it("Given a player who is not the active one, When they decline, Then it is refused as not their turn", () => {
    const state = agencyState({ owner: AFFORDABLE_INTERN });

    rejected(
      declinePromotion(
        state,
        decline(state, { actorId: agencyIds.revealedOpponent }),
        agencyContext(),
      ),
      "NOT_ACTOR_TURN",
    );
  });
});

describe("management.block-promotion", () => {
  function openedWindow(): {
    readonly state: GameState;
    readonly decisionPointId: DecisionPointId;
  } {
    const state = agencyState({ owner: AFFORDABLE_INTERN, rules: roleModeRules });
    const { state: next } = accepted(
      attemptPromotion(state, attempt(state), agencyContext(), { openBlockWindow: true }),
    );
    const window = next.reactionWindows[0];
    if (window === undefined) throw new Error("expected a promotion-block window");

    return { state: next, decisionPointId: window.id };
  }

  it("Given a promotion raised into a block window, When the window opens, Then nothing is charged yet and the audience is every other seat", () => {
    const { state } = openedWindow();

    expect(resourceValue(state, agencyIds.owner, "money")).toBe(1000);
    expect(state.players[agencyIds.owner]?.rank.kind).toBe("rank.intern");
    expect(state.pendingEffects).toHaveLength(1);
    // Naming only the Management players here would publish the hidden role
    // through the projection, so the audience is deliberately everybody else.
    expect(state.reactionWindows[0]?.eligiblePlayerIds).toEqual([
      agencyIds.hiddenOpponent,
      agencyIds.revealedOpponent,
    ]);
    expectRoundTrips(state);
  });

  it("Given an open block window, When a Management player blocks, Then the promotion is cancelled and the blocker is revealed", () => {
    const { state, decisionPointId } = openedWindow();

    const { state: next, events } = accepted(
      blockPromotion(state, block(state, decisionPointId), agencyContext()),
    );

    expect(next.players[agencyIds.owner]?.rank.kind).toBe("rank.intern");
    expect(resourceValue(next, agencyIds.owner, "money")).toBe(1000);
    expect(next.reactionWindows).toHaveLength(0);
    expect(next.pendingEffects).toHaveLength(0);
    expect(next.players[agencyIds.hiddenOpponent]?.role.revealed).toBe(true);
    expect(events.map((event) => event.type)).toEqual([
      "PromotionBlocked",
      "ManagementRevealed",
    ]);
    expectRoundTrips(next);
  });

  it("Given a player who is not Management, When they try to block, Then the veto is refused and the promotion survives", () => {
    const { state, decisionPointId } = openedWindow();

    rejected(
      blockPromotion(
        state,
        block(state, decisionPointId, { actorId: agencyIds.revealedOpponent }),
        agencyContext(),
      ),
      "ACTOR_NOT_AUTHORIZED",
    );
    expect(state.reactionWindows).toHaveLength(1);
  });

  it("Given the promoting player themselves, When they try to block their own promotion, Then they are not in the window's audience", () => {
    const { state, decisionPointId } = openedWindow();

    rejected(
      blockPromotion(
        state,
        block(state, decisionPointId, { actorId: agencyIds.owner }),
        agencyContext(),
      ),
      "ACTOR_NOT_AUTHORIZED",
    );
  });

  it("Given a decision-point id that names no open window, When a block arrives, Then it is refused", () => {
    const { state } = openedWindow();

    rejected(
      blockPromotion(
        state,
        block(state, branded<DecisionPointId>("decision-invented")),
        agencyContext(),
      ),
      "DECISION_POINT_NOT_FOUND",
    );
  });

  it("Given a mode with no Management role, When a block arrives, Then the whole power is off", () => {
    const { state, decisionPointId } = openedWindow();
    const noRoles: GameState = {
      ...state,
      rules: { ...state.rules, hidden: { ...state.rules.hidden, rolesEnabled: false } },
    };

    rejected(
      blockPromotion(noRoles, block(noRoles, decisionPointId), agencyContext()),
      "ILLEGAL_ACTION",
    );
  });

  it("Given a mode with reaction windows off, When a promotion is attempted with the window opt-in, Then it resolves immediately instead", () => {
    const state = agencyState({
      owner: AFFORDABLE_INTERN,
      rules: { hidden: { rolesEnabled: true }, interaction: { reactionWindows: false } },
    });

    const { state: next } = accepted(
      attemptPromotion(state, attempt(state), agencyContext(), { openBlockWindow: true }),
    );

    expect(next.reactionWindows).toHaveLength(0);
    expect(next.players[agencyIds.owner]?.rank.kind).toBe("rank.staff");
  });

  it("Given no Management opponent at the table, When a promotion is attempted with the window opt-in, Then no window is raised for nobody to answer", () => {
    const state = agencyState({
      owner: AFFORDABLE_INTERN,
      rules: roleModeRules,
      opponent: { role: "role.worker" },
      bystander: { role: "role.worker" },
    });

    const { state: next } = accepted(
      attemptPromotion(state, attempt(state), agencyContext(), { openBlockWindow: true }),
    );

    expect(next.reactionWindows).toHaveLength(0);
    expect(next.players[agencyIds.owner]?.rank.kind).toBe("rank.staff");
  });
});

describe("resolvePendingPromotion — the window.expire seam", () => {
  function openedWindow(): {
    readonly state: GameState;
    readonly decisionPointId: DecisionPointId;
  } {
    const state = agencyState({ owner: AFFORDABLE_INTERN, rules: roleModeRules });
    const { state: next } = accepted(
      attemptPromotion(state, attempt(state), agencyContext(), { openBlockWindow: true }),
    );
    const window = next.reactionWindows[0];
    if (window === undefined) throw new Error("expected a promotion-block window");

    return { state: next, decisionPointId: window.id };
  }

  it("Given a window nobody blocked, When it expires, Then the promotion is charged and applied", () => {
    const { state, decisionPointId } = openedWindow();

    const { state: next } = accepted(
      resolvePendingPromotion(
        state,
        expire(state, decisionPointId),
        decisionPointId,
        agencyContext(),
      ),
    );

    expect(next.players[agencyIds.owner]?.rank.kind).toBe("rank.staff");
    expect(resourceValue(next, agencyIds.owner, "money")).toBe(750);
    expect(next.reactionWindows).toHaveLength(0);
    expect(next.pendingEffects).toHaveLength(0);
    expectRoundTrips(next);
  });

  it("Given an expiry that already fired, When it fires again, Then the second one cannot promote a second time", () => {
    const { state, decisionPointId } = openedWindow();
    const { state: resolved } = accepted(
      resolvePendingPromotion(
        state,
        expire(state, decisionPointId),
        decisionPointId,
        agencyContext(),
      ),
    );

    rejected(
      resolvePendingPromotion(
        resolved,
        expire(resolved, decisionPointId),
        decisionPointId,
        agencyContext(),
      ),
      "DECISION_POINT_NOT_FOUND",
    );
  });

  it("Given the promoting player can no longer afford the rung, When the window expires, Then the offer lapses without charging them", () => {
    const { state, decisionPointId } = openedWindow();
    const owner = state.players[agencyIds.owner];
    if (owner === undefined) throw new Error("fixture missing owner");
    const broke: GameState = {
      ...state,
      players: {
        ...state.players,
        [agencyIds.owner]: {
          ...owner,
          resources: {
            ...owner.resources,
            money: { ...owner.resources.money, value: 10 },
          },
        },
      },
    };

    const { state: next } = accepted(
      resolvePendingPromotion(
        broke,
        expire(broke, decisionPointId),
        decisionPointId,
        agencyContext(),
      ),
    );

    expect(next.players[agencyIds.owner]?.rank.kind).toBe("rank.intern");
    expect(resourceValue(next, agencyIds.owner, "money")).toBe(10);
    expect(next.reactionWindows).toHaveLength(0);
    expectRoundTrips(next);
  });

  it("Given the promoting player, When they try to close their own block window with an ordinary command, Then they are not authorised to", () => {
    const { state, decisionPointId } = openedWindow();
    const selfServing = {
      ...attempt(state, { commandId: branded<CommandId>("promotion-force") }),
    };

    rejected(
      resolvePendingPromotion(state, selfServing, decisionPointId, agencyContext()),
      "ACTOR_NOT_AUTHORIZED",
    );
    expect(state.reactionWindows).toHaveLength(1);
  });

  it("Given a blocked promotion, When the expiry arrives afterwards, Then there is nothing left to resolve", () => {
    const { state, decisionPointId } = openedWindow();
    const { state: blocked } = accepted(
      blockPromotion(state, block(state, decisionPointId), agencyContext()),
    );

    rejected(
      resolvePendingPromotion(
        blocked,
        expire(blocked, decisionPointId),
        decisionPointId,
        agencyContext(),
      ),
      "DECISION_POINT_NOT_FOUND",
    );
  });
});
