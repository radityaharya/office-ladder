/**
 * Real-database verification that the jsonb columns hold JSON, not a JSON string.
 *
 * **Not a vitest test, and it cannot be one.** `apps/server/vitest.config.ts`
 * aliases the `bun` module to a stub (tests/stubs/bun.ts) so `drizzle-orm/bun-sql`
 * is importable under Node at all, which means no test in that suite can open a
 * connection. The double encoding this file checks for is *produced by the
 * driver*, so a fake connection could not reproduce it and a round-trip assertion
 * cannot see it — `JSON.stringify` on the way in and `JSON.parse` on the way out
 * cancel out perfectly. Only Postgres can answer the question:
 *
 * ```sh
 * bun --env-file=.env.local run apps/server/tests/rooms/verify-jsonb-encoding.ts
 * ```
 *
 * What it proves, in order:
 *
 * 1. A room and a started match written through the real service store
 *    `room_projections.projection` and `games.canonical_state` as jsonb
 *    **objects** — `jsonb_typeof` = 'object', and `jsonb_object_keys` returns
 *    real keys instead of failing with 22023 ("cannot call jsonb_object_keys on
 *    a scalar"), which is how the bug was originally found.
 * 2. Game state is queryable *in SQL*: a `#>>` path into the canonical state, a
 *    key count over `players`, an array length over `memberIds`. None of these
 *    could return anything on a double-encoded row.
 * 3. The StoredRoom that comes back is identical to the one that went in, so this
 *    changed only the encoding and not the content.
 * 4. A row in the **old** shape still opens. This is the half that must not lose a
 *    match: rows written before the fix are jsonb strings, and a database the
 *    migration has not reached yet still holds them.
 * 5. `drizzle/0004_jsonb_object_encoding.sql` — the actual shipped file, executed
 *    from disk rather than paraphrased here — rewrites such a row into an object
 *    with byte-identical content, and is a no-op on the second run.
 *
 * It creates its own throwaway users, room and game, and deletes all of them in a
 * `finally`.
 */
import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { SQL } from "bun";

import { createStableId } from "@office-ladder/engine";
import { PostgresRoomRepository } from "../../src/rooms/postgres-repository";
import { createRoomService } from "../../src/rooms/service/create-room-service";
import type { RoomService, StoredRoom } from "../../src/rooms/service/types";

const connectionString = process.env["DATABASE_URL"];
if (connectionString === undefined || connectionString.length === 0) {
  console.error("DATABASE_URL is required. Run with: bun --env-file=.env.local run …");
  process.exit(2);
}

const MIGRATION = new URL(
  "../../../../packages/db/drizzle/0004_jsonb_object_encoding.sql",
  import.meta.url,
);

const sql = new SQL(connectionString);
const suffix = randomUUID().slice(0, 8);
const roomId = `verify-jsonb-room-${suffix}`;
const gameId = `verify-jsonb-game-${suffix}`;
const members = [
  `verify-jsonb-host-${suffix}`,
  `verify-jsonb-second-${suffix}`,
  `verify-jsonb-third-${suffix}`,
] as const;

function ok(label: string, value: unknown): void {
  console.log(`PASS  ${label}: ${JSON.stringify(value)}`);
}

function bad(label: string, value: unknown): never {
  console.log(`FAIL  ${label}: ${JSON.stringify(value)}`);
  throw new Error(label);
}

/** Key order is not part of the value; Postgres reorders jsonb object keys. */
function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  if (typeof value === "object" && value !== null) {
    const entries = Object.entries(value as Record<string, unknown>)
      .filter(([, entry]) => entry !== undefined)
      .sort(([left], [right]) => (left < right ? -1 : 1))
      .map(([key, entry]) => `${JSON.stringify(key)}:${canonical(entry)}`);
    return `{${entries.join(",")}}`;
  }
  return JSON.stringify(value) ?? "null";
}

function same(label: string, actual: unknown, expected: unknown): void {
  if (canonical(actual) !== canonical(expected)) bad(label, { actual, expected });
}

/** A brand new repository and service: a restart is "the process state is gone". */
function freshService(): { service: RoomService; repository: PostgresRoomRepository } {
  const repository = new PostgresRoomRepository();
  return {
    repository,
    service: createRoomService({
      repository,
      now: () => new Date().toISOString(),
      ids: {
        roomId: () => roomId,
        roomCode: () => `J${suffix.slice(0, 5).toUpperCase()}`,
        gameId: () => createStableId("GameId", gameId),
        commandId: () => createStableId("CommandId", `verify-jsonb-command-${suffix}`),
      },
      gameSeed: () => `verify-jsonb-seed-${suffix}`,
      turnTimeoutMs: 0,
    }),
  };
}

async function readRoom(): Promise<StoredRoom> {
  const room = await freshService().repository.get(roomId);
  if (room === null) bad("the room could not be read back at all", room);
  return room;
}

async function typeOf(): Promise<{ projection: unknown; canonicalState: unknown }> {
  const [row] = await sql`
    select jsonb_typeof(p.projection) as projection,
           jsonb_typeof(g.canonical_state) as canonical_state
    from room_projections p
    join games g on g.room_id = p.room_id
    where p.room_id = ${roomId}`;
  return { projection: row?.projection, canonicalState: row?.canonical_state };
}

/** Executes the shipped migration file, statement by statement, as drizzle would. */
async function runMigration0004(): Promise<void> {
  const statements = readFileSync(MIGRATION, "utf8")
    .split("--> statement-breakpoint")
    .map((statement) => statement.trim())
    .filter((statement) => statement.length > 0);
  for (const statement of statements) await sql.unsafe(statement);
}

try {
  for (const id of members) {
    await sql`
      insert into "user" (id, name, email, email_verified, created_at, updated_at)
      values (${id}, ${id}, ${`${id}@example.invalid`}, false, now(), now())`;
  }

  // 1. A real room with a real started match, written through the real service.
  const { service } = freshService();
  const created = await service.create({
    hostId: members[0],
    playerName: "Host",
    modeId: "mode.quick",
    capacity: 6,
  });
  if (!created.ok) bad("create", created.error);
  await service.join({ roomId, actorId: members[1], playerName: "Second" });
  await service.join({ roomId, actorId: members[2], playerName: "Third" });
  const started = await service.start({
    roomId,
    actorId: members[0],
    actorKind: "human",
    commandId: `verify-jsonb-start-${suffix}`,
  });
  if (!started.ok) bad("start", started.error);
  ok("a match was started", { room: roomId, revision: started.value.game.revision });

  // 2. The query whose failure was the bug report. `jsonb_object_keys` on a
  //    scalar raises 22023; on an object it returns the keys.
  const typing = await typeOf();
  if (typing.projection !== "object" || typing.canonicalState !== "object") {
    bad("jsonb_typeof", typing);
  }
  ok("jsonb_typeof", typing);

  const projectionKeys = await sql`
    select jsonb_object_keys(projection) as key from room_projections
    where room_id = ${roomId} order by key`;
  const stateKeys = await sql`
    select jsonb_object_keys(canonical_state) as key from games
    where room_id = ${roomId} order by key`;
  if (projectionKeys.length === 0 || stateKeys.length === 0) {
    bad("jsonb_object_keys returned nothing", { projectionKeys, stateKeys });
  }
  ok(
    "jsonb_object_keys(projection)",
    projectionKeys.map((row: { key: string }) => row.key),
  );
  ok(
    "jsonb_object_keys(canonical_state)",
    stateKeys.map((row: { key: string }) => row.key),
  );

  // 3. Game state is now answerable in SQL, which was the whole point of jsonb.
  const [inspected] = await sql`
    select p.projection #>> '{game,turn,round}' as round,
           p.projection #>> '{status}' as status,
           jsonb_array_length(p.projection -> 'memberIds') as members,
           (select count(*)::int from jsonb_object_keys(g.canonical_state -> 'players')) as players,
           g.canonical_state #>> '{rules,winShape}' as win_shape
    from room_projections p
    join games g on g.room_id = p.room_id
    where p.room_id = ${roomId}`;
  if (inspected?.members !== 3 || inspected.players !== 3 || inspected.status !== "active") {
    bad("SQL could not see inside the stored state", inspected);
  }
  ok("SQL sees inside the stored state", inspected);

  // 4. Same content, only better encoded: the StoredRoom round trips unchanged.
  const roundTripped = await readRoom();
  same("StoredRoom round trip", roundTripped, started.value);
  same("GameState round trip", roundTripped.game, started.value.game);
  ok("round trip is identical", {
    revision: roundTripped.revision,
    events: roundTripped.eventSummaries.length,
  });

  // 5. The old shape must still open. `to_jsonb(text)` reproduces exactly what
  //    the double encoding used to store: a jsonb string of the JSON text.
  const [before] = await sql`
    select projection::text as projection from room_projections where room_id = ${roomId}`;
  const [beforeState] = await sql`
    select canonical_state::text as canonical_state from games where room_id = ${roomId}`;
  await sql`
    update room_projections set projection = to_jsonb(projection::text)
    where room_id = ${roomId}`;
  await sql`
    update games set canonical_state = to_jsonb(canonical_state::text)
    where room_id = ${roomId}`;
  const legacyTyping = await typeOf();
  if (legacyTyping.projection !== "string" || legacyTyping.canonicalState !== "string") {
    bad("the legacy shape was not reproduced", legacyTyping);
  }
  ok("a pre-fix row was reproduced", legacyTyping);

  const legacyRoom = await readRoom();
  same("a pre-fix row reads identically", legacyRoom, roundTripped);
  ok("the tolerant read still opens a pre-fix row", {
    status: legacyRoom.status,
    round: legacyRoom.game?.turn.round,
  });

  // 6. The migration repairs it, byte for byte, and says nothing new.
  await runMigration0004();
  const migratedTyping = await typeOf();
  if (migratedTyping.projection !== "object" || migratedTyping.canonicalState !== "object") {
    bad("migration 0004 did not re-encode the row", migratedTyping);
  }
  const [after] = await sql`
    select projection::text as projection from room_projections where room_id = ${roomId}`;
  const [afterState] = await sql`
    select canonical_state::text as canonical_state from games where room_id = ${roomId}`;
  same("migration preserved the projection exactly", after?.projection, before?.projection);
  same("migration preserved the canonical state exactly", afterState?.canonical_state, beforeState?.canonical_state);
  same("the migrated row reads identically", await readRoom(), roundTripped);
  ok("migration 0004 repaired the row", migratedTyping);

  // Idempotent: a second run must not touch an already-correct row.
  await runMigration0004();
  same("migration 0004 is idempotent", await typeOf(), migratedTyping);
  same("a second run changed nothing", await readRoom(), roundTripped);
  ok("migration 0004 is idempotent", migratedTyping);

  // 7. Nothing double-encoded is left anywhere on this database.
  const [remaining] = await sql`
    select
      (select count(*)::int from room_projections where jsonb_typeof(projection) = 'string') as projections,
      (select count(*)::int from games where jsonb_typeof(canonical_state) = 'string') as games,
      (select count(*)::int from rooms where jsonb_typeof(custom_rules) = 'string') as custom_rules`;
  ok("double-encoded rows remaining on this database", remaining);

  console.log("\nALL CHECKS PASSED");
} finally {
  await sql`delete from room_projections where room_id = ${roomId}`;
  await sql`delete from games where room_id = ${roomId}`;
  await sql`delete from rooms where id = ${roomId}`;
  for (const id of members) await sql`delete from "user" where id = ${id}`;
  await sql.end();
}
