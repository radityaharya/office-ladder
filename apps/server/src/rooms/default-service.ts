import { randomBytes, randomUUID } from "node:crypto";

import { createStableId } from "@office-ladder/engine";
import { InMemoryRoomRepository } from "./in-memory-repository";
import { createRoomService } from "./service/create-room-service";

const roomCodeAlphabet = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";

function createRoomCode(): string {
  return Array.from(randomBytes(6), (byte) => roomCodeAlphabet[byte % roomCodeAlphabet.length])
    .join("")
    .slice(0, 6);
}

export const roomRepository = new InMemoryRoomRepository();

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
});
