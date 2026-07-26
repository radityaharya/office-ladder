import { describe, expect, it } from "vitest";

import { createStableId } from "@office-ladder/engine";
import { InMemoryRoomRepository } from "../../src/rooms/in-memory-repository";
import { createRoomService } from "../../src/rooms/service/create-room-service";
import type { RoomService } from "../../src/rooms/service/types";

const host = createStableId("PlayerId", "user-host");
const second = createStableId("PlayerId", "user-second");
const roomId = "room-serialization-test";

function createService(repository: InMemoryRoomRepository): RoomService {
  return createRoomService({
    repository,
    now: () => "2026-07-26T12:00:00.000Z",
    ids: {
      roomId: () => roomId,
      roomCode: () => "SER123",
      gameId: () => createStableId("GameId", "game-serialization-test"),
      commandId: () => createStableId("CommandId", "command-serialization-test"),
    },
    gameSeed: () => "serialization-seed",
    // Off unless a test needs the clock: an armed deadline in an unrelated
    // test would be enforcement nobody asked for.
    turnTimeoutMs: 0,
  });
}

async function openRoomWithTwoBots(): Promise<{
  readonly repository: InMemoryRoomRepository;
  readonly service: RoomService;
}> {
  const repository = new InMemoryRoomRepository();
  const service = createService(repository);
  await service.create({
    hostId: host,
    playerName: "Host",
    modeId: "mode.quick",
    capacity: 6,
  });
  await service.addBot({ roomId, actorId: host, difficulty: "standard" });
  await service.addBot({ roomId, actorId: host, difficulty: "easy" });
  return { repository, service };
}

/**
 * The repository keeps the whole StoredRoom as one value and save() is an
 * unconditional overwrite, so overlapping mutations must be serialized per room
 * or the loser's snapshot silently reverts the winner's. These are regressions,
 * not hypotheticals: before the room service took a per-room lock, the first
 * case here left a room that had already answered 200 to /start sitting back in
 * the lobby with game === null.
 */
describe("room mutation serialization", () => {
  it("Given a bot being added while the host starts, When both are in flight, Then the started game is not reverted to the lobby", async () => {
    const { repository, service } = await openRoomWithTwoBots();

    const [started, added] = await Promise.all([
      service.start({ roomId, actorId: host, actorKind: "human" }),
      service.addBot({ roomId, actorId: host, difficulty: "ruthless" }),
    ]);

    const final = await repository.get(roomId);
    expect(final).not.toBeNull();
    if (final === null) return;

    // Exactly one of the two may win, and the persisted room must agree with it.
    expect(started.ok).not.toBe(added.ok);
    if (started.ok) {
      expect(final.status).toBe("active");
      expect(final.game).not.toBeNull();
      expect(final.bots.length).toBe(2);
      expect(added).toEqual({ ok: false, error: { code: "ROOM_NOT_OPEN" } });
    } else {
      expect(final.status).toBe("open");
      expect(final.game).toBeNull();
      expect(final.bots.length).toBe(3);
    }
  });

  it("Given a human joining while a bot is added, When both are in flight, Then both members survive and revisions do not collide", async () => {
    const { repository, service } = await openRoomWithTwoBots();
    const before = await repository.get(roomId);
    expect(before).not.toBeNull();
    if (before === null) return;

    const [joined, added] = await Promise.all([
      service.join({ roomId, actorId: second, playerName: "Second" }),
      service.addBot({ roomId, actorId: host, difficulty: "standard" }),
    ]);
    expect(joined.ok).toBe(true);
    expect(added.ok).toBe(true);

    const final = await repository.get(roomId);
    expect(final).not.toBeNull();
    if (final === null) return;
    expect(final.memberIds).toContain(second);
    expect(final.bots.length).toBe(3);
    expect(final.memberIds.length).toBe(5);
    expect(final.revision).toBe(before.revision + 2);
  });

  it("Given a double-submitted roll for the same turn, When both are in flight, Then only one command is committed", async () => {
    const { repository, service } = await openRoomWithTwoBots();
    const started = await service.start({ roomId, actorId: host, actorKind: "human" });
    expect(started.ok).toBe(true);
    if (!started.ok) return;

    const gameRevision = started.value.game.revision;
    const [first, secondRoll] = await Promise.all([
      service.roll({
        roomId,
        actorId: host,
        actorKind: "human",
        commandId: "roll-a",
        expectedRevision: gameRevision,
      }),
      service.roll({
        roomId,
        actorId: host,
        actorKind: "human",
        commandId: "roll-b",
        expectedRevision: gameRevision,
      }),
    ]);

    // The second submission must be rejected rather than overwriting the first.
    expect([first.ok, secondRoll.ok].filter(Boolean).length).toBe(1);
    const final = await repository.get(roomId);
    expect(final?.game?.revision).toBe(gameRevision + 1);
    expect(final?.revision).toBe(started.value.revision + 1);
  });
});
