import { describe, expect, it } from "vitest";

import { createStableId } from "@office-ladder/engine";
import { createRoomService } from "../../src/rooms/service/create-room-service";
import type { RoomRepository, StoredRoom } from "../../src/rooms/service/types";

const players = {
  host: createStableId("PlayerId", "user-host"),
  second: createStableId("PlayerId", "user-second"),
  third: createStableId("PlayerId", "user-third"),
} as const;

const roomId = "room-service-test";

class InMemoryRoomRepository implements RoomRepository {
  readonly rooms = new Map<string, StoredRoom>();

  async create(room: StoredRoom): Promise<void> {
    this.rooms.set(room.id, room);
  }

  async get(id: string): Promise<StoredRoom | null> {
    return this.rooms.get(id) ?? null;
  }

  async save(room: StoredRoom): Promise<void> {
    this.rooms.set(room.id, room);
  }
}

function createService(repository: InMemoryRoomRepository) {
  return createRoomService({
    repository,
    now: () => "2026-07-18T12:00:00.000Z",
    ids: {
      roomId: () => roomId,
      gameId: () => createStableId("GameId", "game-service-test"),
      commandId: () => createStableId("CommandId", "command-service-test"),
    },
    gameSeed: () => "room-service-seed",
  });
}

async function createThreePlayerRoom(
  repository: InMemoryRoomRepository,
): Promise<ReturnType<typeof createService>> {
  const service = createService(repository);
  await service.create({ hostId: players.host, modeId: "mode.quick" });
  await service.join({ roomId, actorId: players.second });
  await service.join({ roomId, actorId: players.third });
  return service;
}

describe("room service", () => {
  it("Given a host, When creating a room, Then the host owns its only initial seat", async () => {
    const repository = new InMemoryRoomRepository();
    const result = await createService(repository).create({
      hostId: players.host,
      modeId: "mode.quick",
    });

    expect(result).toMatchObject({
      ok: true,
      value: { id: roomId, hostId: players.host, memberIds: [players.host], status: "open" },
    });
  });

  it("Given a host room, When a second user joins, Then the room has two distinct members", async () => {
    const repository = new InMemoryRoomRepository();
    const service = createService(repository);
    await service.create({ hostId: players.host, modeId: "mode.quick" });
    const result = await service.join({ roomId, actorId: players.second });

    expect(result).toMatchObject({
      ok: true,
      value: { memberIds: [players.host, players.second] },
    });
  });

  it("Given a two-player room, When the host starts it, Then start is rejected before the engine minimum", async () => {
    const repository = new InMemoryRoomRepository();
    const service = createService(repository);
    await service.create({ hostId: players.host, modeId: "mode.quick" });
    await service.join({ roomId, actorId: players.second });
    const result = await service.start({ roomId, actorId: players.host });

    expect(result).toEqual({ ok: false, error: { code: "MINIMUM_PLAYERS_NOT_MET" } });
  });

  it("Given a three-player room, When a non-host starts it, Then start is rejected", async () => {
    const repository = new InMemoryRoomRepository();
    const service = await createThreePlayerRoom(repository);
    const result = await service.start({ roomId, actorId: players.second });

    expect(result).toEqual({ ok: false, error: { code: "ACTOR_NOT_HOST" } });
  });

  it("Given two identical three-player rooms, When each host starts, Then each creates the same active canonical game", async () => {
    const firstRepository = new InMemoryRoomRepository();
    const secondRepository = new InMemoryRoomRepository();
    const first = await createThreePlayerRoom(firstRepository);
    const second = await createThreePlayerRoom(secondRepository);
    const firstResult = await first.start({ roomId, actorId: players.host });
    const secondResult = await second.start({ roomId, actorId: players.host });

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
    const started = await service.start({ roomId, actorId: players.host });

    expect(started).toMatchObject({ ok: true, value: { game: { revision: 1 } } });
    if (!started.ok) return;

    const result = await service.roll({
      roomId,
      actorId: players.host,
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
    await service.start({ roomId, actorId: players.host });
    const result = await service.roll({
      roomId,
      actorId: players.host,
      expectedRevision: 0,
    });

    expect(result).toEqual({ ok: false, error: { code: "STALE_REVISION" } });
  });

  it("Given an active room, When a member bootstraps, Then the response hides canonical server-only state", async () => {
    const repository = new InMemoryRoomRepository();
    const service = await createThreePlayerRoom(repository);
    await service.start({ roomId, actorId: players.host });
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
});
