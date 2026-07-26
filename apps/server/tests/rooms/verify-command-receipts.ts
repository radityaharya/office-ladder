/**
 * Real-database verification for the command endpoint's idempotency store.
 *
 * **Not a vitest test, and it cannot be one.** `apps/server/vitest.config.ts`
 * aliases the `bun` module to a stub (tests/stubs/bun.ts) so that
 * `drizzle-orm/bun-sql` is importable under Node at all — which means no test in
 * that suite can open a real connection. So this runs under Bun, against the live
 * `DATABASE_URL`:
 *
 * ```sh
 * bun --env-file=.env.local run apps/server/tests/rooms/verify-command-receipts.ts
 * ```
 *
 * It exists because of one thing an in-memory fake structurally cannot catch:
 * `command_receipts.game_id` carries a foreign key to `games.id`, and the `games`
 * row for a freshly started match is written by the repository's own save. A
 * receipt written *before* the commit passes every in-memory test and can never
 * succeed against Postgres — the exact foreign-key ordering bug that has already
 * shipped once in this codebase, for exactly this reason.
 *
 * It creates its own throwaway room, users and game, and deletes all of them in a
 * `finally`.
 */
import { randomUUID } from "node:crypto";
import { SQL } from "bun";

import { createStableId } from "@office-ladder/engine";
import { PostgresRoomRepository } from "../../src/rooms/postgres-repository";
import { createRoomService } from "../../src/rooms/service/create-room-service";
import {
  createCommandGateway,
  PostgresCommandReceiptStore,
} from "../../src/routes/commands";

const connectionString = process.env["DATABASE_URL"];
if (connectionString === undefined || connectionString.length === 0) {
  console.error("DATABASE_URL is required. Run with: bun --env-file=.env.local run …");
  process.exit(2);
}

const sql = new SQL(connectionString);
const suffix = randomUUID().slice(0, 8);
const roomId = `verify-room-${suffix}`;
const gameId = `verify-game-${suffix}`;
const members = [
  `verify-host-${suffix}`,
  `verify-second-${suffix}`,
  `verify-third-${suffix}`,
] as const;

function ok(label: string, value: unknown): void {
  console.log(`PASS  ${label}: ${JSON.stringify(value)}`);
}

function bad(label: string, value: unknown): never {
  console.log(`FAIL  ${label}: ${JSON.stringify(value)}`);
  throw new Error(label);
}

const repository = new PostgresRoomRepository();
const roomService = createRoomService({
  repository,
  now: () => new Date().toISOString(),
  ids: {
    roomId: () => roomId,
    roomCode: () => `V${suffix.slice(0, 5).toUpperCase()}`,
    gameId: () => createStableId("GameId", gameId),
    commandId: () => createStableId("CommandId", `verify-command-${suffix}`),
  },
  gameSeed: () => `verify-seed-${suffix}`,
  turnTimeoutMs: 0,
});

const gateway = createCommandGateway({
  roomService,
  repository,
  receipts: new PostgresCommandReceiptStore(),
});

const commandId = `verify-loan-${suffix}`;

function loan(principal: number, expectedRevision: number) {
  return {
    roomId,
    actorId: members[0],
    command: {
      type: "loan.take",
      request: { commandId, expectedRevision, principal },
    },
  } as const;
}

try {
  // rooms.host_user_id references user.id, so real user rows are required first.
  for (const id of members) {
    await sql`
      insert into "user" (id, name, email, email_verified, created_at, updated_at)
      values (${id}, ${id}, ${`${id}@example.invalid`}, false, now(), now())`;
  }

  await roomService.create({
    hostId: members[0],
    playerName: "Host",
    modeId: "mode.marathon",
    capacity: 6,
  });
  await roomService.join({ roomId, actorId: members[1], playerName: "Second" });
  await roomService.join({ roomId, actorId: members[2], playerName: "Third" });
  const started = await roomService.start({
    roomId,
    actorId: members[0],
    actorKind: "human",
    commandId: `verify-start-${suffix}`,
    expectedRevision: 2,
  });
  if (!started.ok) bad("start", started.error);
  const active = started.value.game.turn.activePlayerId;
  if (active !== members[0]) bad("expected the host to be on turn first", active);
  ok("start", { roomRevision: started.value.revision, gameId: started.value.game.gameId });

  // 1. A generic command through the real gateway, the real repository and a real
  //    command_receipts INSERT. This is the foreign-key ordering check.
  const first = await gateway.submit(loan(500, started.value.game.revision));
  if (!first.ok) bad("first submit", first.error);
  ok("first submit", first.value);

  const rows = await sql`
    select command_id, type, status, expected_revision, resulting_revision, response_payload
    from command_receipts where game_id = ${gameId}`;
  if (rows.length !== 1) bad("receipt row count", rows);
  ok("receipt row", rows[0]);

  // 2. The retry. Same id, same body: the original outcome comes back and the
  //    game does not move.
  const replay = await gateway.submit(loan(500, started.value.game.revision));
  if (!replay.ok) bad("replay", replay.error);
  if (!replay.value.replayed) bad("replay flag", replay.value);
  if (replay.value.gameRevision !== first.value.gameRevision) {
    bad("replay revision", { first: first.value, replay: replay.value });
  }
  ok("replay", replay.value);

  const afterReplay = await repository.get(roomId);
  const game = afterReplay?.game;
  if (game == null) bad("room after replay", afterReplay);
  if (game.revision !== first.value.gameRevision) bad("state after replay", game.revision);
  const loans = game.players[members[0]]?.loans ?? [];
  if (loans.length !== 1) bad("loans after replay", loans);
  ok("state after replay", { gameRevision: game.revision, loans: loans.length });

  // 3. The same id carrying a different command is a conflict, not a replay.
  const reused = await gateway.submit(loan(900, first.value.gameRevision));
  if (reused.ok || reused.error.code !== "COMMAND_ID_REUSED") bad("reused id", reused);
  ok("reused id", reused.error);

  const [tally] = await sql`
    select count(*)::int as count from command_receipts where game_id = ${gameId}`;
  ok("receipt rows at end", tally);
  console.log("\nALL CHECKS PASSED");
} finally {
  await sql`delete from command_receipts where game_id = ${gameId}`;
  await sql`delete from room_projections where room_id = ${roomId}`;
  await sql`delete from games where room_id = ${roomId}`;
  await sql`delete from rooms where id = ${roomId}`;
  for (const id of members) await sql`delete from "user" where id = ${id}`;
  await sql.end();
}
