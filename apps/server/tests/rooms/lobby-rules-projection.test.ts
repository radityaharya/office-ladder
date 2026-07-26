/**
 * The lobby projection carries the ruleset the room is actually played under.
 *
 * `RoomProjection` used to publish `mode` and nothing else about the terms, so a
 * joiner reading it saw the name of a *preset* — while the room could be playing a
 * host-authored ruleset that replaces that preset's rules block wholesale (spec
 * §8.4). Elimination on, negotiation off, quarters twice as long, upkeep doubled:
 * none of that is inferable from `mode: "mode.standard"`, and a player who cannot
 * read the terms is agreeing to terms they were never shown when they sit down.
 *
 * Two halves, and both matter:
 *
 * 1. **The ruleset in force is published**, and it is the same one the match will
 *    freeze at `game.start` — resolved the same way, so the lobby and the running
 *    game cannot describe different games.
 * 2. **Only the ruleset is published.** `StoredRoom` also holds the canonical
 *    `GameState`, the event log, the turn timer's internals and every member's
 *    stored claim. The key-set assertions below are the guard: widening this
 *    projection again has to be deliberate, not a spread that happened to pick up
 *    a field.
 */
import { describe, expect, it } from "vitest";

import { deadlineDashModes } from "@office-ladder/content";
import { createStableId, type PlayerId } from "@office-ladder/engine";
import { InMemoryRoomRepository } from "../../src/rooms/in-memory-repository";
import { createRoomService } from "../../src/rooms/service/create-room-service";
import {
  createBootstrap,
  createRoomBootstrap,
  roomProjection,
} from "../../src/rooms/service/projections";
import type { RoomService, StoredRoom } from "../../src/rooms/service/types";

const ROOM_ID = "room-lobby-rules";
const SERVER_TIME = "2026-07-27T12:00:00.000Z";

const players = {
  host: "user-lobby-host",
  second: "user-lobby-second",
  third: "user-lobby-third",
} as const;

const seat = (userId: string): PlayerId => createStableId("PlayerId", userId);

const QUICK_RULES = deadlineDashModes["mode.quick"].rules;
const MARATHON_RULES = deadlineDashModes["mode.marathon"].rules;

/**
 * Every key the lobby projection is allowed to have. Stated as a literal list
 * rather than derived from the DTO type, because the leak this guards against is
 * a *runtime* field the type never mentioned.
 */
const PROJECTION_KEYS = [
  "capacity",
  "code",
  "id",
  "members",
  "mode",
  "revision",
  "rules",
  "status",
] as const;

const MEMBER_KEYS = [
  "avatarUrl",
  "botDifficulty",
  "characterId",
  "characterLabel",
  "displayName",
  "id",
  "isBot",
  "isConnected",
  "isHost",
  "isReady",
  "seat",
] as const;

function createService(repository: InMemoryRoomRepository): RoomService {
  return createRoomService({
    repository,
    now: () => SERVER_TIME,
    ids: {
      roomId: () => ROOM_ID,
      roomCode: () => "LOB123",
      gameId: () => createStableId("GameId", "game-lobby-rules"),
      commandId: () => createStableId("CommandId", "command-lobby-rules"),
    },
    gameSeed: () => "lobby-rules-seed",
    turnTimeoutMs: 0,
  });
}

async function lobbyOfThree(
  create: { readonly modeId?: StoredRoom["modeId"]; readonly customRules?: unknown } = {},
): Promise<{ readonly service: RoomService; readonly repository: InMemoryRoomRepository }> {
  const repository = new InMemoryRoomRepository();
  const service = createService(repository);
  await service.create({
    hostId: players.host,
    playerName: "Host",
    modeId: create.modeId ?? "mode.quick",
    customRules: create.customRules,
  });
  await service.join({ roomId: ROOM_ID, actorId: players.second, playerName: "Second" });
  await service.join({ roomId: ROOM_ID, actorId: players.third, playerName: "Third" });
  return { service, repository };
}

async function storedRoom(repository: InMemoryRoomRepository): Promise<StoredRoom> {
  const room = await repository.get(ROOM_ID);
  if (room === null) throw new Error("the room was not stored");
  return room;
}

describe("the ruleset in force", () => {
  it.each(Object.keys(deadlineDashModes))(
    "Given a room on %s with no authored ruleset, When the lobby is projected, Then it publishes that preset's own rules",
    async (mode) => {
      const { repository } = await lobbyOfThree({
        modeId: mode as StoredRoom["modeId"],
      });

      const projection = roomProjection(await storedRoom(repository));

      expect(projection.mode).toBe(mode);
      expect(projection.rules).toEqual(
        deadlineDashModes[mode as keyof typeof deadlineDashModes].rules,
      );
    },
  );

  it("Given a host-authored ruleset, When a joiner reads the lobby, Then they see the terms in force rather than the preset's", async () => {
    // The whole gap: `mode` still says `mode.quick`, and the room is not playing
    // `mode.quick`'s rules. Publishing only the name means sitting down at a game
    // whose terms were never shown.
    const { repository } = await lobbyOfThree({ customRules: MARATHON_RULES });

    const projection = roomProjection(await storedRoom(repository));

    expect(projection.mode).toBe("mode.quick");
    expect(projection.rules).toEqual(MARATHON_RULES);
    expect(projection.rules).not.toEqual(QUICK_RULES);
  });

  it("Given a ruleset authored after the room existed, When the lobby is projected again, Then it reports the new terms", async () => {
    const { service, repository } = await lobbyOfThree();
    expect(roomProjection(await storedRoom(repository)).rules).toEqual(QUICK_RULES);

    const set = await service.setModeRules({
      roomId: ROOM_ID,
      actorId: players.host,
      rules: MARATHON_RULES,
    });
    expect(set.ok).toBe(true);

    expect(roomProjection(await storedRoom(repository)).rules).toEqual(MARATHON_RULES);
  });

  it("Given a cleared ruleset, When the lobby is projected, Then it reports the preset again", async () => {
    const { service, repository } = await lobbyOfThree({ customRules: MARATHON_RULES });

    await service.setModeRules({ roomId: ROOM_ID, actorId: players.host, rules: null });

    expect(roomProjection(await storedRoom(repository)).rules).toEqual(QUICK_RULES);
  });

  it("Given a running match, When the room is projected, Then it reports the frozen ruleset the game is actually reading", async () => {
    const { service, repository } = await lobbyOfThree({ customRules: MARATHON_RULES });
    const started = await service.start({
      roomId: ROOM_ID,
      actorId: players.host,
      actorKind: "human",
    });
    if (!started.ok) throw new Error(`start failed: ${started.error.code}`);

    const room = await storedRoom(repository);
    const projection = roomProjection(room);
    const bootstrap = createBootstrap(room, seat(players.host), SERVER_TIME);

    // `GameState.rules` rather than a re-resolution of the room: after a mid-match
    // content deploy those are the two answers that could differ, and the one the
    // transitions read is the only true one.
    expect(projection.rules).toEqual(room.game?.rules);
    // And the two places a client can read the rules agree, so no panel has to
    // pick which to trust.
    expect(projection.rules).toEqual(bootstrap.gameplay.rules);
  });

  it("Given a mode this content release does not provide, When the lobby is projected, Then the terms are reported as unknown rather than guessed", async () => {
    const { repository } = await lobbyOfThree();
    const room = await storedRoom(repository);

    const projection = roomProjection({
      ...room,
      modeId: "mode.retired" as StoredRoom["modeId"],
    });

    // Such a room cannot be started either — `start` answers UNSUPPORTED_MODE — so
    // the honest answer is "nobody can tell you the terms", not a preset picked to
    // fill the field.
    expect(projection.rules).toBeNull();
  });

  it("Given a lobby bootstrap, When it is built, Then the ruleset rides on the room projection where every viewer reads it", async () => {
    const { repository } = await lobbyOfThree({ customRules: MARATHON_RULES });
    const room = await storedRoom(repository);

    for (const userId of Object.values(players)) {
      const bootstrap = createRoomBootstrap(room, seat(userId));
      expect(bootstrap.room.rules, userId).toEqual(MARATHON_RULES);
    }
  });
});

describe("what the lobby projection does not publish", () => {
  it("Given a lobby, When it is projected, Then it carries exactly the fields it declares", async () => {
    const { repository } = await lobbyOfThree({ customRules: MARATHON_RULES });

    const projection = roomProjection(await storedRoom(repository));

    expect(Object.keys(projection).sort()).toEqual([...PROJECTION_KEYS]);
    for (const member of projection.members) {
      expect(Object.keys(member).sort()).toEqual([...MEMBER_KEYS]);
    }
    // Named individually as well as by key count, because these are the specific
    // StoredRoom fields a careless spread would bring along: the whole canonical
    // game, the event log, the turn clock's internals and the raw authored ruleset
    // under its storage name.
    for (const forbidden of ["game", "eventSummaries", "turnTimer", "customRules", "hostId", "bots"]) {
      expect(projection).not.toHaveProperty(forbidden);
    }
  });

  it("Given a running match, When the room is projected, Then no canonical game state rides along with the rules", async () => {
    const { service, repository } = await lobbyOfThree();
    const started = await service.start({
      roomId: ROOM_ID,
      actorId: players.host,
      actorKind: "human",
    });
    if (!started.ok) throw new Error(`start failed: ${started.error.code}`);

    const room = await storedRoom(repository);
    const payload = JSON.stringify(roomProjection(room));

    expect(Object.keys(roomProjection(room)).sort()).toEqual([...PROJECTION_KEYS]);
    // The gameplay projection is where game state belongs, and it is per-viewer
    // and redacted. Reading `game.rules` for this field must not have opened a
    // second, unredacted door onto the same object.
    expect(payload).not.toContain(String(room.game?.gameId));
    expect(payload).not.toContain("lobby-rules-seed");
    // Field names, not just values: a whole `GameState` assigned in under any key
    // would bring these along, and none of them belongs in a room projection.
    for (const field of ["playerOrder", "eventSequence", "tileIds", "stateHash", "decks"]) {
      expect(payload, field).not.toContain(field);
    }
  });
});
