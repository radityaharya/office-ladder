import { describe, expect, it } from "vitest";

import { parseAvatarUrl } from "@office-ladder/contracts";
import { createStableId } from "@office-ladder/engine";
import { InMemoryRoomRepository } from "../../src/rooms/in-memory-repository";
import { fromRoomSnapshot } from "../../src/rooms/room-snapshot";
import { createRoomService } from "../../src/rooms/service/create-room-service";
import type { RoomService, StoredRoom } from "../../src/rooms/service/types";

const players = {
  host: createStableId("PlayerId", "user-host"),
  second: createStableId("PlayerId", "user-second"),
} as const;

const roomId = "room-avatar-test";
const HOST_AVATAR = "https://cdn.example.com/host.png";

function createService(repository: InMemoryRoomRepository): RoomService {
  return createRoomService({
    repository,
    now: () => "2026-07-26T12:00:00.000Z",
    ids: {
      roomId: () => roomId,
      roomCode: () => "AVT123",
      gameId: () => createStableId("GameId", "game-avatar-test"),
      commandId: () => createStableId("CommandId", "command-avatar-test"),
    },
    gameSeed: () => "avatar-seed",
    turnTimeoutMs: 0,
  });
}

async function requireRoom(repository: InMemoryRoomRepository): Promise<StoredRoom> {
  const room = await repository.get(roomId);
  if (room === null) throw new Error("room vanished");
  return room;
}

describe("member avatars", () => {
  it("Given a member with a profile picture, When they join, Then it is captured once and projected", async () => {
    const repository = new InMemoryRoomRepository();
    const service = createService(repository);
    await service.create({
      hostId: players.host,
      playerName: "Host",
      modeId: "mode.quick",
      avatarUrl: HOST_AVATAR,
    });
    await service.join({ roomId, actorId: players.second, playerName: "Second" });

    const bootstrap = await service.bootstrap({ roomId, viewerId: players.host });

    // Captured at the door rather than looked up per request: the bootstrap is
    // polled every few seconds per client, and this keeps it a single row read.
    expect((await requireRoom(repository)).memberAvatars).toEqual({
      [players.host]: HOST_AVATAR,
    });
    expect(bootstrap).toMatchObject({
      ok: true,
      value: {
        room: {
          members: [
            { id: players.host, avatarUrl: HOST_AVATAR },
            // The common case: no picture, and the client renders its own marker.
            { id: players.second, avatarUrl: null },
          ],
        },
      },
    });
  });

  it("Given a bot seat, When the lobby is projected, Then it has no avatar at all", async () => {
    const repository = new InMemoryRoomRepository();
    const service = createService(repository);
    await service.create({
      hostId: players.host,
      playerName: "Host",
      modeId: "mode.quick",
      avatarUrl: HOST_AVATAR,
    });
    const added = await service.addBot({
      roomId,
      actorId: players.host,
      difficulty: "standard",
    });
    expect(added).toMatchObject({ ok: true });

    const bootstrap = await service.bootstrap({ roomId, viewerId: players.host });

    // A bot has no user row, so there is nothing to show but the UI's own marker.
    expect(bootstrap).toMatchObject({
      ok: true,
      value: { room: { members: [{ avatarUrl: HOST_AVATAR }, { isBot: true, avatarUrl: null }] } },
    });
  });

  it("Given a picture the parser will not vouch for, When it is captured, Then the member simply has none", async () => {
    const repository = new InMemoryRoomRepository();
    const service = createService(repository);

    await service.create({
      hostId: players.host,
      playerName: "Host",
      modeId: "mode.quick",
      // Exactly what the route passes: parseAvatarUrl(session.user.image), which
      // answers null for a scheme it will not put in an img src.
      avatarUrl: parseAvatarUrl("javascript:alert(document.cookie)"),
    });

    // Degrading to no picture, never failing the join: a bad row in the user table
    // must not be able to keep somebody out of a game.
    expect((await requireRoom(repository)).memberAvatars).toEqual({});
    expect(await service.bootstrap({ roomId, viewerId: players.host })).toMatchObject({
      ok: true,
      value: { room: { members: [{ avatarUrl: null }] } },
    });
  });

  it("Given a persisted snapshot holding an unsafe avatar, When it is read back, Then the reader's rules win", () => {
    // Belt and braces: the row could have been written by a build with looser
    // rules, or by hand. Re-validating on read means tightening the allow-list
    // later takes effect for rooms that already exist.
    const room = fromRoomSnapshot(
      {
        id: roomId,
        code: "AVT123",
        hostId: players.host,
        memberIds: [players.host, players.second],
        memberNames: { [players.host]: "Host" },
        memberAvatars: {
          [players.host]: "javascript:alert(1)",
          [players.second]: HOST_AVATAR,
          "user-never-joined": HOST_AVATAR,
        },
        memberCharacters: {},
        modeId: "mode.quick",
        capacity: 6,
        status: "open",
        revision: 3,
        createdAt: "2026-07-26T12:00:00.000Z",
        game: null,
        eventSummaries: [],
        bots: [],
        turnTimer: null,
      },
      3,
    );

    expect(room?.memberAvatars).toEqual({ [players.second]: HOST_AVATAR });
  });

  it("Given a snapshot written before avatars existed, When it is read back, Then it reads as nobody having one", () => {
    const room = fromRoomSnapshot(
      {
        id: roomId,
        code: "AVT123",
        hostId: players.host,
        memberIds: [players.host],
        memberNames: { [players.host]: "Host" },
        modeId: "mode.quick",
        capacity: 6,
        status: "open",
        revision: 1,
        game: null,
        eventSummaries: [],
      },
      1,
    );

    expect(room).toMatchObject({
      memberAvatars: {},
      memberCharacters: {},
      turnTimer: null,
      bots: [],
    });
  });
});
