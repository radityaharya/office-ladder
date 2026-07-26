import { describe, expect, it } from "vitest";

import type { AdjustRollCommand, GameState, PlayerState } from "../src";
import {
  AGENCY_STATUS_IDS,
  adjustRoll,
  applyRollAgency,
  pendingRollAdjustment,
  setStatus,
} from "../src/execution/agency";
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

function adjustCommand(
  state: GameState,
  pips: number,
  overrides: Partial<AdjustRollCommand> = {},
): AdjustRollCommand {
  return {
    ...commandBase(state, `adjust-${pips}`),
    type: "turn.adjust-roll",
    payload: { pips },
    ...overrides,
  };
}

function owner(state: GameState): PlayerState {
  const player = state.players[agencyIds.owner];
  if (player === undefined) throw new Error("fixture missing owner");

  return player;
}

describe("turn.adjust-roll", () => {
  it("Given an active player with energy, When they buy two pips, Then energy is charged and the adjustment is held for the next roll", () => {
    const state = agencyState({ owner: { energy: 5 } });

    const { state: next, events } = accepted(
      adjustRoll(state, adjustCommand(state, 2), agencyContext()),
    );

    expect(resourceValue(next, agencyIds.owner, "energy")).toBe(3);
    expect(pendingRollAdjustment(owner(next))).toBe(2);
    expect(next.revision).toBe(state.revision + 1);
    // Adjusting is a decision *inside* a turn: it must not hand the turn on.
    expect(next.turn).toEqual(state.turn);
    expect(events.map((event) => event.type)).toEqual([
      "ResourceChanged",
      "EffectProposed",
    ]);
    expectRoundTrips(next);
  });

  it("Given a negative adjustment, When it is bought, Then the pending shift is negative — landing short is a legal thing to want", () => {
    const state = agencyState({ owner: { energy: 5 } });

    const { state: next } = accepted(
      adjustRoll(state, adjustCommand(state, -2), agencyContext()),
    );

    expect(pendingRollAdjustment(owner(next))).toBe(-2);
    expect(resourceValue(next, agencyIds.owner, "energy")).toBe(3);
  });

  it("Given a pip already bought, When a second takes the total past maxPipAdjust, Then it is rejected and nothing is charged", () => {
    const state = agencyState({ owner: { energy: 5 }, rules: { agency: { maxPipAdjust: 2 } } });
    const { state: afterFirst } = accepted(
      adjustRoll(state, adjustCommand(state, 2), agencyContext()),
    );

    const result = adjustRoll(
      afterFirst,
      adjustCommand(afterFirst, 1, { commandId: "adjust-again" as AdjustRollCommand["commandId"] }),
      agencyContext(),
    );

    rejected(result, "ILLEGAL_ACTION");
    expect(resourceValue(afterFirst, agencyIds.owner, "energy")).toBe(3);
  });

  it("Given two purchases inside the cap, When both are applied, Then the pending shift accumulates", () => {
    const state = agencyState({ owner: { energy: 5 }, rules: { agency: { maxPipAdjust: 2 } } });
    const first = accepted(adjustRoll(state, adjustCommand(state, 1), agencyContext())).state;

    const second = accepted(
      adjustRoll(
        first,
        adjustCommand(first, 1, { commandId: "adjust-second" as AdjustRollCommand["commandId"] }),
        agencyContext(),
      ),
    ).state;

    expect(pendingRollAdjustment(owner(second))).toBe(2);
    expect(resourceValue(second, agencyIds.owner, "energy")).toBe(3);
  });

  it("Given a mode with dice adjustment switched off, When a pip is bought, Then it is rejected", () => {
    const state = agencyState({ rules: { agency: { diceAdjustEnabled: false } } });

    rejected(adjustRoll(state, adjustCommand(state, 1), agencyContext()), "ILLEGAL_ACTION");
  });

  it("Given a mode with a zero pip cap, When a pip is bought, Then it is rejected even with dice adjustment nominally on", () => {
    const state = agencyState({
      rules: { agency: { diceAdjustEnabled: true, maxPipAdjust: 0 } },
    });

    rejected(adjustRoll(state, adjustCommand(state, 1), agencyContext()), "ILLEGAL_ACTION");
  });

  it("Given a player who is not the active one, When they try to adjust the roll, Then it is rejected as not their turn", () => {
    const state = agencyState();
    const command = adjustCommand(state, 1, { actorId: agencyIds.hiddenOpponent });

    rejected(adjustRoll(state, command, agencyContext()), "NOT_ACTOR_TURN");
  });

  it("Given a command from somebody who is not in the game at all, When it is applied, Then the actor is refused", () => {
    const state = agencyState();
    const command = adjustCommand(state, 1, {
      actorId: "player-not-seated" as AdjustRollCommand["actorId"],
    });

    rejected(adjustRoll(state, command, agencyContext()), "ACTOR_NOT_FOUND");
  });

  it("Given a player with one energy, When they try to buy two pips, Then it is refused for insufficient energy", () => {
    const state = agencyState({ owner: { energy: 1 } });

    rejected(adjustRoll(state, adjustCommand(state, 2), agencyContext()), "INSUFFICIENT_RESOURCE");
  });

  it.each([0, 1.5, Number.NaN])(
    "Given a nonsense pip count (%s), When it is submitted, Then the command is refused",
    (pips) => {
      const state = agencyState();

      rejected(adjustRoll(state, adjustCommand(state, pips), agencyContext()), "INVALID_COMMAND");
    },
  );

  it("Given the turn is not in pre-roll, When a pip is bought, Then the phase refuses it", () => {
    const base = agencyState();
    const state: GameState = { ...base, turn: { ...base.turn, phase: "prompt" } };

    rejected(adjustRoll(state, adjustCommand(state, 1), agencyContext()), "INVALID_PHASE");
  });

  it("Given a finished match, When a pip is bought, Then the command is refused", () => {
    const base = agencyState();
    const state: GameState = {
      ...base,
      status: "ended",
      outcome: {
        reason: "director-reached",
        winnerPlayerIds: [agencyIds.hiddenOpponent],
        winningRole: null,
        endedAt: "2026-07-18T12:00:00.000Z",
        scores: [],
        winPath: "promotion",
        data: {},
      },
    };

    rejected(adjustRoll(state, adjustCommand(state, 1), agencyContext()), "GAME_ALREADY_ENDED");
  });
});

describe("applyRollAgency — the roll-turn seam", () => {
  it("Given a pending adjustment, When the roll resolves, Then the die is shifted and the adjustment is spent", () => {
    const state = agencyState({ owner: { energy: 5 } });
    const bought = accepted(adjustRoll(state, adjustCommand(state, 2), agencyContext())).state;

    const outcome = applyRollAgency(owner(bought), 3, () => {
      throw new Error("no reroll was bought");
    });

    expect(outcome.die).toBe(5);
    expect(outcome.rawDie).toBe(3);
    expect(outcome.adjustment).toBe(2);
    expect(pendingRollAdjustment(outcome.player)).toBe(0);
  });

  it("Given a downward adjustment larger than the die, When the roll resolves, Then it clamps at one space rather than standing still", () => {
    const player = setStatus(owner(agencyState()), AGENCY_STATUS_IDS.rollAdjustment, {
      pips: -5,
    });

    const outcome = applyRollAgency(player, 2, () => {
      throw new Error("no reroll was bought");
    });

    expect(outcome.die).toBe(1);
    expect(outcome.adjustment).toBe(-1);
  });

  it("Given a spent reroll, When the roll resolves, Then the better of the two faces stands and the reroll is consumed", () => {
    const player = setStatus(owner(agencyState()), AGENCY_STATUS_IDS.rollReroll, {
      keep: "higher",
    });

    const outcome = applyRollAgency(player, 2, () => 6);

    expect(outcome.die).toBe(6);
    expect(outcome.rerolledFace).toBe(6);
    expect(
      outcome.player.statuses.some((status) => status.id === AGENCY_STATUS_IDS.rollReroll),
    ).toBe(false);
  });

  it("Given no agency at all, When the roll resolves, Then the die is untouched and no second face is drawn", () => {
    let rerolls = 0;
    const outcome = applyRollAgency(owner(agencyState()), 4, () => {
      rerolls += 1;

      return 6;
    });

    expect(outcome).toMatchObject({ die: 4, rawDie: 4, adjustment: 0, rerolledFace: null });
    expect(rerolls).toBe(0);
  });
});
