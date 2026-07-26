/**
 * Real-database verification for the mode / custom-ruleset persistence path.
 *
 * **Not a vitest test, and it cannot be one.** `apps/server/vitest.config.ts`
 * aliases the `bun` module to a stub (tests/stubs/bun.ts) so that
 * `drizzle-orm/bun-sql` is importable under Node at all — which means no test in
 * that suite can open a real connection. So this runs under Bun, against the live
 * `DATABASE_URL`:
 *
 * ```sh
 * bun --env-file=.env.local run apps/server/tests/rooms/verify-mode-rules-persistence.ts
 * ```
 *
 * It exists because of three things an in-memory fake structurally cannot check:
 *
 * 1. **`rooms.custom_rules` is really written.** The column shipped in migration
 *    0003 and its own docstring calls itself "the authoritative store for
 *    authored rules", but a repository that never populated it would pass every
 *    in-memory test — the ruleset also rides inside the projection blob, so the
 *    round trip succeeds either way and the column silently stays NULL.
 * 2. **It is really read.** Proved by editing the column behind the
 *    repository's back and watching the next read follow it, which no test that
 *    only writes through the repository can distinguish.
 * 3. **A room actually survives a restart.** Every read here goes through a
 *    freshly constructed repository and service, so nothing is being served out
 *    of a process-local map.
 *
 * It creates its own throwaway room, users and game, and deletes all of them in a
 * `finally`.
 */
import { randomUUID } from "node:crypto";
import { SQL } from "bun";

import { deadlineDashModes } from "@office-ladder/content";
import { createStableId, type ModeRules } from "@office-ladder/engine";
import { PostgresRoomRepository } from "../../src/rooms/postgres-repository";
import { createRoomService } from "../../src/rooms/service/create-room-service";
import { resolveModeRules } from "../../src/rooms/service/game-setup";
import type { RoomService } from "../../src/rooms/service/types";

const connectionString = process.env["DATABASE_URL"];
if (connectionString === undefined || connectionString.length === 0) {
  console.error("DATABASE_URL is required. Run with: bun --env-file=.env.local run …");
  process.exit(2);
}

const sql = new SQL(connectionString);
const suffix = randomUUID().slice(0, 8);
const roomId = `verify-rules-room-${suffix}`;
const gameId = `verify-rules-game-${suffix}`;
const members = [
  `verify-rules-host-${suffix}`,
  `verify-rules-second-${suffix}`,
  `verify-rules-third-${suffix}`,
] as const;

const AUTHORED: ModeRules = deadlineDashModes["mode.standard"].rules;
const PRESET: ModeRules = deadlineDashModes["mode.marathon"].rules;

function ok(label: string, value: unknown): void {
  console.log(`PASS  ${label}: ${JSON.stringify(value)}`);
}

function bad(label: string, value: unknown): never {
  console.log(`FAIL  ${label}: ${JSON.stringify(value)}`);
  throw new Error(label);
}

/**
 * Key order is not part of the value. Postgres stores `jsonb` with its own key
 * ordering, so a state that went through the database comes back with the same
 * fields in a different order — comparing raw `JSON.stringify` output would
 * report that as a difference and it is not one.
 */
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

/**
 * Bun's `SQL` hands a jsonb column back as the raw text it was stored as, unlike
 * drizzle's typed column which parses it. Only this file talks to the database
 * without drizzle, so this is a verification-script detail, not a repository one.
 */
function columnJson(value: unknown): unknown {
  return typeof value === "string" ? JSON.parse(value) : value;
}

/**
 * A brand new repository and service every time, which is the whole point: a
 * restart is exactly "the process-local state is gone and the database is not".
 */
function freshService(): { service: RoomService; repository: PostgresRoomRepository } {
  const repository = new PostgresRoomRepository();
  return {
    repository,
    service: createRoomService({
      repository,
      now: () => new Date().toISOString(),
      ids: {
        roomId: () => roomId,
        roomCode: () => `R${suffix.slice(0, 5).toUpperCase()}`,
        gameId: () => createStableId("GameId", gameId),
        commandId: () => createStableId("CommandId", `verify-rules-command-${suffix}`),
      },
      gameSeed: () => `verify-rules-seed-${suffix}`,
      turnTimeoutMs: 0,
    }),
  };
}

try {
  // rooms.host_user_id references user.id, so real user rows are required first.
  for (const id of members) {
    await sql`
      insert into "user" (id, name, email, email_verified, created_at, updated_at)
      values (${id}, ${id}, ${`${id}@example.invalid`}, false, now(), now())`;
  }

  // 0. The column migration 0003 declares is actually on the live database.
  const [column] = await sql`
    select data_type from information_schema.columns
    where table_schema = 'public' and table_name = 'rooms' and column_name = 'custom_rules'`;
  if (column === undefined) bad("rooms.custom_rules is missing from the database", column);
  ok("rooms.custom_rules exists", column);

  // 1. Create, with a mode and an authored ruleset, through the real service.
  const created = await freshService().service.create({
    hostId: members[0],
    playerName: "Host",
    modeId: "mode.marathon",
    capacity: 6,
    customRules: AUTHORED,
  });
  if (!created.ok) bad("create", created.error);
  ok("create", { room: created.value.id, mode: created.value.modeId });

  // 2. The column — not just the projection blob — carries it.
  const [row] = await sql`select custom_rules from rooms where id = ${roomId}`;
  if (row?.custom_rules == null) bad("rooms.custom_rules was not written", row);
  const stored = columnJson(row.custom_rules) as ModeRules;
  same("rooms.custom_rules content", stored, AUTHORED);
  ok("rooms.custom_rules written", { winShape: stored.winShape });

  // 3. A restart: new repository, new service, nothing cached.
  const afterRestart = await freshService().repository.get(roomId);
  if (afterRestart === null) bad("the room did not survive a restart", afterRestart);
  same("customRules after restart", afterRestart.customRules, AUTHORED);
  if (afterRestart.modeId !== "mode.marathon") bad("modeId after restart", afterRestart.modeId);
  same("resolveModeRules after restart", resolveModeRules(afterRestart), AUTHORED);
  ok("survived a restart", { modeId: afterRestart.modeId, revision: afterRestart.revision });

  // 4. The column is *read*, not merely written. Editing it behind the
  //    repository's back is the only way to tell the two apart: the projection
  //    blob still says `mode.standard`'s ruleset.
  await sql`
    update rooms set custom_rules = ${JSON.stringify(PRESET)}::jsonb where id = ${roomId}`;
  const afterEdit = await freshService().repository.get(roomId);
  same("the column wins over the blob", afterEdit?.customRules, PRESET);
  // `roundsEach` is 4 in the authored ruleset and 6 in the one just written to
  // the column, so this number alone says which of the two was read.
  ok("the column is authoritative", {
    roundsEach: afterEdit?.customRules?.quarters.roundsEach,
    blobRoundsEach: AUTHORED.quarters.roundsEach,
  });

  // 5. The legacy shape: a room written before the column was populated has NULL
  //    there and its ruleset only in the blob. Dropping it would silently return
  //    that room to its mode preset — a rule change nobody asked for.
  await sql`update rooms set custom_rules = null where id = ${roomId}`;
  const afterNull = await freshService().repository.get(roomId);
  same("the blob is the fallback", afterNull?.customRules, AUTHORED);
  ok("legacy rooms keep their ruleset", {
    roundsEach: afterNull?.customRules?.quarters.roundsEach,
  });

  // 6. Start the match and check §5.9: the ruleset is frozen into the state.
  const { service } = freshService();
  await service.join({ roomId, actorId: members[1], playerName: "Second" });
  await service.join({ roomId, actorId: members[2], playerName: "Third" });
  const started = await service.start({
    roomId,
    actorId: members[0],
    actorKind: "human",
    commandId: `verify-rules-start-${suffix}`,
  });
  if (!started.ok) bad("start", started.error);
  same("GameState.rules at start", started.value.game.rules, AUTHORED);
  if (canonical(started.value.game.rules) === canonical(PRESET)) {
    bad("the match started under its mode preset instead of the authored ruleset", PRESET);
  }
  ok("GameState.rules at start", {
    winShape: started.value.game.rules.winShape,
    quarters: started.value.game.quarters.length,
  });

  // 7. And it is still there after another restart — read out of Postgres, which
  //    is what a replay or a second server instance does.
  const reloaded = await freshService().repository.get(roomId);
  same("GameState.rules after restart", reloaded?.game?.rules, AUTHORED);
  if (reloaded?.game?.quarters.length !== AUTHORED.quarters.count) {
    bad("quarters after restart", reloaded?.game?.quarters.length);
  }
  ok("GameState.rules after restart", {
    winShape: reloaded.game?.rules.winShape,
    quarters: reloaded.game?.quarters.length,
  });

  // 8. A hostile ruleset at the create door leaves nothing behind at all: no
  //    room row, no code held in the unique index, no projection.
  const hostile = JSON.parse(JSON.stringify(AUTHORED)) as Record<string, unknown>;
  hostile["agency"] = { ...(hostile["agency"] as Record<string, unknown>), maxPipAdjust: 99 };
  const hostileRoomId = `${roomId}-hostile`;
  const hostileRepository = new PostgresRoomRepository();
  const refused = await createRoomService({
    repository: hostileRepository,
    now: () => new Date().toISOString(),
    ids: {
      roomId: () => hostileRoomId,
      roomCode: () => `H${suffix.slice(0, 5).toUpperCase()}`,
      gameId: () => createStableId("GameId", `${gameId}-hostile`),
      commandId: () => createStableId("CommandId", `verify-rules-hostile-${suffix}`),
    },
    gameSeed: () => `verify-rules-hostile-${suffix}`,
    turnTimeoutMs: 0,
  }).create({
    hostId: members[0],
    playerName: "Host",
    modeId: "mode.marathon",
    capacity: 6,
    customRules: hostile,
  });
  if (refused.ok || refused.error.code !== "INVALID_MODE_RULES") bad("hostile create", refused);
  const [tally] = await sql`
    select count(*)::int as count from rooms where id = ${hostileRoomId}`;
  if (tally?.count !== 0) bad("a refused create left a room behind", tally);
  ok("hostile ruleset refused", { code: refused.error.code, rows: tally.count });

  console.log("\nALL CHECKS PASSED");
} finally {
  await sql`delete from room_projections where room_id = ${roomId}`;
  await sql`delete from games where room_id = ${roomId}`;
  await sql`delete from rooms where id like ${`${roomId}%`}`;
  for (const id of members) await sql`delete from "user" where id = ${id}`;
  await sql.end();
}
