/**
 * Real-database verification for the lobby ruleset: the `setModeRules` write the
 * new `PUT /api/rooms/:roomId/rules` route performs, and the `room.rules` field
 * the lobby projection now publishes.
 *
 * **Not a vitest test, and it cannot be one.** `apps/server/vitest.config.ts`
 * aliases the `bun` module to a stub (tests/stubs/bun.ts) so `drizzle-orm/bun-sql`
 * is importable under Node at all, which means no test in that suite can open a
 * real connection. So this runs under Bun, against the live `DATABASE_URL`:
 *
 * ```sh
 * bun --env-file=.env.local run apps/server/tests/rooms/verify-lobby-rules.ts
 * ```
 *
 * Three things an in-memory fake structurally cannot check:
 *
 * 1. **A lobby edit really moves `rooms.custom_rules`.** The column is the
 *    authoritative store on read (see postgres-repository.ts's `withColumnRules`),
 *    and the ruleset *also* rides inside the projection blob — so a `save` that
 *    updated only the blob would pass every in-memory test and then silently
 *    serve the old ruleset after a restart. That is a rule change nobody asked
 *    for, and only the real column can show it did not happen.
 * 2. **The published ruleset survives persistence.** `room.rules` is read back
 *    through the snapshot boundary and `parseModeRules`, so this proves the lobby
 *    shows the terms actually stored rather than the object the writer happened to
 *    return.
 * 3. **The host-only and lobby-only guards hold against real rows**, including
 *    after a restart, where the guard has to be re-derived from what Postgres
 *    holds rather than from anything in memory.
 *
 * The HTTP layer above this is covered by `tests/rooms/mode-rules-route.test.ts`,
 * which drives the real Hono router and substitutes only the session — the one
 * thing that cannot be conjured here.
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
import { roomProjection } from "../../src/rooms/service/projections";
import type { RoomService, StoredRoom } from "../../src/rooms/service/types";

const connectionString = process.env["DATABASE_URL"];
if (connectionString === undefined || connectionString.length === 0) {
  console.error("DATABASE_URL is required. Run with: bun --env-file=.env.local run …");
  process.exit(2);
}

const sql = new SQL(connectionString);
const suffix = randomUUID().slice(0, 8);
const roomId = `verify-lobby-room-${suffix}`;
const gameId = `verify-lobby-game-${suffix}`;
const members = [
  `verify-lobby-host-${suffix}`,
  `verify-lobby-second-${suffix}`,
  `verify-lobby-third-${suffix}`,
] as const;

/** The room is created on `mode.quick` and then authored into Marathon's terms. */
const PRESET: ModeRules = deadlineDashModes["mode.quick"].rules;
const AUTHORED: ModeRules = deadlineDashModes["mode.marathon"].rules;

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

function ok(label: string, value: unknown): void {
  console.log(`PASS  ${label}: ${JSON.stringify(value)}`);
}

function bad(label: string, value: unknown): never {
  console.log(`FAIL  ${label}: ${JSON.stringify(value)}`);
  throw new Error(label);
}

/** Key order is not part of the value: Postgres re-orders `jsonb` keys. */
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

function differs(label: string, actual: unknown, unexpected: unknown): void {
  if (canonical(actual) === canonical(unexpected)) bad(label, { actual });
}

/** Bun's `SQL` hands jsonb back as raw text; only this file skips drizzle. */
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
        roomCode: () => `L${suffix.slice(0, 5).toUpperCase()}`,
        gameId: () => createStableId("GameId", gameId),
        commandId: () => createStableId("CommandId", `verify-lobby-command-${suffix}`),
      },
      gameSeed: () => `verify-lobby-seed-${suffix}`,
      turnTimeoutMs: 0,
    }),
  };
}

async function reload(): Promise<StoredRoom> {
  const room = await freshService().repository.get(roomId);
  if (room === null) bad("the room did not survive a restart", room);
  return room;
}

/** The lobby projection as a *joiner* would receive it, over persisted state. */
async function lobbyRules(viewerId: string): Promise<unknown> {
  const bootstrap = await freshService().service.bootstrap({ roomId, viewerId });
  if (!bootstrap.ok) bad("bootstrap", bootstrap.error);
  return bootstrap.value.room.rules;
}

try {
  // rooms.host_user_id references user.id, so real user rows are required first.
  for (const id of members) {
    await sql`
      insert into "user" (id, name, email, email_verified, created_at, updated_at)
      values (${id}, ${id}, ${`${id}@example.invalid`}, false, now(), now())`;
  }

  // 1. A lobby of three on mode.quick, playing its preset.
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

  // The column starts empty: this room has authored nothing.
  const [initial] = await sql`select custom_rules from rooms where id = ${roomId}`;
  if (initial?.custom_rules != null) bad("custom_rules should start NULL", initial);
  same("the lobby publishes the preset", await lobbyRules(members[1]), PRESET);
  ok("lobby before authoring", { rules: "mode.quick preset", column: null });

  // 2. The host authors a ruleset in the lobby — the exact service call the new
  //    PUT /:roomId/rules route makes.
  const before = await reload();
  const set = await freshService().service.setModeRules({
    roomId,
    actorId: members[0],
    rules: AUTHORED,
  });
  if (!set.ok) bad("setModeRules", set.error);
  if (set.value.revision !== before.revision + 1) {
    bad("a ruleset edit must move the revision", {
      before: before.revision,
      after: set.value.revision,
    });
  }
  ok("setModeRules committed", { revision: set.value.revision });

  // 3. The authoritative *column* moved, not just the projection blob.
  const [row] = await sql`select custom_rules from rooms where id = ${roomId}`;
  if (row?.custom_rules == null) bad("rooms.custom_rules was not written", row);
  same("rooms.custom_rules content", columnJson(row.custom_rules), AUTHORED);
  ok("rooms.custom_rules written by a lobby edit", {
    roundsEach: (columnJson(row.custom_rules) as ModeRules).quarters.roundsEach,
  });

  // 4. A restart, then the projection a *joiner* reads. This is the gap that
  //    prompted the field: `mode` still says mode.quick, and the room is not
  //    playing mode.quick's rules.
  const afterRestart = await reload();
  if (afterRestart.modeId !== "mode.quick") bad("modeId after restart", afterRestart.modeId);
  for (const viewer of members) {
    same(`the lobby publishes the authored terms to ${viewer}`, await lobbyRules(viewer), AUTHORED);
  }
  differs("the lobby must not publish the preset's terms", await lobbyRules(members[1]), PRESET);
  ok("the terms in force survive a restart", {
    mode: afterRestart.modeId,
    roundsEach: AUTHORED.quarters.roundsEach,
    presetRoundsEach: PRESET.quarters.roundsEach,
  });

  // 5. Only the ruleset was added. Everything else StoredRoom knows — the whole
  //    canonical game, the event log, the turn clock, the raw authored ruleset
  //    under its storage name — stays out of the lobby payload.
  const keys = Object.keys(roomProjection(afterRestart)).sort();
  same("lobby projection key set", keys, [...PROJECTION_KEYS]);
  for (const forbidden of ["game", "eventSummaries", "turnTimer", "customRules", "hostId", "bots"]) {
    if (Object.hasOwn(roomProjection(afterRestart), forbidden)) {
      bad("the lobby projection leaked a StoredRoom field", forbidden);
    }
  }
  ok("lobby projection publishes the rules and nothing else", keys);

  // 6. Host only, checked against real rows after a restart.
  const notHost = await freshService().service.setModeRules({
    roomId,
    actorId: members[1],
    rules: PRESET,
  });
  if (notHost.ok || notHost.error.code !== "ACTOR_NOT_HOST") bad("non-host edit", notHost);
  same("a refused edit changed nothing", await lobbyRules(members[1]), AUTHORED);
  ok("host only", { code: notHost.error.code });

  // 7. A ruleset the server's own bounds refuse leaves the stored one alone.
  const hostile = JSON.parse(JSON.stringify(AUTHORED)) as Record<string, unknown>;
  hostile["agency"] = { ...(hostile["agency"] as Record<string, unknown>), maxPipAdjust: 99 };
  const refused = await freshService().service.setModeRules({
    roomId,
    actorId: members[0],
    rules: hostile,
  });
  if (refused.ok || refused.error.code !== "INVALID_MODE_RULES") bad("hostile edit", refused);
  same("a refused ruleset changed nothing", await lobbyRules(members[0]), AUTHORED);
  ok("hostile ruleset refused", { code: refused.error.code });

  // 8. Start the match: the ruleset is frozen (§5.9) and the room projection now
  //    reports GameState.rules rather than re-resolving.
  const started = await freshService().service.start({
    roomId,
    actorId: members[0],
    actorKind: "human",
    commandId: `verify-lobby-start-${suffix}`,
  });
  if (!started.ok) bad("start", started.error);
  same("GameState.rules at start", started.value.game.rules, AUTHORED);

  const running = await reload();
  same("the room projection reports the frozen ruleset", roomProjection(running).rules, running.game?.rules);
  same("…which is the authored one", roomProjection(running).rules, AUTHORED);
  ok("frozen into the match", {
    quarters: running.game?.quarters.length,
    winShape: running.game?.rules.winShape,
  });

  // 9. And the lobby edit is refused once the match is running — the guard that
  //    keeps a replay of the stored snapshot reproducible.
  const midMatch = await freshService().service.setModeRules({
    roomId,
    actorId: members[0],
    rules: PRESET,
  });
  if (midMatch.ok || midMatch.error.code !== "ROOM_NOT_OPEN") bad("mid-match edit", midMatch);
  same("the running match still plays what it started under", (await reload()).game?.rules, AUTHORED);
  ok("lobby only", { code: midMatch.error.code });

  console.log("\nALL CHECKS PASSED");
} finally {
  await sql`delete from room_projections where room_id = ${roomId}`;
  await sql`delete from games where room_id = ${roomId}`;
  await sql`delete from rooms where id like ${`${roomId}%`}`;
  for (const id of members) await sql`delete from "user" where id = ${id}`;
  await sql.end();
}
