import { afterEach, describe, expect, it, vi } from "vitest";

import { createStableId } from "@office-ladder/engine";
import { InMemoryRoomRepository } from "../../src/rooms/in-memory-repository";
import {
  fromRoomSnapshot,
  MAX_PERSISTED_EVENT_SUMMARIES,
} from "../../src/rooms/room-snapshot";
import { createRoomService } from "../../src/rooms/service/create-room-service";
import type { ActiveStoredRoom, RoomService, StoredRoom } from "../../src/rooms/service/types";

const roomId = "room-snapshot-test";

const players = {
  host: createStableId("PlayerId", "user-host"),
  second: createStableId("PlayerId", "user-second"),
  third: createStableId("PlayerId", "user-third"),
} as const;

function createService(repository: InMemoryRoomRepository): RoomService {
  return createRoomService({
    repository,
    now: () => "2026-07-26T12:00:00.000Z",
    ids: {
      roomId: () => roomId,
      roomCode: () => "SNP123",
      gameId: () => createStableId("GameId", "game-snapshot-test"),
      commandId: () => createStableId("CommandId", "command-snapshot-test"),
    },
    gameSeed: () => "snapshot-seed",
    // Off unless a test needs the clock: an armed deadline in an unrelated
    // test would be enforcement nobody asked for.
    turnTimeoutMs: 0,
  });
}

async function startedMatch(): Promise<{
  readonly repository: InMemoryRoomRepository;
  readonly service: RoomService;
  readonly room: ActiveStoredRoom;
}> {
  const repository = new InMemoryRoomRepository();
  const service = createService(repository);
  await service.create({ hostId: players.host, playerName: "Host", modeId: "mode.quick" });
  await service.join({ roomId, actorId: players.second, playerName: "Second" });
  await service.join({ roomId, actorId: players.third, playerName: "Third" });
  const started = await service.start({
    roomId,
    actorId: players.host,
    actorKind: "human",
  });
  if (!started.ok) throw new Error(`match did not start: ${started.error.code}`);
  return { repository, service, room: started.value };
}

/** Every rejection path logs; the assertions are about the outcome, not the noise. */
function silenceLogs(): void {
  vi.spyOn(console, "error").mockImplementation(() => undefined);
}

afterEach(() => {
  vi.restoreAllMocks();
});

function summary(id: string, extra: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id,
    type: "TurnStarted",
    revision: 2,
    occurredAt: "2026-07-26T12:00:01.000Z",
    actorPlayerId: players.host,
    ...extra,
  };
}

/**
 * The whole StoredRoom lives in one jsonb column, so a room saved by an older
 * build reads back with fields that the declared type says are always there.
 * These are the shapes production actually holds, not hypotheticals: `bots` and
 * the DiceRolled `dice`/`total`/`purpose` payload were both added to a type whose
 * old values are still sitting in room_projections.projection.
 */
describe("persisted room snapshot", () => {
  it("Given a legacy DiceRolled summary with no dice payload, When the room is read, Then it is dropped rather than served with fabricated faces", () => {
    const legacy = {
      id: roomId,
      code: "SNP123",
      hostId: players.host,
      memberIds: [players.host],
      memberNames: { [players.host]: "Host" },
      modeId: "mode.quick",
      capacity: 3,
      status: "open",
      revision: 4,
      createdAt: "2026-07-20T12:00:00.000Z",
      game: null,
      eventSummaries: [
        summary("event-turn-started"),
        // Written before DiceRolled carried its payload.
        { ...summary("event-dice-legacy"), type: "DiceRolled" },
        {
          ...summary("event-dice-current"),
          type: "DiceRolled",
          dice: [4],
          total: 4,
          purpose: "movement",
        },
      ],
    };

    const room = fromRoomSnapshot(legacy, 4);

    expect(room?.eventSummaries.map((entry) => entry.id)).toEqual([
      "event-turn-started",
      "event-dice-current",
    ]);
    // No consumer can now narrow to DiceRolled and read an absent field.
    for (const entry of room?.eventSummaries ?? []) {
      if (entry.type !== "DiceRolled") continue;
      expect(entry.dice.length).toBeGreaterThan(0);
      expect(Number.isFinite(entry.total)).toBe(true);
      expect(typeof entry.purpose).toBe("string");
    }
  });

  it("Given summaries with a broken card payload or unknown extra fields, When the room is read, Then each is repaired or dropped in one place", () => {
    const legacy = {
      id: roomId,
      code: "SNP123",
      hostId: players.host,
      memberIds: [players.host],
      memberNames: { [players.host]: "Host" },
      modeId: "mode.quick",
      capacity: 3,
      status: "open",
      revision: 0,
      createdAt: "2026-07-20T12:00:00.000Z",
      game: null,
      bots: [],
      eventSummaries: [
        // A CardDrawn whose card never made it into the snapshot: the client
        // reads card.definitionId unconditionally.
        { ...summary("event-card-broken"), type: "CardDrawn" },
        {
          ...summary("event-card-ok"),
          type: "CardDrawn",
          card: {
            definitionId: "card.work.small-bonus",
            deckId: "deck.work",
            nameKey: "deadlineDash.card.workSmallBonus.name",
          },
        },
        // Fields no contract declares — including RNG bookkeeping an older
        // writer might have copied in — must not survive into a projection.
        { ...summary("event-extra-fields"), rngStream: "dice", rngCursor: 7 },
        // Structurally unusable: no id to de-duplicate on.
        { type: "TurnStarted", revision: 1, occurredAt: "2026-07-20T12:00:00.000Z" },
        // An unknown type is kept: the client treats anything that is not
        // CardDrawn or DiceRolled generically, so a rollback keeps its history.
        { ...summary("event-future-type"), type: "SomethingNewer" },
      ],
    };

    const room = fromRoomSnapshot(legacy, 0);

    expect(room?.eventSummaries.map((entry) => entry.id)).toEqual([
      "event-card-ok",
      "event-extra-fields",
      "event-future-type",
    ]);
    expect(JSON.stringify(room?.eventSummaries)).not.toContain("rngStream");
    expect(JSON.stringify(room?.eventSummaries)).not.toContain("rngCursor");
  });

  it("Given a snapshot with junk in every non-identity field, When it is read, Then each field lands on a usable value and no member is evicted", () => {
    const legacy = {
      id: roomId,
      code: "SNP123",
      hostId: players.host,
      // Duplicated, non-string and empty entries.
      memberIds: [players.host, players.host, 7, "", players.second, players.third],
      memberNames: { [players.host]: "Host", [players.second]: 42, [players.third]: "Third" },
      modeId: "mode.from-a-future-build",
      capacity: 99,
      status: "not-a-status",
      revision: -3,
      createdAt: 1_700_000_000,
      game: null,
      eventSummaries: "not an array",
      bots: [
        { playerId: players.second, difficulty: "impossible" },
        { playerId: "bot:not-a-member:0", difficulty: "easy" },
        "not a seat",
      ],
    };

    const room = fromRoomSnapshot(legacy, 5);

    expect(room).not.toBeNull();
    expect(room?.memberIds).toEqual([players.host, players.second, players.third]);
    expect(room?.memberNames).toEqual({ [players.host]: "Host", [players.third]: "Third" });
    expect(room?.modeId).toBe("mode.quick");
    // Smallest legal capacity that still seats all three members.
    expect(room?.capacity).toBe(3);
    expect(room?.status).toBe("open");
    // The row's own revision column wins over the one inside the blob, because
    // that is what the conditional write compares against. With no column to
    // trust, an unusable revision inside the blob falls back to 0 rather than
    // becoming a predicate no write could ever match.
    expect(room?.revision).toBe(5);
    expect(fromRoomSnapshot(legacy, null)?.revision).toBe(0);
    expect(room?.createdAt).toBe("1970-01-01T00:00:00.000Z");
    expect(room?.eventSummaries).toEqual([]);
    // The ghost seat for a non-member is gone; the unrecognized difficulty
    // becomes a drivable one rather than silently demoting the seat to a human.
    expect(room?.bots).toEqual([{ playerId: players.second, difficulty: "standard" }]);
  });

  it("Given more summaries than the persisted bound, When the room is read, Then only the newest are kept", () => {
    const total = MAX_PERSISTED_EVENT_SUMMARIES + 50;
    const legacy = {
      id: roomId,
      code: "SNP123",
      hostId: players.host,
      memberIds: [players.host],
      memberNames: { [players.host]: "Host" },
      modeId: "mode.quick",
      capacity: 3,
      status: "open",
      revision: 0,
      createdAt: "2026-07-20T12:00:00.000Z",
      game: null,
      bots: [],
      eventSummaries: Array.from({ length: total }, (_, index) => summary(`event-${index}`)),
    };

    const room = fromRoomSnapshot(legacy, 0);

    expect(room?.eventSummaries.length).toBe(MAX_PERSISTED_EVENT_SUMMARIES);
    expect(room?.eventSummaries[0]?.id).toBe("event-50");
    expect(room?.eventSummaries.at(-1)?.id).toBe(`event-${total - 1}`);
  });

  it("Given a snapshot claiming to be active with no canonical game, When it is read, Then it reads as abandoned instead of offering rolls", () => {
    const legacy = {
      id: roomId,
      code: "SNP123",
      hostId: players.host,
      memberIds: [players.host, players.second, players.third],
      memberNames: {},
      modeId: "mode.quick",
      capacity: 6,
      status: "active",
      revision: 3,
      createdAt: "2026-07-20T12:00:00.000Z",
      game: null,
      eventSummaries: [],
      bots: [],
    };

    expect(fromRoomSnapshot(legacy, 3)?.status).toBe("abandoned");
  });

  it("Given a snapshot with no identity at all, When it is read, Then it is reported absent rather than half-built", () => {
    silenceLogs();

    expect(fromRoomSnapshot(null, 0)).toBeNull();
    expect(fromRoomSnapshot("a string", 0)).toBeNull();
    expect(fromRoomSnapshot({ code: "SNP123", hostId: players.host }, 0)).toBeNull();
    expect(fromRoomSnapshot({ id: roomId, hostId: players.host }, 0)).toBeNull();
    expect(fromRoomSnapshot({ id: roomId, code: "SNP123" }, 0)).toBeNull();
  });

  it("Given a legacy room read end to end, When a member bootstraps the match, Then nothing faults and the projection carries only readable history", async () => {
    const { repository, service, room } = await startedMatch();
    const legacy = { ...room } as Record<string, unknown>;
    // Exactly what an older build left behind: no bots key, and a DiceRolled
    // summary from before the payload existed.
    delete legacy["bots"];
    legacy["eventSummaries"] = [
      ...room.eventSummaries,
      { ...summary("event-dice-legacy"), type: "DiceRolled" },
    ];
    const saved = await repository.save(legacy as unknown as StoredRoom, room.revision);
    expect(saved).toEqual({ ok: true });

    const bootstrap = await service.bootstrap({ roomId, viewerId: players.second });

    expect(bootstrap.ok).toBe(true);
    // Throwing, not returning: `bootstrap.ok` is asserted above but the
    // `publicProjection` half of this guard was not, so a legacy room that read
    // back *without* its canonical game — the exact regression this end-to-end
    // case exists to catch, since the room would then project as a lobby or as
    // `abandoned` — silently skipped both assertions below and passed.
    if (!bootstrap.ok || !("publicProjection" in bootstrap.value)) {
      throw new Error("a started match must still project as a game");
    }
    expect(
      bootstrap.value.publicProjection.eventSummaries.map((entry) => entry.id),
    ).toEqual(room.eventSummaries.map((entry) => entry.id));
    expect(bootstrap.value.room.members.every((member) => !member.isBot)).toBe(true);
  });
});

/**
 * packages/engine ships a real serialization contract (serializeGameState /
 * deserializeGameState, with assertGameState behind both). The repository used to
 * bypass it with JSON.parse(JSON.stringify(...)), so a state holding undefined, a
 * Map, a Date or a non-finite number persisted silently corrupted.
 */
describe("canonical game serialization at the persistence boundary", () => {
  it("Given a real started match, When it is persisted and read back, Then the canonical state survives unchanged", async () => {
    const { repository, room } = await startedMatch();

    const readBack = await repository.get(roomId);

    expect(readBack?.game).toEqual(room.game);
    expect(readBack?.game).not.toBe(room.game);
  });

  it("Given a game state JSON cannot represent, When it is saved, Then the write is refused instead of silently losing data", async () => {
    silenceLogs();
    const { repository, room } = await startedMatch();

    const result = await repository.save(
      { ...room, game: { ...room.game, boardSize: Number.NaN } },
      room.revision,
    );

    expect(result).toEqual({ ok: false, error: { code: "SERIALIZATION_FAILED" } });
    // JSON.stringify would have written `null` here and the room would have been
    // unreadable afterwards; the stored snapshot is untouched instead.
    expect((await repository.get(roomId))?.game).toEqual(room.game);
  });

  it("Given a persisted game this engine refuses, When the room is read, Then it is reported absent rather than projected", async () => {
    silenceLogs();
    const { room } = await startedMatch();

    const corrupted = { ...room, game: { ...room.game, players: {} } };

    expect(fromRoomSnapshot(corrupted, room.revision)).toBeNull();
  });
});
