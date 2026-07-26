import { randomBytes, randomUUID } from "node:crypto";

import { createStableId } from "@office-ladder/engine";
import { PostgresRoomRepository } from "./postgres-repository";
import { createRoomService } from "./service/create-room-service";
import { TURN_TIMEOUT_MS } from "./turn-timer/configured-timeout";

const roomCodeAlphabet = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";

function createRoomCode(): string {
  return Array.from(randomBytes(6), (byte) => roomCodeAlphabet[byte % roomCodeAlphabet.length])
    .join("")
    .slice(0, 6);
}

// Postgres-backed: rooms survive a restart and work across server
// instances. DATABASE_URL is already mandatory for this process to boot at
// all (better-auth's drizzle adapter requires it too), so there's no
// meaningful in-memory fallback to fall back to.
export const roomRepository = new PostgresRoomRepository();

export const roomService = createRoomService({
  repository: roomRepository,
  now: () => new Date().toISOString(),
  ids: {
    roomId: randomUUID,
    roomCode: createRoomCode,
    gameId: () => createStableId("GameId", randomUUID()),
    commandId: () => createStableId("CommandId", randomUUID()),
  },
  gameSeed: () => randomBytes(32).toString("hex"),
  // Shared with the turn-timeout driver, which enforces exactly what this arms.
  turnTimeoutMs: TURN_TIMEOUT_MS,
});
