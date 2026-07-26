/**
 * Real-Postgres verification for the window-expiry scheduler.
 *
 * Deliberately **not** a `.test.ts` file — vitest's `include` is
 * `tests/**\/*.test.ts`, so this never runs in the ordinary suite and never
 * requires a database to be reachable for `bun run test` to pass. It exists
 * because the unit tests above run against `InMemoryRoomRepository`, which has
 * no foreign keys and no serialization boundary: a write ordering that could
 * never succeed against real Postgres passes every one of them. That exact gap
 * is how a foreign-key ordering bug shipped once already.
 *
 * Run from `apps/server`:
 *
 *   bun --env-file=../../.env.local run tests/rooms/window-timer/postgres-verification.ts
 *
 * It creates a throwaway room, starts a match, injects a reaction window and a
 * ballot whose deadlines have already passed, drives the scheduler, and then
 * re-reads through a *fresh* repository instance — so what it asserts is what
 * actually reached the database, not what stayed in a process's memory.
 */
import { randomBytes, randomUUID } from "node:crypto";

import { db } from "@office-ladder/db";
import { games, roomProjections, rooms, user } from "@office-ladder/db/schema";
import { eq, inArray } from "drizzle-orm";
import { createStableId, type GameState } from "@office-ladder/engine";
import { PostgresRoomRepository } from "@/rooms/postgres-repository";
import { createRoomService } from "@/rooms/service/create-room-service";
import { createWindowExpiryDriver } from "@/rooms/window-timer/window-expiry-driver";
import type { WindowExpiryDriverEvent } from "@/rooms/window-timer/window-expiry-driver";

const roomId = randomUUID();
const players = {
  host: createStableId("PlayerId", `verify-host-${roomId}`),
  second: createStableId("PlayerId", `verify-second-${roomId}`),
  third: createStableId("PlayerId", `verify-third-${roomId}`),
};

function assert(condition: boolean, message: string): void {
  if (!condition) throw new Error(`FAILED: ${message}`);
  console.log(`  ok  ${message}`);
}

/**
 * `rooms.host_user_id` is a real foreign key onto Better Auth's `user` table —
 * the exact class of constraint `InMemoryRoomRepository` cannot express, and the
 * reason this script exists at all. Seeding real rows is part of the test, not
 * setup noise.
 */
async function seedUsers(): Promise<void> {
  await db.insert(user).values(
    Object.values(players).map((id) => ({
      id: String(id),
      name: String(id),
      email: `${String(id)}@window-timer.invalid`,
      emailVerified: false,
    })),
  );
}

/**
 * `games.room_id` is ON DELETE RESTRICT and `room_projections.game_id` is
 * ON DELETE SET NULL, so the rows have to come apart in dependency order —
 * another constraint the in-memory repository cannot express.
 */
async function cleanUp(): Promise<void> {
  await db.delete(roomProjections).where(eq(roomProjections.roomId, roomId));
  await db.delete(games).where(eq(games.roomId, roomId));
  await db.delete(rooms).where(eq(rooms.id, roomId));
  await db.delete(user).where(inArray(user.id, Object.values(players).map(String)));
}

async function main(): Promise<void> {
  await seedUsers();
  const repository = new PostgresRoomRepository();
  const now = (): string => new Date().toISOString();
  const service = createRoomService({
    repository,
    now,
    ids: {
      roomId: () => roomId,
      roomCode: () =>
        Array.from(randomBytes(6), (byte) => "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"[byte % 32]).join(""),
      gameId: () => createStableId("GameId", randomUUID()),
      commandId: () => createStableId("CommandId", randomUUID()),
    },
    gameSeed: () => randomBytes(32).toString("hex"),
    turnTimeoutMs: 60_000,
  });

  console.log(`room ${roomId}`);
  await service.create({ hostId: players.host, playerName: "Host", modeId: "mode.quick" });
  await service.join({ roomId, actorId: players.second, playerName: "Second" });
  await service.join({ roomId, actorId: players.third, playerName: "Third" });
  const started = await service.start({ roomId, actorId: players.host, actorKind: "human" });
  assert(started.ok, "a match started and persisted");

  // Inject the two resolvables no content path opens yet, both already overdue.
  const stored = await repository.get(roomId);
  if (stored === null || stored.game === null) throw new Error("room did not persist");
  const past = new Date(Date.now() - 30_000).toISOString();
  const patched: GameState = {
    ...stored.game,
    reactionWindows: [
      {
        id: createStableId("DecisionPointId", "verify-window"),
        frameId: createStableId("FrameId", "verify-frame"),
        kind: "prevention",
        eligiblePlayerIds: [players.second, players.third],
        priorityPlayerId: players.second,
        passedPlayerIds: [],
        playedByPlayerIds: [],
        deadlineAt: past,
        pendingEffectId: null,
      },
    ],
    ballots: [
      {
        id: createStableId("BallotId", "verify-ballot"),
        kind: "vote",
        subjectId: "verify-subject",
        subject: { options: ["yes", "no"] },
        audience: [players.host, players.second, players.third],
        castBy: {},
        deadlineAt: past,
        closesAtRound: 99,
        visibility: "open",
        resolution: null,
      },
    ],
  };
  const injected = await repository.save(
    { ...stored, revision: stored.revision + 1, game: patched },
    stored.revision,
  );
  assert(injected.ok, "an overdue window and ballot were written to Postgres");

  const events: WindowExpiryDriverEvent[] = [];
  const driver = createWindowExpiryDriver({
    repository,
    roomService: service,
    now,
    turnClockEnabled: true,
    publish: async () => {},
    setTimer: () => () => {},
    onEvent: (event) => events.push(event),
  });

  await driver.drive(roomId);
  driver.stop();

  // A *fresh* repository, so this reads the database and not a cache.
  const reread = await new PostgresRoomRepository().get(roomId);
  if (reread === null || reread.game === null) throw new Error("room vanished");

  const firedKinds = events
    .filter((event) => event.type === "window-expiry.fired")
    .map((event) => `${event.targetKind}(late ${event.lateMs}ms)`);
  console.log(`  fired: ${firedKinds.join(", ")}`);
  console.log(`  final stop: ${JSON.stringify(
    events.filter((event) => event.type === "window-expiry.pass.finished").at(-1)?.stop,
  )}`);

  assert(reread.game.reactionWindows.length === 0, "the reaction window is gone from the database");
  assert(reread.game.ballots[0]?.resolution !== null, "the ballot is resolved in the database");
  assert(reread.game.revision === patched.revision + 2, "exactly two commands were applied");

  // Idempotency against the real store: a second pass must change nothing.
  const revisionBefore = reread.revision;
  await driver.drive(roomId);
  const again = await new PostgresRoomRepository().get(roomId);
  assert(again?.revision === revisionBefore, "a second pass wrote nothing");

  console.log("PASS");
}

try {
  await main();
} finally {
  await cleanUp();
  console.log("cleaned up");
}
