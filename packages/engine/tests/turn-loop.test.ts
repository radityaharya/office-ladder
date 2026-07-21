import { describe, expect, it } from "vitest";

import { applyCommand } from "../src";
import { fixtureIds } from "./fixtures";
import {
  accepted,
  context,
  logicalTimestamp,
  rollCommand,
  rollState,
  startCommand,
  startState,
} from "./turn-loop-fixtures";

describe("turn command execution", () => {
  it("Given a setup game, when the owner starts it, then setup becomes active with contiguous start events", () => {
    const state = startState();
    const command = startCommand(state);

    const transition = accepted(applyCommand(state, command, context([])));

    expect(transition.state.status).toBe("active");
    expect(transition.state.revision).toBe(state.revision + 1);
    expect(transition.state.eventSequence).toBe(state.eventSequence + 2);
    expect(transition.state.turn).toMatchObject({
      number: 1,
      round: 1,
      activePlayerId: fixtureIds.owner,
      phase: "pre-roll",
      startedAt: logicalTimestamp,
    });
    expect(transition.events.map((event) => event.type)).toEqual([
      "GameStarted",
      "TurnStarted",
    ]);
    expect(transition.events.map((event) => event.sequence)).toEqual([30, 31]);
    expect(transition.events.every((event) => event.revision === state.revision + 1)).toBe(true);
    expect(transition.events.every((event) => event.causationCommandId === command.commandId)).toBe(true);
    expect(transition.events[0]?.logicalTimestamp).toBe(logicalTimestamp);
    expect(transition.state.playerOrder).not.toBe(state.playerOrder);
    expect(transition.events[0]?.payload).toMatchObject({
      playerOrder: state.playerOrder,
    });
    if (transition.events[0]?.type === "GameStarted") {
      expect(transition.events[0].payload.playerOrder).not.toBe(state.playerOrder);
    }
  });

  it("Given a pre-roll turn, when the owner rolls, then persisted dice drive movement and the next round", () => {
    const state = rollState(3);
    const command = rollCommand(state);

    const transition = accepted(applyCommand(state, command, context([0])));

    expect(transition.events.map((event) => event.type)).toEqual([
      "DiceRolled",
      "PlayerMoved",
      "TileResolved",
      "TurnStarted",
    ]);
    expect(transition.events[0]?.payload).toMatchObject({ playerId: fixtureIds.owner, dice: [1], total: 1, rngStream: "dice", rngCursor: 1 });
    expect(transition.events[1]?.payload).toMatchObject({ playerId: fixtureIds.owner, from: 3, to: 4, distance: 1, direction: "forward", lapsGained: 0 });
    expect(transition.state.players[fixtureIds.owner]?.position).toBe(4);
    // The hidden opponent fixture carries skipTurns: 1, so turn order passes
    // over them (their counter decrements to 0) straight to the revealed
    // opponent — this is resolveNextTurn's skipTurns handling, not a bug.
    expect(transition.state.players[fixtureIds.hiddenOpponent]?.skipTurns).toBe(0);
    expect(transition.state.turn).toMatchObject({
      number: 2,
      round: 1,
      activePlayerId: fixtureIds.revealedOpponent,
      phase: "pre-roll",
    });
    expect(transition.state.rng.streams.dice?.cursor).toBe(1);
    expect(transition.events.map((event) => event.sequence)).toEqual([30, 31, 32, 33]);
    expect(transition.state.revision).toBe(state.revision + 1);
  });

  it("Given a turn one space before Receptionist, when the owner rolls across it, then salary precedes the resource update", () => {
    const state = rollState(43);
    const command = rollCommand(state);

    const transition = accepted(applyCommand(state, command, context([0])));

    expect(transition.events.map((event) => event.type)).toEqual([
      "DiceRolled",
      "PlayerMoved",
      "SalaryAwarded",
      "ResourceChanged",
      "TileResolved",
      "TurnStarted",
    ]);
    expect(transition.events[2]?.payload).toMatchObject({ playerId: fixtureIds.owner, amount: 400, rankId: "rank-owner" });
    expect(transition.events[3]?.payload).toMatchObject({ playerId: fixtureIds.owner, previousValue: 12, newValue: 412, reason: "salary" });
    expect(transition.state.players[fixtureIds.owner]?.resources.money?.value).toBe(412);
  });

  it("Given identical state, command, and context, when applied twice, then transitions deep-equal", () => {
    const state = rollState(3);
    const command = rollCommand(state);

    const first = applyCommand(state, command, context([0, 0]));
    const second = applyCommand(state, command, context([0, 0]));

    expect(first).toEqual(second);
  });
});
