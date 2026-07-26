import { describe, expect, it } from "vitest";

import { deadlineDashContent } from "@office-ladder/content";
import {
  createDeadlineDashGame,
  createGame,
  createStableId,
} from "../src";

const playerIds = [
  createStableId("PlayerId", "player-alex"),
  createStableId("PlayerId", "player-blair"),
  createStableId("PlayerId", "player-casey"),
] as const;

const characterIds = [
  createStableId("CharacterId", "character.workaholic"),
  createStableId("CharacterId", "character.social-butterfly"),
  createStableId("CharacterId", "character.sales-star"),
] as const;

const roleIds = [
  createStableId("RoleId", "role.alex"),
  createStableId("RoleId", "role.blair"),
  createStableId("RoleId", "role.casey"),
] as const;

const setup = {
  gameId: createStableId("GameId", "game.setup-contract"),
  modeId: createStableId("ModeId", "mode.quick"),
  players: [
    {
      id: playerIds[0],
      order: 0,
      characterId: characterIds[0],
      role: { id: roleIds[0], kind: "role.worker" },
    },
    {
      id: playerIds[1],
      order: 1,
      characterId: characterIds[1],
      role: { id: roleIds[1], kind: "role.management" },
    },
    {
      id: playerIds[2],
      order: 2,
      characterId: characterIds[2],
      role: { id: roleIds[2], kind: "role.worker" },
    },
  ],
  authorizedStarterId: playerIds[1],
} as const;

function expectFailure(
  result: ReturnType<typeof createDeadlineDashGame>,
  code: string,
): void {
  expect(result).toMatchObject({ ok: false, error: { code } });
}

describe("Deadline Dash deterministic game setup", () => {
  it("Given a valid three-player Quick setup, When creating the game, Then it initializes canonical state", () => {
    const result = createDeadlineDashGame(setup, "setup-seed");

    expect(result.ok).toBe(true);
    if (!result.ok) return;

    expect(result.value.gameId).toBe(setup.gameId);
    expect(result.value.modeId).toBe(setup.modeId);
    expect(result.value.status).toBe("setup");
    expect(result.value.boardSize).toBe(44);
    expect(result.value.tileIds).toEqual(
      deadlineDashContent.board.spaces.map((space) => space.id),
    );
    expect(result.value.playerOrder).toEqual(playerIds);
    expect(result.value.startAuthorizedPlayerId).toBe(setup.authorizedStarterId);
    expect(result.value.turn.activePlayerId).toBeNull();
    expect(result.value.turn.phase).toBe("not-started");
  });

  it("Given the same setup and seed, When creating through both entry points, Then state is identical", () => {
    const wrapped = createDeadlineDashGame(setup, "repeatable-seed");
    const generic = createGame(setup, "repeatable-seed", deadlineDashContent);

    expect(wrapped).toEqual(generic);
    expect(createDeadlineDashGame(setup, "repeatable-seed")).toEqual(wrapped);
  });

  it("Given a new game, When inspecting random state, Then setup and dice streams are independent at cursor zero", () => {
    const result = createDeadlineDashGame(setup, "independent-streams");

    expect(result.ok).toBe(true);
    if (!result.ok) return;

    expect(result.value.rng.streams.setup.cursor).toBe(0);
    expect(result.value.rng.streams.dice.cursor).toBe(0);
    expect(result.value.rng.streams.setup.state).not.toBe(
      result.value.rng.streams.dice.state,
    );
    expect(result.value.rng.streams.setup).not.toBe(
      result.value.rng.streams.dice,
    );
  });

  it("Given a valid Quick setup, When creating the game, Then each player starts as an Intern with canonical resources and tokens", () => {
    const result = createDeadlineDashGame(setup, "starting-state");

    expect(result.ok).toBe(true);
    if (!result.ok) return;

    for (const playerId of playerIds) {
      const player = result.value.players[playerId];
      expect(player.position).toBe(0);
      expect(player.rank.kind).toBe("rank.intern");
      expect(player.rank.index).toBe(0);
      expect(player.resources).toMatchObject({
        money: { kind: "resource.money", value: 1000, minimum: 0 },
        reputation: { kind: "resource.reputation", value: 0, minimum: 0 },
        // 8/8, not 5/5: `startingResources` now carries an explicit
        // `energyMaximum` so the ceiling stops being pinned to the starting
        // value. A promotion to `rank.supervisor` widens it to 10.
        energy: { kind: "resource.energy", value: 8, minimum: 0, maximum: 8 },
        "work-counter": { kind: "resource.work-counter", value: 0, minimum: 0 },
      });
      expect(player.tokens.move).toMatchObject({
        kind: "token.move",
        count: 1,
        maximum: 3,
      });
    }
  });

  it("Given explicit player roles and characters, When creating the game, Then order and assignments are preserved", () => {
    const result = createDeadlineDashGame(setup, "assignments");

    expect(result.ok).toBe(true);
    if (!result.ok) return;

    expect(result.value.playerOrder).toEqual(playerIds);
    expect(result.value.players[playerIds[0]]).toMatchObject({
      order: 0,
      characterId: characterIds[0],
      role: { id: roleIds[0], kind: "role.worker" },
    });
    expect(result.value.players[playerIds[1]]).toMatchObject({
      order: 1,
      characterId: characterIds[1],
      role: { id: roleIds[1], kind: "role.management" },
    });
    expect(result.value.players[playerIds[2]]).toMatchObject({
      order: 2,
      characterId: characterIds[2],
      role: { id: roleIds[2], kind: "role.worker" },
    });
  });

  it("Given fewer than three players, When creating the game, Then setup is rejected", () => {
    const result = createDeadlineDashGame(
      { ...setup, players: setup.players.slice(0, 2) },
      "invalid-player-count",
    );

    expectFailure(result, "INVALID_PLAYER_COUNT");
  });

  it("Given duplicate player IDs, When creating the game, Then setup is rejected", () => {
    const result = createDeadlineDashGame(
      {
        ...setup,
        players: [setup.players[0], setup.players[0], setup.players[2]],
      },
      "duplicate-player",
    );

    expectFailure(result, "DUPLICATE_PLAYER_ID");
  });

  it("Given duplicate character IDs, When creating the game, Then setup is rejected", () => {
    const result = createDeadlineDashGame(
      {
        ...setup,
        players: [
          setup.players[0],
          { ...setup.players[1], characterId: setup.players[0].characterId },
          setup.players[2],
        ],
      },
      "duplicate-character",
    );

    expectFailure(result, "DUPLICATE_CHARACTER_ID");
  });

  it("Given no authorized starter, When creating the game, Then setup is rejected", () => {
    const result = createDeadlineDashGame(
      {
        ...setup,
        authorizedStarterId: createStableId("PlayerId", "player-missing"),
      },
      "missing-starter",
    );

    expectFailure(result, "AUTHORIZED_STARTER_NOT_FOUND");
  });

  it("Given an unsupported mode, When creating the game, Then setup is rejected", () => {
    const result = createDeadlineDashGame(
      { ...setup, modeId: createStableId("ModeId", "mode.unsupported") },
      "unsupported-mode",
    );

    expectFailure(result, "UNSUPPORTED_MODE");
  });
});
