import { describe, expect, it } from "vitest";

import { createStableId } from "@office-ladder/engine";
import { createBotDriver } from "../../src/rooms/bots/bot-driver";
import { shouldDriveBots } from "../../src/rooms/bots/should-drive";
import { InMemoryRoomRepository } from "../../src/rooms/in-memory-repository";
import { createRoomService } from "../../src/rooms/service/create-room-service";
import type { ActiveStoredRoom, RoomService, StoredRoom } from "../../src/rooms/service/types";
import { shouldEnforceTurnTimer } from "../../src/rooms/turn-timer/should-enforce";
import { createTurnTimeoutDriver } from "../../src/rooms/turn-timer/turn-timeout-driver";

/**
 * A room written by an older build, read by this one.
 *
 * The whole StoredRoom lives in a single jsonb column, so every field added since
 * a row was written comes back **absent** — and the declared type says it is always
 * there. Four fields have been added to `StoredRoom` without a migration
 * (`bots`, `memberAvatars`, `memberCharacters`, `turnTimer`), plus the required
 * `dice`/`total`/`purpose` payload on a `DiceRolled` event summary.
 *
 * `room-snapshot.test.ts` already covers `fromRoomSnapshot` in isolation. What is
 * not covered is the rest of the read path: the consumers that would fault on an
 * absent field are not in the snapshot module at all. Three of them dereference
 * without a guard, so if normalization were ever bypassed or incomplete they throw
 * rather than degrade:
 *
 * - `projections.ts`'s `room.memberAvatars[memberId]` — a TypeError per member.
 * - `turn-timer.ts`'s `nextTurnTimer`, which tests `existing !== null` and then
 *   reads `existing.gameRevision`; `undefined` passes that test. It runs on
 *   *every committed game mutation*, so it would 500 every roll.
 * - `projections.ts`'s `turnTimerProjection` → `isTurnTimerCurrent`, same shape.
 *
 * So this drives a genuinely legacy blob through everything a real request touches:
 * both bootstrap projections, both read-path predicates, and both server-side
 * drivers.
 */

const players = {
  host: createStableId("PlayerId", "user-host"),
  second: createStableId("PlayerId", "user-second"),
  third: createStableId("PlayerId", "user-third"),
} as const;

const roomId = "room-legacy-read-path-test";
const TIMEOUT_MS = 30_000;

/** Every StoredRoom key that did not exist in an earlier build of this server. */
const FIELDS_ADDED_SINCE = [
  "bots",
  "memberAvatars",
  "memberCharacters",
  "turnTimer",
] as const;

function createService(
  repository: InMemoryRoomRepository,
  now: () => string,
  turnTimeoutMs: number,
): RoomService {
  return createRoomService({
    repository,
    now,
    ids: {
      roomId: () => roomId,
      roomCode: () => "LGY123",
      gameId: () => createStableId("GameId", "game-legacy-read-path-test"),
      commandId: () => createStableId("CommandId", "command-legacy-read-path-test"),
    },
    gameSeed: () => "legacy-read-path-seed",
    turnTimeoutMs,
  });
}

type Legacy = {
  readonly repository: InMemoryRoomRepository;
  readonly service: RoomService;
  readonly started: ActiveStoredRoom;
};

/**
 * Starts a real match, then rewrites its row as an older build would have left it:
 * every later-added key deleted, and a `DiceRolled` summary with no payload.
 *
 * Written *through the repository*, so `toRoomSnapshot` spreads the object with the
 * keys genuinely missing — this is the production write/read path, not a
 * hand-assembled object handed straight to a normalizer.
 */
async function writeLegacyRow(options: { readonly turnTimeoutMs: number }): Promise<Legacy> {
  const repository = new InMemoryRoomRepository();
  const service = createService(repository, () => "2026-07-26T12:00:00.000Z", options.turnTimeoutMs);
  await service.create({ hostId: players.host, playerName: "Host", modeId: "mode.quick" });
  await service.join({ roomId, actorId: players.second, playerName: "Second" });
  await service.join({ roomId, actorId: players.third, playerName: "Third" });
  const started = await service.start({ roomId, actorId: players.host, actorKind: "human" });
  if (!started.ok) throw new Error(`match did not start: ${started.error.code}`);

  const legacy = { ...started.value } as Record<string, unknown>;
  for (const field of FIELDS_ADDED_SINCE) delete legacy[field];
  legacy["eventSummaries"] = [
    ...started.value.eventSummaries,
    // Persisted before DiceRolled carried dice/total/purpose. A consumer that
    // narrows on the variant and reads `.dice` faults on this.
    {
      id: "event-dice-legacy",
      type: "DiceRolled",
      revision: 1,
      occurredAt: "2026-07-26T12:00:01.000Z",
      actorPlayerId: players.host,
    },
  ];

  const saved = await repository.save(
    legacy as unknown as StoredRoom,
    started.value.revision,
  );
  expect(saved).toEqual({ ok: true });
  // Sanity: the keys really are gone from what was persisted, or this whole file
  // is testing a snapshot that already has them.
  for (const field of FIELDS_ADDED_SINCE) {
    expect(Object.hasOwn(legacy, field)).toBe(false);
  }

  return { repository, service, started: started.value };
}

describe("a legacy room snapshot through the whole read path", () => {
  it("Given every later-added field missing, When the room is read, Then each lands on its safe default", async () => {
    const { repository } = await writeLegacyRow({ turnTimeoutMs: TIMEOUT_MS });

    const room = await repository.get(roomId);

    expect(room).not.toBeNull();
    expect(room?.bots).toEqual([]);
    expect(room?.memberAvatars).toEqual({});
    expect(room?.memberCharacters).toEqual({});
    // Not "some deadline": a room with no persisted timer must read as having none,
    // so the driver arms a fresh one rather than enforcing an invented past.
    expect(room?.turnTimer).toBeNull();
  });

  it.each(FIELDS_ADDED_SINCE)(
    "Given only %s missing, When a member bootstraps the match, Then nothing throws",
    async (field) => {
      // One at a time as well as all together: a normalizer that happened to
      // rebuild three of the four would still pass an all-or-nothing test if the
      // fourth's consumer only faults in isolation.
      const repository = new InMemoryRoomRepository();
      const service = createService(
        repository,
        () => "2026-07-26T12:00:00.000Z",
        TIMEOUT_MS,
      );
      await service.create({ hostId: players.host, playerName: "Host", modeId: "mode.quick" });
      await service.join({ roomId, actorId: players.second, playerName: "Second" });
      await service.join({ roomId, actorId: players.third, playerName: "Third" });
      const started = await service.start({ roomId, actorId: players.host, actorKind: "human" });
      if (!started.ok) throw new Error("match did not start");
      const legacy = { ...started.value } as Record<string, unknown>;
      delete legacy[field];
      expect(
        await repository.save(legacy as unknown as StoredRoom, started.value.revision),
      ).toEqual({ ok: true });

      const bootstrap = await service.bootstrap({ roomId, viewerId: players.second });

      expect(bootstrap.ok).toBe(true);
      if (!bootstrap.ok || !("publicProjection" in bootstrap.value)) {
        throw new Error("the match should still project as a game");
      }
      expect(bootstrap.value.room.members).toHaveLength(3);
    },
  );

  it("Given a legacy row, When a member bootstraps, Then the projection is complete and the payload-less roll is dropped rather than faked", async () => {
    const { service, started } = await writeLegacyRow({ turnTimeoutMs: TIMEOUT_MS });

    const bootstrap = await service.bootstrap({ roomId, viewerId: players.second });

    expect(bootstrap.ok).toBe(true);
    if (!bootstrap.ok || !("publicProjection" in bootstrap.value)) {
      throw new Error("the match should still project as a game");
    }
    for (const member of bootstrap.value.room.members) {
      expect(member.isBot).toBe(false);
      expect(member.botDifficulty).toBeNull();
      expect(member.avatarUrl).toBeNull();
      expect(member.characterId).not.toBeNull();
    }
    // The faces were never recorded, so any value would be a fabricated roll shown
    // as if it had happened; the entry is absent instead.
    expect(
      bootstrap.value.publicProjection.eventSummaries.map((entry) => entry.id),
    ).toEqual(started.eventSummaries.map((entry) => entry.id));
    for (const entry of bootstrap.value.publicProjection.eventSummaries) {
      if (entry.type !== "DiceRolled") continue;
      expect(entry.dice.length).toBeGreaterThan(0);
    }
  });

  it("Given a legacy row, When the read path decides what to revive, Then both predicates answer without throwing", async () => {
    const { service } = await writeLegacyRow({ turnTimeoutMs: TIMEOUT_MS });

    const bootstrap = await service.bootstrap({ roomId, viewerId: players.host });
    if (!bootstrap.ok) throw new Error("bootstrap failed");

    // A legacy row has no bot seats, so the active seat reads as human: the clock
    // is revived and the bot drain is not.
    expect(shouldDriveBots(bootstrap.value)).toBe(false);
    expect(shouldEnforceTurnTimer(bootstrap.value)).toBe(true);
  });

  it("Given a legacy row with no persisted deadline, When the clock driver runs, Then it arms one instead of faulting", async () => {
    const { repository, service } = await writeLegacyRow({ turnTimeoutMs: TIMEOUT_MS });
    const driver = createTurnTimeoutDriver({
      roomService: service,
      repository,
      now: () => "2026-07-26T12:00:00.000Z",
      timeoutMs: TIMEOUT_MS,
      publish: async () => undefined,
      driveBots: async () => undefined,
      setTimer: () => () => undefined,
      onEvent: () => undefined,
    });

    await driver.drive(roomId);

    expect((await repository.get(roomId))?.turnTimer).toMatchObject({
      playerId: players.host,
      durationMs: TIMEOUT_MS,
    });
  });

  it("Given a legacy row, When a player rolls, Then the command commits and re-derives the clock", async () => {
    // nextTurnTimer runs inside every committed mutation, reading `room.turnTimer`
    // — the field the legacy row does not have. A roll is the shortest path to it.
    const { repository, service, started } = await writeLegacyRow({
      turnTimeoutMs: TIMEOUT_MS,
    });

    const rolled = await service.roll({
      roomId,
      actorId: players.host,
      actorKind: "human",
      commandId: "11111111-2222-3333-4444-555555555555",
      expectedRevision: started.game.revision,
    });

    expect(rolled).toMatchObject({ ok: true });
    expect((await repository.get(roomId))?.turnTimer).not.toBeNull();
  });

  it("Given a repository that does not normalize at all, When the service reads through it, Then its own boundary still fills the gaps", async () => {
    // rooms/room-snapshot.ts is the real boundary, and both shipped repositories
    // use it. normalizeStoredRoom is the service's own idempotent backstop, and its
    // doc comment promises it covers "a StoredRoom that reached the service some
    // other way" — which was true of `bots` and silently untrue of the three fields
    // added after it. A repository handed in by a test is exactly that path.
    const backing = new InMemoryRoomRepository();
    const service = createService(backing, () => "2026-07-26T12:00:00.000Z", TIMEOUT_MS);
    await service.create({ hostId: players.host, playerName: "Host", modeId: "mode.quick" });
    await service.join({ roomId, actorId: players.second, playerName: "Second" });
    await service.join({ roomId, actorId: players.third, playerName: "Third" });
    const started = await service.start({ roomId, actorId: players.host, actorKind: "human" });
    if (!started.ok) throw new Error("match did not start");

    const raw = { ...started.value } as Record<string, unknown>;
    for (const field of FIELDS_ADDED_SINCE) delete raw[field];
    const unnormalizing = {
      create: (room: StoredRoom) => backing.create(room),
      getByCode: (code: string) => backing.getByCode(code),
      save: (room: StoredRoom, expectedRevision: number) =>
        backing.save(room, expectedRevision),
      // Hands back the legacy object verbatim, with no snapshot round trip.
      get: async (): Promise<StoredRoom | null> => raw as unknown as StoredRoom,
    };
    const exposed = createService(
      unnormalizing as unknown as InMemoryRoomRepository,
      () => "2026-07-26T12:00:00.000Z",
      TIMEOUT_MS,
    );

    const bootstrap = await exposed.bootstrap({ roomId, viewerId: players.second });

    expect(bootstrap.ok).toBe(true);
    if (!bootstrap.ok || !("publicProjection" in bootstrap.value)) {
      throw new Error("the match should still project as a game");
    }
    expect(bootstrap.value.room.members.every((member) => member.avatarUrl === null)).toBe(
      true,
    );
    expect(bootstrap.value.publicProjection.deadlineAt).toBeNull();
    // And a mutation, which is where nextTurnTimer would throw on `undefined`.
    expect(
      await exposed.roll({
        roomId,
        actorId: players.host,
        actorKind: "human",
        commandId: "22222222-3333-4444-5555-666666666666",
        expectedRevision: started.value.game.revision,
      }),
    ).toMatchObject({ ok: true });
  });

  it("Given a legacy row, When the bot driver is kicked, Then it stops on the human turn rather than faulting", async () => {
    const { repository, service } = await writeLegacyRow({ turnTimeoutMs: 0 });
    const events: string[] = [];
    const driver = createBotDriver({
      roomService: service,
      repository,
      delayMs: 0,
      sleep: async () => undefined,
      publish: async () => undefined,
      onEvent: (event) => {
        if (event.type === "bot.drain.finished") events.push(event.stop.kind);
        if (event.type === "bot.drain.crashed") events.push("crashed");
      },
    });

    await driver.drive(roomId);

    // A legacy row has no `bots`, so every seat is a human seat.
    expect(events).toEqual(["human-turn"]);
  });
});
