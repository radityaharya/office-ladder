import { describe, expect, it } from "vitest";

import { applyCommand } from "../src";
import type {
  AttemptPromotionCommand,
  BlockPromotionCommand,
  CommandId,
  DecisionPointId,
  ExpireWindowCommand,
  GameState,
  PassReactionCommand,
  PlayerId,
  RollTurnCommand,
} from "../src";
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

/**
 * `management.block-promotion` was routed, authorised and unit-tested, and dead:
 * a promotion-block window only ever opened when `attemptPromotion` was called
 * with `{ openBlockWindow: true }`, and nothing in `src` passed it — only
 * `promotion-choice.test.ts` did. The Management role's one real power could not
 * be used in an actual match.
 *
 * These go through `applyCommand`, not `attemptPromotion` directly, because the
 * router is the thing that was missing.
 */

/** Intern → Staff costs 250 money and 3 reputation under the fixture's mode. */
const AFFORDABLE_INTERN = { money: 1000, reputation: 3 } as const;

const ROLE_MODE = {
  hidden: { rolesEnabled: true },
  interaction: { reactionWindows: true },
} as const;

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

function block(
  state: GameState,
  decisionPointId: DecisionPointId,
  actorId: PlayerId = agencyIds.hiddenOpponent,
): BlockPromotionCommand {
  return {
    ...commandBase(state, `promotion-block-${actorId}`, actorId),
    type: "management.block-promotion",
    decisionPointId,
    payload: {},
  };
}

function pass(
  state: GameState,
  decisionPointId: DecisionPointId,
  actorId: PlayerId,
): PassReactionCommand {
  return {
    ...commandBase(state, `reaction-pass-${actorId}-${state.revision}`, actorId),
    type: "reaction.pass",
    decisionPointId,
    payload: {},
  };
}

/** A promotion attempt routed through `applyCommand` in a roles + reactions mode. */
function attempted(): { readonly state: GameState; readonly decisionPointId: DecisionPointId } {
  const state = agencyState({ owner: AFFORDABLE_INTERN, rules: ROLE_MODE });
  const { state: next } = accepted(applyCommand(state, attempt(state), agencyContext()));
  const window = next.reactionWindows[0];
  if (window === undefined) throw new Error("expected a promotion-block window");

  return { state: next, decisionPointId: window.id };
}

describe("promotion.attempt — the block window has a producer", () => {
  it("Given a mode with roles and reaction windows, When a promotion is attempted through the router, Then a block window opens and nothing is charged yet", () => {
    const before = agencyState({ owner: AFFORDABLE_INTERN, rules: ROLE_MODE });

    const { state: next, events } = accepted(
      applyCommand(before, attempt(before), agencyContext()),
    );

    expect(next.reactionWindows).toHaveLength(1);
    expect(next.reactionWindows[0]).toMatchObject({
      kind: "promotion-block",
      // Naming only the Management seats here would publish the hidden role
      // through the projection, so the audience is deliberately everybody else.
      eligiblePlayerIds: [agencyIds.hiddenOpponent, agencyIds.revealedOpponent],
      deadlineAt: null,
    });
    expect(next.pendingEffects).toHaveLength(1);
    expect(next.players[agencyIds.owner]?.rank.kind).toBe("rank.intern");
    expect(resourceValue(next, agencyIds.owner, "money")).toBe(1000);
    expect(events.map((event) => event.type)).toEqual([
      "PromotionAttempted",
      "ReactionWindowOpened",
    ]);
    expectRoundTrips(next);
  });

  it("Given an open block window, When a Management player blocks, Then the promotion is cancelled and the blocker's cover is spent", () => {
    const { state, decisionPointId } = attempted();

    const { state: next, events } = accepted(
      applyCommand(state, block(state, decisionPointId), agencyContext()),
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

  it("Given an open block window, When every eligible seat passes, Then the promotion is charged and applied", () => {
    // The reason the option was opt-in was that a window nobody closes freezes
    // the match. Both closers now exist: this is the players' one, and
    // `window.expire` is the server's.
    const { state, decisionPointId } = attempted();

    const { state: onePassed } = accepted(
      applyCommand(state, pass(state, decisionPointId, agencyIds.hiddenOpponent), agencyContext()),
    );
    expect(onePassed.reactionWindows).toHaveLength(1);

    const { state: next } = accepted(
      applyCommand(
        onePassed,
        pass(onePassed, decisionPointId, agencyIds.revealedOpponent),
        agencyContext(),
      ),
    );

    expect(next.players[agencyIds.owner]?.rank.kind).toBe("rank.staff");
    expect(resourceValue(next, agencyIds.owner, "money")).toBe(750);
    expect(next.reactionWindows).toHaveLength(0);
    expect(next.pendingEffects).toHaveLength(0);
    expectRoundTrips(next);
  });

  it("Given an open block window, When the promoting player tries to roll on, Then their own pending window blocks them", () => {
    const { state } = attempted();
    const roll: RollTurnCommand = {
      ...commandBase(state, "roll-through-window"),
      type: "turn.roll",
      payload: {},
    };

    rejected(applyCommand(state, roll, agencyContext()), "ILLEGAL_ACTION");
  });
});

describe("promotion.attempt — the block window stays gated", () => {
  it("Given a mode with reaction windows switched off, When a promotion is attempted, Then it resolves on the spot", () => {
    const state = agencyState({
      owner: AFFORDABLE_INTERN,
      rules: { hidden: { rolesEnabled: true }, interaction: { reactionWindows: false } },
    });

    const { state: next } = accepted(applyCommand(state, attempt(state), agencyContext()));

    expect(next.reactionWindows).toHaveLength(0);
    expect(next.players[agencyIds.owner]?.rank.kind).toBe("rank.staff");
    expect(resourceValue(next, agencyIds.owner, "money")).toBe(750);
  });

  it("Given a mode with hidden roles switched off, When a promotion is attempted, Then there is no Management to ask and it resolves on the spot", () => {
    const state = agencyState({
      owner: AFFORDABLE_INTERN,
      rules: { hidden: { rolesEnabled: false }, interaction: { reactionWindows: true } },
    });

    const { state: next } = accepted(applyCommand(state, attempt(state), agencyContext()));

    expect(next.reactionWindows).toHaveLength(0);
    expect(next.players[agencyIds.owner]?.rank.kind).toBe("rank.staff");
  });

  it("Given a table with no Management opponent, When a promotion is attempted, Then no window is raised for nobody to answer", () => {
    const state = agencyState({
      owner: AFFORDABLE_INTERN,
      rules: ROLE_MODE,
      opponent: { role: "role.worker" },
      bystander: { role: "role.worker" },
    });

    const { state: next } = accepted(applyCommand(state, attempt(state), agencyContext()));

    expect(next.reactionWindows).toHaveLength(0);
    expect(next.players[agencyIds.owner]?.rank.kind).toBe("rank.staff");
  });

  it("Given a mode that promotes automatically, When a promotion is attempted, Then it is refused and no window is opened", () => {
    const state = agencyState({
      owner: AFFORDABLE_INTERN,
      rules: { ...ROLE_MODE, agency: { promotionIsChoice: false } },
    });

    rejected(applyCommand(state, attempt(state), agencyContext()), "ILLEGAL_ACTION");
    expect(state.reactionWindows).toHaveLength(0);
  });
});

describe("promotion.attempt — hostile input against the block window", () => {
  it("Given a seat that is not Management, When they try to veto a rival's promotion, Then the veto is refused and the window survives", () => {
    const { state, decisionPointId } = attempted();

    rejected(
      applyCommand(
        state,
        block(state, decisionPointId, agencyIds.revealedOpponent),
        agencyContext(),
      ),
      "ACTOR_NOT_AUTHORIZED",
    );
    expect(state.reactionWindows).toHaveLength(1);
  });

  it("Given the promoting player, When they try to block their own promotion, Then they are not in the window's audience", () => {
    const { state, decisionPointId } = attempted();

    rejected(
      applyCommand(state, block(state, decisionPointId, agencyIds.owner), agencyContext()),
      "ACTOR_NOT_AUTHORIZED",
    );
  });

  it("Given the promoting player, When they inject an expiry to force their promotion past Management, Then the router refuses it as server-injected", () => {
    const { state, decisionPointId } = attempted();
    const forced: ExpireWindowCommand = {
      ...commandBase(state, "window-expire-forged"),
      type: "window.expire",
      payload: { decisionPointId },
    };

    rejected(applyCommand(state, forced, agencyContext()), "ACTOR_NOT_AUTHORIZED");
    expect(state.reactionWindows).toHaveLength(1);
    expect(state.players[agencyIds.owner]?.rank.kind).toBe("rank.intern");
  });

  it("Given a client-chosen decision-point id, When a block names it, Then it matches no window", () => {
    const { state } = attempted();

    rejected(
      applyCommand(
        state,
        block(state, branded<DecisionPointId>("decision-invented")),
        agencyContext(),
      ),
      "DECISION_POINT_NOT_FOUND",
    );
  });

  it("Given a Management player who has already answered, When they block a second time, Then the window is gone and nothing is double-cancelled", () => {
    const { state, decisionPointId } = attempted();
    const { state: blocked } = accepted(
      applyCommand(state, block(state, decisionPointId), agencyContext()),
    );

    rejected(
      applyCommand(
        blocked,
        {
          ...block(blocked, decisionPointId),
          commandId: branded<CommandId>("promotion-block-again"),
        },
        agencyContext(),
      ),
      "DECISION_POINT_NOT_FOUND",
    );
  });
});
