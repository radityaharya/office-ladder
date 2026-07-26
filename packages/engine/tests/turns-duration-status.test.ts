import { describe, expect, it } from "vitest";

import { applyCommand } from "../src";
import type { CommandId, GameEvent, GameState, PlayerState, StatusId } from "../src";
import {
  accepted,
  boardIndexOfKind,
  context,
  rollCommand,
  rollState,
} from "./turn-loop-fixtures";
import { fixtureIds } from "./fixtures";

const brand = <Id extends string>(value: string) => value as Id;

const BURNOUT_STATUS = "status.burnout-tile";
const BURNOUT_INDEX = boardIndexOfKind("burnout");

function burnoutStatus(remainingTurns: number, movementPenalty = 1) {
  return {
    id: brand<StatusId>(BURNOUT_STATUS),
    sourceId: null,
    stacks: 1,
    remainingTurns,
    expiresAtRound: null,
    visibility: "private" as const,
    data: { movementPenalty },
  };
}

/**
 * The canonical fixture hands the owner two unrelated statuses; every test here
 * starts from an explicit status list so the turns-based one under test is the
 * only thing in play.
 */
function stateWithOwnerStatuses(
  position: number,
  statuses: PlayerState["statuses"],
): GameState {
  const state = rollState(position);
  const owner = state.players[fixtureIds.owner];
  if (owner === undefined) throw new Error("fixture missing owner player");

  return {
    ...state,
    players: { ...state.players, [fixtureIds.owner]: { ...owner, statuses } },
  };
}

/** Gives the owner another pre-roll turn without replaying the rest of the table. */
function handTurnBackToOwner(state: GameState): GameState {
  return {
    ...state,
    turn: { ...state.turn, activePlayerId: fixtureIds.owner, phase: "pre-roll" },
  };
}

function ownerStatus(state: GameState) {
  return (
    state.players[fixtureIds.owner]?.statuses.find((status) => status.id === BURNOUT_STATUS) ?? null
  );
}

function ownerPosition(state: GameState): number {
  const position = state.players[fixtureIds.owner]?.position;
  if (position === undefined) throw new Error("fixture missing owner player");
  return position;
}

function money(state: GameState): number {
  const value = state.players[fixtureIds.owner]?.resources.money.value;
  if (value === undefined) throw new Error("fixture missing owner money");
  return value;
}

function salaryMultiplierStatus(multiplier: number) {
  return {
    id: brand<StatusId>("status.next-salary-multiplier"),
    sourceId: null,
    stacks: 1,
    remainingTurns: null,
    expiresAtRound: null,
    visibility: "private" as const,
    data: { multiplier },
  };
}

describe("turns-duration statuses", () => {
  it("Given a player one space from the burnout tile, When they land on it, Then they hold the authored two-turn burnout status alongside the skipped turns", () => {
    const state = stateWithOwnerStatuses(BURNOUT_INDEX - 1, []);

    // die = 1 lands on tile.board.43.burnout
    const { state: nextState } = accepted(applyCommand(state, rollCommand(state), context([0])));

    expect(nextState.players[fixtureIds.owner]?.skipTurns).toBe(2);
    expect(ownerStatus(nextState)).toMatchObject({
      id: BURNOUT_STATUS,
      remainingTurns: 2,
      data: { movementPenalty: 1 },
    });
    // The status was applied during this turn's tile resolution, so this turn's
    // own upkeep must not have already spent one of its two turns.
    expect(ownerStatus(nextState)?.remainingTurns).toBe(2);
    // Neither the upkeep tick nor the tile effects touched the persisted stream.
    expect(nextState.rng.streams.dice?.cursor).toBe(1);
  });

  it("Given a two-turn burnout status, When the holder takes three turns, Then movement is one space short on exactly the first two and the status is then gone", () => {
    const first = stateWithOwnerStatuses(13, [burnoutStatus(2)]);

    // die = 3 every turn; the penalty makes that 2 spaces while burnout lasts.
    const firstTurn = accepted(applyCommand(first, rollCommand(first), context([0.4])));
    expect(ownerPosition(firstTurn.state)).toBe(15);
    expect(ownerStatus(firstTurn.state)?.remainingTurns).toBe(1);
    expect(firstTurn.state.rng.streams.dice?.cursor).toBe(1);

    const second = handTurnBackToOwner(firstTurn.state);
    const secondTurn = accepted(
      applyCommand(second, rollCommand(second, { commandId: brand<CommandId>("roll-2") }), context([0.4])),
    );
    expect(ownerPosition(secondTurn.state)).toBe(17);
    // Exactly two turns of effect: the second tick expires it.
    expect(ownerStatus(secondTurn.state)).toBeNull();
    expect(secondTurn.state.players[fixtureIds.owner]?.statuses).toEqual([]);

    const third = handTurnBackToOwner(secondTurn.state);
    const thirdTurn = accepted(
      applyCommand(third, rollCommand(third, { commandId: brand<CommandId>("roll-3") }), context([0.4])),
    );
    // Full die again, and the dice stream advanced exactly once per roll — the
    // upkeep tick and the penalty consume no randomness at all.
    expect(ownerPosition(thirdTurn.state)).toBe(20);
    expect(thirdTurn.state.rng.streams.dice?.cursor).toBe(3);
  });

  it("Given a penalty larger than the die, When the player rolls, Then they still move one space rather than standing still", () => {
    const state = stateWithOwnerStatuses(30, [burnoutStatus(1, 5)]);

    const { state: nextState, events } = accepted(
      applyCommand(state, rollCommand(state), context([0])),
    );

    // die = 1, penalty = 5: an unclamped `die - penalty` would be -4, and a
    // clamp at zero would re-resolve tile 30 the player is already on.
    expect(ownerPosition(nextState)).toBe(31);
    const moved = events.find((event) => event.type === "PlayerMoved");
    expect(moved?.payload).toMatchObject({ from: 30, to: 31, distance: 1 });
    const rolled = events.find((event) => event.type === "DiceRolled");
    expect(rolled?.payload).toMatchObject({ dice: [1], total: 1 });
    expect(ownerStatus(nextState)).toBeNull();
  });

  /**
   * Deliberately chosen so the raw die and the spaces actually traversed differ:
   * with die == spaces (as happens whenever the penalty clamps to one space)
   * this assertion cannot tell `distance: die` from `distance: spaces`.
   */
  it("Given a penalty smaller than the die, When the player rolls, Then PlayerMoved reports the spaces traversed while DiceRolled reports the raw face", () => {
    const state = stateWithOwnerStatuses(21, [burnoutStatus(1, 2)]);

    const { state: nextState, events } = accepted(
      applyCommand(state, rollCommand(state), context([0.9])),
    );

    // die = 6, penalty = 2, so four spaces: 21 -> 25.
    expect(ownerPosition(nextState)).toBe(25);
    const moved = events.find((event) => event.type === "PlayerMoved");
    expect(moved?.payload).toMatchObject({ from: 21, to: 25, distance: 4, lapsGained: 0 });
    const rolled = events.find((event) => event.type === "DiceRolled");
    expect(rolled?.payload).toMatchObject({ dice: [6], total: 6 });
  });

  it.each([
    ["zero", 0],
    ["negative", -3],
  ] as const)(
    "Given a %s movementPenalty, When the player rolls, Then the die is used unmodified",
    (_label, movementPenalty) => {
      const state = stateWithOwnerStatuses(21, [burnoutStatus(1, movementPenalty)]);

      const { state: nextState, events } = accepted(
        applyCommand(state, rollCommand(state), context([0.9])),
      );

      // A negative penalty must never be read as a movement *bonus*.
      expect(ownerPosition(nextState)).toBe(27);
      expect(events.find((event) => event.type === "PlayerMoved")?.payload).toMatchObject({
        distance: 6,
      });
    },
  );

  it("Given a fractional movementPenalty, When the player rolls, Then it is floored to whole spaces", () => {
    const state = stateWithOwnerStatuses(21, [burnoutStatus(1, 1.8)]);

    const { state: nextState } = accepted(
      applyCommand(state, rollCommand(state), context([0.9])),
    );

    // floor(1.8) = 1, so five spaces, not four and not a fractional position.
    expect(ownerPosition(nextState)).toBe(26);
  });

  it("Given a non-numeric movementPenalty, When the player rolls, Then the malformed value is ignored rather than corrupting movement", () => {
    const state = stateWithOwnerStatuses(21, [
      { ...burnoutStatus(1), data: { movementPenalty: "two" } },
    ]);

    const { state: nextState } = accepted(
      applyCommand(state, rollCommand(state), context([0.9])),
    );

    expect(ownerPosition(nextState)).toBe(27);
    expect(Number.isInteger(ownerPosition(nextState))).toBe(true);
  });

  it("Given a burnout status on one player, When a different player takes their turn, Then the holder's remaining turns are untouched", () => {
    const base = stateWithOwnerStatuses(13, [burnoutStatus(2)]);
    const other = base.players[fixtureIds.revealedOpponent];
    const owner = base.players[fixtureIds.owner];
    if (other === undefined || owner === undefined) throw new Error("fixture missing players");
    const state: GameState = {
      ...base,
      players: {
        ...base.players,
        // The canonical fixture gives this player no resources; salary
        // resolution needs money to exist before they can roll at all.
        [fixtureIds.revealedOpponent]: {
          ...other,
          statuses: [],
          resources: { money: { ...owner.resources.money, value: 100 } },
        },
      },
      turn: { ...base.turn, activePlayerId: fixtureIds.revealedOpponent },
    };

    const { state: nextState } = accepted(
      applyCommand(
        state,
        rollCommand(state, { actorId: fixtureIds.revealedOpponent }),
        context([0]),
      ),
    );

    expect(ownerStatus(nextState)?.remainingTurns).toBe(2);
    expect(ownerPosition(nextState)).toBe(13);
  });

  it("Given a uses-duration status, When the holder takes a turn without triggering it, Then neither the turn upkeep nor the unpaid salary consumes it", () => {
    const state = stateWithOwnerStatuses(13, [salaryMultiplierStatus(2)]);
    const moneyBefore = money(state);

    const { state: nextState, events } = accepted(
      applyCommand(state, rollCommand(state), context([0])),
    );

    // 13 -> 14 crosses no receptionist, so no salary was awarded...
    expect(events.some((event) => event.type === "SalaryAwarded")).toBe(false);
    expect(money(nextState)).toBe(moneyBefore);
    // ...and a status promising to multiply the *next* award must therefore
    // still be held: `tickStatusTurns` must skip uses-duration statuses, and the
    // multiplier must not be looked up (and so consumed) on a zero salary.
    expect(nextState.players[fixtureIds.owner]?.statuses).toEqual([
      expect.objectContaining({ id: "status.next-salary-multiplier", remainingTurns: null }),
    ]);
  });

  it("Given a multiplier held across a salary-less turn, When the holder later passes the receptionist, Then the award is still doubled and only then is the status spent", () => {
    const state = stateWithOwnerStatuses(41, [salaryMultiplierStatus(2)]);

    // 41 -> 42: no receptionist crossed, so the status must survive untouched.
    const dry = accepted(applyCommand(state, rollCommand(state), context([0])));
    expect(dry.state.players[fixtureIds.owner]?.statuses).toHaveLength(1);

    // 42 -> 1 (die = 3) crosses the receptionist and pays out.
    const handedBack = handTurnBackToOwner(dry.state);
    const paid = accepted(
      applyCommand(
        handedBack,
        rollCommand(handedBack, { commandId: brand<CommandId>("roll-pass") }),
        context([0.4]),
      ),
    );

    // The undoubled baseline: the exact same *two* turns, with the status list
    // as the only difference.
    //
    // It has to replay the dry turn rather than start parked on 42, because 42
    // is a Work tile — it draws a card, and a drawn card moves money. Starting
    // the control on 42 skips that draw, so the two arms would differ by the
    // card as well as by the multiplier, and the money delta below would be
    // measuring both. That is exactly what happened when the card pack grew and
    // the drawn card stopped being money-neutral: the assertion broke without
    // anything about salary multipliers changing. Replaying the turn also keeps
    // the two arms on the same revision and event sequence, which is what the
    // tile-effect random source is seeded from, so both draw the same card.
    const control = stateWithOwnerStatuses(41, []);
    const controlDry = accepted(applyCommand(control, rollCommand(control), context([0])));
    const controlHandedBack = handTurnBackToOwner(controlDry.state);
    const baseline = accepted(
      applyCommand(
        controlHandedBack,
        rollCommand(controlHandedBack, { commandId: brand<CommandId>("roll-pass") }),
        context([0.4]),
      ),
    );

    const awarded = (events: readonly GameEvent[]): number => {
      const event = events.find((candidate) => candidate.type === "SalaryAwarded");
      if (event === undefined || event.type !== "SalaryAwarded") {
        throw new Error("expected a SalaryAwarded event");
      }
      return event.payload.amount;
    };
    const salaryCredit = (events: readonly GameEvent[]): number => {
      const event = events.find(
        (candidate) => candidate.type === "ResourceChanged" && candidate.payload.reason === "salary",
      );
      if (event === undefined || event.type !== "ResourceChanged") {
        throw new Error("expected a salary ResourceChanged event");
      }
      return event.payload.newValue - event.payload.previousValue;
    };

    // rank.staff pays 400 plus its 100 receptionist-pass bonus.
    expect(awarded(baseline.events)).toBe(500);
    expect(salaryCredit(baseline.events)).toBe(500);
    // The multiplier must be visible in the event stream, not only in canonical
    // state: a client that sums SalaryAwarded would otherwise disagree with the
    // authoritative money value.
    expect(awarded(paid.events)).toBe(1000);
    expect(salaryCredit(paid.events)).toBe(1000);
    expect(money(paid.state) - money(baseline.state)).toBe(500);
    // Spent exactly once, on the turn that actually paid.
    expect(paid.state.players[fixtureIds.owner]?.statuses).toEqual([]);
  });
});
