import { describe, expect, it } from "vitest";

import { applyCommand, enumerateLegalActions } from "../src";
import type {
  CommandId,
  DecisionPointId,
  FrameId,
  GameEvent,
  GameState,
  PlayerState,
  PromptOptionId,
  ResourceId,
  ResourceState,
} from "../src";
import {
  accepted,
  boardIndexOfKind,
  context,
  rollCommand,
  rollState,
} from "./turn-loop-fixtures";
import { fixtureIds } from "./fixtures";

const brand = <Id extends string>(value: string) => value as Id;

/**
 * The burnout rule under test: *"If Energy = 0 → skip your turn, Energy
 * automatically refills to full"* (docs/DEADLINE_DASH_How_to_Play_EN.html), the
 * same rule the workbook writes on all 14 Work tiles as "if energy decrease to
 * zero, skip 1 turn to refill energy to full" and the GDD puts in turn phase 1.
 *
 * Every case here drives it through `applyCommand`, because the rule is about
 * *whose turn is next* — nothing about it is observable from a single player's
 * record.
 */
const ENERGY_MAXIMUM = 5;

function energy(
  ownerId: string,
  value: number,
  maximum: number | null = ENERGY_MAXIMUM,
): ResourceState {
  return {
    id: brand<ResourceId>(`${ownerId}:resource:energy`),
    kind: "resource.energy",
    value,
    minimum: 0,
    maximum,
  };
}

type SeatOverrides = {
  readonly energy?: ResourceState;
  readonly skipTurns?: number;
};

/**
 * A two-seat table, so "the other player rolls and the exhausted one is passed
 * over" is legible in one transition instead of three. The canonical fixture's
 * third seat carries an unrelated `skipTurns: 1` that would otherwise absorb the
 * pass under test.
 *
 * Both seats get money because salary resolution requires it before a player can
 * roll at all; only the seats asked for get an energy resource, which is exactly
 * how the canonical fixture leaves every other test unaffected by this rule.
 */
function twoSeatState(
  ownerPosition: number,
  owner: SeatOverrides = {},
  opponent: SeatOverrides = {},
): GameState {
  const state = rollState(ownerPosition);
  const ownerPlayer = state.players[fixtureIds.owner];
  const opponentPlayer = state.players[fixtureIds.revealedOpponent];
  if (ownerPlayer === undefined || opponentPlayer === undefined) {
    throw new Error("fixture missing players");
  }

  const seat = (player: PlayerState, overrides: SeatOverrides): PlayerState => ({
    ...player,
    statuses: [],
    skipTurns: overrides.skipTurns ?? 0,
    resources: {
      money: { ...ownerPlayer.resources.money, value: 1000 },
      ...(overrides.energy === undefined ? {} : { energy: overrides.energy }),
    },
  });

  return {
    ...state,
    playerOrder: [fixtureIds.owner, fixtureIds.revealedOpponent],
    players: {
      ...state.players,
      [fixtureIds.owner]: seat(ownerPlayer, owner),
      [fixtureIds.revealedOpponent]: {
        ...seat(opponentPlayer, opponent),
        position: 13,
      },
    },
  };
}

/** Hands the turn to `playerId` without replaying the rest of the table. */
function activate(state: GameState, playerId: string): GameState {
  return {
    ...state,
    turn: {
      ...state.turn,
      activePlayerId: brand<GameState["playerOrder"][number]>(playerId),
      phase: "pre-roll",
    },
  };
}

function ownerEnergy(state: GameState): number | undefined {
  return state.players[fixtureIds.owner]?.resources.energy?.value;
}

function recoveries(events: readonly GameEvent[]) {
  return events.filter(
    (event) => event.type === "ResourceChanged" && event.payload.reason === "burnout-recovery",
  );
}

function diceCursor(state: GameState): number | undefined {
  return state.rng.streams.dice?.cursor;
}

function withDiceStreamState(state: GameState, value: string): GameState {
  const dice = state.rng.streams.dice;
  if (dice === undefined) throw new Error("fixture missing a dice stream");

  return {
    ...state,
    rng: { streams: { ...state.rng.streams, dice: { ...dice, state: value } } },
  };
}

/**
 * The first variant of `base` whose Work landing really does leave the player on
 * zero energy.
 *
 * A Work tile spends the energy *and* draws a Work card, and one authored card
 * (`card.work.free-coffee`) restores energy to maximum — so the landing does not
 * always end in exhaustion. Which card is drawn is steered by the canonical
 * dice-stream state (the tile-effect RNG is seeded from server-owned state, see
 * ephemeral-random.ts), so searching that is how this test aims at a real
 * exhausting landing without pinning anything a client could choose.
 */
function stateWhereWorkLandingExhausts(base: GameState): GameState {
  for (let candidate = 1; candidate <= 200; candidate += 1) {
    const attempt = withDiceStreamState(base, String(candidate));
    const result = applyCommand(attempt, rollCommand(attempt), context([0]));
    if (!result.ok) continue;
    if (ownerEnergy(result.value.state) === 0) return attempt;
  }

  throw new Error("no dice-stream state produced an exhausting work landing");
}

describe("energy exhaustion (burnout)", () => {
  it("Given a player with one energy left, When they land on a Work tile and the table plays on, Then the Work landing empties their energy and costs them their next turn, which refills it", () => {
    const workIndex = boardIndexOfKind("work");
    const base = twoSeatState(workIndex - 1, {
      energy: energy(fixtureIds.owner, 1),
    });
    const state = stateWhereWorkLandingExhausts(base);

    // The exhausting turn itself is not interrupted: the player finishes it and
    // the turn passes on normally.
    const exhausting = accepted(applyCommand(state, rollCommand(state), context([0])));
    expect(exhausting.state.players[fixtureIds.owner]?.position).toBe(workIndex);
    expect(ownerEnergy(exhausting.state)).toBe(0);
    expect(exhausting.state.turn.activePlayerId).toBe(fixtureIds.revealedOpponent);
    expect(recoveries(exhausting.events)).toEqual([]);
    // Nothing here may be paid for out of the persisted dice stream but the die.
    expect(diceCursor(exhausting.state)).toBe(1);

    const opponentTurn = accepted(
      applyCommand(
        exhausting.state,
        rollCommand(exhausting.state, {
          commandId: brand<CommandId>("roll-opponent"),
          actorId: fixtureIds.revealedOpponent,
          expectedRevision: exhausting.state.revision,
        }),
        context([0]),
      ),
    );

    // The exhausted player's turn is forfeited — the roller keeps the turn —
    // and their energy comes back with it.
    expect(opponentTurn.state.turn.activePlayerId).toBe(fixtureIds.revealedOpponent);
    expect(opponentTurn.state.turn.number).toBe(exhausting.state.turn.number + 1);
    expect(ownerEnergy(opponentTurn.state)).toBe(ENERGY_MAXIMUM);
    expect(recoveries(opponentTurn.events)).toHaveLength(1);
    expect(recoveries(opponentTurn.events)[0]?.payload).toMatchObject({
      playerId: fixtureIds.owner,
      previousValue: 0,
      newValue: ENERGY_MAXIMUM,
      reason: "burnout-recovery",
    });
    // The refill is bookkeeping, not a roll: exactly one die came off the
    // persisted stream during that whole transition.
    expect(diceCursor(opponentTurn.state)).toBe(2);
  });

  it("Given an exhausted player, When the turn reaches them, Then the reported refill is the value canonical state actually holds and it is announced before the next turn starts", () => {
    const state = activate(
      twoSeatState(3, { energy: energy(fixtureIds.owner, 0) }),
      fixtureIds.revealedOpponent,
    );

    const { state: nextState, events } = accepted(
      applyCommand(
        state,
        rollCommand(state, { actorId: fixtureIds.revealedOpponent }),
        context([0]),
      ),
    );

    const refill = recoveries(events)[0];
    if (refill === undefined || refill.type !== "ResourceChanged") {
      throw new Error("expected a burnout-recovery event");
    }
    const resource = nextState.players[fixtureIds.owner]?.resources.energy;
    expect(refill.payload.resourceId).toBe(resource?.id);
    expect(refill.payload.newValue).toBe(resource?.value);
    // A client that replays events must never see the turn open before the
    // refill that made it possible.
    const refillIndex = events.indexOf(refill);
    const turnIndex = events.findIndex((event) => event.type === "TurnStarted");
    expect(refillIndex).toBeGreaterThanOrEqual(0);
    expect(refillIndex).toBeLessThan(turnIndex);
  });

  it("Given an exhausted player who has just been refilled, When the turn comes round again, Then they take it and are not skipped twice", () => {
    const state = activate(
      twoSeatState(3, { energy: energy(fixtureIds.owner, 0) }),
      fixtureIds.revealedOpponent,
    );

    const skipped = accepted(
      applyCommand(
        state,
        rollCommand(state, { actorId: fixtureIds.revealedOpponent }),
        context([0]),
      ),
    );
    expect(skipped.state.turn.activePlayerId).toBe(fixtureIds.revealedOpponent);

    const second = accepted(
      applyCommand(
        skipped.state,
        rollCommand(skipped.state, {
          commandId: brand<CommandId>("roll-opponent-2"),
          actorId: fixtureIds.revealedOpponent,
          expectedRevision: skipped.state.revision,
        }),
        context([0]),
      ),
    );

    // Exactly one turn lost, which is what "skip 1 turn" means.
    expect(second.state.turn.activePlayerId).toBe(fixtureIds.owner);
    expect(recoveries(second.events)).toEqual([]);
    expect(ownerEnergy(second.state)).toBe(ENERGY_MAXIMUM);
  });

  it("Given a player who is both serving skipped turns and exhausted, When the turn reaches them, Then the skip is served first and only the turn after it is the burnout one", () => {
    const state = activate(
      twoSeatState(3, { energy: energy(fixtureIds.owner, 0), skipTurns: 1 }),
      fixtureIds.revealedOpponent,
    );

    const first = accepted(
      applyCommand(
        state,
        rollCommand(state, { actorId: fixtureIds.revealedOpponent }),
        context([0]),
      ),
    );

    // The burnout tile's debt is being paid; the turn never starts, so the
    // burnout check has not run and nothing has been refilled.
    expect(first.state.players[fixtureIds.owner]?.skipTurns).toBe(0);
    expect(ownerEnergy(first.state)).toBe(0);
    expect(recoveries(first.events)).toEqual([]);

    const second = accepted(
      applyCommand(
        first.state,
        rollCommand(first.state, {
          commandId: brand<CommandId>("roll-opponent-2"),
          actorId: fixtureIds.revealedOpponent,
          expectedRevision: first.state.revision,
        }),
        context([0]),
      ),
    );

    expect(recoveries(second.events)).toHaveLength(1);
    expect(ownerEnergy(second.state)).toBe(ENERGY_MAXIMUM);
    expect(second.state.turn.activePlayerId).toBe(fixtureIds.revealedOpponent);
  });

  it.each([
    ["no maximum to refill to", null],
    ["a maximum of zero", 0],
  ] as const)(
    "Given an exhausted player with %s, When the turn reaches them, Then they take it rather than being skipped forever",
    (_label, maximum) => {
      const state = activate(
        twoSeatState(3, { energy: energy(fixtureIds.owner, 0, maximum) }),
        fixtureIds.revealedOpponent,
      );

      const { state: nextState, events } = accepted(
        applyCommand(
          state,
          rollCommand(state, { actorId: fixtureIds.revealedOpponent }),
          context([0]),
        ),
      );

      // A skip that cannot fix the exhaustion would recur on every pass and
      // strand this player for the rest of the match, so it must not happen.
      expect(nextState.turn.activePlayerId).toBe(fixtureIds.owner);
      expect(recoveries(events)).toEqual([]);
      expect(ownerEnergy(nextState)).toBe(0);
    },
  );

  it("Given a player with no energy resource at all, When the turn reaches them, Then they are never treated as exhausted", () => {
    const state = activate(twoSeatState(3), fixtureIds.revealedOpponent);

    const { state: nextState, events } = accepted(
      applyCommand(
        state,
        rollCommand(state, { actorId: fixtureIds.revealedOpponent }),
        context([0]),
      ),
    );

    expect(nextState.turn.activePlayerId).toBe(fixtureIds.owner);
    expect(recoveries(events)).toEqual([]);
  });

  it("Given a turn that ends by answering a prompt rather than rolling, When the next player is exhausted, Then the same check runs and no dice are drawn for it", () => {
    const base = twoSeatState(3, { energy: energy(fixtureIds.owner, 0) });
    const opponent = base.players[fixtureIds.revealedOpponent];
    if (opponent === undefined) throw new Error("fixture missing opponent");

    const promptId = brand<DecisionPointId>("prompt-audit-burnout");
    const payFine = brand<PromptOptionId>("pay-fine");
    const attemptRoll = brand<PromptOptionId>("attempt-roll");
    const state: GameState = {
      ...activate(base, fixtureIds.revealedOpponent),
      players: {
        ...base.players,
        [fixtureIds.revealedOpponent]: { ...opponent, inAudit: true },
      },
      prompts: [
        {
          id: promptId,
          frameId: brand<FrameId>("frame-audit-burnout"),
          kind: "audit-release",
          audience: [fixtureIds.revealedOpponent],
          legalResponses: [
            { id: payFine, value: null },
            { id: attemptRoll, value: null },
          ],
          deadlineAt: null,
          defaultResponse: { optionId: attemptRoll, value: null },
          visibility: "public",
          responses: {},
        },
      ],
    };

    const { state: nextState, events } = accepted(
      applyCommand(
        state,
        {
          commandId: brand<CommandId>("respond-pay-fine"),
          gameId: state.gameId,
          actorId: fixtureIds.revealedOpponent,
          expectedRevision: state.revision,
          decisionPointId: promptId,
          type: "prompt.respond" as const,
          payload: { optionId: payFine, value: null },
        },
        context([]),
      ),
    );

    expect(recoveries(events)).toHaveLength(1);
    expect(ownerEnergy(nextState)).toBe(ENERGY_MAXIMUM);
    expect(nextState.turn.activePlayerId).toBe(fixtureIds.revealedOpponent);
    // Answering a prompt never touches the persisted dice stream, and neither
    // does the refill.
    expect(diceCursor(nextState)).toBe(diceCursor(state));
  });

  it("Given an exhausted player who is also confined by an audit, When their turn is skipped, Then the prompt survives and is theirs to answer on the turn after", () => {
    const base = twoSeatState(3, { energy: energy(fixtureIds.owner, 0) });
    const owner = base.players[fixtureIds.owner];
    if (owner === undefined) throw new Error("fixture missing owner");

    const promptId = brand<DecisionPointId>("prompt-audit-confined");
    const payFine = brand<PromptOptionId>("pay-fine");
    const attemptRoll = brand<PromptOptionId>("attempt-roll");
    const state: GameState = {
      ...activate(base, fixtureIds.revealedOpponent),
      players: {
        ...base.players,
        [fixtureIds.owner]: { ...owner, inAudit: true },
      },
      prompts: [
        {
          id: promptId,
          frameId: brand<FrameId>("frame-audit-confined"),
          kind: "audit-release",
          audience: [fixtureIds.owner],
          legalResponses: [
            { id: payFine, value: null },
            { id: attemptRoll, value: null },
          ],
          deadlineAt: null,
          defaultResponse: { optionId: attemptRoll, value: null },
          visibility: "public",
          responses: {},
        },
      ],
    };

    const skipped = accepted(
      applyCommand(
        state,
        rollCommand(state, { actorId: fixtureIds.revealedOpponent }),
        context([0]),
      ),
    );
    expect(skipped.state.turn.activePlayerId).toBe(fixtureIds.revealedOpponent);
    expect(skipped.state.prompts).toHaveLength(1);

    const returned = accepted(
      applyCommand(
        skipped.state,
        rollCommand(skipped.state, {
          commandId: brand<CommandId>("roll-opponent-2"),
          actorId: fixtureIds.revealedOpponent,
          expectedRevision: skipped.state.revision,
        }),
        context([0]),
      ),
    );

    // Burnout must not be able to strand a confined player: they come back with
    // the same question still on the table and an action that can answer it.
    expect(returned.state.turn.activePlayerId).toBe(fixtureIds.owner);
    expect(returned.state.prompts).toHaveLength(1);
    expect(
      enumerateLegalActions(returned.state, fixtureIds.owner).map((action) => action.type),
    ).toEqual(["prompt.respond"]);
  });

  it("Given the exhausted player is the only seat at the table, When they end their turn, Then canonical state carries the refill the event announced", () => {
    const base = twoSeatState(3, { energy: energy(fixtureIds.owner, 0) });
    const state: GameState = { ...base, playerOrder: [fixtureIds.owner] };

    const { state: nextState, events } = accepted(
      applyCommand(state, rollCommand(state), context([0])),
    );

    // The walk wraps round to the actor themselves here, which is the one case
    // where the caller's own rebuilt player record could silently drop the
    // refill and leave state disagreeing with the event stream.
    expect(recoveries(events)).toHaveLength(1);
    expect(ownerEnergy(nextState)).toBe(ENERGY_MAXIMUM);
    expect(nextState.turn.activePlayerId).toBe(fixtureIds.owner);
  });
});
