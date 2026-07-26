import { describe, expect, it } from "vitest";

import { deadlineDashContent } from "@office-ladder/content";

import {
  applyCommand,
  deserializeGameState,
  serializeGameState,
  stableStringify,
} from "../src";
import type { GameState, PlayerState } from "../src";
import { spendableTokens, spendToken } from "../src/execution/play-card";
import { fixtureIds } from "./fixtures";
import { accepted, context, logicalTimestamp, rollCommand, withRules } from "./turn-loop-fixtures";
import { handState, spendTokenCommand, tokenIds } from "./cards-hand-fixtures";

const EXTRA_MOVEMENT_STATUS_ID = "status.next-roll-extra-movement";

function transitionContext(timestamp = logicalTimestamp) {
  return { logicalTimestamp: timestamp, content: deadlineDashContent };
}

function ownerOf(state: GameState): PlayerState {
  const player = state.players[fixtureIds.owner];
  if (player === undefined) throw new Error("fixture is missing the owner");

  return player;
}

function accept(result: ReturnType<typeof spendToken>) {
  expect(result.ok).toBe(true);
  if (!result.ok) throw new Error(result.error.message);

  return result.value;
}

function rejection(result: ReturnType<typeof spendToken>): string {
  expect(result.ok).toBe(false);
  if (result.ok) throw new Error("expected the command to be rejected");

  return result.error.code;
}

function extraMovement(player: PlayerState): number | null {
  const status = player.statuses.find((candidate) => candidate.id === EXTRA_MOVEMENT_STATUS_ID);
  const spaces = status?.data["spaces"];

  return typeof spaces === "number" ? spaces : null;
}

describe("turn.spend-token", () => {
  it("Given a move token, When the active player spends it, Then their next roll is banked and the token is gone", () => {
    const state = handState({ ownerMoveTokens: 2 });

    const { state: next, events } = accept(
      spendToken(state, spendTokenCommand(state), transitionContext()),
    );

    expect(ownerOf(next).tokens.move?.count).toBe(1);
    expect(extraMovement(ownerOf(next))).toBe(1);
    expect(events.map((event) => event.type)).toEqual(["StatusApplied"]);
    expect(next.revision).toBe(state.revision + 1);
    // Spending is a free action: the turn stays exactly where it was.
    expect(next.turn).toEqual(state.turn);
  });

  it("Given banked movement, When the player then rolls, Then the die really is shifted and the status is spent", () => {
    const state = handState({ ownerMoveTokens: 2 });
    const spent = accept(spendToken(state, spendTokenCommand(state), transitionContext())).state;

    // 0.5 -> a die face of 4; the banked token makes it 5 spaces.
    const rolled = accepted(applyCommand(spent, rollCommand(spent), context([0.5])));

    const moved = rolled.events.find((event) => event.type === "PlayerMoved");
    expect(moved?.type === "PlayerMoved" && moved.payload.distance).toBe(5);
    expect(extraMovement(ownerOf(rolled.state))).toBeNull();
  });

  it("Given another player's token id, When the actor spends it, Then the command is rejected as unauthorised and no token moves", () => {
    const state = handState();

    const result = spendToken(
      state,
      spendTokenCommand(state, { payload: { tokenId: tokenIds.opponentMove } }),
      transitionContext(),
    );

    expect(rejection(result)).toBe("ACTOR_NOT_AUTHORIZED");
    expect(state.players[fixtureIds.hiddenOpponent]?.tokens.move?.count).toBe(2);
    expect(ownerOf(state).tokens.move?.count).toBe(2);
  });

  it("Given a player whose turn it is not, When they spend their own token, Then the command is rejected", () => {
    const state = handState();

    const result = spendToken(
      state,
      spendTokenCommand(state, {
        actorId: fixtureIds.hiddenOpponent,
        payload: { tokenId: tokenIds.opponentMove },
      }),
      transitionContext(),
    );

    expect(rejection(result)).toBe("NOT_ACTOR_TURN");
  });

  it("Given a mode with dice adjustment switched off, When a token is spent, Then the command is rejected", () => {
    const state = withRules(handState(), { agency: { diceAdjustEnabled: false } });

    expect(rejection(spendToken(state, spendTokenCommand(state), transitionContext()))).toBe(
      "ILLEGAL_ACTION",
    );
  });

  it("Given fewer tokens than the spend asks for, When it is submitted, Then it is rejected as insufficient", () => {
    const state = handState({ ownerMoveTokens: 1 });

    expect(
      rejection(
        spendToken(state, spendTokenCommand(state, { payload: { quantity: 2 } }), transitionContext()),
      ),
    ).toBe("INSUFFICIENT_RESOURCE");
    expect(ownerOf(state).tokens.move?.count).toBe(1);
  });

  it("Given the mode's pip cap, When a spend would exceed it, Then it is rejected — including across several small spends", () => {
    const state = handState({ ownerMoveTokens: 5 });
    // mode.quick allows a two-pip adjustment.
    expect(state.rules.agency.maxPipAdjust).toBe(2);

    const first = accept(spendToken(state, spendTokenCommand(state), transitionContext())).state;
    const second = accept(spendToken(first, spendTokenCommand(first), transitionContext())).state;

    expect(extraMovement(ownerOf(second))).toBe(2);
    expect(rejection(spendToken(second, spendTokenCommand(second), transitionContext()))).toBe(
      "ILLEGAL_ACTION",
    );
    expect(
      rejection(
        spendToken(state, spendTokenCommand(state, { payload: { quantity: 3 } }), transitionContext()),
      ),
    ).toBe("ILLEGAL_ACTION");
  });

  it("Given a token of the wrong kind, When it is spent on movement, Then the command is rejected", () => {
    const state = handState();

    expect(
      rejection(
        spendToken(
          state,
          spendTokenCommand(state, { payload: { tokenId: tokenIds.ownerMomentum } }),
          transitionContext(),
        ),
      ),
    ).toBe("ILLEGAL_ACTION");
  });

  it("Given a token id nobody holds, When it is spent, Then the command is rejected as illegal rather than unauthorised", () => {
    const state = handState();

    expect(
      rejection(
        spendToken(
          state,
          spendTokenCommand(state, { payload: { tokenId: "token-nobody-holds" as never } }),
          transitionContext(),
        ),
      ),
    ).toBe("ILLEGAL_ACTION");
  });

  it("Given an unsupported use, When a token is spent, Then the command is rejected", () => {
    const state = handState();

    expect(
      rejection(
        spendToken(
          state,
          spendTokenCommand(state, { payload: { use: "buy-a-promotion" } }),
          transitionContext(),
        ),
      ),
    ).toBe("ILLEGAL_ACTION");
  });

  it.each([0, -1, 1.5])(
    "Given a quantity of %s, When a token is spent, Then the command is rejected as invalid",
    (quantity) => {
      const state = handState();

      expect(
        rejection(
          spendToken(state, spendTokenCommand(state, { payload: { quantity } }), transitionContext()),
        ),
      ).toBe("INVALID_COMMAND");
    },
  );

  it("Given a game that is not running, When a token is spent, Then the command is rejected", () => {
    const state: GameState = { ...handState(), status: "ended" };

    expect(rejection(spendToken(state, spendTokenCommand(state), transitionContext()))).toBe(
      "GAME_NOT_ACTIVE",
    );
  });

  it("Given a turn past the roll, When a token is spent, Then the phase rejects it", () => {
    const base = handState();
    const state: GameState = { ...base, turn: { ...base.turn, phase: "tile-resolution" } };

    expect(rejection(spendToken(state, spendTokenCommand(state), transitionContext()))).toBe(
      "INVALID_PHASE",
    );
  });

  it("Given an eliminated actor, When they spend a token, Then it is refused even though the turn pointer is on them", () => {
    const base = handState();
    const state: GameState = { ...base, eliminatedPlayerIds: [fixtureIds.owner] };

    expect(rejection(spendToken(state, spendTokenCommand(state), transitionContext()))).toBe(
      "ILLEGAL_ACTION",
    );
    expect(spendableTokens(state, fixtureIds.owner)).toEqual([]);
  });

  it("Given the same spend applied twice to the same state, Then the result is identical and JSON round-trips", () => {
    const state = handState();
    const command = spendTokenCommand(state);

    const first = accept(spendToken(state, command, transitionContext()));
    const second = accept(spendToken(state, command, transitionContext()));

    expect(stableStringify(second.state)).toBe(stableStringify(first.state));
    expect(stableStringify(second.events)).toBe(stableStringify(first.events));
    expect(deserializeGameState(serializeGameState(first.state))).toEqual(first.state);
  });

  it("Given a table, When spendable tokens are enumerated, Then only the active player's own move tokens are offered", () => {
    const state = handState({ ownerMoveTokens: 5 });

    expect(spendableTokens(state, fixtureIds.owner)).toEqual([
      { tokenId: tokenIds.ownerMove, use: "extra-movement", maxQuantity: 2 },
    ]);
    expect(spendableTokens(state, fixtureIds.hiddenOpponent)).toEqual([]);
    expect(
      spendableTokens(withRules(state, { agency: { diceAdjustEnabled: false } }), fixtureIds.owner),
    ).toEqual([]);

    const capped = accept(
      spendToken(
        state,
        spendTokenCommand(state, { payload: { quantity: 2 } }),
        transitionContext(),
      ),
    ).state;
    expect(spendableTokens(capped, fixtureIds.owner)).toEqual([]);
  });
});
