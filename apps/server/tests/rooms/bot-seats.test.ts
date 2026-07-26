import { describe, expect, it } from "vitest";

import { parseOpaqueId } from "@office-ladder/contracts";
import { createStableId } from "@office-ladder/engine";
import { InMemoryRoomRepository } from "../../src/rooms/in-memory-repository";
import { createRoomService } from "../../src/rooms/service/create-room-service";
import type { RoomService, StoredRoom } from "../../src/rooms/service/types";

const players = {
  host: createStableId("PlayerId", "user-host"),
  second: createStableId("PlayerId", "user-second"),
} as const;

const roomId = "room-bot-seats-test";

function createService(repository: InMemoryRoomRepository): RoomService {
  return createRoomService({
    repository,
    now: () => "2026-07-26T12:00:00.000Z",
    ids: {
      roomId: () => roomId,
      roomCode: () => "BOT123",
      gameId: () => createStableId("GameId", "game-bot-seats-test"),
      commandId: () => createStableId("CommandId", "command-bot-seats-test"),
    },
    gameSeed: () => "bot-seats-seed",
    // Off unless a test needs the clock: an armed deadline in an unrelated
    // test would be enforcement nobody asked for.
    turnTimeoutMs: 0,
  });
}

async function createSoloRoom(
  repository: InMemoryRoomRepository,
  capacity?: 3 | 4 | 5 | 6,
): Promise<RoomService> {
  const service = createService(repository);
  await service.create({
    hostId: players.host,
    playerName: "Host",
    modeId: "mode.quick",
    capacity,
  });
  return service;
}

describe("room service bot seats", () => {
  it("Given a host room, When the host adds a bot, Then the bot becomes an ordinary member with a seat, a name and a difficulty", async () => {
    const repository = new InMemoryRoomRepository();
    const service = await createSoloRoom(repository);

    const result = await service.addBot({
      roomId,
      actorId: players.host,
      difficulty: "standard",
    });

    expect(result).toMatchObject({
      ok: true,
      value: {
        revision: 1,
        memberIds: [players.host, `bot:${roomId}:0`],
        bots: [{ playerId: `bot:${roomId}:0`, difficulty: "standard" }],
      },
    });
    if (!result.ok) return;

    expect(result.value.memberNames[`bot:${roomId}:0` as never]).toBe("Temp Analyst");
    // The generated id has to survive contracts' ID_PATTERN, because it is
    // both an actorId and a DELETE /bots/:memberId path segment.
    expect(parseOpaqueId(`bot:${roomId}:0`, "memberId")).toBe(`bot:${roomId}:0`);
  });

  it("Given a room with a bot, When bootstrapping the lobby, Then the projection marks exactly that member as a bot", async () => {
    const repository = new InMemoryRoomRepository();
    const service = await createSoloRoom(repository);
    await service.addBot({ roomId, actorId: players.host, difficulty: "ruthless" });

    const response = await service.bootstrap({ roomId, viewerId: players.host });

    expect(response).toMatchObject({
      ok: true,
      value: {
        room: {
          members: [
            { id: players.host, isBot: false, botDifficulty: null, seat: 0 },
            {
              id: `bot:${roomId}:0`,
              displayName: "Temp Analyst",
              isBot: true,
              botDifficulty: "ruthless",
              seat: 1,
            },
          ],
        },
      },
    });
  });

  it("Given a host room, When bots are added repeatedly, Then each takes the next free slot with a distinct name", async () => {
    const repository = new InMemoryRoomRepository();
    const service = await createSoloRoom(repository);
    await service.addBot({ roomId, actorId: players.host, difficulty: "easy" });
    const second = await service.addBot({
      roomId,
      actorId: players.host,
      difficulty: "standard",
    });

    expect(second).toMatchObject({
      ok: true,
      value: {
        revision: 2,
        bots: [
          { playerId: `bot:${roomId}:0`, difficulty: "easy" },
          { playerId: `bot:${roomId}:1`, difficulty: "standard" },
        ],
      },
    });
    if (!second.ok) return;

    const names = second.value.memberIds.map((id) => second.value.memberNames[id]);
    expect(names).toEqual(["Host", "Temp Analyst", "Contract Auditor"]);
    expect(new Set(names).size).toBe(names.length);
  });

  it("Given a non-host member, When they add a bot, Then it is rejected", async () => {
    const repository = new InMemoryRoomRepository();
    const service = await createSoloRoom(repository);
    await service.join({ roomId, actorId: players.second, playerName: "Second" });

    const result = await service.addBot({
      roomId,
      actorId: players.second,
      difficulty: "easy",
    });

    expect(result).toEqual({ ok: false, error: { code: "ACTOR_NOT_HOST" } });
  });

  it("Given a full room, When the host adds another bot, Then capacity is enforced", async () => {
    const repository = new InMemoryRoomRepository();
    const service = await createSoloRoom(repository, 3);
    await service.addBot({ roomId, actorId: players.host, difficulty: "easy" });
    await service.addBot({ roomId, actorId: players.host, difficulty: "easy" });

    const result = await service.addBot({
      roomId,
      actorId: players.host,
      difficulty: "easy",
    });

    expect(result).toEqual({ ok: false, error: { code: "ROOM_FULL" } });
  });

  it("Given an active match, When the host adds a bot, Then the room is no longer open", async () => {
    const repository = new InMemoryRoomRepository();
    const service = await createSoloRoom(repository);
    await service.addBot({ roomId, actorId: players.host, difficulty: "easy" });
    await service.addBot({ roomId, actorId: players.host, difficulty: "easy" });
    await service.start({ roomId, actorId: players.host, actorKind: "human" });

    const result = await service.addBot({
      roomId,
      actorId: players.host,
      difficulty: "easy",
    });

    expect(result).toEqual({ ok: false, error: { code: "ROOM_NOT_OPEN" } });
  });

  it("Given a room with a bot, When the host removes it, Then the seat, the name and the difficulty all go", async () => {
    const repository = new InMemoryRoomRepository();
    const service = await createSoloRoom(repository);
    await service.addBot({ roomId, actorId: players.host, difficulty: "easy" });

    const result = await service.removeBot({
      roomId,
      actorId: players.host,
      memberId: `bot:${roomId}:0`,
    });

    expect(result).toMatchObject({
      ok: true,
      value: { revision: 2, memberIds: [players.host], bots: [] },
    });
    if (!result.ok) return;

    expect(Object.keys(result.value.memberNames)).toEqual([players.host]);
  });

  it("Given a removed bot slot, When another bot is added, Then the freed slot is reused", async () => {
    const repository = new InMemoryRoomRepository();
    const service = await createSoloRoom(repository);
    await service.addBot({ roomId, actorId: players.host, difficulty: "easy" });
    await service.addBot({ roomId, actorId: players.host, difficulty: "easy" });
    await service.removeBot({
      roomId,
      actorId: players.host,
      memberId: `bot:${roomId}:0`,
    });

    const result = await service.addBot({
      roomId,
      actorId: players.host,
      difficulty: "ruthless",
    });

    expect(result).toMatchObject({
      ok: true,
      value: {
        bots: [
          { playerId: `bot:${roomId}:1`, difficulty: "easy" },
          { playerId: `bot:${roomId}:0`, difficulty: "ruthless" },
        ],
      },
    });
  });

  it("Given a human member, When the host tries to remove them as a bot, Then it is rejected", async () => {
    const repository = new InMemoryRoomRepository();
    const service = await createSoloRoom(repository);
    await service.join({ roomId, actorId: players.second, playerName: "Second" });

    const result = await service.removeBot({
      roomId,
      actorId: players.host,
      memberId: players.second,
    });

    expect(result).toEqual({ ok: false, error: { code: "MEMBER_NOT_BOT" } });
  });

  it("Given a non-member id, When the host removes it, Then it is rejected as not a bot", async () => {
    const repository = new InMemoryRoomRepository();
    const service = await createSoloRoom(repository);

    const result = await service.removeBot({
      roomId,
      actorId: players.host,
      memberId: `bot:${roomId}:9`,
    });

    expect(result).toEqual({ ok: false, error: { code: "MEMBER_NOT_BOT" } });
  });

  it("Given a room whose only members are bots, When the host adds another, Then the last-human guard rejects it", async () => {
    const repository = new InMemoryRoomRepository();
    const service = await createSoloRoom(repository);
    const seeded = await service.addBot({
      roomId,
      actorId: players.host,
      difficulty: "easy",
    });
    expect(seeded).toMatchObject({ ok: true });
    if (!seeded.ok) return;

    // Not reachable through the public API today (the host is always human and
    // cannot be removed), so the corrupt state is written directly.
    await repository.save(
      {
        ...seeded.value,
        memberIds: seeded.value.bots.map((seat) => seat.playerId),
      } satisfies StoredRoom,
      seeded.value.revision,
    );

    const result = await service.addBot({
      roomId,
      actorId: players.host,
      difficulty: "easy",
    });

    expect(result).toEqual({ ok: false, error: { code: "LAST_HUMAN_REQUIRED" } });
  });

  it("Given a legacy room persisted without a bots field, When it is read, Then it behaves as a room with no bots", async () => {
    const repository = new InMemoryRoomRepository();
    const service = await createSoloRoom(repository);
    const stored = await repository.get(roomId);
    expect(stored).not.toBeNull();
    if (stored === null) return;

    const legacy = { ...stored } as Record<string, unknown>;
    delete legacy["bots"];
    await repository.save(legacy as unknown as StoredRoom, stored.revision);

    const bootstrapped = await service.bootstrap({ roomId, viewerId: players.host });
    expect(bootstrapped).toMatchObject({
      ok: true,
      value: { room: { members: [{ id: players.host, isBot: false }] } },
    });

    const result = await service.addBot({
      roomId,
      actorId: players.host,
      difficulty: "standard",
    });
    expect(result).toMatchObject({
      ok: true,
      value: { bots: [{ playerId: `bot:${roomId}:0`, difficulty: "standard" }] },
    });
  });
});
