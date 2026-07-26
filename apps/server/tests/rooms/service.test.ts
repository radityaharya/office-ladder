import { describe, expect, it } from "vitest";

import { createStableId, type CardDrawnEvent } from "@office-ladder/engine";
import { InMemoryRoomRepository } from "../../src/rooms/in-memory-repository";
import { createRoomService } from "../../src/rooms/service/create-room-service";
import { eventSummaries } from "../../src/rooms/service/game-setup";

const players = {
  host: createStableId("PlayerId", "user-host"),
  second: createStableId("PlayerId", "user-second"),
  third: createStableId("PlayerId", "user-third"),
} as const;

const roomId = "room-service-test";

// The shared implementation, not a local stand-in: it round-trips through the
// same snapshot boundary and applies the same revision predicate as Postgres, so
// these tests exercise the semantics production actually has.
function createService(repository: InMemoryRoomRepository) {
  return createRoomService({
    repository,
    now: () => "2026-07-18T12:00:00.000Z",
    ids: {
      roomId: () => roomId,
      roomCode: () => "ABC123",
      gameId: () => createStableId("GameId", "game-service-test"),
      commandId: () => createStableId("CommandId", "command-service-test"),
    },
    gameSeed: () => "room-service-seed",
    // Off unless a test needs the clock: an armed deadline in an unrelated
    // test would be enforcement nobody asked for.
    turnTimeoutMs: 0,
  });
}

async function createThreePlayerRoom(
  repository: InMemoryRoomRepository,
): Promise<ReturnType<typeof createService>> {
  const service = createService(repository);
  await service.create({
    hostId: players.host,
    playerName: "Host",
    modeId: "mode.quick",
  });
  await service.join({ roomId, actorId: players.second, playerName: "Second" });
  await service.join({ roomId, actorId: players.third, playerName: "Third" });
  return service;
}

describe("room service", () => {
  it("Given a host, When creating a room, Then the host owns its only initial seat", async () => {
    const repository = new InMemoryRoomRepository();
    const result = await createService(repository).create({
      hostId: players.host,
      playerName: "Host",
      modeId: "mode.quick",
    });

    expect(result).toMatchObject({
      ok: true,
      value: {
        id: roomId,
        hostId: players.host,
        memberIds: [players.host],
        status: "open",
      },
    });
  });

  it("Given a host room, When a second user joins, Then the room has two distinct members", async () => {
    const repository = new InMemoryRoomRepository();
    const service = createService(repository);
    await service.create({
      hostId: players.host,
      playerName: "Host",
      modeId: "mode.quick",
    });
    const result = await service.join({
      roomId,
      actorId: players.second,
      playerName: "Second",
    });

    expect(result).toMatchObject({
      ok: true,
      value: {
        memberIds: [players.host, players.second],
      },
    });
  });

  it("Given a host room code, When a second user joins by code, Then they become a room member", async () => {
    const repository = new InMemoryRoomRepository();
    const service = createService(repository);
    await service.create({
      hostId: players.host,
      playerName: "Host",
      modeId: "mode.quick",
    });

    const result = await service.joinByCode({
      roomCode: "ABC123",
      actorId: players.second,
      playerName: "Second",
    });

    expect(result).toMatchObject({
      ok: true,
      value: { memberIds: [players.host, players.second] },
    });
  });

  it("Given room members, When a member bootstraps the lobby, Then room members display their chosen names", async () => {
    const repository = new InMemoryRoomRepository();
    const service = createService(repository);
    await service.create({
      hostId: players.host,
      playerName: "Host",
      modeId: "mode.quick",
    });
    await service.join({
      roomId,
      actorId: players.second,
      playerName: "Second",
    });

    const response = await service.bootstrap({ roomId, viewerId: players.host });

    expect(response).toMatchObject({
      ok: true,
      value: {
        room: {
          members: [
            { id: players.host, displayName: "Host" },
            { id: players.second, displayName: "Second" },
          ],
        },
      },
    });
  });

  it("Given a two-player room, When the host starts it, Then start is rejected before the engine minimum", async () => {
    const repository = new InMemoryRoomRepository();
    const service = createService(repository);
    await service.create({
      hostId: players.host,
      playerName: "Host",
      modeId: "mode.quick",
    });
    await service.join({
      roomId,
      actorId: players.second,
      playerName: "Second",
    });
    const result = await service.start({ roomId, actorId: players.host, actorKind: "human" });

    expect(result).toEqual({ ok: false, error: { code: "MINIMUM_PLAYERS_NOT_MET" } });
  });

  it("Given a three-player room, When a non-host starts it, Then start is rejected", async () => {
    const repository = new InMemoryRoomRepository();
    const service = await createThreePlayerRoom(repository);
    const result = await service.start({ roomId, actorId: players.second, actorKind: "human" });

    expect(result).toEqual({ ok: false, error: { code: "ACTOR_NOT_HOST" } });
  });

  it("Given two identical three-player rooms, When each host starts, Then each creates the same active canonical game", async () => {
    const firstRepository = new InMemoryRoomRepository();
    const secondRepository = new InMemoryRoomRepository();
    const first = await createThreePlayerRoom(firstRepository);
    const second = await createThreePlayerRoom(secondRepository);
    const firstResult = await first.start({ roomId, actorId: players.host, actorKind: "human" });
    const secondResult = await second.start({ roomId, actorId: players.host, actorKind: "human" });

    expect(firstResult).toMatchObject({
      ok: true,
      value: {
        status: "active",
        game: {
          status: "active",
          revision: 1,
          turn: { activePlayerId: players.host, phase: "pre-roll" },
        },
      },
    });
    expect(secondResult).toEqual(firstResult);
  });

  it("Given an active room, When its active player rolls at the current revision, Then the authoritative game advances", async () => {
    const repository = new InMemoryRoomRepository();
    const service = await createThreePlayerRoom(repository);
    const started = await service.start({ roomId, actorId: players.host, actorKind: "human" });

    expect(started).toMatchObject({ ok: true, value: { game: { revision: 1 } } });
    if (!started.ok) return;

    const result = await service.roll({
      roomId,
      actorId: players.host,
      actorKind: "human",
      expectedRevision: started.value.game.revision,
    });

    expect(result).toMatchObject({
      ok: true,
      value: { game: { revision: 2, turn: { activePlayerId: players.second } } },
    });
  });

  it("Given an active room, When a player rolls with a stale revision, Then no new game transition is accepted", async () => {
    const repository = new InMemoryRoomRepository();
    const service = await createThreePlayerRoom(repository);
    await service.start({ roomId, actorId: players.host, actorKind: "human" });
    const result = await service.roll({
      roomId,
      actorId: players.host,
      actorKind: "human",
      expectedRevision: 0,
    });

    expect(result).toEqual({ ok: false, error: { code: "STALE_REVISION" } });
  });

  it("Given an active room, When a member bootstraps, Then the response hides canonical server-only state", async () => {
    const repository = new InMemoryRoomRepository();
    const service = await createThreePlayerRoom(repository);
    await service.start({ roomId, actorId: players.host, actorKind: "human" });
    const response = await service.bootstrap({ roomId, viewerId: players.second });

    expect(response).toMatchObject({
      ok: true,
      value: {
        room: { id: roomId, status: "active" },
        publicProjection: { status: "active" },
        self: { playerId: players.second },
      },
    });
    if (!response.ok) return;

    expect(response.value).not.toHaveProperty("canonicalGame");
    expect(JSON.stringify(response.value)).not.toContain("rng");
    expect(JSON.stringify(response.value)).not.toContain("resolutionStack");
  });

  it("Given a persisted CardDrawn summary, When a member bootstraps, Then the public projection exposes only its safe card payload", async () => {
    const repository = new InMemoryRoomRepository();
    const service = await createThreePlayerRoom(repository);
    const started = await service.start({ roomId, actorId: players.host, actorKind: "human" });

    expect(started).toMatchObject({ ok: true });
    if (!started.ok) return;

    const cardDrawn = {
      eventId: createStableId("EventId", "event-bootstrap-card-drawn"),
      gameId: started.value.game.gameId,
      sequence: 3,
      revision: started.value.game.revision,
      causationCommandId: createStableId("CommandId", "command-bootstrap-card-drawn"),
      correlationFrameId: null,
      logicalTimestamp: "2026-07-24T12:00:00.000Z",
      schemaVersion: 1,
      visibility: { kind: "public" },
      type: "CardDrawn",
      payload: {
        playerId: players.second,
        cardId: createStableId("CardDefinitionId", "card.work.small-bonus"),
        deckId: createStableId("DeckId", "deck.work"),
        nameKey: "deadlineDash.card.workSmallBonus.name",
      },
    } satisfies CardDrawnEvent;
    await repository.save(
      {
        ...started.value,
        eventSummaries: eventSummaries([cardDrawn], players.host),
      },
      started.value.revision,
    );

    const response = await service.bootstrap({ roomId, viewerId: players.third });

    expect(response).toMatchObject({
      ok: true,
      value: {
        publicProjection: {
          eventSummaries: [
            {
              id: "event-bootstrap-card-drawn",
              type: "CardDrawn",
              actorPlayerId: players.second,
              card: {
                definitionId: "card.work.small-bonus",
                deckId: "deck.work",
                nameKey: "deadlineDash.card.workSmallBonus.name",
              },
            },
          ],
        },
      },
    });
    if (!response.ok) return;

    const bootstrap = JSON.stringify(response.value);
    expect(bootstrap).not.toContain("effects");
    expect(bootstrap).not.toContain("rng");
    expect(bootstrap).not.toContain("hands");
  });
});
