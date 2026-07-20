import { describe, expect, it } from "vitest";

import { deadlineDashContent } from "../../src/content/deadline-dash";
import {
  applyCommand,
  createDeadlineDashGame,
  createStableId,
  deserializeGameState,
  enumerateLegalActions,
  serializeGameState,
  type GameEvent,
  type GameState,
} from "../../src/engine";

const playerIds = [
  createStableId("PlayerId", "player-one"),
  createStableId("PlayerId", "player-two"),
  createStableId("PlayerId", "player-three"),
] as const;

const setup = {
  gameId: createStableId("GameId", "game.public-api-scenario"),
  modeId: createStableId("ModeId", "mode.quick"),
  players: [
    {
      id: playerIds[0],
      order: 0,
      characterId: createStableId("CharacterId", "character.workaholic"),
      role: {
        id: createStableId("RoleId", "role.player-one"),
        kind: "role.worker" as const,
      },
    },
    {
      id: playerIds[1],
      order: 1,
      characterId: createStableId("CharacterId", "character.social-butterfly"),
      role: {
        id: createStableId("RoleId", "role.player-two"),
        kind: "role.management" as const,
      },
    },
    {
      id: playerIds[2],
      order: 2,
      characterId: createStableId("CharacterId", "character.sales-star"),
      role: {
        id: createStableId("RoleId", "role.player-three"),
        kind: "role.worker" as const,
      },
    },
  ],
  authorizedStarterId: playerIds[0],
} as const;

const seed = "public-api-scenario-seed";
const timestamps = [
  "2026-07-18T12:00:00.000Z",
  "2026-07-18T12:01:00.000Z",
  "2026-07-18T12:02:00.000Z",
  "2026-07-18T12:03:00.000Z",
] as const;

type ScenarioResult = {
  readonly state: GameState;
  readonly events: readonly GameEvent[];
  readonly serialization: string;
};

function acceptedTransition(
  result: ReturnType<typeof applyCommand>,
): { readonly state: GameState; readonly events: readonly GameEvent[] } {
  expect(result.ok).toBe(true);
  if (!result.ok) {
    throw new Error(result.error.message);
  }

  return result.value;
}

function currentActor(state: GameState) {
  const actorId = state.turn.activePlayerId;
  if (actorId === null) {
    throw new Error("Expected an active player");
  }

  return actorId;
}

function runScenario(): ScenarioResult {
  const created = createDeadlineDashGame(setup, seed);
  expect(created.ok).toBe(true);
  if (!created.ok) {
    throw new Error(created.error.message);
  }

  let state = created.value;
  const events: GameEvent[] = [];
  const start = acceptedTransition(
    applyCommand(
      state,
      {
        commandId: createStableId("CommandId", "command.start"),
        gameId: state.gameId,
        actorId: playerIds[0],
        expectedRevision: state.revision,
        type: "game.start",
        payload: {},
      },
      { logicalTimestamp: timestamps[0], content: deadlineDashContent },
    ),
  );
  state = start.state;
  events.push(...start.events);

  for (const [index, timestamp] of timestamps.slice(1).entries()) {
    const actorId = currentActor(state);
    const legalActions = enumerateLegalActions(state, actorId);
    expect(legalActions).toHaveLength(1);
    expect(legalActions[0]?.type).toBe("turn.roll");

    const commandId = createStableId("CommandId", `command.roll.${index + 1}`);
    const transition = acceptedTransition(
      applyCommand(
        state,
        {
          commandId,
          gameId: state.gameId,
          actorId,
          expectedRevision: state.revision,
          type: "turn.roll",
          payload: {},
        },
        { logicalTimestamp: timestamp, content: deadlineDashContent },
      ),
    );
    state = transition.state;
    events.push(...transition.events);
  }

  const serialization = serializeGameState(state);
  return { state, events, serialization };
}

describe("public API game scenario", () => {
  it("Given a seeded three-player setup, When three persisted-seeded turns are rolled, Then the full scenario replays identically", () => {
    // Given: the same explicit setup, seed, command IDs, and logical timestamps.
    const firstRun = runScenario();

    // When: the resulting state is serialized and restored, then the scenario is rerun.
    const restored = deserializeGameState(firstRun.serialization);
    const secondRun = runScenario();

    // Then: every current actor exposes only turn.roll before their command.
    expect(firstRun.state.turn.activePlayerId).toBe(playerIds[0]);
    expect(firstRun.state.turn.round).toBe(2);
    expect(firstRun.state.turn.number).toBe(4);
    expect(firstRun.state.revision).toBe(4);
    expect(firstRun.state.rng.streams.dice?.cursor).toBe(3);

    // Then: event sequences are contiguous across start and all three rolls.
    expect(firstRun.events.map((event) => event.sequence)).toEqual(
      Array.from({ length: firstRun.events.length }, (_, index) => index + 1),
    );

    // Then: serialization round-trips and replay produces identical observable results.
    expect(restored).toEqual(firstRun.state);
    expect(serializeGameState(restored)).toBe(firstRun.serialization);
    expect(secondRun).toEqual(firstRun);
  });
});
